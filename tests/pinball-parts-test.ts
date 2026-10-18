// Tests the table's live parts (TableParts, stage/pinball-parts.ts) as the stage draws them over the Blender picture: a
// plaque per flip target that turns about its pin when its bit sets, the two drop targets, three flippers and two
// spinners each at its own angle, the lamps' glows by the LIT bits; that the stage's camera, with the parts in the
// table's place (tiltTable), puts the table's probe points on the picture's pixels (tools/export-scene.ts's probes,
// which the Blender build matched its camera to within 0.5 px) and the live parts on them; and that the picture's
// unseen shapes (table-mesh.ts's pictureDepth) hide what the picture hides, and not what it shows. The flippers are drawn
// in the physics' own shape (shared/table.ts FLIPPER_SHAPE), checked against the physics' colliders.
// Usage: npm run pinball-parts-test
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { initPhysics } from '@kit/server';
import { PinballSim } from '../src/server/sim';
import { LIT } from '../src/shared/pinball';
import { FLIPPER_SHAPE, TABLE, TABLE_IN_USE, isLockTarget, type Table } from '../src/shared/table';
// The stage's code loads in Node with its CSS and pictures stubbed (stub-assets.ts).
import './stub-assets';

const { GOLD, TableParts } = await import('../src/stage/pinball-parts');
const { fitStageCamera, tiltTable } = await import('../src/stage/pinball');
const { pictureDepth } = await import('../src/stage/table-mesh');
const { exportScene } = await import('../tools/export-scene');
const { WIDTH, HEIGHT } = await import('@kit/stage');

await initPhysics();

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
  // All at rest first, then plaque 4's bit sets: it turns (not shown turned at once, as at the first look).
  parts.setTargets(0, 0, 0);
  parts.setTargets(0, 1 << 4, 0.05);
  parts.setTargets(0, 1 << 4, 0.1);
  const mid = Math.abs(parts.targets[4].pivot.rotation.y - parts.targets[4].rest);
  assert.ok(mid > 0.05 && mid < Math.PI - 0.05, `plaque 4 is turning: ${mid}`);
  parts.setTargets(0, 1 << 4, 0.25);
  parts.targets.forEach((t, i) => {
    const turn = t.pivot.rotation.y - t.rest;
    if (i === 4) assert.ok(near(Math.abs(turn), Math.PI, 1e-6), `plaque 4 turned ${turn}, not π`);
    else assert.ok(near(turn, 0), `target ${i} moved ${turn} from its rest`);
  });
});

test('a plaque whose bit clears mid-turn turns back from where it is, smoothly (no jump)', () => {
  const parts = new TableParts(TABLE_IN_USE);
  const p = parts.targets[4];
  const turn = () => p.pivot.rotation.y - p.rest;
  parts.setTargets(0, 0, 10);
  parts.setTargets(0, 1 << 4, 10);
  // The largest step the eased turn makes in 0.01 s: π × 1.5 (the ease's steepest) × 0.01 / 0.15.
  const most = (Math.PI * 1.5 * 0.01) / 0.15 + 1e-9;
  let last = turn();
  let t = 10;
  for (let k = 1; k <= 7; k++) {
    t = 10 + k * 0.01;
    parts.setTargets(0, 1 << 4, t);
    assert.ok(Math.abs(turn() - last) <= most, `a jump of ${turn() - last} at ${t.toFixed(2)}`);
    last = turn();
  }
  const atClear = turn();
  assert.ok(atClear > 0.1 && atClear < Math.PI - 0.1, `mid-turn when its bit clears: ${atClear}`);
  parts.setTargets(0, 0, t);
  assert.ok(near(turn(), atClear, 1e-12), `no jump as its bit clears: ${atClear} to ${turn()}`);
  for (let k = 1; k <= 7; k++) {
    parts.setTargets(0, 0, t + k * 0.01);
    assert.ok(turn() <= last + 1e-12, `going back toward rest: ${last} to ${turn()}`);
    assert.ok(last - turn() <= most, `a jump of ${last - turn()} going back`);
    last = turn();
  }
  assert.ok(last < atClear && last > 0, `on its way back: ${last}`);
  parts.setTargets(0, 0, t + 0.2);
  assert.ok(near(turn(), 0, 1e-12), `back at rest: ${turn()}`);
});

