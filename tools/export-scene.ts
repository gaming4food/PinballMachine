// Writes blender/scene.json for the Blender build (blender/build_table.py): the table in use, with its walls as the
// physics builds them (wallsWithTomb: the pyramid's wall cut open for the tomb's doorway, and the doorway's jambs), the
// pyramid as the build sculpts it (its closed outline's corners and the doorway's mouth and pocket, worked out here so
// the build never works them out again), the table's place in the world and the stage's camera, both exactly as the
// stage sets them (tiltTable and stageCamera in src/stage/pinball.ts, never copied numbers), the flippers' shape (the
// physics', which the stage draws too), and where a few known table points land on the stage's frame, which the build
// checks its own camera against (CAMERA MATCH).
// Usage: npx tsx tools/export-scene.ts [out path]   (npm run picture runs it)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FLIPPER_SHAPE, TABLE, TABLE_IN_USE, tombMouth, wallsWithTomb, type Table } from '../src/shared/table';
// The stage's code loads in Node with its CSS and the like stubbed.
import '../tests/stub-assets';

const { stageCamera, tiltTable } = await import('../src/stage/pinball');
const { WIDTH, HEIGHT } = await import('@kit/stage');

/** Table points (x, y, z in the table's own coordinates) whose pixels the build checks: corners, the top, a rail. */
const PROBES: [number, number, number][] = [[-5, 0, 0], [5, 0, 0.3], [0, 0, 16.7], [-2.1, 0, 2], [1.3, 0, 2], [-0.4, 0, 10.7], [-5, 0.5, 13.0]];

/**
 * The pyramid as the build sculpts it: the corners of its closed outline (the `pyramid` wall's points less the one that
 * closes it, so from the front corner round), and, on a table with a tomb, the doorway cut into that corner: the
 * mouth's two ends (`a` its right end, `b` its left: tombMouth) and the pocket behind the mouth, from `a` round the
 * jambs' far corners to `b` (the jambs wallsWithTomb adds).
 */
export interface Pyramid {
  corners: [number, number][];
  doorway: { a: [number, number]; b: [number, number]; pocket: [number, number][] } | null;
}

export interface Scene {
  pixels: { table: [number, number, number]; px: [number, number] }[];
  width: number;
  height: number;
  fovY: number;
  viewY: number;
  cameraMatrix: number[];
  tableMatrix: number[];
  tableConst: typeof TABLE;
  flipperShape: typeof FLIPPER_SHAPE;
  /** The table in use, its walls as the physics builds them (wallsWithTomb). */
  table: typeof TABLE_IN_USE;
  /** Null on a table with no pyramid wall. */
  pyramid: Pyramid | null;
}

/** The pyramid as the build sculpts it, from the table's own outline, tombMouth and wallsWithTomb's jambs. */
function pyramidOf(t: Table): Pyramid | null {
  const wall = t.walls.find((w) => w.kind === 'pyramid');
  if (!wall) return null;
  const mouth = tombMouth(t);
  const jambs = wallsWithTomb(t).filter((w) => w.kind === 'tomb');
  // Each jamb runs from its end of the mouth straight up the table to the pocket's far side: a's first, then b's.
  const doorway = mouth && jambs.length === 2 ? { ...mouth, pocket: [jambs[0].points[0], jambs[0].points[1], jambs[1].points[1], jambs[1].points[0]] } : null;
  return { corners: wall.points.slice(0, -1), doorway };
}

export function exportScene(): Scene {
  const table = tiltTable(new THREE.Group());
  table.updateMatrixWorld(true);
  const fit = stageCamera(TABLE_IN_USE, WIDTH, HEIGHT);
  const camera = new THREE.PerspectiveCamera(fit.fovY, WIDTH / HEIGHT, 0.5, 200);
  camera.matrixAutoUpdate = false;
  camera.matrix.fromArray(fit.matrix);
  camera.matrixWorld.fromArray(fit.matrix);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  camera.setViewOffset(WIDTH, HEIGHT, 0, fit.viewY, WIDTH, HEIGHT);
  const pixels = PROBES.map((t) => {
    const p = new THREE.Vector3(...t).applyMatrix4(table.matrixWorld).project(camera);
    return { table: t, px: [((p.x + 1) / 2) * WIDTH, ((1 - p.y) / 2) * HEIGHT] as [number, number] };
  });
  return {
    pixels,
    width: WIDTH,
    height: HEIGHT,
    fovY: fit.fovY,
    viewY: fit.viewY,
    cameraMatrix: fit.matrix, // column-major, three's Y-up world
    tableMatrix: [...table.matrixWorld.elements],
    tableConst: TABLE,
    flipperShape: FLIPPER_SHAPE,
    table: { ...TABLE_IN_USE, walls: wallsWithTomb(TABLE_IN_USE) },
    pyramid: pyramidOf(TABLE_IN_USE),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = process.argv[2] ?? fileURLToPath(new URL('../blender/scene.json', import.meta.url));
  writeFileSync(path, JSON.stringify(exportScene(), null, 1));
  console.log(`wrote ${path}`);
}
