// The pyramid table: the table the owner's picture is of, designed and proven in a Blender spike (the pieces' reasons below
// are the spike's own notes, from the layouts it grew through). It is 16.7 long: the apron below the flippers is gone, so
// the drain and the flippers start at the cabinet's front and the room gained went to play.
//
// The playfield is x from -5 to 4.2, so its middle is x = -0.4 (the bumpers', the pyramid's and the main flippers' axis);
// the shooter lane (x 4.2 to 5) is walled off on the right. The main flippers are mirrors about that middle: x on one
// side is -0.8 - x on the other. Walls stand TABLE.wallTop high; the dish, the ramps and the glass (TABLE.glassY) are over them.
import type { Table } from './table';

export const PYRAMID: Table = {
  walls: [
    // The outer wall: up the left side, over the arch at the top, and down the right side (the shooter lane's outer wall).
    { kind: 'outer', points: [[-5, 0], [-5, 13], [-4.2, 15], [-2.5, 16.2], [0, 16.7], [2.5, 16.2], [4.2, 15], [5, 13], [5, 0.3]], restitution: 0.4 },
    // The shooter lane's floor and its inner wall, which stops short of the top so a launched ball comes out over the arch.
    { kind: 'shooter', points: [[4.2, 0.3], [5, 0.3]], restitution: 0.1 },
    { kind: 'shooter', points: [[4.2, 0.3], [4.2, 12.1]], restitution: 0.4 },
    // The inlane guides: the left one from the left wall down to the flipper's pivot, the right one from the top of its
    // inlane down to its pivot; the right outlane's inner wall is the guide that runs on down to the drain.
    { kind: 'guide', points: [[-5, 6.6], [-4.2, 6], [-4.2, 3.6], [-2.1, 2]], restitution: 0.3 },
    { kind: 'guide', points: [[3.25, 5.6], [3.25, 3.6], [1.3, 2]], restitution: 0.3 },
    { kind: 'guide', points: [[3.25, 3.6], [3.25, 0]], restitution: 0.3 },
    // The orbit: a wall that guides a ball round the upper table, up the left side, over the top and down the right.
    { kind: 'orbit', points: [[-4, 8.7], [-4, 12.3], [-3.9, 13.5], [-3.2, 14.5], [-2, 15.2], [-0.6, 15.6], [1, 15.45], [2.2, 14.8], [2.9, 13.9], [3.2, 12.6], [3.2, 8.9]], restitution: 0.35 },
    // The pyramid: a square base 2.7 across, standing on the table's centre line (x -0.4), its corners at the front, right,
    // top and left. It is 1.5 times as wide as the first one. Its left corner (-1.75) would have closed the lane by the
    // left ramp's mouth, so the mouth moved up its own shot line (see ramp-left) instead.
    { kind: 'pyramid', points: [[-0.4, 5.75], [0.95, 7.1], [-0.4, 8.45], [-1.75, 7.1], [-0.4, 5.75]], restitution: 0.45 },
    // The island under the upper flipper, at the orbit's right side.
    { kind: 'island', points: [[2.2, 14.8], [2.35, 12.1], [3.2, 12.1]], restitution: 0.35 },
    // The slings' backs, closing the pocket behind each sling.
    { kind: 'slingback', points: [[-2.8, 4.8], [-3.1, 3.85], [-2.2, 3.2]], restitution: 0.3 },
    { kind: 'slingback', points: [[2, 4.8], [2.25, 3.85], [1.4, 3.2]], restitution: 0.3 },
    // The top lanes' guides end at 14.3, lower than the orbit wall above them: a ball wedged between a guide's top and the wall.
    { kind: 'lane', points: [[-1.9, 13.65], [-1.9, 14.3]], restitution: 0.3 },
    { kind: 'lane', points: [[-0.9, 13.65], [-0.9, 14.3]], restitution: 0.3 },
    { kind: 'lane', points: [[0.1, 13.65], [0.1, 14.3]], restitution: 0.3 },
    { kind: 'lane', points: [[1.1, 13.65], [1.1, 14.3]], restitution: 0.3 },
    // The nook under the dish is closed off, from the left ramp's top corner to the orbit wall: a ball came to rest in it.
    { kind: 'island', points: [[-3.24, 13.4], [-2, 15.2]], restitution: 0.35 },
  ],
  bumpers: [
    { id: 'bumper-1', x: -1.4, z: 12.4, radius: 0.55, kick: 9, points: 100 },
    { id: 'bumper-2', x: 0.6, z: 12.4, radius: 0.55, kick: 9, points: 100 },
    { id: 'bumper-3', x: -0.4, z: 10.7, radius: 0.55, kick: 9, points: 100 },
    // The fourth bumper stands on the dish (y0), toward its uphill rim, the gap there narrower than a ball, so a ball is
    // never uphill of it: on a flat dish one rested against its uphill side, and a coned floor pinned one at the uphill rim.
    { id: 'bumper-4', x: -3.6, z: 14.8, radius: 0.35, kick: 7, points: 200, y0: 0.8 },
    // The small sun-disc bumper above the right sling, where the left flipper's shots cross (the slope bends them down: at
    // 6.3 they passed under it), leaving a ball's width and more to the right sling's top corner (0.67) and to the right
    // inlane's mouth (0.81).
    { id: 'bumper-sun', x: 2.05, z: 5.9, radius: 0.35, kick: 7, points: 100 },
  ],
  slings: [
    { id: 'sling-left', a: [-2.8, 4.8], b: [-2.2, 3.2], kick: 7, points: 10 },
    { id: 'sling-right', a: [2, 4.8], b: [1.4, 3.2], kick: 7, points: 10 },
  ],
  targets: [
    // The scarab target on the pyramid's upper-left face, and the eye on its upper-right face, each 0.12 out from the
    // middle of its face. (The lower faces carry banks of flip plaques, below.)
    { id: 'target-scarab', x: -1.195, z: 7.895, width: 0.6, points: 500 },
    { id: 'target-eye', x: 0.395, z: 7.895, width: 0.6, points: 500 },
    // The Ra bank: three flip targets along the right orbit's inner wall, facing the left flipper. They are 0.5 wide, 0.54
    // apart, from 9.2 to 10.78: standing (no longer dropping), the top plaque (to 11.0) held a ball under the upper
    // flipper's base, and a bottom one moved lower closed the gap to the Horus bank's end.
    { id: 'target-ra-1', x: 3.02, z: 9.45, width: 0.5, points: 300, flip: true },
    { id: 'target-ra-2', x: 3.02, z: 9.99, width: 0.5, points: 300, flip: true },
    { id: 'target-ra-3', x: 3.02, z: 10.53, width: 0.5, points: 300, flip: true },
    // The Horus bank: three flip targets in a row in the open floor right of the pyramid, its face square to the left
    // flipper's shots past the pyramid's right corner (from about (-1.4, 3.3)). Along the left ramp's side, their faces ran
    // parallel to every shot from the flippers, and they shut the way up to the lock. The bank sits 0.25 left and 0.15 up
    // of where it started: the 0.7 between its right end and the right orbit wall's tip held balls coming down onto its back.
    { id: 'target-horus-1', x: 0.983, z: 9.468, width: 0.6, points: 300, angle: -29.31, flip: true },
    { id: 'target-horus-2', x: 1.55, z: 9.15, width: 0.6, points: 300, angle: -29.31, flip: true },
    { id: 'target-horus-3', x: 2.117, z: 8.832, width: 0.6, points: 300, angle: -29.31, flip: true },
    // The Ankh bank on the pyramid's lower-left face (facing the right flipper) and the Eye bank on its lower-right face
    // (facing the left): three plaques along each face from the front corner, close to the face (0.14 out) and slid 0.18
    // toward the front corner, 0.5 wide. Across the whole face at 0.6, the top one stood out into the shot up the left
    // ramp past the pyramid's left corner (2 of 10 shots made it). On the pyramid's faces they block nothing that wasn't
    // already a wall; a bank under the pyramid stood in the shot up the left ramp, and one by the left inlane trapped
    // every ball down the left orbit.
    { id: 'target-ankh-1', x: -0.672, z: 5.824, width: 0.5, points: 300, angle: 135, flip: true },
    { id: 'target-ankh-2', x: -1.047, z: 6.199, width: 0.5, points: 300, angle: 135, flip: true },
    { id: 'target-ankh-3', x: -1.421, z: 6.573, width: 0.5, points: 300, angle: 135, flip: true },
    { id: 'target-eye-1', x: -0.128, z: 5.824, width: 0.5, points: 300, angle: 45, flip: true },
    { id: 'target-eye-2', x: 0.247, z: 6.199, width: 0.5, points: 300, angle: 45, flip: true },
    { id: 'target-eye-3', x: 0.621, z: 6.573, width: 0.5, points: 300, angle: 45, flip: true },
  ],
  rollovers: [
    // The three top lanes, between the lane guides.
    { id: 'rollover-1', x: -1.4, z: 14.05, points: 50 },
    { id: 'rollover-2', x: -0.4, z: 14.05, points: 50 },
    { id: 'rollover-3', x: 0.6, z: 14.05, points: 50 },
    // The inlanes' and the right outlane's switches: lighting the kickback, spelling bonuses.
    { id: 'inlane-left', x: -3.65, z: 4.4, points: 100 },
    { id: 'inlane-right', x: 2.75, z: 4.4, points: 100 },
    { id: 'outlane-right', x: 3.72, z: 3.1, points: 250 },
    // Under the centre lane's four lamps, so a ball down the middle lights them in turn.
    { id: 'centre-1', x: -0.4, z: 2.9, points: 25 },
    { id: 'centre-2', x: -0.4, z: 3.52, points: 25 },
    { id: 'centre-3', x: -0.4, z: 4.14, points: 25 },
    { id: 'centre-4', x: -0.4, z: 4.76, points: 25 },
  ],
  // The spinner on the left orbit's outside lane.
  spinner: { x: -4.5, z: 9.3, width: 0.9, pointsPerTurn: 10 },
  // The lock sits right of the left ramp's foot, clear of it.
  lock: { x: -2.4, z: 12.95, radius: 0.5 },
  kickback: { side: 'left', x: 3.72, z: 1.8 },
  // 34 units/s (1.7 m/s): a launch, already rolling, gets round the arch; at 20 a launch got only to z 7: tilted gravity
  // takes 21.7 units/s² off it.
  plunger: { x: 4.6, zFrom: 0.7, zTo: 2, speed: 34 },
  drainZ: 0.1,
  flippers: [
    { side: 'left', pivot: [-2.1, 2], length: 1.6, restDeg: -30, upDeg: 30 },
    { side: 'right', pivot: [1.3, 2], length: 1.6, restDeg: 210, upDeg: 150 },
    // The upper flipper's pivot is tucked against the right orbit's wall and just under the island (no pocket at its
    // base); at rest it points down and left like the right flipper, and it swings up on the right button.
    { side: 'right', pivot: [2.85, 11.7], length: 1, restDeg: 210, upDeg: 150 },
  ],
  ramps: [
    // Up the left lane, curling left as it climbs, into the dish's south gap. Its mouth is flared, at (-2.75, 8) where the
    // right flipper's shots 27 degrees left of straight up arrive (measured with real flips; the steeper ones, 32, are the
    // left orbit's). Pointing straight up the table no flip went up it, and bent away from the shot's line a flip lost its
    // speed on the rails. The mouth sits above the pyramid's left corner, 0.9 clear of it; at (-2.95, 8.4) the shorter,
    // steeper ramp lost half the shots up it. It rises on a smooth profile from the playfield, because a kink in a ramp's
    // slope takes a ball's speed like a step.
    {
      id: 'ramp-left', width: 0.8, flare: 0.45, rail: 0.45,
      path: [
        [-2.75, 8, 0], [-2.8, 8.311, 0.008], [-2.85, 8.622, 0.031],
        [-2.9, 8.934, 0.066], [-2.95, 9.245, 0.112], [-3, 9.556, 0.167],
        [-3.05, 9.867, 0.229], [-3.1, 10.178, 0.295], [-3.15, 10.489, 0.365],
        [-3.2, 10.801, 0.435], [-3.25, 11.112, 0.505], [-3.3, 11.423, 0.571],
        [-3.35, 11.734, 0.633], [-3.4, 12.045, 0.688], [-3.45, 12.356, 0.734],
        [-3.5, 12.668, 0.769], [-3.55, 12.979, 0.792], [-3.6, 13.29, 0.8],
      ],
    },
    // The right S-ramp: a raised gold wireform from the dish's east gap, across the top over the orbit, S-curving down the
    // right side over the right orbit, and dropping the ball off its end onto the playfield above the right inlane. It
    // stands clear everywhere (balls in the orbit and on the playfield pass under it) and runs downhill the whole way, so a
    // ball on it always leaves it. (An S-hump in the orbit lane itself trapped balls: a pocket against the shooter's gate,
    // and a valley at the hump's foot.) It goes east from the dish and gently down the table from there on: its first run
    // went up the table, and a ball leaving the dish ran out of speed on it and rolled back.
    {
      id: 'ramp-right', width: 0.6, rail: 0.45, skirt: false,
      path: [
        [-2.55, 14.35, 0.8], [-2.172, 14.345, 0.799], [-1.794, 14.34, 0.799],
        [-1.415, 14.335, 0.798], [-1.037, 14.33, 0.798], [-0.659, 14.32, 0.797],
        [-0.281, 14.308, 0.796], [0.097, 14.296, 0.796], [0.475, 14.285, 0.795],
        [0.854, 14.273, 0.795], [1.232, 14.261, 0.794], [1.609, 14.245, 0.793],
        [1.942, 14.066, 0.793], [2.275, 13.887, 0.792], [2.608, 13.707, 0.792],
        [2.926, 13.511, 0.791], [3.136, 13.197, 0.79], [3.345, 12.882, 0.79],
        [3.555, 12.567, 0.789], [3.622, 12.203, 0.788], [3.651, 11.826, 0.788],
        [3.679, 11.449, 0.787], [3.707, 11.072, 0.787], [3.735, 10.694, 0.786],
        [3.721, 10.319, 0.785], [3.662, 9.945, 0.785], [3.602, 9.572, 0.784],
        [3.543, 9.198, 0.784], [3.483, 8.825, 0.783], [3.424, 8.451, 0.782],
        [3.334, 8.085, 0.782], [3.222, 7.723, 0.781], [3.111, 7.362, 0.781],
        [3, 7, 0.78],
      ],
    },
  ],
  dishes: [
    // The raised dish at the top left, holding bumper-4. Its rim stands 1.15 over its floor (gold to 0.45, clear acrylic
    // above): a hard shot up the left ramp reached it still climbing, jumped a 0.45 rim and dropped behind the top-left
    // arch, off the playfield (1 in 3,250 shots). Gaps at 250 to 290 degrees (the south, where the left ramp comes in) and
    // -18 to 18 (the east, where the right ramp leaves).
    { id: 'dish', x: -3.6, z: 14.35, y: 0.8, r: 1.1, rail: 1.15, gaps: [[250, 290], [-18, 18]] },
  ],
  saucers: [
    // The Scarab saucer in the lane behind the pyramid's left side, where balls come down from the bumpers: a slow ball
    // drops in, is held, and is kicked up and right into the pop bumpers (down, the lane past the pyramid is narrower
    // than a ball).
    { id: 'saucer-scarab', x: -1.95, z: 10, radius: 0.12, hold: 0.8, eject: [0.8, 0.6], speed: 7, maxSpeed: 14, points: 750 },
    // The Eye of Ra magnet in the centre lane under the pyramid: a slow ball over it is held a moment and flung out, left
    // and right in turn, toward the slings. It steps down to z 5.1, clear of the pyramid's front corner (z 5.75).
    { id: 'magnet-ra', x: -0.4, z: 5.1, radius: 0.12, hold: 0.7, eject: [1, -0.35], speed: 9, maxSpeed: 12, alternate: true, points: 250 },
  ],
  spinners: [
    // Across the right orbit lane (between its wall at x 3.2 and the shooter lane's at 4.2), under the right ramp.
    { id: 'spinner-right', x: 3.7, z: 10, width: 0.8, pointsPerTurn: 10 },
  ],
  // Banks of flip targets: one stays up when hit and turns to its back; when all three of a bank show their backs the bank
  // matches (the game pays its bonus) and they turn back a second later.
  banks: [
    { id: 'bank-horus', targets: ['target-horus-1', 'target-horus-2', 'target-horus-3'], bonus: 5000 },
    { id: 'bank-ra', targets: ['target-ra-1', 'target-ra-2', 'target-ra-3'], bonus: 5000 },
    { id: 'bank-ankh', targets: ['target-ankh-1', 'target-ankh-2', 'target-ankh-3'], bonus: 5000 },
    { id: 'bank-eye', targets: ['target-eye-1', 'target-eye-2', 'target-eye-3'], bonus: 5000 },
  ],
};
