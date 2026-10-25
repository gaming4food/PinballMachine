// Tests the table's live parts (TableParts, stage/pinball-parts.ts) as the stage draws them over the Blender picture: a
// plaque per flip target that turns about its pin when its bit sets, the two drop targets, three flippers and two
// spinners each at its own angle, the lamps' glows by the LIT bits, and the quest's toys (the pop-ups and the mummy
// rising and sinking by their bits, the mummy rocking when hit, the tomb's door and the diverter's gate by the toy
// bits); the lamps the light shows light (every glow, the frame's rail lights as a ring, the ladders), the shows' light
// over the game's, the toys' lamps by their bits, the quest's lasting look and chat's events' (the curse's red pulse on
// the rail lights and arrows, the summoned mummy's blinking lamp), and no glow rising more than 3 times a second,
// whatever lights it, counted in real seconds however fast the host's dt runs; that the stage's camera, with the parts
// in the table's place (tiltTable), puts the table's probe points on the picture's pixels (tools/export-scene.ts's
// probes, which the Blender build matched its camera to within 0.5 px) and the live parts on them, the toys and the new
// lamps where the build draws them; and that the picture's unseen shapes (table-mesh.ts's pictureDepth) hide what the
// picture hides, and not what it shows: a toy up, or a ball the tomb holds at its doorway. The flippers are drawn in
// the physics' own shape (shared/table.ts FLIPPER_SHAPE), checked against the physics' colliders.
// Usage: npm run pinball-parts-test
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DT, initPhysics } from '@kit/server';
import { PinballSim, WALL_HALF } from '../src/server/sim';
import { GOD_COLOR, GODS, LIT, TOY, type God, type PinballCueMsg, type PinballHypeMsg } from '../src/shared/pinball';
import { FLIPPER_SHAPE, TABLE, TABLE_IN_USE, isLockTarget, tombMouth, wallsWithTomb, type Ramp, type Table, type Target } from '../src/shared/table';
import { burst, DARK_BELOW, darken, FLASH_GAP, LIT_ABOVE, LightShowPlayer, type LampLight, type Show, type ShowLamp } from '../src/stage/light-show';
import { PinballShows } from '../src/stage/pinball-shows';
// The stage's code loads in Node with its CSS and pictures stubbed (stub-assets.ts).
import './stub-assets';

const { GOLD, TableParts } = await import('../src/stage/pinball-parts');
const { fitStageCamera, tiltTable } = await import('../src/stage/pinball');
const { pictureDepth } = await import('../src/stage/table-mesh');
const { tableEnvironmentScene } = await import('../src/stage/table-environment');
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

