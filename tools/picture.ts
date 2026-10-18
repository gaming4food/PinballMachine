// Builds the stage's picture of the table in Blender (blender/README.md): exports the scene (tools/export-scene.ts),
// composes the printed art if it isn't there yet, renders the table without its live parts through the stage's own
// camera, grades it into src/assets/pinball.png, and writes its sidecar src/assets/pinball.json (which table and which
// camera it was made from; tests/picture-test.ts holds the stage to it). Fails if Blender's camera is more than
// MAX_CAMERA_PX off the stage's on the scene's probe points.
// `hero` instead renders the promotional picture (38°, 90 mm, the live parts in) to blender/renders/hero.png and leaves
// src/assets alone; TURNED=<target ids> shows those flip plaques turned in it.
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

const which = process.argv[2] === 'hero' ? 'hero' : 'stage';

/** Runs a program in the repo, its output shown as it comes and kept; rejects if it fails. */
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`> ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => { out += d; process.stdout.write(d); });
    child.stderr.on('data', (d: Buffer) => { out += d; process.stderr.write(d); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

const t0 = Date.now();
const scene = exportScene();
writeFileSync(new URL(`../${SCENE}`, import.meta.url), JSON.stringify(scene, null, 1));
console.log(`wrote ${SCENE}`);

if (!['playfield-art13.png', 'front-art13.png'].every((f) => existsSync(new URL(`../${OUT}/${f}`, import.meta.url)))) {
  await run('python', ['-I', 'blender/compose_art.py', 'blender/art', OUT]);
}

const log = await run(BLENDER, ['-b', '--factory-startup', '--python-exit-code', '1', '--python', 'blender/build_table.py', '--', SCENE, OUT, String(SAMPLES), which]);
const match = /CAMERA MATCH: worst ([\d.]+) px/.exec(log);
if (!match) throw new Error('the build printed no CAMERA MATCH');
if (Number(match[1]) > MAX_CAMERA_PX) throw new Error(`Blender's camera is ${match[1]} px off the stage's (at most ${MAX_CAMERA_PX})`);

if (which === 'hero') {
  mkdirSync(new URL('../blender/renders', import.meta.url), { recursive: true });
  await run('python', ['-I', 'blender/grade.py', `${OUT}/hero.png`, 'blender/renders/hero.png']);
  console.log(`blender/renders/hero.png in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
} else {
  mkdirSync(new URL('../src/assets', import.meta.url), { recursive: true });
  await run('python', ['-I', 'blender/grade.py', `${OUT}/stage.png`, 'src/assets/pinball.png']);
  const png = readFileSync(new URL('../src/assets/pinball.png', import.meta.url));
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (width !== scene.width || height !== scene.height) throw new Error(`the picture is ${width} x ${height}, not ${scene.width} x ${scene.height}`);
  const sidecar = {
    tableHash: createHash('sha256').update(JSON.stringify(TABLE_IN_USE)).digest('hex'),
    camera: { matrix: scene.cameraMatrix, fovY: scene.fovY, viewY: scene.viewY },
    width,
    height,
  };
  writeFileSync(new URL('../src/assets/pinball.json', import.meta.url), `${JSON.stringify(sidecar, null, 2)}\n`);
  console.log(`src/assets/pinball.png and pinball.json (${match[0]}) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
