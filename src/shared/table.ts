// The pinball table as data: what the physics (the server) and the stage (the picture) both read. Until the picture's
// own table comes in (Task 8), STAND_IN is a classic layout to play on.
//
// Units are scene units, 1 unit = 5.1 cm. The playfield is the plane y = 0; x runs across it (-5 left, +5 right) and z
// runs up the table (0 at the drain, 20 at the top). The shooter lane is the strip at the right, x from 4.2 to 5.

/** The table's size and the ball's. */
export const TABLE = { width: 10, length: 20, tiltDeg: 6.5, ballRadius: 0.27, glassY: 0.8 } as const;

/** A wall: a polyline in (x, z) that the ball bounces off, with how lively the bounce is (0 dead, 1 perfect). */
export interface Wall {
  points: [number, number][];
  restitution: number;
}

/** A pop bumper: a round post that kicks the ball away when it's hit. */
export interface Bumper {
  id: string;
  x: number;
  z: number;
  radius: number;
  kick: number;
  points: number;
}

/** A slingshot: a rubber face from a to b, above a flipper, that kicks the ball back out. */
export interface Sling {
  id: string;
  a: [number, number];
  b: [number, number];
  kick: number;
  points: number;
}

/** A drop target: one of a bank, centered at (x, z) and `width` wide along its wall. */
export interface Target {
  id: string;
  x: number;
  z: number;
  width: number;
  points: number;
}

/** A rollover lane at the top: it scores and lights when a ball rolls over it. */
export interface Rollover {
  id: string;
  x: number;
  z: number;
  points: number;
}

/** The spinner on a lane: it turns as the ball passes and scores for each turn. */
export interface Spinner {
  x: number;
  z: number;
  width: number;
  pointsPerTurn: number;
}

/** The lock: a saucer that holds a ball (for multiball). */
export interface Lock {
  x: number;
  z: number;
  radius: number;
}

/** The kickback: a kicker in the left outlane that, when lit, shoots a draining ball back up. */
export interface Kickback {
  side: 'left';
  x: number;
  z: number;
}

/** The plunger: it sits in the shooter lane at x and fires a ball from zFrom up toward zTo at `speed`. */
export interface Plunger {
  x: number;
  zFrom: number;
  zTo: number;
  speed: number;
}

/**
 * A flipper. Angles are in degrees in the x-z plane, measured from the +x axis toward +z (counterclockwise with x to
 * the right and z up the table). So a left flipper rests at -30 (pointing right and down) and swings up to +30; the
 * right flipper is its mirror, resting at 210 (pointing left and down) and swinging up to 150.
 */
export interface Flipper {
  side: 'left' | 'right';
  pivot: [number, number];
  length: number;
  restDeg: number;
  upDeg: number;
}

/** A whole table. */
export interface Table {
  walls: Wall[];
  bumpers: Bumper[];
  slings: Sling[];
  targets: Target[];
  rollovers: Rollover[];
  spinner: Spinner;
  lock: Lock;
  kickback: Kickback;
  plunger: Plunger;
  /** A ball below this z has drained. */
  drainZ: number;
  flippers: Flipper[];
}

/** Where a flipper's tip is at a given angle (its rest angle by default), from its pivot and length. */
export function flipperTip(f: Flipper, deg: number = f.restDeg): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [f.pivot[0] + f.length * Math.cos(a), f.pivot[1] + f.length * Math.sin(a)];
}

/*
 * The stand-in layout. The playfield is x from -5 to 4.2, so its middle is x = -0.4; the shooter lane (x 4.2 to 5) is
 * walled off on the right. The two sides are mirrors about that middle: x on one side is -0.8 - x on the other.
 */
export const STAND_IN: Table = {
  walls: [
    // The outer wall: up the left side, over the arch at the top, and down the right side (the shooter lane's outer wall).
    {
      points: [[-5, 0], [-5, 16], [-4.2, 18.2], [-2.5, 19.4], [0, 20], [2.5, 19.4], [4.2, 18.2], [5, 16], [5, 0.3]],
      restitution: 0.4,
    },
    // The shooter lane's floor and its inner wall, which stops short of the top so a launched ball comes out over the arch.
    { points: [[4.2, 0.3], [5, 0.3]], restitution: 0.1 },
    { points: [[4.2, 0.3], [4.2, 16.4]], restitution: 0.4 },
    // The inlane guides, from the top of each inlane down to the flipper's pivot.
    { points: [[-3.7, 5.6], [-3.7, 3.6], [-2.1, 2]], restitution: 0.3 },
    { points: [[2.9, 5.6], [2.9, 3.6], [1.3, 2]], restitution: 0.3 },
    // The outlanes' inner walls, from the pivots down to the drain.
    { points: [[2.9, 3.6], [2.9, 0]], restitution: 0.3 },
    { points: [[-3.7, 3.6], [-3.7, 0]], restitution: 0.3 },
    // The orbit lane on the right: a rail that guides a ball up past the spinner.
    { points: [[3.2, 11.5], [3.2, 15.5], [2.2, 17.2]], restitution: 0.3 },
  ],
  bumpers: [
    { id: 'bumper-1', x: -1.6, z: 12.5, radius: 0.55, kick: 9, points: 100 },
    { id: 'bumper-2', x: 0.8, z: 12.5, radius: 0.55, kick: 9, points: 100 },
    { id: 'bumper-3', x: -0.4, z: 10.6, radius: 0.55, kick: 9, points: 100 },
  ],
  slings: [
    { id: 'sling-left', a: [-2.8, 4.8], b: [-2.2, 3.2], kick: 7, points: 10 },
    { id: 'sling-right', a: [2.0, 4.8], b: [1.4, 3.2], kick: 7, points: 10 },
  ],
  targets: [
    { id: 'target-1', x: -4.8, z: 8, width: 0.7, points: 500 },
    { id: 'target-2', x: -4.8, z: 9, width: 0.7, points: 500 },
    { id: 'target-3', x: -4.8, z: 10, width: 0.7, points: 500 },
    { id: 'target-4', x: -4.8, z: 11, width: 0.7, points: 500 },
  ],
  rollovers: [
    { id: 'rollover-1', x: -1.6, z: 17.6, points: 50 },
    { id: 'rollover-2', x: -0.4, z: 17.6, points: 50 },
    { id: 'rollover-3', x: 0.8, z: 17.6, points: 50 },
  ],
  spinner: { x: 3.7, z: 13.5, width: 0.9, pointsPerTurn: 10 },
  lock: { x: -3.2, z: 15, radius: 0.5 },
  kickback: { side: 'left', x: -4.35, z: 1.8 },
  plunger: { x: 4.6, zFrom: 0.7, zTo: 2, speed: 20 },
  drainZ: 0.1,
  flippers: [
    { side: 'left', pivot: [-2.1, 2], length: 1.6, restDeg: -30, upDeg: 30 },
    { side: 'right', pivot: [1.3, 2], length: 1.6, restDeg: 210, upDeg: 150 },
  ],
};
