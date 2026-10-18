// Tests the table's live parts (TableParts, stage/pinball-parts.ts) as the stage draws them over the Blender picture: a
// plaque per flip target that turns about its pin when its bit sets, the two drop targets, three flippers and two
// spinners each at its own angle, the lamps' glows by the LIT bits; that the stage's camera, with the parts in the
// table's place (tiltTable), puts the table's probe points on the picture's pixels (tools/export-scene.ts's probes,
// which the Blender build matched its camera to within 0.5 px) and the live parts on them; and that the picture's
// unseen shapes (table-mesh.ts's pictureDepth) hide what the picture hides, and not what it shows.
// Usage: npm run pinball-parts-test
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { LIT } from '../src/shared/pinball';
import { TABLE, TABLE_IN_USE } from '../src/shared/table';
// The stage's code loads in Node with its CSS and pictures stubbed (stub-assets.ts).
import './stub-assets';

const { TableParts } = await import('../src/stage/pinball-parts');
const { fitStageCamera, tiltTable } = await import('../src/stage/pinball');
const { pictureDepth } = await import('../src/stage/table-mesh');
const { exportScene } = await import('../tools/export-scene');
const { WIDTH, HEIGHT } = await import('@kit/stage');

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

test('a plaque per flip target, turning when its bit sets', () => {
  const parts = new TableParts(TABLE_IN_USE);
  const flips = TABLE_IN_USE.targets.flatMap((t, i) => (t.flip ? [i] : []));
  assert.equal(flips.length, 12);
  for (const i of flips) {
    const t = TABLE_IN_USE.targets[i];
    assert.ok(parts.targets[i].plaque, `target ${i} (${t.id}) has a plaque`);
    // Its front faces the play: down the table, toward the flippers.
    const front = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), parts.targets[i].rest);
    assert.ok(front.x * (-0.4 - t.x) + front.z * (2 - t.z) > 0, `${t.id}'s front faces the flippers`);
  }
  parts.setTargets(0, 1 << 4, 0);
  parts.setTargets(0, 1 << 4, 0.2);
  parts.targets.forEach((t, i) => {
    const turn = t.pivot.rotation.y - t.rest;
    if (i === 4) assert.ok(near(Math.abs(turn), Math.PI, 1e-6), `plaque 4 turned ${turn}, not π`);
    else assert.ok(near(turn, 0), `target ${i} moved ${turn} from its rest`);
  });
});

