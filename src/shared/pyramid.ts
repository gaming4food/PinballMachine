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
    // inlane down to its pivot; the right outlane's inner wall is the guide that runs on down to the drain. The left
    // one's last run is the right one's mirror (from x -4.05): from -4.2 its gentler slope held a ball caught on the left
    // flipper on the flipper's base once the flipper dropped (6 of 81 catches sat there for good; none on the right).
    { kind: 'guide', points: [[-5, 6.6], [-4.2, 6], [-4.05, 3.6], [-2.1, 2]], restitution: 0.3 },
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
    // The small sun-disc bumper capping the right inlane's guide, where balls come down the right side (off the right
    // ramp's end and out of the right orbit) and the inlane and the outlane part: sealed to the guide's top, 0.7 to the
    // shooter lane's wall, clear of the kickback's shot up the outlane (at x 3.25, 0.25 across, it clipped it), and its
    // base clear of the double-score ladder's first lamp. Above the right sling (2.05, 5.9) it stood in the left
    // flipper's commonest shot, the one round the right orbit: none of the sim test's ten left flips got past z 12 (6 do
    // now), nor 13% of a sweep of real flips (30% now).
    { id: 'bumper-sun', x: 3.12, z: 5.88, radius: 0.3, kick: 7, points: 100 },
  ],
  slings: [
    { id: 'sling-left', a: [-2.8, 4.8], b: [-2.2, 3.2], kick: 7, points: 10 },
    { id: 'sling-right', a: [2, 4.8], b: [1.4, 3.2], kick: 7, points: 10 },
  ],
  targets: [
    // The two drop targets, the scarab and the eye, side by side in the open right of the pyramid and in front of the
    // Horus bank, square to the left flipper's steeper shots (from about (-0.9, 3)), 0.62 apart: the stage's camera sees
    // their faces as well as the Horus bank's. On the pyramid's upper faces it saw only their backs. The order of this
    // list is the snapshot's and the sim's target numbering.
    { id: 'target-scarab', x: 1.323, z: 8.139, width: 0.55, points: 500, angle: -26.57 },
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
    // The eye target, the scarab's partner (above).
    { id: 'target-eye', x: 1.877, z: 7.861, width: 0.55, points: 500, angle: -26.57 },
    // The Ankh bank on the pyramid's lower-left face (facing the right flipper) and the Eye bank on its lower-right face
    // (facing the left): three plaques along each face from the front corner, close to the face (0.14 out). Across the
    // whole face at 0.6, the top one stood out into the shot up the left ramp past the pyramid's left corner (2 of 10
    // shots made it). On the pyramid's faces they block nothing that wasn't already a wall; a bank under the pyramid
    // stood in the shot up the left ramp, and one by the left inlane trapped every ball down the left orbit.
    // Each bank was 0.5 wide at 0.245, 0.775 and 1.305 along its face from the front corner, the lowest nearly meeting
    // its twin there. The tomb's doorway is cut into that corner (tomb, below), so the lowest now starts past its
    // mouth, 0.424 along, and three 0.5 wide no longer fit. The Eye bank is 0.42 wide, centred 0.66, 1.11 and 1.56
    // along. The Ankh bank cannot be: its highest plaque may end no farther up than about 1.57, or it clips the shot up
    // the left ramp past the pyramid's left corner (at 0.42 wide only 6 of the layout test's 10 shots, and 14 of its
    // 25, reached the dish, where the old bank held 9 and 20). So it is packed against the doorway: 0.38 wide, the
    // least planned for a plaque, 0.382 apart from 0.427 to 1.570 along, with under 0.01 to spare. The Eye bank can't
    // be packed alike: the left flipper's first shot in pinball-sim-test then lands on a drop target, not round the
    // right orbit (5 of 10 get up there, where 6 are held). (Provisional, like the toys below, until the quest's toys
    // are measured on the table.)
    { id: 'target-ankh-1', x: -0.935, z: 6.087, width: 0.38, points: 300, angle: 135, flip: true },
    { id: 'target-ankh-2', x: -1.205, z: 6.357, width: 0.38, points: 300, angle: 135, flip: true },
    { id: 'target-ankh-3', x: -1.475, z: 6.627, width: 0.38, points: 300, angle: 135, flip: true },
    { id: 'target-eye-1', x: 0.166, z: 6.118, width: 0.42, points: 300, angle: 45, flip: true },
    { id: 'target-eye-2', x: 0.484, z: 6.436, width: 0.42, points: 300, angle: 45, flip: true },
    { id: 'target-eye-3', x: 0.802, z: 6.754, width: 0.42, points: 300, angle: 45, flip: true },
    // The quest's toys, after the fourteen above: the snapshot header's bit for each of those must not move. These
    // start down (no wall, nothing to hit) and the game raises them. The three pop-ups run up the open floor right of
    // the pyramid, each stepped down the table and out from the one before, and drop when hit; the mummy stands in the
    // left lane, taller and thicker than the rest, and stays up when hit, scoring every hit. (All four spots are
    // provisional: the toys are to be measured on the table, and these placed from the measurements.)
    { id: 'target-popup-1', x: 1.35, z: 6.75, width: 0.5, points: 500, angle: -30, rise: 'drop' },
    { id: 'target-popup-2', x: 1.85, z: 6.45, width: 0.5, points: 500, angle: -30, rise: 'drop' },
    { id: 'target-popup-3', x: 2.35, z: 6.15, width: 0.5, points: 500, angle: -30, rise: 'drop' },
    { id: 'target-mummy', x: -2.25, z: 6.25, width: 0.8, points: 750, angle: 30, rise: 'hold', depth: 0.3, height: 0.95 },
  ],
  rollovers: [
    // The three top lanes, between the lane guides.
    { id: 'rollover-1', x: -1.4, z: 14.05, points: 50 },
    { id: 'rollover-2', x: -0.4, z: 14.05, points: 50 },
    { id: 'rollover-3', x: 0.6, z: 14.05, points: 50 },
    // The inlanes' and the right outlane's switches: they only score (the three top lanes light the kickback).
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
  // The kickback sits in the right outlane (x 3.72, between the guide at 3.25 and the shooter lane's wall at 4.2).
  kickback: { side: 'right', x: 3.72, z: 1.8 },
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
    // Up the left lane, curling left as it climbs, into the dish's south gap. Its mouth is at (-2.954, 8.175), on the right
    // flipper's shots 27 degrees left of straight up (measured with real flips; the steeper ones, 32, are the left
    // orbit's). Its first stretch points 107 degrees, nearer the shots as they reach it (117 to 121) than the old
    // ramp's 99, and it bends to 94 halfway up and back to 99 at the dish.
    // Straight from (-2.75, 8) to the dish it pointed 18 degrees off the shot, and its mouth's flare (0.45) narrowed at 19
    // degrees a side: a shot struck the far rail at about 37 degrees and zigzagged up between the rails, losing its speed
    // (7 of 10 of the layout test's shots made the dish, 11 of a 5 x 5 grid). The flare is 0.2 now. Pointing straight up
    // the table no flip went up it. The mouth sits above the pyramid's left corner, clear of it; at (-2.95, 8.4) the old
    // straight ramp lost half the shots up it. It rises on a smooth profile from the playfield, because a kink in a ramp's
    // slope takes a ball's speed like a step.
    {
      id: 'ramp-left', width: 0.8, flare: 0.2, rail: 0.45,
      path: [
        [-2.954, 8.175, 0], [-3.044, 8.465, 0.008], [-3.113, 8.761, 0.031],
        [-3.167, 9.06, 0.066], [-3.21, 9.361, 0.112], [-3.245, 9.662, 0.167],
        [-3.275, 9.965, 0.229], [-3.302, 10.267, 0.295], [-3.326, 10.57, 0.365],
        [-3.349, 10.873, 0.435], [-3.372, 11.176, 0.505], [-3.396, 11.479, 0.571],
        [-3.422, 11.782, 0.633], [-3.45, 12.084, 0.688], [-3.481, 12.386, 0.734],
        [-3.516, 12.688, 0.769], [-3.555, 12.989, 0.792], [-3.6, 13.29, 0.8],
      ],
    },
    // The right S-ramp: a raised gold wireform from the dish's east gap, across the top over the orbit, S-curving down the
    // right side over the right orbit, and dropping the ball off its end onto the playfield above the right inlane. It
    // stands clear everywhere (balls in the orbit and on the playfield pass under it) and runs downhill the whole way, so a
    // ball on it always leaves it. (An S-hump in the orbit lane itself trapped balls: a pocket against the shooter's gate,
    // and a valley at the hump's foot.) It goes east from the dish and gently down the table from there on: its first run
    // went up the table, and a ball leaving the dish ran out of speed on it and rolled back.
    // Its right rail is left out between its 2nd and 4th points (the diverter's gap, diverter below).
    {
      id: 'ramp-right', width: 0.6, rail: 0.45, skirt: false, opening: { side: 'right', from: 1, to: 3 },
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
  // The tomb: a doorway cut into the pyramid's front corner, 0.6 across at z 6.05 (where the two lower faces are 0.6
  // apart), on the table's middle line. Its jambs' ends are walls, so it is 0.44 wide between them, narrower than a
  // ball (0.54), and a ball never gets in: the open tomb catches one at its mouth and holds it there 1 s, at
  // (-0.4, 5.68), just in front of the door's line (a ball's radius and 0.02 in front of the door's face, which is 0.08
  // in front of the line; the jambs' ends are further off), then kicks it out down the table, a little to the left
  // (toward the left flipper, not down the middle into the drain) at 11 units/s. A doorway a ball fits would push the
  // Ankh bank into the left ramp's shot. wallsWithTomb cuts the pyramid's wall open there and closes a pocket behind
  // it. (Provisional, as the toys' spots are.)
  tomb: { id: 'tomb', x: -0.4, z: 6.05, width: 0.6, held: [-0.4, 5.68], hold: 1.0, eject: [-0.45, -1], speed: 11, points: 1000 },
  // The diverter: a 0.6 gate hinged by the right S-ramp's start (the dish's east gap), at rest along the ramp's upper
  // rail and swinging 45 degrees across the ramp to the gap in its other rail. (Provisional, as the toys' spots are.)
  diverter: { id: 'diverter', ramp: 'ramp-right', pivot: [-2.45, 14.62], length: 0.6, restDeg: 0, overDeg: -45 },
};
