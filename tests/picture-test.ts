// Tests the stage's picture (src/assets/pinball.png, made by `npm run picture` in Blender): it was rendered from the
// table in use (its sidecar's hash), through the stage's own camera (stageCamera), at the stage's size; and that camera
// puts the table's frame where FRAME_TOP and FRAME_BOTTOM say.
// Usage: npm run picture-test
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { TABLE, TABLE_IN_USE } from '../src/shared/table';
// The stage's code loads in Node with its CSS and the like stubbed (stub-assets.ts).
import './stub-assets';

const { FRAME_BOTTOM, FRAME_TOP, stageCamera, tiltTable } = await import('../src/stage/pinball');
const { WIDTH, HEIGHT } = await import('@kit/stage');

const PNG = new URL('../src/assets/pinball.png', import.meta.url);
const SIDECAR = new URL('../src/assets/pinball.json', import.meta.url);

interface Sidecar {
  tableHash: string;
  camera: { matrix: number[]; fovY: number; viewY: number };
  width: number;
  height: number;
}
const sidecar = (): Sidecar => JSON.parse(readFileSync(SIDECAR, 'utf8')) as Sidecar;

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

test('the picture was rendered from the table in use', () => {
  const live = createHash('sha256').update(JSON.stringify(TABLE_IN_USE)).digest('hex');
  assert.equal(sidecar().tableHash, live, 'the table changed since the picture was made: run npm run picture');
});

test("the picture's camera is the stage's camera", () => {
  const { camera } = sidecar();
  const stage = stageCamera(TABLE_IN_USE, WIDTH, HEIGHT);
  assert.equal(camera.matrix.length, 16);
  stage.matrix.forEach((v, i) => assert.ok(Math.abs(camera.matrix[i] - v) <= 1e-6, `matrix[${i}]: ${camera.matrix[i]} vs the stage's ${v}`));
  assert.ok(Math.abs(camera.fovY - stage.fovY) <= 1e-6, `fovY: ${camera.fovY} vs the stage's ${stage.fovY}`);
  assert.ok(Math.abs(camera.viewY - stage.viewY) <= 1e-6, `viewY: ${camera.viewY} vs the stage's ${stage.viewY}`);
});

test("the stage's camera fits the table's frame between FRAME_TOP and FRAME_BOTTOM", () => {
  // The box stageCamera fits: the side rails' outsides, the front rail to past the top rail, from the playfield up to
  // the rails' tops (TABLE's size), placed as the stage places the table.
  const fit = stageCamera(TABLE_IN_USE, WIDTH, HEIGHT);
  const camera = new THREE.PerspectiveCamera(fit.fovY, WIDTH / HEIGHT, 0.5, 200);
  camera.matrixAutoUpdate = false;
  camera.matrixWorld.fromArray(fit.matrix);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  camera.setViewOffset(WIDTH, HEIGHT, 0, fit.viewY, WIDTH, HEIGHT);
  const table = tiltTable(new THREE.Group());
  table.updateMatrixWorld(true);
  const half = TABLE.width / 2 + 0.8;
  const ys: number[] = [];
  for (const x of [-half, half]) {
    for (const z of [-1.7, TABLE.length + 0.6]) {
      for (const y of [0, 0.9]) ys.push(((1 - new THREE.Vector3(x, y, z).applyMatrix4(table.matrixWorld).project(camera).y) / 2) * HEIGHT);
    }
  }
  // The camera steps back in small steps until the box fits, so each edge is within a pixel of its band's.
  const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
  assert.ok(Math.abs(top - FRAME_TOP) <= 1, `the frame's top is at ${top.toFixed(1)} px, not FRAME_TOP ${FRAME_TOP}`);
  assert.ok(Math.abs(bottom - FRAME_BOTTOM) <= 1, `the frame's bottom is at ${bottom.toFixed(1)} px, not FRAME_BOTTOM ${FRAME_BOTTOM}`);
});

test("the picture is the stage's size", () => {
  const png = readFileSync(PNG);
  assert.equal(png.toString('ascii', 12, 16), 'IHDR', 'not a PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [WIDTH, HEIGHT]);
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
