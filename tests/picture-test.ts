// Tests the stage's picture (src/assets/pinball.png, made by `npm run picture` in Blender): it was rendered from the
// table in use (its sidecar's hash), through the stage's own camera (stageCamera), at the stage's size.
// Usage: npm run picture-test
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TABLE_IN_USE } from '../src/shared/table';
// The stage's code loads in Node with its CSS and the like stubbed (stub-assets.ts).
import './stub-assets';

const { stageCamera } = await import('../src/stage/pinball');
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