test("a plaque's emblem reads the right way round on the stage (not mirrored by the table's turn into the world)", () => {
  const camera = new THREE.PerspectiveCamera();
  fitStageCamera(camera, WIDTH, HEIGHT);
  const table = tiltTable(new THREE.Group());
  const parts = new TableParts(TABLE_IN_USE);
  table.add(parts.group);
  table.updateMatrixWorld(true);
  for (const i of [1, 4, 8, 11]) {
    // The front emblem: the plane in front of the plaque's body (local z > 0).
    const face = parts.targets[i].pivot.children.find((c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.PlaneGeometry && c.position.z > 0) as THREE.Mesh;
    const pos = face.geometry.attributes.position as THREE.BufferAttribute;
    const uv = face.geometry.attributes.uv as THREE.BufferAttribute;
    const screenX = (k: number) => new THREE.Vector3().fromBufferAttribute(pos, k).applyMatrix4(face.matrixWorld).project(camera).x;
    // The art's left edge (its smallest u) is left of its right edge (its largest u) on the screen.
    let lo = 0;
    let hi = 0;
    for (let k = 0; k < uv.count; k++) {
      if (uv.getX(k) < uv.getX(lo)) lo = k;
      if (uv.getX(k) > uv.getX(hi)) hi = k;
    }
    assert.ok(screenX(lo) < screenX(hi), `${TABLE_IN_USE.targets[i].id}'s emblem is mirrored`);
  }
});

test('a plaque turns over 0.15 s, and back again when its bit clears', () => {
  const parts = new TableParts(TABLE_IN_USE);
  const p = parts.targets[7 + 1]; // target-ankh-1
  assert.ok(p.plaque);
  const turn = () => Math.abs(p.pivot.rotation.y - p.rest);
  parts.setTargets(0, 0, 10);
  parts.setTargets(0, 1 << 8, 10.05);
  parts.setTargets(0, 1 << 8, 10.12);
  assert.ok(turn() > 0.05 && turn() < Math.PI - 0.05, `half way through its turn it is at ${turn()}`);
  parts.setTargets(0, 1 << 8, 10.2);
  assert.ok(near(turn(), Math.PI, 1e-6), `turned: ${turn()}`);
  parts.setTargets(0, 0, 10.3);
  parts.setTargets(0, 0, 10.5);
  assert.ok(near(turn(), 0, 1e-6), `turned back: ${turn()}`);
});

test('the two drop targets are drop targets (no plaque), each with its emblem, and they sink when down', () => {
  const parts = new TableParts(TABLE_IN_USE);
  const drops = TABLE_IN_USE.targets.flatMap((t, i) => (t.flip ? [] : [i]));
  assert.deepEqual(drops.map((i) => TABLE_IN_USE.targets[i].id), ['target-scarab', 'target-eye']);
  for (const i of drops) assert.equal(parts.targets[i].plaque, false);
  parts.setTargets(1 << drops[1], 0, 0);
  for (let k = 0; k < 30; k++) parts.update(1 / 60);
  assert.equal(parts.targets[drops[1]].pivot.visible, false, 'down: out of sight');
  assert.equal(parts.targets[drops[0]].pivot.visible, true, 'the other stays up');
});

test('three flippers and two spinners', () => {
  const parts = new TableParts(TABLE_IN_USE);
  assert.equal(parts.flippers.length, 3);
  assert.equal(parts.spinners.length, 2);
  parts.setFlippers([20, 170, 200]);
  const deg = parts.flippers.map((f) => -THREE.MathUtils.radToDeg(f.mesh.rotation.y));
  [20, 170, 200].forEach((d, i) => assert.ok(near(deg[i], d, 1e-9), `flipper ${i} at ${deg[i]}, not ${d}`));
  // Each at its own pivot: the upper flipper isn't the right one.
  TABLE_IN_USE.flippers.forEach((f, i) => {
    assert.ok(near(parts.flippers[i].mesh.position.x, f.pivot[0]) && near(parts.flippers[i].mesh.position.z, f.pivot[1]), `flipper ${i} at its pivot`);
  });
  parts.setSpinners([0.5, 1.25]);
  assert.ok(near(parts.spinners[0].pivot.rotation.x, 0.5) && near(parts.spinners[1].pivot.rotation.x, 1.25));
  const sp = [TABLE_IN_USE.spinner, ...TABLE_IN_USE.spinners];
  sp.forEach((s, i) => assert.ok(near(parts.spinners[i].pivot.position.x, s.x) && near(parts.spinners[i].pivot.position.z, s.z), `spinner ${i} at its place`));
});

test('the lamps glow by their LIT bits, and a bumper by its flash', () => {
  const parts = new TableParts(TABLE_IN_USE);
  parts.usePicture(true);
  parts.setLit(LIT.centre2 | LIT.rollover0);
  parts.update(0.001);
  const lit = parts.glows.filter((g) => g.material.opacity > 0).map((g) => g.id);
  assert.deepEqual(lit.sort(), ['centre2', 'rollover0']);
  for (const id of ['centre0', 'centre1', 'centre3', 'lock', 'saver']) assert.ok(parts.glows.some((g) => g.id === id), `a ${id} glow`);
  parts.flashBumper('bumper-3');
  parts.update(0.001);
  assert.ok(parts.glows.find((g) => g.id === 'bumper-3')!.material.opacity > 0, 'bumper-3 flashes');
});

test("the stage's camera puts the probe points and the live parts on the picture's pixels (within 3 px)", () => {
  const camera = new THREE.PerspectiveCamera();
  fitStageCamera(camera, WIDTH, HEIGHT);
  const table = tiltTable(new THREE.Group());
  const parts = new TableParts(TABLE_IN_USE);
  table.add(parts.group);
  table.updateMatrixWorld(true);
  const pixel = (p: THREE.Vector3): [number, number] => {
    const q = p.clone().project(camera);
    return [((q.x + 1) / 2) * WIDTH, ((1 - q.y) / 2) * HEIGHT];
  };
  const onTable = (x: number, y: number, z: number) => pixel(new THREE.Vector3(x, y, z).applyMatrix4(table.matrixWorld));
  let worst = 0;
  const check = (what: string, got: [number, number], want: [number, number]) => {
    const err = Math.hypot(got[0] - want[0], got[1] - want[1]);
    worst = Math.max(worst, err);
    assert.ok(err <= 3, `${what}: ${got.map((v) => v.toFixed(1))} vs the picture's ${want.map((v) => v.toFixed(1))} (${err.toFixed(2)} px)`);
  };
  const probes = [...exportScene().pixels];
  const sceneJson = new URL('../blender/scene.json', import.meta.url);
  if (existsSync(sceneJson)) probes.push(...(JSON.parse(readFileSync(sceneJson, 'utf8')) as ReturnType<typeof exportScene>).pixels);
  for (const { table: t, px } of probes) check(`probe ${t.join(', ')}`, onTable(t[0], t[1], t[2]), px);
  const probe = (x: number, y: number, z: number) => probes.find((p) => p.table[0] === x && p.table[1] === y && p.table[2] === z)!.px;
  // The live parts in the table group, at their places: the flippers' pivots, bumper-3's glow (on the playfield).
  const at = (o: THREE.Object3D, y = 0) => {
    const local = o.position.clone();
    local.y = y;
    return pixel(local.applyMatrix4(table.matrixWorld));
  };
  check('the left flipper', at(parts.flippers[0].mesh), probe(-2.1, 0, 2));
  check('the right flipper', at(parts.flippers[1].mesh), probe(1.3, 0, 2));
  check('bumper-3', at(parts.glows.find((g) => g.id === 'bumper-3')!.object), probe(-0.4, 0, 10.7));
  console.log(`      worst: ${worst.toFixed(3)} px over ${probes.length + 3} points`);
});

test("the picture's unseen shapes hide what the picture hides (under the right ramp, behind the pyramid), not what it shows", () => {
  const camera = new THREE.PerspectiveCamera();
  fitStageCamera(camera, WIDTH, HEIGHT);
  const table = tiltTable(new THREE.Group());
  const depth = pictureDepth(TABLE_IN_USE, TABLE.width, TABLE.length);
  table.add(depth);
  table.updateMatrixWorld(true);
  const unseen = depth.children.filter((m) => m instanceof THREE.Mesh && m.renderOrder === -1) as THREE.Mesh[];
  for (const m of unseen) {
    const mat = m.material as THREE.Material;
    assert.equal(mat.colorWrite, false, 'an unseen shape draws only into the depth buffer');
  }
  const catcher = depth.children.find((m) => m instanceof THREE.Mesh && m.material instanceof THREE.ShadowMaterial) as THREE.Mesh | undefined;
  assert.ok(catcher?.receiveShadow, 'a shadow catcher over the playfield');
  const ray = new THREE.Raycaster();
  const hidden = (x: number, y: number, z: number) => {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(table.matrixWorld);
    const dir = p.clone().sub(camera.position);
    const dist = dir.length();
    ray.set(camera.position, dir.normalize());
    return ray.intersectObjects(unseen, false).some((h) => h.distance < dist - 0.02);
  };
  const R = TABLE.ballRadius;
  // Under the right ramp (in the right orbit lane, at the right spinner), and the scarab drop target behind the pyramid.
  assert.ok(hidden(3.7, R, 10), 'a ball under the right ramp is hidden');
  assert.ok(hidden(-1.195, 0.26, 7.895), "the scarab target, behind the pyramid's far face, is hidden");
  // In the open: on the playfield, in the lanes and the inlanes, on the ramps' and the dish's floors.
  for (const [x, y, z] of [[-0.4, R, 1], [-3.65, R, 4.4], [2.75, R, 4.4], [4.6, R, 3], [-0.4, R, 14.05], [-2.4, R, 12.95], [-3.2, 0.44 + R, 10.8], [0.5, 0.795 + R, 14.29], [-3.6, 0.8 + R, 13.8]]) {
    assert.ok(!hidden(x, y, z), `a ball at (${x}, ${y.toFixed(2)}, ${z}) is seen`);
  }
  // The live parts: each flipper along its length (at rest and up), every flip plaque, the main spinner.
  for (const f of TABLE_IN_USE.flippers) {
    for (const deg of [f.restDeg, f.upDeg]) {
      for (const k of [0, 0.5, 1]) {
        const a = THREE.MathUtils.degToRad(deg);
        assert.ok(!hidden(f.pivot[0] + Math.cos(a) * f.length * k, 0.34, f.pivot[1] + Math.sin(a) * f.length * k), `the ${f.side} flipper at ${f.pivot.join(', ')} is seen`);
      }
    }
  }
  for (const t of TABLE_IN_USE.targets) if (t.flip) assert.ok(!hidden(t.x, 0.26, t.z), `${t.id} is seen`);
  assert.ok(!hidden(TABLE_IN_USE.spinner.x, 0.5, TABLE_IN_USE.spinner.z), 'the main spinner is seen');
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(err as Error).message.split('\n').join('\n      ')}`);
  }
}
console.log(failed ? `\n${failed} of ${tests.length} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