test("each flipper is drawn in the physics' shape (shared/table.ts FLIPPER_SHAPE): its far end, its rounds and its height", () => {
  const parts = new TableParts(TABLE_IN_USE);
  const sim = new PinballSim(TABLE_IN_USE, () => {});
  // The physics' flipper colliders, in their own frames (the sim keeps them to itself; read here only).
  const colliders = (sim as unknown as { flippers: { body: { collider(i: number): { vertices(): Float32Array } } }[] }).flippers.map((s) => s.body.collider(0));
  /** The shape's measures in its own frame: its far end, its back, its widest, its height, its tip's round. */
  const measure = (pts: THREE.Vector3[], length: number) => {
    const tipAt = length - FLIPPER_SHAPE.tipRadius;
    return {
      far: Math.max(...pts.map((p) => p.x)),
      back: Math.min(...pts.map((p) => p.x)),
      wide: Math.max(...pts.map((p) => Math.abs(p.z))),
      top: Math.max(...pts.map((p) => p.y)),
      bottom: Math.min(...pts.map((p) => p.y)),
      tip: Math.max(...pts.filter((p) => p.x >= tipAt - 1e-6).map((p) => Math.hypot(p.x - tipAt, p.z))),
    };
  };
  TABLE_IN_USE.flippers.forEach((f, i) => {
    const pos = parts.flippers[i].body.geometry.attributes.position as THREE.BufferAttribute;
    const drawn = measure(Array.from({ length: pos.count }, (_, k) => new THREE.Vector3().fromBufferAttribute(pos, k)), f.length);
    const v = colliders[i].vertices();
    const physics = measure(Array.from({ length: v.length / 3 }, (_, k) => new THREE.Vector3(v[3 * k], v[3 * k + 1], v[3 * k + 2])), f.length);
    for (const key of Object.keys(drawn) as (keyof typeof drawn)[]) {
      assert.ok(near(drawn[key], physics[key], 1e-5), `flipper ${i}'s ${key}: drawn ${drawn[key]}, the physics' ${physics[key]}`);
    }
    assert.ok(near(drawn.far, f.length, 1e-6), `flipper ${i} ends at its length`);
    assert.ok(near(drawn.wide, FLIPPER_SHAPE.baseRadius, 1e-6) && near(drawn.tip, FLIPPER_SHAPE.tipRadius, 1e-6), `flipper ${i}'s rounds`);
    assert.ok(near(drawn.top, FLIPPER_SHAPE.height, 1e-6), `flipper ${i}'s height`);
  });
});

