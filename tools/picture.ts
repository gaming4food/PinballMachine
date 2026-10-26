// Builds the stage's picture of the table in Blender (blender/README.md): exports the scene (tools/export-scene.ts),
// composes the printed art if it isn't there yet, renders the table without its live parts through the stage's own
// camera, grades it into src/assets/pinball.png, and writes its sidecar src/assets/pinball.json (which table and which
// camera it was made from; tests/picture-test.ts holds the stage to it). Fails if Blender's camera is more than
// MAX_CAMERA_PX off the stage's on the scene's probe points, and, for the stage's picture, if Blender's log lacks the
// "GLOW on" line (the build renders without its glare when that fails, and a picture without it must not be committed);
// both before anything is written to src/assets.
// `hero` instead renders the promotional picture (38°, 90 mm, the live parts in) to blender/renders/hero.png and leaves
// src/assets alone; TURNED=<target ids> shows those flip plaques turned in it. Any other argument is refused, so that a
// typo can't render the stage's picture over src/assets/pinball.png.
// Usage: npm run picture [-- hero]   (Blender from BLENDER, else Blender 5.2's usual place)
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TABLE_IN_USE } from '../src/shared/table';
import { exportScene } from './export-scene';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BLENDER = process.env.BLENDER ?? 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const SAMPLES = 256;
const MAX_CAMERA_PX = 0.5;
// Paths handed to Blender and Python, relative to the repo with forward slashes (a backslash before `$` was once eaten
// on the way and wrote the spike's render into a folder named for it).
const SCENE = 'blender/scene.json';
const OUT = 'blender/out';

// No argument is the stage's picture and `hero` the promotional one; anything else is refused before anything is run or
// written (a typo like `heor` would otherwise be a stage render over the committed picture).
const given = process.argv.slice(2);
if (given.length > 1 || (given.length === 1 && given[0] !== 'hero')) {
  console.error(
    `picture: unknown argument ${given.map((a) => JSON.stringify(a)).join(' ')}\n` +
      'usage: npm run picture [-- hero]\n' +
      "  npm run picture          the stage's picture: src/assets/pinball.png and pinball.json\n" +
      '  npm run picture -- hero  the promotional picture: blender/renders/hero.png',
  );
  process.exit(2);
}
const which = given[0] === 'hero' ? 'hero' : 'stage';

/** Runs a program in the repo, its output shown as it comes and kept; rejects if it fails. */
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`> ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => { out += d; process.stdout.write(d); });
    child.stderr.on('data', (d: Buffer) => { out += d; process.stderr.write(d); });
    // A program that isn't there is said so, with how to point at it, rather than as a bare "spawn ... ENOENT".
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') return reject(err);
      reject(new Error(cmd === BLENDER
        ? `Blender was not found at ${BLENDER}: install Blender 5.2, or set the BLENDER environment variable to the full path of its blender.exe`
        : `${cmd} was not found: it must be installed and on the PATH (blender/README.md says what the picture needs)`));
    });
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

const t0 = Date.now();
const scene = exportScene();
writeFileSync(new URL(`../${SCENE}`, import.meta.url), JSON.stringify(scene, null, 1));
console.log(`wrote ${SCENE}`);

if (!['playfield-art15.png', 'front-art15.png'].every((f) => existsSync(new URL(`../${OUT}/${f}`, import.meta.url)))) {
  await run('python', ['-I', 'blender/compose_art.py', 'blender/art', OUT]);
}

const log = await run(BLENDER, ['-b', '--factory-startup', '--python-exit-code', '1', '--python', 'blender/build_table.py', '--', SCENE, OUT, String(SAMPLES), which]);
const match = /CAMERA MATCH: worst ([\d.]+) px/.exec(log);
if (!match) throw new Error('the build printed no CAMERA MATCH');
if (Number(match[1]) > MAX_CAMERA_PX) throw new Error(`Blender's camera is ${match[1]} px off the stage's (at most ${MAX_CAMERA_PX})`);
// The stage's picture has its glare (the compositor's soft glow round the lamps). If that can't be set up the build says
// "GLOW skipped" and renders without it: a picture like that must not be graded into src/assets, let alone committed.
if (which === 'stage' && !/^GLOW on\s*$/m.test(log)) {
  const why = /^GLOW skipped.*$/m.exec(log)?.[0].trim();
  throw new Error(`the stage render has no glare: Blender's log has no "GLOW on" line${why ? ` (it says "${why}")` : ''}; src/assets is untouched`);
}

if (which === 'hero') {
  mkdirSync(new URL('../blender/renders', import.meta.url), { recursive: true });
  await run('python', ['-I', 'blender/grade.py', `${OUT}/hero.png`, 'blender/renders/hero.png']);
  console.log(`blender/renders/hero.png in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
} else {
  mkdirSync(new URL('../src/assets', import.meta.url), { recursive: true });
  await run('python', ['-I', 'blender/grade.py', `${OUT}/stage.png`, 'src/assets/pinball.png']);
  const png = readFileSync(new URL('../src/assets/pinball.png', import.meta.url));
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (width !== scene.renderWidth || height !== scene.renderHeight) throw new Error(`the picture is ${width} x ${height}, not ${scene.renderWidth} x ${scene.renderHeight}`);
  const sidecar = {
    tableHash: createHash('sha256').update(JSON.stringify(TABLE_IN_USE)).digest('hex'),
    camera: { matrix: scene.cameraMatrix, fovY: scene.fovY, viewY: scene.viewY },
    width,
    height,
  };
  writeFileSync(new URL('../src/assets/pinball.json', import.meta.url), `${JSON.stringify(sidecar, null, 2)}\n`);
  console.log(`src/assets/pinball.png and pinball.json (${match[0]}) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