test("the emblems show the art's printed middle (build_table.py's crop: u 0.16 to 0.84, v 0.12 to 0.88), front, back, drop targets and pop-ups; the mummy's face its art's middle (u 0.06 to 0.94, v 0 to 1)", () => {
  const parts = new TableParts(TABLE_IN_USE);
  parts.targets.forEach((t, i) => {
    const spec = TABLE_IN_USE.targets[i];
    const faces = t.pivot.children.filter((c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.PlaneGeometry) as THREE.Mesh[];
    assert.equal(faces.length, t.plaque ? 2 : 1, `${spec.id}: its faces`);
    const [u0, u1, v0, v1] = spec.rise === 'hold' ? [0.06, 0.94, 0, 1] : [0.16, 0.84, 0.12, 0.88];
    for (const face of faces) {
      const uv = face.geometry.attributes.uv as THREE.BufferAttribute;
      const us = Array.from({ length: uv.count }, (_, k) => uv.getX(k));
      const vs = Array.from({ length: uv.count }, (_, k) => uv.getY(k));
      assert.ok(near(Math.min(...us), u0, 1e-6) && near(Math.max(...us), u1, 1e-6), `${spec.id}: u ${Math.min(...us)} to ${Math.max(...us)}`);
      assert.ok(near(Math.min(...vs), v0, 1e-6) && near(Math.max(...vs), v1, 1e-6), `${spec.id}: v ${Math.min(...vs)} to ${Math.max(...vs)}`);
    }
  });
});

test('the plaque pictures are 256 × 256 (made from blender/art by blender/plaques.py)', () => {
  const dir = new URL('../src/assets/plaques/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  assert.deepEqual(files, ['ankh-31.png', 'eye-22.png', 'falconplaque-31.png', 'falconplaque-62.png', 'mummy.png', 'scarab-62.png', 'sundisc-14.png']);
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

test("a plaque's emblem reads the right way round on the stage (not mirrored by the table's turn into the world), and so do the toys' faces", () => {
  const camera = new THREE.PerspectiveCamera();
  fitStageCamera(camera, WIDTH, HEIGHT);
  const table = tiltTable(new THREE.Group());
  const parts = new TableParts(TABLE_IN_USE);
  // The toys up, so their faces are where they're seen.
  parts.setTargets(0, 0, 0);
  parts.setToys(0);
  table.add(parts.group);
  table.updateMatrixWorld(true);
  /** The art's left edge (its smallest u) is left of its right edge (its largest u) on the screen. */
  const readsRight = (face: THREE.Mesh, what: string) => {
    const pos = face.geometry.attributes.position as THREE.BufferAttribute;
    const uv = face.geometry.attributes.uv as THREE.BufferAttribute;
    const screenX = (k: number) => new THREE.Vector3().fromBufferAttribute(pos, k).applyMatrix4(face.matrixWorld).project(camera).x;
    let lo = 0;
    let hi = 0;
    for (let k = 0; k < uv.count; k++) {
      if (uv.getX(k) < uv.getX(lo)) lo = k;
      if (uv.getX(k) > uv.getX(hi)) hi = k;
    }
    assert.ok(screenX(lo) < screenX(hi), `${what} is mirrored`);
  };
  const toys = TABLE_IN_USE.targets.flatMap((t, i) => (t.rise ? [i] : []));
  assert.equal(toys.length, 4);
  for (const i of [1, 4, 8, 11, ...toys]) {
    // The front emblem: the plane in front of the plaque's body (local z > 0).
    const face = parts.targets[i].pivot.children.find((c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.PlaneGeometry && c.position.z > 0) as THREE.Mesh;
    readsRight(face, `${TABLE_IN_USE.targets[i].id}'s emblem`);
  }
  assert.ok(parts.door, 'the tomb has a door');
  readsRight(parts.door.seal, "the tomb door's seal");
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

/** The quest's rising targets (the pop-ups and the mummy), by their places in the table's targets, and their bits. */
const RISING_AT = TABLE_IN_USE.targets.flatMap((t, i) => (t.rise ? [i] : []));
const RISING = RISING_AT.reduce((bits, i) => bits | (1 << i), 0);

/**
 * A target's way along its face (u) and out of its front (n), as build_table.py's target_frame stands one at its own
 * angle (each toy has one): its front toward the flippers, the table's middle line 2 up the table.
 */
function frameOf(t: Target): { u: [number, number]; n: [number, number] } {
  assert.ok(t.angle !== undefined, `${t.id} stands at its own angle`);
  const a = THREE.MathUtils.degToRad(t.angle);
  const u: [number, number] = [Math.cos(a), Math.sin(a)];
  const n: [number, number] = [-u[1], u[0]];
  return { u, n: n[0] * (-0.4 - t.x) + n[1] * (2 - t.z) < 0 ? [-n[0], -n[1]] : n };
}

/**
 * The tomb's doorway as build_table.py carves it and hangs its door there, worked out here from tombMouth and the jambs
 * wallsWithTomb adds: the jambs' faces (x0, x1), the shut door's face (front, a wall's half thickness in front of the
 * mouth's line), the pocket's far face (back), the mouth's line, and its height (the walls', the physics' door's).
 */
function doorwayOf() {
  const mouth = tombMouth(TABLE_IN_USE)!;
  const jamb = wallsWithTomb(TABLE_IN_USE).find((w) => w.kind === 'tomb')!;
  return {
    x0: Math.min(mouth.a[0], mouth.b[0]) + WALL_HALF,
    x1: Math.max(mouth.a[0], mouth.b[0]) - WALL_HALF,
    front: mouth.a[1] - WALL_HALF,
    back: jamb.points[1][1] - WALL_HALF,
    mouth: mouth.a[1],
    height: TABLE.wallTop,
  };
}

/**
 * The diverter, its ramp, and the floor its gate stands on: the height at the gap's end nearer its hinge
 * (build_table.py's GATE_Y).
 */
function gateOf() {
  const dv = TABLE_IN_USE.diverter!;
  const ramp = TABLE_IN_USE.ramps.find((r) => r.id === dv.ramp)!;
  const { from, to } = ramp.opening!;
  const off = (k: number) => Math.hypot(ramp.path[k][0] - dv.pivot[0], ramp.path[k][1] - dv.pivot[1]);
  return { dv, ramp, floor: ramp.path[off(from) < off(to) ? from : to][2] };
}

/** The stage's camera, and the table placed as the stage places it, the picture's unseen shapes and `parts` in it. */
function onStage(parts?: InstanceType<typeof TableParts>) {
  const camera = new THREE.PerspectiveCamera();
  fitStageCamera(camera, WIDTH, HEIGHT);
  const table = tiltTable(new THREE.Group());
  const depth = pictureDepth(TABLE_IN_USE, TABLE.width, TABLE.length);
  table.add(depth);
  if (parts) table.add(parts.group);
  table.updateMatrixWorld(true);
  const unseen = depth.children.filter((m) => m instanceof THREE.Mesh && m.renderOrder === -1) as THREE.Mesh[];
  const ray = new THREE.Raycaster();
  /** Whether an unseen shape stands between the camera and p, a point in the world. */
  const hiddenAt = (p: THREE.Vector3) => {
    const dir = p.clone().sub(camera.position);
    const dist = dir.length();
    ray.set(camera.position, dir.normalize());
    return ray.intersectObjects(unseen, false).some((h) => h.distance < dist - 0.02);
  };
  const world = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(table.matrixWorld);
  return { camera, world, unseen, hiddenAt, hidden: (x: number, y: number, z: number) => hiddenAt(world(x, y, z)) };
}

test('the pop-ups and the mummy start down and rise by their bits', () => {
  assert.deepEqual(RISING_AT.map((i) => TABLE_IN_USE.targets[i].id), ['target-popup-1', 'target-popup-2', 'target-popup-3', 'target-mummy']);
  const [, popup2, , mummy] = RISING_AT;
  const parts = new TableParts(TABLE_IN_USE);
  const shown = (i: number) => parts.targets[i].pivot.visible;
  const height = (i: number) => parts.targets[i].pivot.position.y;
  // Drawn down from the first, and kept down with no header yet: none stands up in the page's first frames.
  for (const i of RISING_AT) assert.equal(shown(i), false, `${TABLE_IN_USE.targets[i].id} starts out of sight`);
  for (let k = 0; k < 30; k++) parts.update(1 / 60);
  for (const i of RISING_AT) assert.equal(shown(i), false, `${TABLE_IN_USE.targets[i].id} stays down with no header`);
  for (const i of TABLE_IN_USE.targets.flatMap((t, k) => (isLockTarget(t) ? [k] : []))) assert.ok(shown(i) && height(i) === 0, 'the drop targets start up');
  // The first header, with them down: still down.
  parts.setTargets(RISING, 0, 0);
  parts.update(1 / 60);
  for (const i of RISING_AT) assert.equal(shown(i), false);
  // A page opening on them up shows them up at once, not rising.
  const opened = new TableParts(TABLE_IN_USE);
  opened.setTargets(0, 0, 0);
  for (const i of RISING_AT) assert.ok(opened.targets[i].pivot.visible && opened.targets[i].pivot.position.y === 0, `${TABLE_IN_USE.targets[i].id} up at once`);
  // The second pop-up's bit clears: it rises as the drop targets move (0.56 at 6 a second); the rest stay down.
  parts.setTargets(RISING & ~(1 << popup2), 0, 1);
  parts.update(0.05);
  assert.ok(shown(popup2) && near(height(popup2), -0.26, 1e-9), `pop-up 2 on its way up: ${height(popup2)}`);
  parts.update(0.1);
  assert.equal(height(popup2), 0, 'pop-up 2 up');
  for (const i of RISING_AT) if (i !== popup2) assert.equal(shown(i), false, `${TABLE_IN_USE.targets[i].id} stays down`);
  // The mummy rises over 0.6 s (it's 0.95 tall), and sinks as slowly.
  const mh = TABLE_IN_USE.targets[mummy].height!;
  parts.setTargets(RISING & ~(1 << popup2) & ~(1 << mummy), 0, 2);
  parts.update(0.3);
  assert.ok(shown(mummy) && Math.abs(height(mummy) + mh / 2) < 0.05, `the mummy halfway up after 0.3 s: ${height(mummy)}`);
  parts.update(0.29);
  assert.ok(height(mummy) < 0, `not up before 0.6 s: ${height(mummy)}`);
  parts.update(0.02);
  assert.equal(height(mummy), 0, 'the mummy up after 0.6 s');
  parts.setTargets(RISING & ~(1 << popup2), 0, 3);
  parts.update(0.3);
  assert.ok(shown(mummy) && Math.abs(height(mummy) + mh / 2) < 0.05, `the mummy halfway down after 0.3 s: ${height(mummy)}`);
  parts.update(0.31);
  assert.equal(shown(mummy), false, 'the mummy down after 0.6 s, out of sight');
  // A fresh hello: the next header's are shown as they are, at once.
  parts.reset();
  parts.setTargets(RISING & ~(1 << mummy), 0, 0);
  assert.ok(shown(mummy) && height(mummy) === 0, 'the mummy up at once');
  assert.equal(shown(popup2), false, 'pop-up 2 down at once');
});

test('the mummy rocks away from the ball that hits it, from in front or behind, and settles', () => {
  const mummy = RISING_AT[3];
  const t = TABLE_IN_USE.targets[mummy];
  const { n } = frameOf(t);
  const parts = new TableParts(TABLE_IN_USE);
  parts.setTargets(RISING & ~(1 << mummy), 0, 0);
  const pivot = parts.targets[mummy].pivot;
  /** How far the mummy's top has moved out of its front (toward the play), from over its middle. */
  const lean = () => {
    parts.group.updateMatrixWorld(true);
    const top = pivot.localToWorld(new THREE.Vector3(0, t.height!, 0));
    return (top.x - t.x) * n[0] + (top.z - t.z) * n[1];
  };
  /** A ball touching the mummy's front (side 1) or its back (side -1), a little along its face from its middle. */
  const ball = (side: number) => {
    const d = side * (TABLE.ballRadius + (t.depth ?? 0.2) / 2 + 0.02);
    const u = [Math.cos(THREE.MathUtils.degToRad(t.angle!)), Math.sin(THREE.MathUtils.degToRad(t.angle!))];
    return { id: 1, x: t.x + n[0] * d + u[0] * 0.2, z: t.z + n[1] * d + u[1] * 0.2 };
  };
  assert.ok(near(lean(), 0, 1e-9), `upright: ${lean()}`);
  for (const [side, from] of [[1, 'in front'], [-1, 'behind']] as const) {
    parts.rockMummy(ball(side));
    let most = 0;
    for (let k = 0; k < 12; k++) {
      parts.update(1 / 60);
      if (Math.abs(lean()) > Math.abs(most)) most = lean();
    }
    // Its top goes first to the side away from the ball: back, away from the play, for a ball in front, and forward
    // for one behind it.
    assert.ok(-side * most > 0.04, `hit from ${from}, it rocked away from the ball: its top went ${most.toFixed(3)} out of its front`);
    for (let k = 0; k < 90; k++) parts.update(1 / 60);
    assert.ok(Math.abs(lean()) < 1e-3, `hit from ${from}, it settled upright: ${lean()}`);
  }
  const base = pivot.localToWorld(new THREE.Vector3());
  assert.ok(near(base.x, t.x, 1e-9) && near(base.y, 0, 1e-9) && near(base.z, t.z, 1e-9), 'standing on its slot');
});

test('the door and the gate follow the toy bits', () => {
  const parts = new TableParts(TABLE_IN_USE);
  const { door, gate } = parts;
  assert.ok(door && gate, 'the table has a tomb and a diverter');
  const { dv } = gateOf();
  const H = TABLE.wallTop;
  const lift = () => door.group.position.y;
  const deg = () => -THREE.MathUtils.radToDeg(gate.pivot.rotation.y);
  // Before any header: shut and at rest.
  assert.ok(lift() === 0 && door.group.visible, 'shut');
  assert.ok(near(deg(), dv.restDeg, 1e-9), `at rest: ${deg()}`);
  // A page opening on the tomb open and the gate over shows them so at once.
  parts.setToys(TOY.tombOpen | TOY.diverterOver);
  assert.ok(near(lift(), H, 1e-9) && !door.group.visible, `open at once: slid up out of sight (${lift()})`);
  assert.ok(near(deg(), dv.overDeg, 1e-9), `over at once: ${deg()}`);
  // Shut, the door slides down over 0.3 s; at rest, the gate swings back at 400 degrees a second.
  parts.setToys(0);
  parts.update(0.1);
  assert.ok(door.group.visible && near(lift(), (H * 2) / 3, 1e-9), `a third of the way down: ${lift()}`);
  assert.ok(near(deg(), dv.overDeg + 40, 1e-9), `40 degrees back: ${deg()}`);
  parts.update(0.1);
  parts.update(0.11);
  assert.ok(lift() === 0 && near(deg(), dv.restDeg, 1e-9), `shut and at rest: ${lift()}, ${deg()}`);
  // Open, it slides up over 0.3 s, out of sight at the top. The tomb's bit alone moves only the door.
  parts.setToys(TOY.tombOpen);
  parts.update(0.15);
  assert.ok(door.group.visible && near(lift(), H / 2, 1e-9), `halfway up: ${lift()}`);
  parts.update(0.16);
  assert.ok(near(lift(), H, 1e-9) && !door.group.visible, `up, out of sight: ${lift()}`);
  assert.ok(near(deg(), dv.restDeg, 1e-9), 'the gate stays at rest');
  // A fresh hello: the next header's shown as they are, at once.
  parts.reset();
  parts.setToys(TOY.diverterOver);
  assert.ok(lift() === 0 && door.group.visible && near(deg(), dv.overDeg, 1e-9), 'shut and over at once');
});

test("the drawn gate is the physics': on its ramp's floor at its hinge, as long as it, as tall as the rails, and swinging with it", () => {
  const { dv, ramp } = gateOf();
  const sim = new PinballSim(TABLE_IN_USE, () => {});
  const physics = (sim as unknown as { diverter: { angle: number; y: number } }).diverter;
  const parts = new TableParts(TABLE_IN_USE);
  const gate = parts.gate!;
  parts.setToys(0);
  const at = gate.pivot.position;
  assert.ok(near(at.x, dv.pivot[0]) && near(at.y, physics.y) && near(at.z, dv.pivot[1]), `its hinge at (${at.x}, ${at.y}, ${at.z})`);
  const { width, height, depth } = (gate.body.geometry as THREE.BoxGeometry).parameters;
  assert.ok(near(width, dv.length) && near(height, ramp.rail) && near(depth, 2 * WALL_HALF), `its size: ${width} × ${height} × ${depth}`);
  assert.ok(near(gate.body.position.x, dv.length / 2) && near(gate.body.position.y, ramp.rail / 2) && near(gate.body.position.z, 0), 'out from its hinge, standing on the floor');
  const drawn = () => -THREE.MathUtils.radToDeg(gate.pivot.rotation.y);
  for (const over of [true, false]) {
    assert.ok(sim.setDiverter(over));
    parts.setToys(over ? TOY.diverterOver : 0);
    for (let k = 1; k <= 12; k++) {
      sim.step();
      parts.update(DT);
      assert.ok(near(drawn(), physics.angle, 1e-6), `${over ? 'over' : 'back'}, step ${k}: drawn ${drawn()}, the physics' ${physics.angle}`);
    }
    assert.ok(near(drawn(), over ? dv.overDeg : dv.restDeg, 1e-9));
  }
});

test('every toy is seen when up', () => {
  const parts = new TableParts(TABLE_IN_USE);
  parts.setTargets(0, 0, 0);
  parts.setToys(0);
  const { hidden } = onStage(parts);
  // The pop-ups and the mummy: across their fronts, from their feet to their tops, and along their tops.
  for (const i of RISING_AT) {
    const t = TABLE_IN_USE.targets[i];
    const { u, n } = frameOf(t);
    const hw = t.width / 2 - 0.03;
    const hd = (t.depth ?? 0.2) / 2;
    const h = t.height ?? 0.52;
    for (const along of [-hw, 0, hw]) {
      for (const [out, y] of [[hd, 0.05], [hd, h / 2], [hd, h - 0.02], [0, h - 0.01], [-hd + 0.02, h - 0.01]]) {
        const x = t.x + u[0] * along + n[0] * out;
        const z = t.z + u[1] * along + n[1] * out;
        assert.ok(!hidden(x, y, z), `${t.id} at (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}) is seen`);
      }
    }
  }
  // The tomb's door, shut: its front across the doorway.
  const d = doorwayOf();
  for (const x of [d.x0 + 0.03, (d.x0 + d.x1) / 2, d.x1 - 0.03]) {
    for (const y of [0.05, d.height / 2, d.height - 0.05]) assert.ok(!hidden(x, y, d.front - 0.005), `the door at (${x.toFixed(2)}, ${y.toFixed(2)}) is seen`);
  }
  // The diverter's gate, at rest and over: along its top and its middle (the left ramp, a wireform with clear sides,
  // hides nothing).
  const { dv, ramp, floor } = gateOf();
  for (const deg of [dv.restDeg, dv.overDeg]) {
    const a = THREE.MathUtils.degToRad(deg);
    for (const k of [0.1, 0.5, 0.95]) {
      for (const y of [floor + ramp.rail - 0.02, floor + ramp.rail / 2]) {
        assert.ok(!hidden(dv.pivot[0] + Math.cos(a) * dv.length * k, y, dv.pivot[1] + Math.sin(a) * dv.length * k), `the gate at ${deg} degrees, ${k} along, ${y.toFixed(2)} up, is seen`);
      }
    }
  }
});

test("the door, slid up into the pyramid, is out of sight; shut, its ends are behind the doorway's pillars", () => {
  const { hidden } = onStage();
  const d = doorwayOf();
  // The risen door's front (from the doorway's top up as far again) and its top.
  for (const x of [d.x0 - 0.01, (d.x0 + d.x1) / 2, d.x1 + 0.01]) {
    for (const y of [d.height + 0.02, d.height * 1.5, 2 * d.height - 0.02]) assert.ok(hidden(x, y, d.front), `its front at (${x.toFixed(2)}, ${y.toFixed(2)}) is hidden`);
    for (const z of [d.front + 0.02, d.mouth, d.mouth + WALL_HALF - 0.02]) assert.ok(hidden(x, 2 * d.height, z), `its top at (${x.toFixed(2)}, ${z.toFixed(2)}) is hidden`);
  }
  // Shut, it reaches into the pillars each side of the doorway, which stand in front of it in the picture.
  for (const x of [d.x0 - 0.01, d.x1 + 0.01]) {
    for (const y of [0.05, d.height / 2, d.height - 0.05]) assert.ok(hidden(x, y, d.front + 0.01), `its end at (${x.toFixed(2)}, ${y.toFixed(2)}) is hidden`);
  }
});

test('a ball held in the tomb is seen', () => {
  const { camera, world, unseen } = onStage();
  const R = TABLE.ballRadius;
  const [x, z] = TABLE_IN_USE.tomb!.held;
  const ball = new THREE.Sphere(world(x, R, z), R);
  // Every pixel of the stage's frame the ball covers: the ray through it meets the ball before any unseen shape.
  const centre = ball.center.clone().project(camera);
  const [cx, cy] = [((centre.x + 1) / 2) * WIDTH, ((1 - centre.y) / 2) * HEIGHT];
  const ray = new THREE.Raycaster();
  const at = new THREE.Vector3();
  let covered = 0;
  const hidden: string[] = [];
  for (let py = Math.floor(cy - 40); py <= cy + 40; py++) {
    for (let px = Math.floor(cx - 40); px <= cx + 40; px++) {
      ray.setFromCamera(new THREE.Vector2(((px + 0.5) / WIDTH) * 2 - 1, 1 - ((py + 0.5) / HEIGHT) * 2), camera);
      if (!ray.ray.intersectSphere(ball, at)) continue;
      covered++;
      const meets = at.distanceTo(ray.ray.origin);
      if (ray.intersectObjects(unseen, false).some((h) => h.distance < meets - 1e-4)) hidden.push(`(${px}, ${py})`);
    }
  }
  assert.ok(covered > 300, `the ball covers ${covered} pixels`);
  assert.deepEqual(hidden, [], `of the ${covered} pixels the held ball covers, these are hidden`);
});

test("the live toys sit where the picture's build draws them, on its pixels (within 3 px), with its art", () => {
  // The picture's camera, as tools/export-scene.ts hands it to the build (which matched its own camera to it).
  const scene = exportScene();
  const pictureCamera = new THREE.PerspectiveCamera(scene.fovY, scene.width / scene.height, 0.5, 200);
  pictureCamera.matrixAutoUpdate = false;
  pictureCamera.matrixWorld.fromArray(scene.cameraMatrix);
  pictureCamera.matrixWorldInverse.copy(pictureCamera.matrixWorld).invert();
  pictureCamera.setViewOffset(scene.width, scene.height, 0, scene.viewY, scene.width, scene.height);
  const tableMatrix = new THREE.Matrix4().fromArray(scene.tableMatrix);
  const pixel = (p: THREE.Vector3, camera: THREE.Camera): [number, number] => {
    const q = p.clone().project(camera);
    return [((q.x + 1) / 2) * WIDTH, ((1 - q.y) / 2) * HEIGHT];
  };
  const onPicture = (pts: [number, number, number][]) => pts.map(([x, y, z]) => pixel(new THREE.Vector3(x, y, z).applyMatrix4(tableMatrix), pictureCamera));
  // The live parts through the stage's camera: the toys up, the door shut, the gate at rest, as the build draws them.
  const camera = new THREE.PerspectiveCamera();
  fitStageCamera(camera, WIDTH, HEIGHT);
  const table = tiltTable(new THREE.Group());
  const parts = new TableParts(TABLE_IN_USE);
  parts.setTargets(0, 0, 0);
  parts.setToys(0);
  table.add(parts.group);
  table.updateMatrixWorld(true);
  /** The corners of every mesh under `o` (its box's, or its face's), in the table's own coordinates. */
  const drawn = (o: THREE.Object3D) => {
    const out: THREE.Vector3[] = [];
    const toTable = new THREE.Matrix4().copy(table.matrixWorld).invert();
    o.traverse((m) => {
      if (!(m instanceof THREE.Mesh)) return;
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox!;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push(new THREE.Vector3(x, y, z).applyMatrix4(m.matrixWorld).applyMatrix4(toTable));
    });
    return out;
  };
  let worst = 0;
  let count = 0;
  /**
   * Each corner the build draws has one drawn on its pixel (within 3 px) and at its place in the table, and each one
   * drawn is as near one the build draws. The drawn corners go through the stage's camera, the build's through the
   * picture's.
   */
  const same = (what: string, got: THREE.Vector3[], want: [number, number, number][]) => {
    const onStageFrame = got.map((p) => pixel(p.clone().applyMatrix4(table.matrixWorld), camera));
    const wanted = want.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const gap = (p: [number, number], set: [number, number][]) => Math.min(...set.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
    for (const [from, to, says] of [[onPicture(want), onStageFrame, "the build's"], [onStageFrame, onPicture(want), 'a drawn']] as const) {
      for (const p of from) {
        const e = gap(p, to);
        worst = Math.max(worst, e);
        count++;
        assert.ok(e <= 3, `${what}: ${says} corner at (${p[0].toFixed(1)}, ${p[1].toFixed(1)}) is ${e.toFixed(2)} px from the nearest of the other`);
      }
    }
    const off = (p: THREE.Vector3, set: THREE.Vector3[]) => Math.min(...set.map((q) => q.distanceTo(p)));
    for (const p of wanted) assert.ok(off(p, got) < 1e-6, `${what}: nothing drawn at the build's corner (${p.toArray().map((v) => v.toFixed(3))})`);
    for (const p of got) assert.ok(off(p, wanted) < 1e-6, `${what}: a corner drawn at (${p.toArray().map((v) => v.toFixed(3))}), where the build has none`);
  };
  /** build_table.py's target_box: `hw` each way along a target's face and `hd` across it, from y0 to y1. */
  const box = (t: Target, hw: number, hd: number, y0: number, y1: number) => {
    const { u, n } = frameOf(t);
    const pts: [number, number, number][] = [];
    for (const a of [-hw, hw]) for (const o of [-hd, hd]) for (const y of [y0, y1]) pts.push([t.x + u[0] * a + n[0] * o, y, t.z + u[1] * a + n[1] * o]);
    return pts;
  };
  /** build_table.py's facing_quad on a target's front: `e` each way along it, just in front of its face, y0 to y1. */
  const front = (t: Target, e: number, hd: number, y0: number, y1: number) => {
    const { u, n } = frameOf(t);
    const pts: [number, number, number][] = [];
    for (const a of [-e, e]) for (const y of [y0, y1]) pts.push([t.x + u[0] * a + n[0] * (hd + 0.003), y, t.z + u[1] * a + n[1] * (hd + 0.003)]);
    return pts;
  };
  /** The art a face shows (its texture's name is its picture's file). */
  const artOf = (face: THREE.Mesh) => ((face.material as THREE.MeshStandardMaterial).map?.name ?? '').split('/').pop();
  for (const i of RISING_AT) {
    const t = TABLE_IN_USE.targets[i];
    const hw = t.width / 2;
    const hd = (t.depth ?? 0.2) / 2;
    const h = t.height ?? 0.52;
    const want =
      t.rise === 'hold'
        ? [...box(t, hw, hd, 0, h - 0.07), ...box(t, hw + 0.02, hd + 0.02, h - 0.07, h), ...front(t, hw - 0.05, hd, 0.05, h - 0.11)]
        : [...box(t, hw, hd, 0, h), ...front(t, hw - 0.04, hd, 0.06, h - 0.04)];
    same(t.id, drawn(parts.targets[i].pivot), want);
    const face = parts.targets[i].pivot.children.find((c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.PlaneGeometry) as THREE.Mesh;
    assert.equal(artOf(face), t.rise === 'hold' ? 'mummy.png' : 'falconplaque-62.png', `${t.id}'s art`);
  }
  // The tomb's door, shut: a slab across the doorway from the door's face back to the mouth's line and as far again,
  // tucked 0.02 into the pillars each side, with its scarab seal on its front.
  const d = doorwayOf();
  const xm = (d.x0 + d.x1) / 2;
  const s = (d.x1 - d.x0) / 2 - 0.05;
  const ym = d.height * 0.55;
  const door: [number, number, number][] = [];
  for (const x of [d.x0 - 0.02, d.x1 + 0.02]) for (const y of [0, d.height]) for (const z of [d.front, d.mouth + WALL_HALF]) door.push([x, y, z]);
  for (const x of [xm - s, xm + s]) for (const y of [ym - s, ym + s]) door.push([x, y, d.front - 0.003]);
  same("the tomb's door", drawn(parts.door!.group), door);
  assert.equal(artOf(parts.door!.seal), 'scarab-62.png', "the door's seal");
  // The diverter's gate, at rest: out from its hinge along the gap, a wall thick, from the floor as tall as the rails.
  const { dv, ramp, floor } = gateOf();
  const [ux, uz] = [Math.cos(THREE.MathUtils.degToRad(dv.restDeg)), Math.sin(THREE.MathUtils.degToRad(dv.restDeg))];
  const gate: [number, number, number][] = [];
  for (const k of [0, dv.length]) {
    for (const side of [-1, 1]) for (const y of [floor, floor + ramp.rail]) gate.push([dv.pivot[0] + ux * k + side * uz * WALL_HALF, y, dv.pivot[1] + uz * k - side * ux * WALL_HALF]);
  }
  same("the diverter's gate", drawn(parts.gate!.pivot), gate);
  console.log(`      worst: ${worst.toFixed(3)} px over ${count} corners`);
});

/**
 * The glows this stage adds, each a lamp the light shows light: its id, whether it's a sprite drawn over everything (or
 * lies flat), how wide it is, and its own colour.
 */
const NEW_LAMPS: { id: string; sprite: boolean; size: number; color: number }[] = [
  ...['left', 'right'].flatMap((side) => Array.from({ length: 16 }, (_, k) => ({ id: `rail-${side}-${k}`, sprite: true, size: 0.5, color: 0x4a7dff }))),
  ...[0, 1, 2].map((k) => ({ id: `orbit-left-${k}`, sprite: false, size: 0.7, color: 0xffa030 })),
  ...[0, 1, 2].map((k) => ({ id: `orbit-right-${k}`, sprite: false, size: 0.65, color: 0xffa030 })),
  { id: 'doorway-0', sprite: true, size: 0.45, color: 0xffa030 },
  { id: 'doorway-1', sprite: true, size: 0.45, color: 0xffa030 },
  { id: 'doorstep', sprite: false, size: 1.1, color: 0xff3344 },
  ...[1, 2, 3].map((k) => ({ id: `popup-${k}`, sprite: false, size: 0.8, color: 0x4a7dff })),
  { id: 'mummy', sprite: false, size: 1.2, color: 0x39ff6a },
  { id: 'gate', sprite: false, size: 0.9, color: 0xffc23a },
];
/** The toys' lamps: the tomb's three, a pop-up's each, the mummy's and the gate's. */
const TOY_LAMPS = ['doorway-0', 'doorway-1', 'doorstep', 'popup-1', 'popup-2', 'popup-3', 'mummy', 'gate'];

/**
 * The most rises in any 1 s window of a light looked at every `dt` (each level a share of its peak): a rise is going
 * above LIT_ABOVE after being below DARK_BELOW, and a light starts out dark (light-show-test counts them so too).
 */
function rises(seen: number[], dt: number): number {
  const at: number[] = [];
  let dark = true;
  seen.forEach((level, i) => {
    if (level < DARK_BELOW) dark = true;
    else if (dark && level > LIT_ABOVE) {
      dark = false;
      at.push(i * dt);
    }
  });
  let most = 0;
  for (let a = 0, b = 0; b < at.length; b++) {
    while (at[b] - at[a] >= 1) a++;
    most = Math.max(most, b - a + 1);
  }
  return most;
}

/**
 * A ramp's floor height at p, in (x, z), as the physics has it (server/sim.ts's floorHeight): its centre line's height
 * at the point on it nearest p.
 */
function floorOf(r: Ramp, p: readonly [number, number]): number {
  let best = Infinity;
  let y = r.path[0][2];
  for (let i = 0; i + 1 < r.path.length; i++) {
    const [ax, az, ay] = r.path[i];
    const [bx, bz, by] = r.path[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const k = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(p[0] - ax - k * dx, p[1] - az - k * dz);
    if (d < best) {
      best = d;
      y = ay + k * (by - ay);
    }
  }
  return y;
}

test("every glow is a lamp: the 32 rail lights, the 6 orbit arrows, the doorway's 2 and its step, a lamp for each toy; the ring goes round the frame in order; the ladders are ten", () => {
  const parts = new TableParts(TABLE_IN_USE);
  const { all, ring, ladders } = parts.lamps;
  // A lamp for every glow, in the glows' order: at its glow's place on the table, in its glow's own colour.
  assert.equal(all.length, parts.glows.length, 'a lamp for every glow');
  assert.equal(new Set(all).size, all.length, 'no lamp twice');
  parts.glows.forEach((g, i) => {
    assert.ok(near(all[i].x, g.object.position.x) && near(all[i].z, g.object.position.z), `${g.id}'s lamp is at (${all[i].x}, ${all[i].z}), its glow at (${g.object.position.x}, ${g.object.position.z})`);
    assert.equal(all[i].color, g.material.color.getHex(), `${g.id}'s lamp is in its glow's colour`);
  });
  // The new ones, each once: no LIT bit, dark until a show or its toy lights it, and drawn as each lamp is.
  for (const want of NEW_LAMPS) {
    const found = parts.glows.filter((g) => g.id === want.id);
    assert.equal(found.length, 1, `one ${want.id} glow`);
    const [g] = found;
    assert.equal(g.bit, 0, `${want.id} has no LIT bit`);
    assert.ok(g.material.opacity === 0 && !g.object.visible, `${want.id} starts dark`);
    assert.equal(g.object instanceof THREE.Sprite, want.sprite, `${want.id} is ${want.sprite ? 'a sprite' : 'flat'}`);
    const size = g.object instanceof THREE.Sprite ? g.object.scale.x : (g.object.geometry as THREE.PlaneGeometry).parameters.width;
    assert.ok(near(size, want.size), `${want.id} is ${size} across, not ${want.size}`);
    assert.equal(g.material.color.getHex(), want.color, `${want.id}'s colour is ${g.material.color.getHexString()}`);
  }
  const idOf = (l: ShowLamp) => parts.glows[all.indexOf(l)]?.id;
  // The ring: the frame's rail lights, up the left column from the bottom and down the right one from the top, each
  // the next round from the last. Its lamps are all's own, not copies: a show knows its lamps by which they are.
  assert.ok(ring.every((l) => all.includes(l)), "the ring's lamps are all's own");
  const up = Array.from({ length: 16 }, (_, k) => k);
  assert.deepEqual(ring.map(idOf), [...up.map((k) => `rail-left-${k}`), ...[...up].reverse().map((k) => `rail-right-${k}`)]);
  ring.forEach((l, i) => {
    if (i === 0) return;
    const [dx, dz] = [l.x - ring[i - 1].x, l.z - ring[i - 1].z];
    const step = i < 16 ? [0, 1.05] : i === 16 ? [10.46, 0] : [0, -1.05];
    assert.ok(near(dx, step[0], 1e-9) && near(dz, step[1], 1e-9), `${idOf(l)} is next round from ${idOf(ring[i - 1])}: (${dx}, ${dz}) on`);
  });
  // The ladders: double score's ten, all's own too.
  assert.equal(ladders.length, 10);
  assert.ok(ladders.every((l) => all.includes(l)), "the ladders' lamps are all's own");
  assert.equal(new Set(ladders).size, 10, 'ten lamps');
  assert.ok(ladders.every((l) => idOf(l) === 'double'), "the ladders are double score's");
});

test("the new lamps sit where the picture's build draws them, on its pixels (within 3 px)", () => {
  // The picture's camera, as tools/export-scene.ts hands it to the build (which matched its own camera to it).
  const scene = exportScene();
  const pictureCamera = new THREE.PerspectiveCamera(scene.fovY, scene.width / scene.height, 0.5, 200);
  pictureCamera.matrixAutoUpdate = false;
  pictureCamera.matrixWorld.fromArray(scene.cameraMatrix);
  pictureCamera.matrixWorldInverse.copy(pictureCamera.matrixWorld).invert();
  pictureCamera.setViewOffset(scene.width, scene.height, 0, scene.viewY, scene.width, scene.height);
  const tableMatrix = new THREE.Matrix4().fromArray(scene.tableMatrix);
  const pixel = (p: THREE.Vector3, camera: THREE.Camera): [number, number] => {
    const q = p.clone().project(camera);
    return [((q.x + 1) / 2) * WIDTH, ((1 - q.y) / 2) * HEIGHT];
  };
  // The glows through the stage's camera.
  const camera = new THREE.PerspectiveCamera();
  fitStageCamera(camera, WIDTH, HEIGHT);
  const table = tiltTable(new THREE.Group());
  const parts = new TableParts(TABLE_IN_USE);
  table.add(parts.group);
  table.updateMatrixWorld(true);
  // Where build_table.py draws each lamp, by its own formulas, in the table's coordinates (x, up, z).
  const build = new Map<string, [number, number, number]>();
  // The rail LEDs: domes on the frame's brass lip (1.08 up), each 0.52 above a frame screw; the screws from 0.4 up the
  // cabinet in steps of 1.05 while under its top less 1.2 (FY1, 17.7), at x ±5.12 scaled out to the lip's ±5.23.
  for (let k = 0; 0.4 + k * 1.05 < 17.7 - 1.2; k++) {
    for (const [side, x] of [['left', -5.12], ['right', 5.12]] as const) build.set(`rail-${side}-${k}`, [(x * 5.23) / 5.12, 1.08, 0.4 + k * 1.05 + 0.52]);
  }
  // The orbits' arrows: inserts 0.006 thick, three up each orbit lane.
  for (let k = 0; k < 3; k++) {
    build.set(`orbit-left-${k}`, [-4.5, 0.006, 9.9 + k * 0.55]);
    build.set(`orbit-right-${k}`, [3.7, 0.006, 11.3 + k * 0.45]);
  }
  // The doorway's LEDs: domes on its lintel's top (0.1 over the doorway), 0.05 outside each jamb's face and 0.045
  // behind the door's face. The build draws no lamp on the doorstep, nor at the toys: those lie on what it draws there,
  // the doorstep's at the doorway's middle, 0.25 in front of the door's face (the doorstep is 0.006 thick), and a
  // pop-up's and the mummy's on the playfield, out from the toy's face (its target_frame's n) by 0.35 and 0.45.
  const d = doorwayOf();
  build.set('doorway-0', [d.x0 - 0.05, d.height + 0.1, d.front + 0.045]);
  build.set('doorway-1', [d.x1 + 0.05, d.height + 0.1, d.front + 0.045]);
  build.set('doorstep', [(d.x0 + d.x1) / 2, 0.006, d.front - 0.25]);
  for (const i of RISING_AT) {
    const t = TABLE_IN_USE.targets[i];
    const { n } = frameOf(t);
    const out = (t.depth ?? 0.2) / 2 + (t.rise === 'hold' ? 0.45 : 0.35);
    build.set(t.id.replace(/^target-/, ''), [t.x + n[0] * out, 0, t.z + n[1] * out]);
  }
  // The gate's: the middle of the build's gate at rest, on its ramp's floor there.
  const { dv, ramp } = gateOf();
  const a = THREE.MathUtils.degToRad(dv.restDeg);
  const mid: [number, number] = [dv.pivot[0] + (Math.cos(a) * dv.length) / 2, dv.pivot[1] + (Math.sin(a) * dv.length) / 2];
  build.set('gate', [mid[0], floorOf(ramp, mid), mid[1]]);
  assert.deepEqual([...build.keys()].sort(), NEW_LAMPS.map((l) => l.id).sort(), 'a place in the build for every new lamp');
  let worst = 0;
  for (const [id, [x, y, z]] of build) {
    const glow = parts.glows.find((g) => g.id === id);
    assert.ok(glow, `a ${id} glow`);
    const got = pixel(glow.object.getWorldPosition(new THREE.Vector3()), camera);
    const want = pixel(new THREE.Vector3(x, y, z).applyMatrix4(tableMatrix), pictureCamera);
    const err = Math.hypot(got[0] - want[0], got[1] - want[1]);
    worst = Math.max(worst, err);
    assert.ok(err <= 3, `${id}: drawn at (${got.map((v) => v.toFixed(1))}), the build's at (${want.map((v) => v.toFixed(1))}): ${err.toFixed(2)} px`);
  }
  console.log(`      worst: ${worst.toFixed(3)} px over ${build.size} lamps`);
});

test("a show's light shows over the game's, in its colour; when it ends every lamp is what the game says: lit, blinking or dark", () => {
  const dt = 1 / 120;
  // The table with a show lighting every lamp for 1 s, and the same table with none: what the game says.
  const parts = new TableParts(TABLE_IN_USE);
  const game = new TableParts(TABLE_IN_USE);
  for (const p of [parts, game]) p.setLit(LIT.lock | LIT.centre2);
  const SHOW = 0xff2bd6;
  const light: LampLight = { level: 1, color: SHOW };
  const player = new LightShowPlayer(parts.lamps.all);
  player.play({ seconds: 1, light: () => light }, 0);
  const lock = parts.glows.findIndex((g) => g.id === 'lock');
  const centre2 = parts.glows.findIndex((g) => g.id === 'centre2');
  const lockSeen = new Set<number>();
  let k = 0;
  for (; k * dt < 3; k++) {
    const t = k * dt;
    parts.setShowLights(player.lights(t));
    parts.update(dt);
    game.update(dt);
    if (t < 1) {
      // The show's light over every glow, in its colour: over the lit lamp and the blinking lock too.
      for (const g of parts.glows) {
        assert.ok(g.object.visible && near(g.material.opacity, 0.9, 1e-9) && g.material.color.getHex() === SHOW, `${g.id} at ${t.toFixed(3)} s: ${g.material.opacity} in ${g.material.color.getHexString()}`);
      }
    } else if (t >= 1 + FLASH_GAP) {
      // Over, and past the gap a rise holds a light dark for: every glow as the game has it, which is centre 2 lit,
      // the lock blinking and every other lamp dark, each in its own colour.
      parts.glows.forEach((g, i) => {
        const w = game.glows[i];
        const what = `${g.id} at ${t.toFixed(3)} s: ${g.material.opacity} in ${g.material.color.getHexString()}`;
        assert.ok(g.material.opacity === w.material.opacity && g.object.visible === w.object.visible, `${what}, the game's ${w.material.opacity}`);
        assert.equal(g.material.color.getHex(), parts.lamps.all[i].color, `${what}: its own colour`);
        if (i === centre2) assert.ok(near(g.material.opacity, 0.45, 1e-9), `${what}: lit`);
        else if (i === lock) lockSeen.add(Math.round(g.material.opacity * 1e6) / 1e6);
        else assert.ok(g.material.opacity === 0 && !g.object.visible, `${what}: dark`);
      });
    }
  }
  assert.deepEqual([...lockSeen].sort(), [0.15, 0.45], 'the lock blinks, lit and dim');
  // A show dimmer than the game's light leaves the lamp the game's, in its own colour; on a dark lamp it shows.
  const dim: LampLight = { level: 0.4, color: SHOW };
  const at = k * dt;
  player.play({ seconds: 0.5, light: () => dim }, at);
  const rail = parts.glows.findIndex((g) => g.id === 'rail-left-0');
  for (; k * dt < at + 0.5; k++) {
    parts.setShowLights(player.lights(k * dt));
    parts.update(dt);
    const [c, r] = [parts.glows[centre2], parts.glows[rail]];
    assert.ok(near(c.material.opacity, 0.45, 1e-9) && c.material.color.getHex() === parts.lamps.all[centre2].color, `centre2 under a dim show: ${c.material.opacity} in ${c.material.color.getHexString()}`);
    assert.ok(near(r.material.opacity, 0.36, 1e-9) && r.material.color.getHex() === SHOW, `rail-left-0 under a dim show: ${r.material.opacity} in ${r.material.color.getHexString()}`);
  }
});

test("the toys' lamps: a pop-up's and the mummy's lit while it stands, the doorway's while the tomb is open, the gate's while it's over; as they are at the first look", () => {
  const [, popup2, , mummy] = RISING_AT;
  /** The toys' lamps lit after a frame, each lit at a lit lamp's glow (GLOW_LIT, 0.45). */
  const lit = (p: InstanceType<typeof TableParts>) => {
    p.update(1 / 60);
    return TOY_LAMPS.filter((id) => {
      const g = p.glows.find((glow) => glow.id === id)!;
      assert.ok(g.object.visible ? near(g.material.opacity, 0.45, 1e-9) : g.material.opacity === 0, `${id} glows at ${g.material.opacity}`);
      return g.object.visible;
    });
  };
  const but = (...out: string[]) => TOY_LAMPS.filter((id) => !out.includes(id));
  // Before any header every toy is down, the tomb shut and the gate at rest: none lit.
  const parts = new TableParts(TABLE_IN_USE);
  assert.deepEqual(lit(parts), []);
  // A page opening on every toy up, the tomb open and the gate over shows every toy's lamp lit, at its first look.
  parts.setTargets(0, 0, 0);
  parts.setToys(TOY.tombOpen | TOY.diverterOver);
  assert.deepEqual(lit(parts), TOY_LAMPS);
  // Each goes out with its own bit: a pop-up knocked down, the mummy down, the tomb shut, the gate back at rest.
  parts.setTargets(1 << popup2, 0, 1);
  assert.deepEqual(lit(parts), but('popup-2'));
  parts.setTargets((1 << popup2) | (1 << mummy), 0, 2);
  assert.deepEqual(lit(parts), but('popup-2', 'mummy'));
  parts.setToys(TOY.diverterOver);
  assert.deepEqual(lit(parts), but('popup-2', 'mummy', 'doorway-0', 'doorway-1', 'doorstep'));
  parts.setToys(0);
  assert.deepEqual(lit(parts), ['popup-1', 'popup-3']);
  // And each lights again with its bit: as its toy starts up (the mummy is still rising) or the tomb starts to open.
  parts.setTargets(0, 0, 3);
  parts.setToys(TOY.tombOpen | TOY.diverterOver);
  assert.deepEqual(lit(parts), TOY_LAMPS);
  assert.ok(parts.targets[mummy].pivot.position.y < 0, 'the mummy is still rising');
  // A fresh hello: the next header's are shown as they are, at once.
  parts.reset();
  parts.setTargets(RISING & ~(1 << mummy), 0, 0);
  parts.setToys(TOY.diverterOver);
  assert.deepEqual(lit(parts), ['mummy', 'gate']);
  // A page opening on every toy down, the tomb shut and the gate at rest shows none lit.
  const shut = new TableParts(TABLE_IN_USE);
  shut.setTargets(RISING, 0, 0);
  shut.setToys(0);
  assert.deepEqual(lit(shut), []);
});

test('no glow rises more than 3 times in any second, whatever lights it: bumpers hit every 0.1 s, the blinking lock, a show bursting every 0.1 s', () => {
  const dt = 1 / 120;
  /**
   * The table for 5 s, a frame every 1/120 s, with the lock lit (it blinks): every `hitEvery` frames each bumper is
   * hit, and with `bursts`, every 12 frames (0.1 s) a burst runs out from the table's middle over every lamp. What each
   * glow shows (its opacity as a share of its peak, 0.9), and what the shows alone asked of each lamp.
   */
  const play = (hitEvery: number, bursts: boolean) => {
    const parts = new TableParts(TABLE_IN_USE);
    parts.setLit(LIT.lock);
    const player = new LightShowPlayer(parts.lamps.all);
    const shown = parts.glows.map(() => [] as number[]);
    const asked = parts.glows.map(() => [] as number[]);
    for (let k = 0; k < 600; k++) {
      const t = k * dt;
      if (k % hitEvery === 0) for (const b of TABLE_IN_USE.bumpers) parts.flashBumper(b.id);
      if (bursts && k % 12 === 0) player.play(burst(parts.lamps.all, { x: 0, z: 8, reach: 10, color: 0xffffff, seconds: 0.5 }), t);
      const lights = player.lights(t);
      lights.forEach((l, i) => asked[i].push(l?.level ?? 0));
      parts.setShowLights(lights);
      parts.update(dt);
      parts.glows.forEach((g, i) => shown[i].push(g.material.opacity / 0.9));
    }
    return { parts, shown, asked };
  };
  const most = (levels: number[][]) => Math.max(...levels.map((l) => rises(l, dt)));
  const held = (what: string, { parts, shown }: ReturnType<typeof play>) =>
    parts.glows.forEach((g, i) => assert.ok(rises(shown[i], dt) <= 3, `${what}: ${g.id} (glow ${i}) rose ${rises(shown[i], dt)} times in a second`));
  // The bursts ask most lamps to rise 10 times a second (a ring every 0.1 s, each gone before the next comes): the
  // limit holds every glow to 3.
  const busy = play(12, true);
  assert.ok(most(busy.asked) >= 9, `the bursts alone ask up to ${most(busy.asked)} rises a second`);
  held('bursts, bumpers and the lock', busy);
  // Hit every 0.1 s, a bumper's flash never dies away before the next hit, so it rises once. Hit every 0.3 s, it dies
  // below DARK_BELOW before each hit, so the game itself asks for 3.3 rises a second; the limit holds that to 3 too.
  const slow = play(36, false);
  const bumpers = slow.parts.glows.flatMap((g, i) => (TABLE_IN_USE.bumpers.some((b) => b.id === g.id) ? [i] : []));
  assert.ok(bumpers.length > 0, 'the bumpers glow');
  for (const i of bumpers) {
    for (let k = 36; k < 600; k += 36) assert.ok(slow.shown[i][k - 1] < DARK_BELOW, `${slow.parts.glows[i].id} is dark before the hit at frame ${k}`);
    assert.ok(rises(slow.shown[i], dt) >= 2, `${slow.parts.glows[i].id} still flashes: ${rises(slow.shown[i], dt)} rises a second`);
  }
  held('bumpers hit every 0.3 s', slow);
});

test("the glows' limit counts real seconds, not the host's dt: with dt 1.5 times real time, bumpers hit and a show bursting every 0.2 real seconds rise no glow more than 3 times in any real second", () => {
  // The city's frame loop measures each frame's dt from a 1/fps grid, so its dt sums to about 1.5 times real time at
  // its 60 fps cap. So the scene passes the browser's own clock to update() as `real`, and the glows' limits count
  // that. Here a frame comes every 1/60 real second with a dt of 1.5 / 60, and the shows run on the table's clock,
  // which keeps real time. Counting the dt instead, the limits would let a glow rise 4 times in a real second.
  const step = 1 / 60;
  /**
   * The table for 10 real seconds: every 12 frames (0.2 real seconds) each bumper is hit, or a burst runs out from the
   * table's middle over every lamp. What each glow shows (its opacity as a share of its peak, 0.9), and what the shows
   * alone asked of each lamp.
   */
  const play = (what: 'bumpers' | 'bursts') => {
    const parts = new TableParts(TABLE_IN_USE);
    const player = new LightShowPlayer(parts.lamps.all);
    const shown = parts.glows.map(() => [] as number[]);
    const asked = parts.glows.map(() => [] as number[]);
    for (let k = 0; k < 600; k++) {
      const real = k * step;
      if (k % 12 === 0 && what === 'bumpers') for (const b of TABLE_IN_USE.bumpers) parts.flashBumper(b.id);
      if (k % 12 === 0 && what === 'bursts') player.play(burst(parts.lamps.all, { x: 0, z: 8, reach: 10, color: 0xffffff, seconds: 1 }), real);
      const lights = player.lights(real);
      lights.forEach((l, i) => asked[i].push(l?.level ?? 0));
      parts.setShowLights(lights);
      parts.update(1.5 * step, real);
      parts.glows.forEach((g, i) => shown[i].push(g.material.opacity / 0.9));
    }
    return { parts, shown, asked };
  };
  const held = (what: string, { parts, shown }: ReturnType<typeof play>) =>
    parts.glows.forEach((g, i) => assert.ok(rises(shown[i], step) <= 3, `${what}: ${g.id} (glow ${i}) rose ${rises(shown[i], step)} times in a real second`));
  // Each bumper's flash dies away on the dt, so it is dark before every hit: the game asks it to rise 5 times a real
  // second, and the limit holds that to 3.
  const hits = play('bumpers');
  const bumpers = hits.parts.glows.flatMap((g, i) => (TABLE_IN_USE.bumpers.some((b) => b.id === g.id) ? [i] : []));
  assert.ok(bumpers.length > 0, 'the bumpers glow');
  for (const i of bumpers) {
    for (let k = 12; k < 600; k += 12) assert.ok(hits.shown[i][k - 1] < DARK_BELOW, `${hits.parts.glows[i].id} is dark before the hit at frame ${k}`);
    assert.ok(rises(hits.shown[i], step) >= 2, `${hits.parts.glows[i].id} still flashes: ${rises(hits.shown[i], step)} rises a real second`);
  }
  held('bumpers hit every 0.2 real seconds', hits);
  // The bursts ask most lamps to rise 5 times a real second (a ring every 0.2 s, each gone before the next comes): the
  // limit holds every glow to 3.
  const bursts = play('bursts');
  const asks = Math.max(...bursts.asked.map((l) => rises(l, step)));
  assert.ok(asks >= 5, `the bursts alone ask up to ${asks} rises a real second`);
  held('a show bursting every 0.2 real seconds', bursts);
});

/** Each god's toy lamps, by their glows' ids: the gate's for Ra, the pop-ups' for Horus, the mummy's, the doorstep's. */
const TOY_LAMP_OF: Record<God, string[]> = { ra: ['gate'], horus: ['popup-1', 'popup-2', 'popup-3'], ankh: ['mummy'], eye: ['doorstep'] };
/** The lamps the quest's lasting look lights while a mode runs: the frame's rail lights and the orbits' arrows. */
const isDecor = (id: string) => id.startsWith('rail-') || id.startsWith('orbit-');
/** The quest's gold, and a glow's opacity lit (GLOW_LIT) and at a blink's dim half (GLOW_DIM). */
const QUEST_GOLD = 0xffc23a;
const GLOW_LIT = 0.45;
const GLOW_DIM = 0.15;
/** Pharaoh's curse's red, which the rail lights and arrows pulse in while it lasts. */
const CURSE_RED = 0xff2a2a;

test("while a mode runs the rail lights and orbit arrows glow in its god's colour and its toy's lamp blinks in it while the toy is up, dark while it's down; with none, they're as before", () => {
  // A frame every 1/120 s of the table's clock, with a dt half as long again (the city's): the blink goes by `now`.
  const step = 1 / 120;
  const [, popup2] = RISING_AT;
  for (const god of GODS) {
    const color = GOD_COLOR[god];
    // The toys up but the second pop-up, the tomb open and the gate over, so the game lights their lamps; centre 2
    // lit and the lock blinking. `game` is the same table with no mode: what the game says.
    const parts = new TableParts(TABLE_IN_USE);
    const game = new TableParts(TABLE_IN_USE);
    for (const p of [parts, game]) {
      p.setLit(LIT.lock | LIT.centre2);
      p.setTargets(1 << popup2, 0, 0);
      p.setToys(TOY.tombOpen | TOY.diverterOver);
    }
    const toys = TOY_LAMP_OF[god];
    assert.deepEqual(parts.lamps.toys[god].map((l) => parts.glows[parts.lamps.all.indexOf(l)].id), toys, `${god}'s toy lamps`);
    const shown = parts.glows.map(() => [] as number[]);
    // The second pop-up is down, so its lamp stays dark: a lamp blinking where a pop-up isn't would say it was there.
    const downLamp = 'popup-2';
    const blinks = new Map(toys.filter((id) => id !== downLamp).map((id) => [id, [] as number[]]));
    for (let k = 0; k * step < 2; k++) {
      const now = 40 + k * step;
      parts.setQuestLook({ god, finale: false, curse: false, summoned: false }, now);
      parts.update(1.5 * step);
      game.update(1.5 * step);
      parts.glows.forEach((g, i) => {
        shown[i].push(g.material.opacity / 0.9);
        const what = `${god}: ${g.id} at ${now.toFixed(3)}: ${g.material.opacity} in ${g.material.color.getHexString()}`;
        if (isDecor(g.id)) {
          assert.ok(g.object.visible && near(g.material.opacity, GLOW_LIT) && g.material.color.getHex() === color, `${what}, steady in the god's colour`);
        } else if (g.id === downLamp && toys.includes(g.id)) {
          assert.ok(!g.object.visible && g.material.opacity === 0, `${what}, dark while its pop-up is down`);
        } else if (toys.includes(g.id)) {
          assert.ok(g.object.visible && g.material.color.getHex() === color, `${what}, in the god's colour`);
          assert.ok(near(g.material.opacity, GLOW_LIT) || near(g.material.opacity, GLOW_DIM), `${what}, at a blink's levels`);
          blinks.get(g.id)!.push(g.material.opacity);
        } else {
          // Every other lamp is the game's, in its own colour: the toys' lamps the game lights, the lit lamp, the
          // blinking lock.
          const w = game.glows[i];
          assert.ok(g.material.opacity === w.material.opacity && g.object.visible === w.object.visible && g.material.color.getHex() === w.material.color.getHex(), `${what}, the game's ${w.material.opacity}`);
        }
      });
    }
    // The toy's lamp blinks twice a second on the table's clock, lit then dim, while its toy is up: lit from the start,
    // and lit again 3 times more in the 2 s.
    for (const [id, seen] of blinks) {
      let relit = 0;
      for (let k = 1; k < seen.length; k++) if (seen[k] > seen[k - 1]) relit++;
      assert.equal(relit, 3, `${god}: ${id} blinks twice a second (lit again ${relit} times in 2 s)`);
      assert.ok(near(seen[0], GLOW_LIT), `${god}: ${id} lit first`);
    }
    // None of the look's light rises a glow: it is lit at half a show's peak, never above, and dims to a sixth of it,
    // never below.
    parts.glows.forEach((g, i) => {
      if (isDecor(g.id) || toys.includes(g.id)) assert.equal(rises(shown[i], step), 0, `${god}: ${g.id} never rises`);
    });
    // The mode over: every glow at once as the game has it.
    parts.setQuestLook({ god: null, finale: false, curse: false, summoned: false }, 42);
    parts.update(1.5 * step);
    game.update(1.5 * step);
    parts.glows.forEach((g, i) => {
      const w = game.glows[i];
      assert.ok(g.material.opacity === w.material.opacity && g.object.visible === w.object.visible && g.material.color.getHex() === w.material.color.getHex(), `${god} over: ${g.id} at ${g.material.opacity}, the game's ${w.material.opacity}`);
    });
  }
  // A table that is never told of a mode is the game's alone.
  const plain = new TableParts(TABLE_IN_USE);
  plain.update(1 / 60);
  assert.ok(plain.glows.every((g) => !g.object.visible), 'nothing lit');
});

test("the finale's chase runs round the rails, a lamp lit once a lap, for as long as the finale does", () => {
  const step = 1 / 120;
  const LAP = 0.9;
  const parts = new TableParts(TABLE_IN_USE);
  const game = new TableParts(TABLE_IN_USE);
  for (const p of [parts, game]) p.setLit(LIT.centre2);
  const ring = parts.lamps.ring.map((l) => parts.lamps.all.indexOf(l));
  assert.equal(ring.length, 32);
  const seen = ring.map(() => [] as number[]);
  const colors = ring.map(() => [] as number[]);
  // Four laps, from the start of a lap of the table's clock.
  const start = 100 * LAP;
  for (let k = 0; k * step < 4 * LAP - 1e-9; k++) {
    const now = start + k * step;
    parts.setQuestLook({ god: null, finale: true, curse: false, summoned: false }, now);
    parts.update(step);
    game.update(step);
    ring.forEach((i, place) => {
      const g = parts.glows[i];
      assert.ok(g.material.opacity <= 0.9 + 1e-9, `${g.id} no brighter than a show's peak`);
      seen[place].push(g.material.opacity / 0.9);
      colors[place].push(g.material.color.getHex());
    });
    // Every lamp off the ring is the game's: the orbits' arrows dark, centre 2 lit.
    parts.glows.forEach((g, i) => {
      if (ring.includes(i)) return;
      const w = game.glows[i];
      assert.ok(g.material.opacity === w.material.opacity && g.material.color.getHex() === w.material.color.getHex(), `${g.id} in the finale: ${g.material.opacity}, the game's ${w.material.opacity}`);
    });
  }
  // Each lamp rises once a lap, as the chase's head passes it, in the ring's order: gold one lap and the rainbow the
  // next, each lamp's hue its own.
  const rainbow: number[] = [];
  seen.forEach((levels, place) => {
    const at: number[] = [];
    // At the first look the head is on the first lamp, and the last few are still fading behind it from the lap
    // before: they rose then, not here.
    let dark = place === 0 || levels[0] < DARK_BELOW;
    levels.forEach((level, k) => {
      if (level < DARK_BELOW) dark = true;
      else if (dark && level > LIT_ABOVE) {
        dark = false;
        at.push(k);
      }
    });
    assert.equal(at.length, 4, `ring lamp ${place} rises ${at.length} times in 4 laps`);
    at.forEach((k, lap) => {
      const want = lap * LAP + (place / 32) * LAP;
      assert.ok(Math.abs(k * step - want) <= step + 1e-9, `ring lamp ${place}'s rise ${lap} at ${k * step}, not ${want}`);
      const color = colors[place][k];
      if (lap % 2 === 0) assert.equal(color, QUEST_GOLD, `ring lamp ${place}, lap ${lap}: gold`);
      else if (lap === 1) rainbow.push(color);
      else assert.equal(color, rainbow[place], `ring lamp ${place}: the same hue each rainbow lap`);
    });
    // Lit through its rise, it keeps that lap's colour while its light fades behind the head.
    const [first] = at;
    for (let k = first; k < levels.length && levels[k] > 0 && k < at[1]; k++) assert.equal(colors[place][k], QUEST_GOLD, `ring lamp ${place} stays gold as it fades`);
  });
  assert.equal(new Set(rainbow).size, 32, 'every lamp of the rainbow lap its own hue');
  assert.ok(!rainbow.includes(QUEST_GOLD));
  // The finale over: the ring dark at once.
  parts.setQuestLook({ god: null, finale: false, curse: false, summoned: false }, start + 4 * LAP);
  parts.update(step);
  for (const i of ring) assert.ok(!parts.glows[i].object.visible, `${parts.glows[i].id} dark when the finale is over`);
  // A stage opened in the middle of the finale shows the chase at its first frame: it comes from the state.
  const late = new TableParts(TABLE_IN_USE);
  late.setQuestLook({ god: null, finale: true, curse: false, summoned: false }, 1234.5);
  late.update(1 / 60);
  assert.ok(ring.filter((i) => late.glows[i].object.visible).length >= 4, 'the chase shows at once');
});

test("setDim darkens every glow, the game's light and the shows' alike, and coming back is one rise", () => {
  const step = 1 / 120;
  const parts = new TableParts(TABLE_IN_USE);
  parts.setLit(LIT.centre2);
  // A show lighting the ring steadily, at its peak, for 4 s; and a fade from 1 s: 0.5 s down, 0.2 s dark, 0.5 s up.
  const ringSet = new Set<ShowLamp>(parts.lamps.ring);
  const full: LampLight = { level: 1, color: 0xff2bd6 };
  const steady: Show = { seconds: 4, light: (l) => (ringSet.has(l) ? full : null) };
  const player = new LightShowPlayer(parts.lamps.all);
  player.play(steady, 0);
  player.fade(darken({ down: 0.5, hold: 0.2, up: 0.5 }), 1);
  const centre2 = parts.glows.findIndex((g) => g.id === 'centre2');
  const rail = parts.glows.findIndex((g) => g.id === 'rail-left-3');
  const shown = parts.glows.map(() => [] as number[]);
  for (let k = 0; k * step < 3.5; k++) {
    const t = k * step;
    parts.setShowLights(player.lights(t));
    parts.setDim(player.dimAt(t));
    parts.update(step);
    parts.glows.forEach((g, i) => shown[i].push(g.material.opacity / 0.9));
    const [c, r] = [parts.glows[centre2].material.opacity, parts.glows[rail].material.opacity];
    if (t < 1 || t >= 2.2) assert.ok(near(c, 0.45) && near(r, 0.9), `at ${t.toFixed(3)}: centre2 ${c}, the rail ${r}, as lit`);
    if (near(t, 1.25, 1e-6)) assert.ok(near(c, 0.225) && near(r, 0.45), `half way down: centre2 ${c}, the rail ${r}`);
    if (t > 1.5 && t < 1.7) assert.ok(parts.glows.every((g) => g.material.opacity === 0 && !g.object.visible), `at ${t.toFixed(3)} every glow is dark`);
  }
  // Each ring lamp rose at the start and once more coming back; centre 2, at half of a show's peak, never rose.
  const risesIn = (i: number) => {
    let dark = true;
    let n = 0;
    for (const level of shown[i]) {
      if (level < DARK_BELOW) dark = true;
      else if (dark && level > LIT_ABOVE) {
        dark = false;
        n++;
      }
    }
    return n;
  };
  for (const l of parts.lamps.ring) {
    const i = parts.lamps.all.indexOf(l);
    assert.equal(risesIn(i), 2, `${parts.glows[i].id}: its first rise, and one coming back`);
  }
  assert.equal(risesIn(centre2), 0, 'centre 2 never rises');

  // The dim goes before the limit: a dim flickered on and off 10 times a second rises a lit lamp no more than 3 times
  // in any second.
  const flicker = new TableParts(TABLE_IN_USE);
  const lit = flicker.lamps.ring.map((l) => flicker.lamps.all.indexOf(l));
  const always = new LightShowPlayer(flicker.lamps.all);
  always.play({ seconds: 10, light: (l) => (flicker.lamps.ring.includes(l) ? full : null) }, 0);
  const flickered = lit.map(() => [] as number[]);
  for (let k = 0; k * step < 5; k++) {
    const t = k * step;
    flicker.setShowLights(always.lights(t));
    flicker.setDim((t * 10) % 1 < 0.5 ? 1 : 0);
    flicker.update(step);
    lit.forEach((i, n) => flickered[n].push(flicker.glows[i].material.opacity / 0.9));
  }
  lit.forEach((i, n) => {
    assert.ok(rises(flickered[n], step) <= 3, `${flicker.glows[i].id} rose ${rises(flickered[n], step)} times in a second`);
    assert.ok(rises(flickered[n], step) >= 2, `${flicker.glows[i].id} still flickers`);
  });
});

test("the curse pulses the rail lights and arrows red once a second over a mode's colour, dark between, and no glow counts a rise from it", () => {
  // A frame every 1/120 s of the table's clock, with a dt half as long again (the city's): the pulse goes by `now`.
  const step = 1 / 120;
  for (const god of [null, ...GODS]) {
    const parts = new TableParts(TABLE_IN_USE);
    const plain = new TableParts(TABLE_IN_USE);
    for (const p of [parts, plain]) {
      p.setLit(LIT.lock | LIT.centre2);
      p.setTargets(0, 0, 0);
      p.setToys(TOY.tombOpen | TOY.diverterOver);
    }
    const toys = god ? TOY_LAMP_OF[god] : [];
    const shown = parts.glows.map(() => [] as number[]);
    const pulses = new Map(parts.glows.filter((g) => isDecor(g.id)).map((g) => [g.id, [] as number[]]));
    for (let k = 0; k * step < 3; k++) {
      const now = 40 + k * step;
      parts.setQuestLook({ god, finale: false, curse: true, summoned: false }, now);
      plain.setQuestLook({ god, finale: false, curse: false, summoned: false }, now);
      parts.update(1.5 * step);
      plain.update(1.5 * step);
      parts.glows.forEach((g, i) => {
        shown[i].push(g.material.opacity / 0.9);
        const what = `${god}: ${g.id} at ${now.toFixed(3)}: ${g.material.opacity} in ${g.material.color.getHexString()}`;
        if (isDecor(g.id)) {
          // Lit in the curse's red the first half of each second of the table's clock, and dark the second half: dark,
          // not dim, so its rise limit is armed again every second (a dim half above DARK_BELOW would never let it go
          // dark, and the limit would hold nothing that a show lit over it).
          const lit = now - Math.floor(now) < 0.5;
          if (lit) assert.ok(g.object.visible && g.material.color.getHex() === CURSE_RED && near(g.material.opacity, GLOW_LIT), `${what}, lit in the curse's red`);
          else assert.ok(!g.object.visible && g.material.opacity === 0, `${what}, dark`);
          pulses.get(g.id)!.push(g.material.opacity);
        } else {
          // Every other lamp is as it would be with no curse: the game's, and a mode's toy lamp blinking in its colour.
          const w = plain.glows[i];
          assert.ok(g.material.opacity === w.material.opacity && g.object.visible === w.object.visible && g.material.color.getHex() === w.material.color.getHex(), `${what}, as with no curse: ${w.material.opacity}${toys.includes(g.id) ? " (the mode's toy lamp)" : ''}`);
        }
      });
    }
    // Once a second: lit from the start, and lit again twice more in the 3 s.
    for (const [id, seen] of pulses) {
      let relit = 0;
      for (let k = 1; k < seen.length; k++) if (seen[k] > seen[k - 1]) relit++;
      assert.equal(relit, 2, `${god}: ${id} pulses once a second (lit again ${relit} times in 3 s)`);
    }
    // Lit, it is half a show's peak, never above, so the pulse itself is never a rise; dark, it is below DARK_BELOW.
    parts.glows.forEach((g, i) => assert.equal(rises(shown[i], step), 0, `${god}: ${g.id} never rises`));
    // The curse over: the mode's colour back at once, or the game's dark.
    parts.setQuestLook({ god, finale: false, curse: false, summoned: false }, 43);
    plain.setQuestLook({ god, finale: false, curse: false, summoned: false }, 43);
    parts.update(1.5 * step);
    plain.update(1.5 * step);
    parts.glows.forEach((g, i) => {
      const w = plain.glows[i];
      assert.ok(g.material.opacity === w.material.opacity && g.material.color.getHex() === w.material.color.getHex(), `${god}, the curse over: ${g.id} at ${g.material.opacity}, not ${w.material.opacity}`);
    });
  }
  // In the finale, the arrows pulse red and the ring's chase still runs over the red.
  const step2 = 1 / 120;
  const fin = new TableParts(TABLE_IN_USE);
  const ring = new Set(fin.lamps.ring.map((l) => fin.lamps.all.indexOf(l)));
  let chased = 0;
  for (let k = 0; k * step2 < 2; k++) {
    const now = 90 + k * step2;
    fin.setQuestLook({ god: null, finale: true, curse: true, summoned: false }, now);
    fin.update(step2);
    fin.glows.forEach((g, i) => {
      if (!isDecor(g.id)) return;
      if (!ring.has(i)) {
        if (g.material.opacity > 0) assert.equal(g.material.color.getHex(), CURSE_RED, `${g.id} red in the finale`);
        return;
      }
      if (g.material.opacity > GLOW_LIT + 1e-9) chased++;
    });
  }
  assert.ok(chased > 0, "the finale's chase shows over the curse");
});

test("the summoned mummy's lamp blinks green while it is up, and is dark when it is down", () => {
  const step = 1 / 120;
  const mummyAt = TABLE_IN_USE.targets.findIndex((t) => t.rise === 'hold');
  assert.ok(mummyAt >= 0, 'the table has its mummy');
  // Alone, and over Sun Chase (whose toy lamp is the gate's, and blinks gold as it would).
  for (const god of [null, 'ra'] as const) {
    const parts = new TableParts(TABLE_IN_USE);
    const plain = new TableParts(TABLE_IN_USE);
    for (const p of [parts, plain]) {
      p.setLit(LIT.centre2);
      p.setTargets(0, 0, 0);
      p.setToys(TOY.diverterOver);
    }
    const lamp = parts.glows.findIndex((g) => g.id === 'mummy');
    const seen: number[] = [];
    for (let k = 0; k * step < 2; k++) {
      const now = 60 + k * step;
      parts.setQuestLook({ god, finale: false, curse: false, summoned: true }, now);
      plain.setQuestLook({ god, finale: false, curse: false, summoned: false }, now);
      parts.update(1.5 * step);
      plain.update(1.5 * step);
      parts.glows.forEach((g, i) => {
        const what = `${god}: ${g.id} at ${now.toFixed(3)}: ${g.material.opacity} in ${g.material.color.getHexString()}`;
        if (i === lamp) {
          assert.ok(g.object.visible && g.material.color.getHex() === GOD_COLOR.ankh, `${what}, green`);
          assert.ok(near(g.material.opacity, GLOW_LIT) || near(g.material.opacity, GLOW_DIM), `${what}, at a blink's levels`);
          seen.push(g.material.opacity);
          return;
        }
        const w = plain.glows[i];
        assert.ok(g.material.opacity === w.material.opacity && g.material.color.getHex() === w.material.color.getHex(), `${what}, as with no summon: ${w.material.opacity}`);
      });
    }
    // Twice a second, as a mode's toy lamp: lit first, and lit again 3 times more in the 2 s; and never a rise.
    let relit = 0;
    for (let k = 1; k < seen.length; k++) if (seen[k] > seen[k - 1]) relit++;
    assert.equal(relit, 3, `${god}: the mummy's lamp blinks twice a second (lit again ${relit} times in 2 s)`);
    assert.ok(near(seen[0], GLOW_LIT), `${god}: lit first`);
    assert.equal(rises(seen.map((o) => o / 0.9), step), 0, `${god}: the blink never rises`);
    // Put down (or not yet up): dark, as a mode's toy lamp is while its toy is down.
    parts.setTargets(1 << mummyAt, 0, 0);
    for (let k = 0; k < 60; k++) {
      parts.setQuestLook({ god, finale: false, curse: false, summoned: true }, 62 + k * step);
      parts.update(1.5 * step);
    }
    assert.ok(!parts.glows[lamp].object.visible && parts.glows[lamp].material.opacity === 0, `${god}: dark while the mummy is down`);
    // The summon over, and the mummy up: the game's lamp, lit in its own colour.
    parts.setTargets(0, 0, 0);
    parts.setQuestLook({ god, finale: false, curse: false, summoned: false }, 63);
    plain.setQuestLook({ god, finale: false, curse: false, summoned: false }, 63);
    for (let k = 0; k < 60; k++) {
      parts.update(1.5 * step);
      plain.update(1.5 * step);
    }
    const g = parts.glows[lamp];
    const w = plain.glows[lamp];
    assert.ok(g.material.opacity === w.material.opacity && g.material.color.getHex() === w.material.color.getHex(), `${god}, the summon over: the game's ${w.material.opacity}`);
  }
});

test('no glow rises more than 3 times in any real second through a mode, a jackpot, the finale, the curse and the summoned mummy together, at 60, 144 and 180 frames a second', () => {
  // As the city draws it: a frame every 1/60 real second with a dt 1.5 times that, the table's clock keeping real time
  // and the glows' limits counting the browser's own clock. And at 144 and 180 frames a second, since the stage's
  // frames come as fast as the display's (its requestAnimationFrame has been measured at 180 a second on the streaming
  // PC), and more frames are more chances to rise.
  for (const fps of [60, 144, 180]) playedAt(fps);
});
/** The combined test above, its frames `fps` a real second. */
function playedAt(fps: number): void {
  const step = 1 / fps;
  const parts = new TableParts(TABLE_IN_USE);
  const player = new LightShowPlayer(parts.lamps.all);
  const shows = new PinballShows(TABLE_IN_USE, parts.lamps, {
    play: (show, at) => player.play(show, at),
    fade: (fade, at) => player.fade(fade, at),
    sparks: () => {},
    flash: () => {},
    shake: () => {},
    coinRain: () => {},
    clear: () => player.clear(),
  });
  parts.setLit(LIT.lock | LIT.centre2);
  parts.setTargets(0, 0, 0);
  parts.setToys(TOY.tombOpen | TOY.diverterOver);
  const tomb = TABLE_IN_USE.tomb!;
  const cue = (at: number, c: Record<string, unknown>) => ({ kind: 'pinballCue', at, ...c }) as PinballCueMsg;
  // Ra's mode won with goals every 0.3 s, Horus's started over its strobe and lost to its fade with goals on through
  // it, Ankh's won on the finale's first moment, and the finale with a jackpot every 0.4 s, the bumpers hit every
  // 0.2 s all through. Chat's events over them: the mummy summoned at 0.4 over Sun Chase and put down at 4.5 (its row's
  // gold burst), Pharaoh's curse from 3 (its red strobe) pulsing over Falcon Strike, the fade and into the finale, and
  // a sandstorm's sweep at 9 in the finale.
  const cues: PinballCueMsg[] = [cue(0, { cue: 'modeStart', god: 'ra' })];
  const mummy = TABLE_IN_USE.targets.find((t) => t.rise === 'hold')!;
  cues.push(cue(4.5, { cue: 'summonDown', value: 10000, x: mummy.x, z: mummy.z }));
  const hypes: PinballHypeMsg[] = [
    { kind: 'pinballHype', id: 'mummy', at: 0.4 },
    { kind: 'pinballHype', id: 'curse', at: 3 },
    { kind: 'pinballHype', id: 'sandstorm', at: 9 },
  ];
  for (let t = 0.5; t < 2; t += 0.3) cues.push(cue(t, { cue: 'goal', god: 'ra', x: 0, z: 9 }));
  cues.push(cue(2, { cue: 'modeWon', god: 'ra', prize: 10000 }), cue(2.3, { cue: 'modeStart', god: 'horus' }));
  for (let t = 2.5; t < 6; t += 0.3) cues.push(cue(t, { cue: 'goal', god: 'horus', x: 1, z: 6.5 }));
  cues.push(cue(5, { cue: 'modeLost', god: 'horus' }), cue(6, { cue: 'modeStart', god: 'ankh' }), cue(7.5, { cue: 'modeWon', god: 'ankh', prize: 10000 }), cue(7.5, { cue: 'finale' }));
  for (let t = 8; t < 13; t += 0.4) cues.push(cue(t, { cue: 'jackpot', value: 75000, x: tomb.held[0], z: tomb.held[1] }));
  cues.push(cue(13, { cue: 'finaleEnd' }));
  // Sent in the order of their times, as the server sends them (stable, so the two at 7.5 keep theirs).
  cues.sort((a, b) => a.at - b.at);
  const modeAt = (t: number): { god: God | null; finale: boolean } =>
    t < 2 ? { god: 'ra', finale: false } : t >= 2.3 && t < 5 ? { god: 'horus', finale: false } : t >= 6 && t < 7.5 ? { god: 'ankh', finale: false } : { god: null, finale: t >= 7.5 && t < 13 };
  const lookAt = (t: number) => ({ ...modeAt(t), curse: t >= 3 && t < 11, summoned: t >= 0.4 && t < 4.5 });
  let nextHype = 0;
  const shown = parts.glows.map(() => [] as number[]);
  const asked = parts.glows.map(() => [] as number[]);
  let next = 0;
  // The bumpers hit every 0.2 real seconds, however many frames that is.
  let hits = -1;
  for (let k = 0; k * step < 14; k++) {
    const real = k * step;
    while (next < cues.length && cues[next].at <= real) shows.cue(cues[next++]);
    while (nextHype < hypes.length && hypes[nextHype].at <= real) shows.hype(hypes[nextHype++]);
    if (Math.floor(real / 0.2 + 1e-9) > hits) {
      hits = Math.floor(real / 0.2 + 1e-9);
      for (const b of TABLE_IN_USE.bumpers) parts.flashBumper(b.id);
    }
    shows.frame(real);
    const lights = player.lights(real);
    lights.forEach((l, i) => asked[i].push(l?.level ?? 0));
    parts.setShowLights(lights);
    parts.setQuestLook(lookAt(real), real);
    parts.setDim(player.dimAt(real));
    parts.update(1.5 * step, real);
    parts.glows.forEach((g, i) => shown[i].push(g.material.opacity / 0.9));
  }
  // The shows alone ask some lamps to rise more than 3 times a second (a jackpot's strobe every 0.4 s), and the
  // limit holds every glow to 3 in any real second.
  const asks = Math.max(...asked.map((l) => rises(l, step)));
  assert.ok(asks > 3, `${fps} fps: the shows ask up to ${asks} rises a real second`);
  parts.glows.forEach((g, i) => assert.ok(rises(shown[i], step) <= 3, `${fps} fps: ${g.id} (glow ${i}) rose ${rises(shown[i], step)} times in a real second`));
  // And the light was seen: the glows rose, and the fade went dark.
  assert.ok(shown.some((l) => rises(l, step) >= 2), `${fps} fps: the glows flash`);
  const fadeDark = Math.round(5.6 / step);
  assert.ok(parts.glows.every((_, i) => shown[i][fadeDark] === 0), `${fps} fps: every glow dark in the fade of the mode lost`);
}

test("without the picture the shows light nothing and nothing throws; the stand-in's inserts still follow the LIT bits", () => {
  const dt = 1 / 120;
  // The stand-in table with a show lighting every lamp, and the same with none.
  const parts = new TableParts(TABLE_IN_USE);
  const plain = new TableParts(TABLE_IN_USE);
  for (const p of [parts, plain]) {
    p.usePicture(false);
    p.setLit(LIT.rollover0 | LIT.lock);
  }
  const light: LampLight = { level: 1, color: 0xff2bd6 };
  const player = new LightShowPlayer(parts.lamps.all);
  player.play({ seconds: 2, light: () => light }, 0);
  /** The stand-in's look: the glow of each of its caps, rubbers and inserts. */
  const look = (p: InstanceType<typeof TableParts>) =>
    p.standIn.children.map((m) => {
      const mat = (m as THREE.Mesh).material as THREE.MeshStandardMaterial;
      return `${mat.emissive.getHexString()} ${mat.emissiveIntensity}`;
    });
  for (let k = 0; k * dt < 2; k++) {
    if (k % 30 === 0) for (const p of [parts, plain]) p.flashBumper(TABLE_IN_USE.bumpers[0].id);
    parts.setShowLights(player.lights(k * dt));
    parts.update(dt);
    plain.update(dt);
    // The glows are hidden without the picture, so no show's light is seen; and the stand-in takes none of it.
    assert.equal(parts.glowGroup.visible, false, 'the glows are hidden');
    assert.deepEqual(look(parts), look(plain), `the stand-in at ${(k * dt).toFixed(3)} s is as it is with no show`);
  }
  // Lights for fewer lamps than there are, or none at all, are no lamp's light.
  assert.doesNotThrow(() => {
    parts.setShowLights([light]);
    parts.update(dt);
    parts.setShowLights([]);
    parts.update(dt);
  });
  // The stand-in's inserts follow the LIT bits: rollover 0's and the lock's lit (the lock blinking, dim or bright), the
  // other rollovers' not; then rollover 1's alone.
  const inserts = parts.standIn.children.filter((m) => m instanceof THREE.Mesh && m.geometry instanceof THREE.CircleGeometry) as THREE.Mesh[];
  const glowAt = (x: number, z: number) => {
    const m = inserts.find((ins) => near(ins.position.x, x) && near(ins.position.z, z));
    assert.ok(m, `an insert at (${x}, ${z})`);
    return (m.material as THREE.MeshStandardMaterial).emissiveIntensity;
  };
  const [r0, r1, r2] = TABLE_IN_USE.rollovers;
  const { lock } = TABLE_IN_USE;
  assert.ok(glowAt(r0.x, r0.z) > 1 && glowAt(lock.x, lock.z) > 1, 'rollover 0 and the lock lit');
  assert.ok(glowAt(r1.x, r1.z) < 0.5 && glowAt(r2.x, r2.z) < 0.5, 'rollovers 1 and 2 unlit');
  parts.setLit(LIT.rollover1);
  parts.update(dt);
  assert.ok(glowAt(r1.x, r1.z) > 1, 'rollover 1 lit');
  assert.ok(glowAt(r0.x, r0.z) < 0.5 && glowAt(r2.x, r2.z) < 0.5 && glowAt(lock.x, lock.z) < 0.5, 'the rest unlit');
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

test('the reflection scene lays the table picture on the floor under the ball, with the neon panels above it in their colours', () => {
  const picture = new THREE.Texture();
  const light = { top: 2, pink: 3, cyan: 4, warm: 1.5, violet: 2.5 };
  const scene = tableEnvironmentScene(picture, light);
  const meshes = scene.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
  const mat = (m: THREE.Mesh) => m.material as THREE.MeshBasicMaterial;
  const floors = meshes.filter((m) => mat(m).map === picture);
  assert.equal(floors.length, 1, 'one floor carries the picture');
  const floor = floors[0];
  assert.ok(floor.position.y < 0, `under the origin: ${floor.position.y}`);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(floor.quaternion);
  assert.ok(near(normal.y, 1, 1e-6), `faces up: ${normal.y}`);
  // The picture's edge must fall well inside the view below the horizon (5 to 15 degrees down), or the ball sees a sliver.
  const params = (floor.geometry as THREE.PlaneGeometry).parameters;
  const edge = (Math.atan2(-floor.position.y, Math.min(params.width, params.height) / 2) * 180) / Math.PI;
  assert.ok(edge >= 5 && edge <= 15, `the picture's edge is ${edge.toFixed(1)} degrees below the horizon`);
  assert.equal(floor.material instanceof THREE.MeshBasicMaterial && floor.material.map!.wrapS, THREE.ClampToEdgeWrapping, 'clamped');
  const skirt = meshes.filter((m) => m !== floor && m.position.y < floor.position.y);
  assert.equal(skirt.length, 1, 'a dark skirt just below the floor');
  assert.ok(near(mat(skirt[0]).color.getHex(), 0x05030a), 'in the room colour');
  const panels = meshes.filter((m) => m !== floor && m !== skirt[0]);
  assert.equal(panels.length, 5, 'five neon panels');
  const want = [[0xffffff, light.top], [0xff2bd6, light.pink], [0x22e6ff, light.cyan], [0xffb060, light.warm], [0x7040ff, light.violet]];
  for (const [hex, strength] of want) {
    const c = new THREE.Color(hex).multiplyScalar(strength);
    assert.ok(panels.some((m) => !mat(m).map && mat(m).color.equals(c)), `a panel of ${hex.toString(16)} at ${strength}`);
  }
  for (const m of panels) assert.ok(m.position.y > floor.position.y, 'the panels sit above the floor');
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