test('a flipper is cream with a gold cap (0.82 of its outline) on its top and a gold pin; the targets, pins and spinners are the one gold', () => {
  const parts = new TableParts(TABLE_IN_USE);
  // The picture's gold, a deep orange gold (see GOLD), with a glow of its own so it reads gold where nothing bright is
  // reflected in it (a mirror gold looking down at the table sees the dark above it and showed black).
  const c = GOLD.color.clone().convertLinearToSRGB();
  assert.ok(c.r > 0.95 && c.g / c.r > 0.5 && c.g / c.r < 0.75 && c.b / c.r < 0.25, `a deep gold: ${c.getHexString()}`);
  assert.ok(GOLD.metalness < 1, 'not a mirror');
  assert.ok(GOLD.emissiveIntensity > 0 && GOLD.emissive.equals(GOLD.color), 'a gold glow of its own');
  for (const { f, body, cap, pin } of parts.flippers) {
    const bodyMat = body.material as THREE.MeshStandardMaterial;
    assert.ok(bodyMat.color.r > 0.8 && bodyMat.color.g > 0.75 && bodyMat.color.b > 0.6, 'a cream body');
    assert.equal(cap.material, GOLD);
    assert.equal(pin.material, GOLD);
    const box = new THREE.Box3().setFromBufferAttribute(cap.geometry.attributes.position as THREE.BufferAttribute);
    assert.ok(near(box.max.x, 0.82 * f.length, 1e-6) && near(box.min.x, -0.82 * FLIPPER_SHAPE.baseRadius, 1e-6), 'the cap is 0.82 of the outline');
    assert.ok(near(box.min.y, FLIPPER_SHAPE.height, 1e-6) && near(box.max.y, FLIPPER_SHAPE.height + 0.03, 1e-6), 'the cap sits on its top');
  }
  for (const t of parts.targets) assert.equal(t.body.material, GOLD, 'a target\'s body is gold');
  const spinnerGold = parts.group.children.filter((c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.CylinderGeometry);
  assert.ok(spinnerGold.length >= 6 && spinnerGold.every((m) => (m as THREE.Mesh).material === GOLD), 'the spinners\' posts and bars are gold');
});

test("the emblems show the art's printed middle (build_table.py's crop: u 0.16 to 0.84, v 0.12 to 0.88), front, back and drop targets", () => {
  const parts = new TableParts(TABLE_IN_USE);
  parts.targets.forEach((t, i) => {
    const faces = t.pivot.children.filter((c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.PlaneGeometry) as THREE.Mesh[];
    assert.equal(faces.length, t.plaque ? 2 : 1, `${TABLE_IN_USE.targets[i].id}: its faces`);
    for (const face of faces) {
      const uv = face.geometry.attributes.uv as THREE.BufferAttribute;
      const us = Array.from({ length: uv.count }, (_, k) => uv.getX(k));
      const vs = Array.from({ length: uv.count }, (_, k) => uv.getY(k));
      assert.ok(near(Math.min(...us), 0.16, 1e-6) && near(Math.max(...us), 0.84, 1e-6), `u ${Math.min(...us)} to ${Math.max(...us)}`);
      assert.ok(near(Math.min(...vs), 0.12, 1e-6) && near(Math.max(...vs), 0.88, 1e-6), `v ${Math.min(...vs)} to ${Math.max(...vs)}`);
    }
  });
});

test('the plaque pictures are 256 × 256 (made from blender/art by blender/plaques.py)', () => {
  const dir = new URL('../src/assets/plaques/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  assert.deepEqual(files, ['ankh-31.png', 'eye-22.png', 'falconplaque-31.png', 'falconplaque-62.png', 'scarab-62.png', 'sundisc-14.png']);
  for (const f of files) {
    const png = readFileSync(new URL(f, dir));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [256, 256], `${f}'s size`);
  }
});

test('the glows are smooth: their map is filtered linearly', () => {
  const parts = new TableParts(TABLE_IN_USE);
  const map = parts.glows[0].material.map!;
  assert.equal(map.magFilter, THREE.LinearFilter);
  assert.equal(map.minFilter, THREE.LinearFilter);
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
  const drops = TABLE_IN_USE.targets.flatMap((t, i) => (isLockTarget(t) ? [i] : []));
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
  // Under the right ramp (in the right orbit lane, at the right spinner), and behind the pyramid's far (upper-left) face,
  // where the scarab drop target stood when the stage could not see it.
  assert.ok(hidden(3.7, R, 10), 'a ball under the right ramp is hidden');
  assert.ok(hidden(-1.195, 0.26, 7.895), "behind the pyramid's far face is hidden");
  // In the open: on the playfield, in the lanes and the inlanes, on the ramps' and the dish's floors.
  for (const [x, y, z] of [[-0.4, R, 1], [-3.65, R, 4.4], [2.75, R, 4.4], [4.6, R, 3], [-0.4, R, 14.05], [-2.4, R, 12.95], [-3.2, 0.44 + R, 10.8], [0.5, 0.795 + R, 14.29], [-3.6, 0.8 + R, 13.8]]) {
    assert.ok(!hidden(x, y, z), `a ball at (${x}, ${y.toFixed(2)}, ${z}) is seen`);
  }
  // The live parts: each flipper along its length (at rest and up), every target (the flip plaques and the two drop
  // targets), the main spinner.
  for (const f of TABLE_IN_USE.flippers) {
    for (const deg of [f.restDeg, f.upDeg]) {
      for (const k of [0, 0.5, 1]) {
        const a = THREE.MathUtils.degToRad(deg);
        assert.ok(!hidden(f.pivot[0] + Math.cos(a) * f.length * k, 0.34, f.pivot[1] + Math.sin(a) * f.length * k), `the ${f.side} flipper at ${f.pivot.join(', ')} is seen`);
      }
    }
  }
  for (const t of TABLE_IN_USE.targets) assert.ok(!hidden(t.x, 0.26, t.z), `${t.id} is seen`);
  assert.ok(!hidden(TABLE_IN_USE.spinner.x, 0.5, TABLE_IN_USE.spinner.z), 'the main spinner is seen');
});

/** A table with only the given walls, flippers and slings (nothing else unseen), for pictureDepth's own cases. */
const bare = (walls: Table['walls'], flippers: Table['flippers'], slings: Table['slings'] = []): Table => ({
  ...TABLE_IN_USE,
  walls,
  flippers,
  slings,
  bumpers: [],
  ramps: [],
  dishes: [],
});
const unseenOf = (t: Table) => pictureDepth(t, TABLE.width, TABLE.length).children.filter((m) => m instanceof THREE.Mesh && m.renderOrder === -1) as THREE.Mesh[];

test("a wall's ends at flippers' pivots are each cut back by exactly 0.35, even when both are", () => {
  const flipper = (x: number): Table['flippers'][number] => ({ side: 'left', pivot: [x, 0], length: 1, restDeg: 0, upDeg: 30 });
  const [box] = unseenOf(bare([{ kind: 'guide', points: [[0, 0], [1, 0]], restitution: 0.3 }], [flipper(0), flipper(1)])).filter(
    (m) => m.geometry instanceof THREE.BoxGeometry,
  );
  assert.ok(box, 'the wall is there');
  const { width, depth } = (box.geometry as THREE.BoxGeometry).parameters;
  // A wall's box is its length and its thickness (table-mesh.ts's segmentBox): 1 - 2 × 0.35 = 0.3 long, in the middle.
  assert.ok(near(width - depth, 0.3, 1e-9), `its length: ${width - depth}`);
  assert.ok(near(box.position.x, 0.5, 1e-9), `its middle: ${box.position.x}`);
});

test("a sling's plastic finds its back wall even when the wall's end differs from the sling's by a hair", () => {
  const s = TABLE_IN_USE.slings[0];
  const back = TABLE_IN_USE.walls.find((w) => w.kind === 'slingback' && w.points[0][0] === s.a[0] && w.points[0][1] === s.a[1])!;
  const nudged = { ...back, points: back.points.map(([x, z], k) => (k === 0 ? [x + 1e-9, z - 1e-9] : [x, z])) as [number, number][] };
  const plastics = unseenOf(bare([nudged], [], [s])).filter((m) => m.geometry instanceof THREE.ExtrudeGeometry);
  assert.equal(plastics.length, 1, "the sling's plastic is there");
  const box = new THREE.Box3().setFromBufferAttribute(plastics[0].geometry.attributes.position as THREE.BufferAttribute);
  // Its back corner is the wall's (back.points[1]), not a guess.
  assert.ok(near(box.min.x, Math.min(s.a[0], s.b[0], back.points[1][0]), 1e-6), `its corner: ${box.min.x}`);
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
