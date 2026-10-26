// Tests the stage's picture (src/assets/pinball.png, made by `npm run picture` in Blender): it was rendered from the
// table in use (its sidecar's hash), through the stage's own camera (stageCamera), at PICTURE_SCALE times the stage's
// size; that camera puts the table's frame where FRAME_TOP and FRAME_BOTTOM say; the machine in it is where MACHINE
// says; and the full layout's zoom (fullFrameView, setStageView) puts that machine between FULL_TOP and FULL_BOTTOM as
// one 2D zoom of the 3D camera and the picture alike.
// Usage: npm run picture-test
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as THREE from 'three';
import { TABLE, TABLE_IN_USE } from '../src/shared/table';
// The stage's code loads in Node with its CSS and the like stubbed (stub-assets.ts).
import './stub-assets';

const { FRAME_BOTTOM, FRAME_TOP, FULL_BOTTOM, FULL_TOP, MACHINE, PICTURE_SCALE, WHOLE_FRAME, fitStageCamera, fullFrameView, setStageView, stageCamera, tiltTable } = await import('../src/stage/pinball');
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

test("the stage's camera puts its fitted box (the table's frame, not the rails) between FRAME_TOP and FRAME_BOTTOM", () => {
  // The box stageCamera fits: the side rails' outsides, from the cabinet's front (z -1.7) to past the top rail, from the
  // playfield up to the rails' tops (TABLE's size), placed as the stage places the table.
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

test("the picture is PICTURE_SCALE times the stage's size, enough for the full layout's zoom", () => {
  const png = readFileSync(PNG);
  assert.equal(png.toString('ascii', 12, 16), 'IHDR', 'not a PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [Math.round(WIDTH * PICTURE_SCALE), Math.round(HEIGHT * PICTURE_SCALE)]);
  const zoom = WIDTH / fullFrameView().width;
  assert.ok(PICTURE_SCALE >= zoom, `the picture (${PICTURE_SCALE}x) has a texel for each pixel of the full layout's ${zoom.toFixed(3)}x zoom`);
});

/** The picture's opaque box (alpha over 40 of 255), in its own pixels: its edges, right and bottom exclusive. */
function opaqueBox(file: URL): { left: number; top: number; right: number; bottom: number; width: number } {
  const png = readFileSync(file);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.deepEqual([png[24], png[25], png[28]], [8, 6, 0], 'an 8-bit RGBA picture, not interlaced');
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const len = png.readUInt32BE(at);
    if (png.toString('ascii', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  let prev = new Uint8Array(stride);
  let [left, top, right, bottom] = [width, height, 0, 0];
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? row[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = (row[i] + add) & 255;
    }
    for (let x = 0; x < width; x++) {
      if (row[x * 4 + 3] <= 40) continue;
      left = Math.min(left, x);
      right = Math.max(right, x + 1);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + 1);
    }
    prev = row;
  }
  return { left, top, right, bottom, width };
}

test("the machine in the picture (the temple's top to the plunger's knob) is where MACHINE says", () => {
  const box = opaqueBox(PNG);
  const k = WIDTH / box.width;
  for (const edge of ['left', 'top', 'right', 'bottom'] as const) {
    const at = box[edge] * k;
    assert.ok(Math.abs(at - MACHINE[edge]) <= 1.5, `the machine's ${edge} is at ${at.toFixed(1)} px of the frame, not MACHINE.${edge} ${MACHINE[edge]}`);
  }
});

/** A frame pixel (x right, y down) through the full layout's view rectangle: where it lands on the screen. */
const zoomed = (view: { x: number; y: number; width: number }, x: number, y: number): [number, number] => [(x - view.x) * (WIDTH / view.width), (y - view.y) * (WIDTH / view.width)];

/** The right column of the city's full layout (style.css's #right: 372 px wide, 30 px in from the right). */
const RIGHT_COLUMN_LEFT = WIDTH - 30 - 372;

test("the full layout's view: the machine's span fills the frame's height (FULL_TOP to FULL_BOTTOM), centred, clear of the right column", () => {
  const view = fullFrameView();
  assert.ok(Math.abs(view.width / view.height - WIDTH / HEIGHT) < 1e-9, "the rectangle is the frame's shape: one zoom, both ways");
  assert.ok(Math.abs(view.x + view.width / 2 - WIDTH / 2) < 1e-9, 'centred across');
  const zoom = WIDTH / view.width;
  assert.ok(zoom > 1.12 && zoom < 1.16, `about 14% bigger (${zoom.toFixed(4)})`);
  const [, top] = zoomed(view, 0, MACHINE.top);
  const [, bottom] = zoomed(view, 0, MACHINE.bottom);
  assert.ok(Math.abs(top - FULL_TOP) < 1e-6 && Math.abs(bottom - FULL_BOTTOM) < 1e-6, `the machine runs ${top.toFixed(2)} to ${bottom.toFixed(2)}, not ${FULL_TOP} to ${FULL_BOTTOM}`);
  assert.ok(FULL_TOP > 0 && FULL_BOTTOM < HEIGHT && FULL_TOP <= 12 && HEIGHT - FULL_BOTTOM <= 12, 'inside the frame, with a small margin');
  const [left] = zoomed(view, MACHINE.left, 0);
  const [right] = zoomed(view, MACHINE.right, 0);
  assert.ok(left > 0 && right < RIGHT_COLUMN_LEFT, `the machine (${left.toFixed(0)} to ${right.toFixed(0)}) is clear of the right column (from ${RIGHT_COLUMN_LEFT})`);
});

/** A camera placed as the stage places its own, and the picture's plate camera and plate, as the scene makes them. */
function cameras() {
  const camera = new THREE.PerspectiveCamera();
  const viewY = fitStageCamera(camera, WIDTH, HEIGHT);
  const plateCamera = new THREE.OrthographicCamera(-WIDTH / 2, WIDTH / 2, HEIGHT / 2, -HEIGHT / 2, -10, 10);
  plateCamera.updateMatrixWorld(true);
  const plate = new THREE.Object3D();
  const table = tiltTable(new THREE.Group());
  table.updateMatrixWorld(true);
  /** A table point (its own coordinates) on the screen, through the 3D camera. */
  const live = (x: number, y: number, z: number): [number, number] => {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(table.matrixWorld).project(camera);
    return [((p.x + 1) / 2) * WIDTH, ((1 - p.y) / 2) * HEIGHT];
  };
  /** The picture's pixel (u, v), in frame pixels, on the screen, through the plate camera. */
  const pictured = (u: number, v: number): [number, number] => {
    const p = new THREE.Vector3(u - WIDTH / 2 + plate.position.x, HEIGHT / 2 - v + plate.position.y, 0).project(plateCamera);
    return [((p.x + 1) / 2) * WIDTH, ((1 - p.y) / 2) * HEIGHT];
  };
  return { camera, viewY, plateCamera, plate, live, pictured };
}
const POINTS: [number, number, number][] = [[-5, 0, 0], [5, 0, 0.3], [0, 0, 16.7], [-2.1, 0, 2], [1.3, 0, 2], [-0.4, 0, 10.7], [-5, 0.5, 13.0], [3, 1.2, 8]];
const near = (a: [number, number], b: [number, number], what: string, tol = 1e-6) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol, `${what}: ${a.map((v) => v.toFixed(3))} vs ${b.map((v) => v.toFixed(3))}`);

test('the full layout zooms the 3D camera and the picture alike: each table point stays on its pixel of the picture', () => {
  const c = cameras();
  const base = POINTS.map((p) => c.live(...p));
  const view = fullFrameView();
  setStageView(c.camera, c.viewY, c.plateCamera, c.plate, view, 0, 0);
  POINTS.forEach((p, i) => {
    const want = zoomed(view, ...base[i]);
    near(c.live(...p), want, `table point ${p} through the zoomed camera`);
    // The picture's pixel under that point in the frame it was rendered for lands on the same screen pixel.
    near(c.pictured(...base[i]), want, `the picture's pixel under ${p}`);
  });
});

test('the whole frame (corner, 9:16) leaves the camera and the picture as fitStageCamera puts them', () => {
  const c = cameras();
  const base = POINTS.map((p) => c.live(...p));
  setStageView(c.camera, c.viewY, c.plateCamera, c.plate, fullFrameView(), 0, 0);
  setStageView(c.camera, c.viewY, c.plateCamera, c.plate, WHOLE_FRAME, 0, 0);
  POINTS.forEach((p, i) => {
    near(c.live(...p), base[i], `table point ${p}`);
    near(c.pictured(...base[i]), base[i], `the picture's pixel under ${p}`);
  });
});

test('a shake moves the table and the picture together by the same screen pixels, zoomed or not', () => {
  for (const view of [WHOLE_FRAME, fullFrameView()]) {
    const c = cameras();
    setStageView(c.camera, c.viewY, c.plateCamera, c.plate, view, 0, 0);
    const still = POINTS.map((p) => c.live(...p));
    // The picture's pixel under each point, in the frame it was rendered for (the view's rectangle run back).
    const pic = still.map(([x, y]) => [view.x + (x * view.width) / WIDTH, view.y + (y * view.width) / WIDTH] as [number, number]);
    setStageView(c.camera, c.viewY, c.plateCamera, c.plate, view, 13, -7);
    POINTS.forEach((p, i) => {
      const want: [number, number] = [still[i][0] + 13, still[i][1] - 7];
      near(c.live(...p), want, `table point ${p} shaken`);
      near(c.pictured(...pic[i]), want, `the picture under ${p} shaken`);
    });
  }
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
