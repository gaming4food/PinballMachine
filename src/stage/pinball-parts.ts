// The table's live parts, drawn over the Blender picture (src/assets/pinball.png, which leaves them out) from each
// snapshot's header and the stage's cues, in the picture's own look (blender/build_table.py's live parts, the same
// sizes): the three flippers at their angles; a plaque per flip target, its emblem in front and the sun disc behind,
// that turns 180° about its pin when its bit sets (and back when it clears); the two drop targets, which sink when down;
// the quest's toys: the three pop-ups (drawn as the drop targets are) and the mummy (a gold sarcophagus with its face
// on its front), which rise out of their slots and sink back into them by their bits, the mummy rocking away from a
// ball that hits it, the tomb's door, which slides up into the pyramid while the tomb is open, and the diverter's gate,
// which swings over and back (the header's toy bits, shared/pinball.ts TOY); both spinners' plates at their turns; and
// soft additive glows over the picture's lamps and bumpers, lit by the header's bits (shared/pinball.ts LIT) and the
// bumper and sling cues, and over the frame's rail lights, the orbits' arrows and a lamp at each toy (by its bits).
// Every glow is a lamp to the light shows as well (light-show.ts, played by the stage: setShowLights), whose light
// shows over the game's where it's the brighter. The quest's lasting look (setQuestLook, from the state) lights the
// rail lights, the arrows and a mode's toy lamp in its god's colour, and chases the ring through the finale; with
// chat's events, it pulses the rail lights and the arrows red while Pharaoh's curse is on and blinks the summoned
// mummy's lamp green; and the fades' dim (setDim) darkens all of it. Whatever lights a glow, it rises no more than 3
// times a second, for the viewers a flashing picture can hurt.
//
// Without the picture (it failed to load) the stand-in look is drawn instead (`usePicture(false)`): the bumper caps
// and sling rubbers that flash, and the inserts, over the stand-in table (table-mesh.ts). The shows light none of it.
// In the table's own coordinates, as table-mesh.ts.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import ankh31 from '../assets/plaques/ankh-31.png';
import eye22 from '../assets/plaques/eye-22.png';
import falcon31 from '../assets/plaques/falconplaque-31.png';
import falcon62 from '../assets/plaques/falconplaque-62.png';
import mummyArt from '../assets/plaques/mummy.png';
import scarab62 from '../assets/plaques/scarab-62.png';
import sundisc14 from '../assets/plaques/sundisc-14.png';
import { DIVERTER_SPEED, GOD_COLOR, GODS, LIT, TOY, type God } from '../shared/pinball';
import { FLIPPER_SHAPE, flipperHull, type Diverter, type Flipper, type Ramp, type Table, type Target } from '../shared/table';
import { RiseLimit, type LampLight, type ShowLamp } from './light-show';
import { CX, CYAN, DOOR_TUCK, doorway, PINK, segmentBox, WALL_THICK } from './table-mesh';

const YELLOW = 0xffd23f;
const GREEN = 0x39ff6a;
/**
 * A flipper as the picture's build draws it, in the physics' shape (FLIPPER_SHAPE): a cream body, a gold cap on its top
 * (its outline shrunk to CAP_SCALE about the pivot, CAP_THICK thick) and a gold pin on the cap.
 */
const CAP_SCALE = 0.82;
const CAP_THICK = 0.03;
/** How many points round each of a drawn flipper's rounds (the physics' collider has 12; more look rounder). */
const FLIPPER_ROUND = 24;
/**
 * A target: its gold body's thickness and height where its table says nothing (Target.depth and height, as the
 * physics' TARGET_DEPTH); its emblem's bottom, and how far under the target's top the emblem's top is.
 */
export const TARGET_THICK = 0.2;
const TARGET_HEIGHT = 0.52;
const EMBLEM_Y0 = 0.06;
const EMBLEM_UNDER_TOP = 0.04;
/**
 * How far past its own height a drop target or a rising one sinks (so it's out of sight under the playfield), and how
 * fast a drop target or a pop-up moves (units a second); how long a plaque's turn takes (s).
 */
const SINK_PAST = 0.04;
const TARGET_SPEED = 6;
const TURN_SECONDS = 0.15;
/**
 * The mummy as the picture's build draws it: a gold box with a lid's lip LID tall round its top, LID_LIP wider all
 * round; its face (the mummy's art) MUMMY_FACE.inset in from each end, from MUMMY_FACE.y0 up to MUMMY_FACE.underTop
 * under its top. Heavier than a pop-up, it rises out of its slot and sinks back over MUMMY_SECONDS.
 */
const LID = 0.07;
const LID_LIP = 0.02;
const MUMMY_FACE = { inset: 0.05, y0: 0.05, underTop: 0.11 };
const MUMMY_SECONDS = 0.6;
/**
 * A hit rocks the mummy away from the ball, its top going first to the side away from the one the ball met (back for a
 * ball at its front, forward for one behind it), as far as ROCK_DEG: it sways back and forth every ROCK_PERIOD seconds,
 * dying away (by e every 1/ROCK_DECAY s), and stands still again after ROCK_SECONDS.
 */
const ROCK_DEG = 6;
const ROCK_PERIOD = 0.35;
const ROCK_DECAY = 4;
const ROCK_SECONDS = 1.2;
/**
 * The tomb's door as the picture's build draws it, shut: a lapis slab across the doorway (table-mesh.ts's doorway), as
 * thick as the physics' door (from its face back across the mouth's line), reaching DOOR_TUCK into the pillars at each
 * end, as tall as the doorway; and sealed on its front with the scarab, a square SEAL_INSET in from the jambs' faces
 * each side, its middle SEAL_Y of the way up. Open, it slides up into the pyramid, as far as it is tall, over
 * DOOR_SECONDS.
 */
const SEAL_INSET = 0.05;
const SEAL_Y = 0.55;
const DOOR_SECONDS = 0.3;
/** The spinners' bar height, and their plates' bottom. */
const SPINNER_BAR = 0.62;
const SPINNER_PLATE_Y0 = 0.2;
/** How bright a cap glows at rest, at a hit's flash, and how fast a flash dies away (per second, exponential). */
const CAP_REST = 0.6;
const CAP_FLASH = 9;
const FLASH_DECAY = 7;
/** An insert's glow lit, and unlit (the stand-in's). */
const LIT_ON = 3.2;
const LIT_OFF = 0.12;
/**
 * A glow over the picture (its opacity, added to the picture's light): a lit lamp's, a blinking lamp's dim half, a
 * bumper's and a sling's flash at its height. Kept low: the picture already shows the lamps coloured, only unlit.
 */
const GLOW_LIT = 0.45;
const GLOW_DIM = 0.15;
const GLOW_BUMPER = 0.9;
const GLOW_SLING = 0.6;
/**
 * A show's light at its brightest (light-show.ts: 1 of a lamp's peak), as a glow's opacity: as bright as a bumper's
 * flash. It's every glow's peak: a glow's rise limit counts its opacity as a share of it, and a rise is going above
 * half of it after being below 0.15 of it. The lamps the game lights keep clear of both: lit (GLOW_LIT) they're half
 * of it, never above, and a blinking lamp's dim half (GLOW_DIM) is a sixth of it, never below. So none of them ever
 * rises, and the lock and the saver blink as they did.
 */
const GLOW_SHOW = 0.9;
/** A lamp's glow lies this far over the playfield (over the shadow catcher, table-mesh.ts's pictureDepth). */
const LAMP_Y = 0.012;
/** The drain's place up the table, its sun disc round it (build_table.py's drain ring). */
const DRAIN_Z = 0.32;
/** The picture's lamp colours: the amber inserts and the blue ones (build_table.py's AMBER_LAMP and BLUE_LAMP). */
const AMBER = 0xffa030;
const BLUE = 0x4a7dff;
/**
 * The frame's blue rail lights (build_table.py's rail led): an LED every 1.05 up each side of the cabinet from z 0.92,
 * 16 a side, on the brass lip at x ±5.23, 1.08 up. Their glows face the camera, drawn over everything as the bumpers'
 * are. Nothing stands in front of them, so they're the ring a chase runs round the table.
 */
const RAIL = { x: 5.23, z0: 0.92, step: 1.05, y: 1.08, count: 16, size: 0.5 };
/**
 * The tomb doorway's two amber LEDs (build_table.py's doorway led): on its lintel's top, `over` above the doorway,
 * `side` outside each jamb's face and `back` behind the door's. Their glows face the camera, drawn over everything as
 * the rail lights' are: the lintel they stand on is one of the picture's unseen shapes.
 */
const DOORWAY_LED = { side: 0.05, back: 0.045, over: 0.1, size: 0.45 };
/**
 * The toys' lamps, each lying flat at its toy's foot, `size` across and in its god's colour in the quest: a pop-up's
 * (Horus's blue) and the mummy's (Ankh's green) `out` beyond the toy's face, toward the play; the doorstep's (the
 * Eye's red) `out` in front of the tomb door's face; and the gate's (Ra's gold) on its ramp's floor at the middle of
 * the gate at rest, in the gap the gate swings out of.
 */
const POPUP_LAMP = { out: 0.35, size: 0.8, color: BLUE };
const MUMMY_LAMP = { out: 0.45, size: 1.2, color: GREEN };
const DOORSTEP_LAMP = { out: 0.25, size: 1.1, color: 0xff3344 };
const GATE_LAMP = { size: 0.9, color: 0xffc23a };
/**
 * Each god's toy lamps, by their glows' ids: the toy its mode is played on (the server's quest pairs the same gods and
 * toys), so the lamp its mode blinks. Ra's is the gate's, Horus's the three pop-ups', Ankh's the mummy's and the Eye's
 * the doorstep's.
 */
const TOY_LAMP_OF: Record<God, (id: string) => boolean> = {
  ra: (id) => id === 'gate',
  horus: (id) => id.startsWith('popup-'),
  ankh: (id) => id === 'mummy',
  eye: (id) => id === 'doorstep',
};
/**
 * The finale's chase round the ring: a lap of FINALE_LAP seconds, each lamp lit as the head passes it and fading over
 * the CHASE_TAIL lamps behind it (as a show's chase, light-show.ts), so each lamp rises once a lap.
 */
const FINALE_LAP = 0.9;
const CHASE_TAIL = 5;
/**
 * Pharaoh's curse (chat's event): the rail lights and the orbits' arrows pulse in its red, CURSE_PULSE seconds a pulse,
 * lit for the first half and dim for the second.
 */
const CURSE_RED = 0xff2a2a;
const CURSE_PULSE = 1;

/**
 * The quest's lasting look, from the state: the god whose mode runs (null for none), whether the finale runs, whether
 * Pharaoh's curse is on, and whether the summoned mummy is (chat's events).
 */
export interface QuestLook {
  god: God | null;
  finale: boolean;
  curse: boolean;
  summoned: boolean;
}

/** Each target's emblem (build_table.py's EMBLEMS); every flip plaque's back is the sun disc. */
const EMBLEMS: Record<string, string> = {
  'target-scarab': scarab62,
  'target-eye': eye22,
  'target-ra-1': falcon62,
  'target-ra-2': falcon62,
  'target-ra-3': falcon62,
  'target-horus-1': falcon31,
  'target-horus-2': falcon31,
  'target-horus-3': falcon31,
  'target-ankh-1': ankh31,
  'target-ankh-2': ankh31,
  'target-ankh-3': ankh31,
  'target-eye-1': eye22,
  'target-eye-2': eye22,
  'target-eye-3': eye22,
  // The quest's pop-ups carry the gold falcon on blue, as the drop targets' emblems are, not the Horus bank's white
  // plaque just above them.
  'target-popup-1': falcon62,
  'target-popup-2': falcon62,
  'target-popup-3': falcon62,
};

/** Which part of a piece of art a face shows: across it (u) and up it (v), from and to. */
interface Crop {
  u: [number, number];
  v: [number, number];
}
/** An emblem's printed middle (build_table.py's crop, every target's emblem and back alike). */
const EMBLEM_CROP: Crop = { u: [0.16, 0.84], v: [0.12, 0.88] };
/** The mummy's face: its art's middle, as wide for its height as the face (build_table.py's MUMMY_UV). */
const MUMMY_CROP: Crop = { u: [0.06, 0.94], v: [0, 1] };
/** The door's seal: the scarab's plaque, just inside its square (build_table.py's tomb seal). */
const SEAL_CROP: Crop = { u: [0.1, 0.9], v: [0.1, 0.9] };

/** The flippers' cream rubber and the spinners' blue enamel (build_table.py's, linear colours). */
const linear = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
/**
 * The live parts' one gold (the targets' bodies and pins, the flippers' caps and pins, the spinners' posts and bars),
 * made to look like the picture's gold from the stage's camera. The picture's gold measures about sRGB (204, 136, 18)
 * at its middle, (141, 105, 43) in shade and (241, 158, 28) lit, a deep orange gold (scene light 0.51, 0.18, 0.003
 * under the stage's tone mapping); build_table.py's base colour (1, 0.7, 0.14) reads pale yellow through it. A mirror
 * gold, as the build's, looking down at the table sees only the dark above it in the stage's environment (lit round its
 * sides) and showed black at the first look; so this is half metal and satin, lit by the stage's lights, with a glow of
 * its own: alone it gives the picture's shade, (161, 96, 16), and lit from above about its middle.
 */
const GOLD_COLOR = linear(1, 0.38, 0.03);
export const GOLD = new THREE.MeshStandardMaterial({ color: GOLD_COLOR, metalness: 0.5, roughness: 0.35, emissive: GOLD_COLOR, emissiveIntensity: 0.28 });
const CREAM = new THREE.MeshStandardMaterial({ color: linear(0.92, 0.86, 0.72), roughness: 0.35, metalness: 0.05 });
const BLUE_ENAMEL = new THREE.MeshStandardMaterial({ color: linear(0.02, 0.12, 0.75), roughness: 0.22, metalness: 0.1 });

/**
 * A piece of art, loaded once (in Node, where there's no page to load it into, a blank texture). It's named by its
 * picture's file, so a test can tell which art a face shows.
 */
const textures = new Map<string, THREE.Texture>();
function art(url: string): THREE.Texture {
  let tex = textures.get(url);
  if (!tex) {
    tex = typeof document === 'undefined' ? new THREE.Texture() : new THREE.TextureLoader().load(url);
    tex.name = url;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    textures.set(url, tex);
  }
  return tex;
}

/** A printed emblem: the art, lit a little from beneath (build_table.py's printed_material, its glow). */
const printed = new Map<string, THREE.MeshStandardMaterial>();
function emblemMaterial(url: string, glow: number): THREE.MeshStandardMaterial {
  const key = `${url}|${glow}`;
  let m = printed.get(key);
  if (!m) {
    const map = art(url);
    m = new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: glow, roughness: 0.32, metalness: 0.2 });
    printed.set(key, m);
  }
  return m;
}

/**
 * A printed face, `width` wide, standing on the playfield from y0 to y1 and facing local +z, showing `crop` of its art.
 * Its art runs right to left along local +x: the table's turn into the world (tiltTable) mirrors z, which would
 * otherwise show it mirrored.
 */
function faceGeometry(width: number, y0: number, y1: number, crop: Crop): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(width, y1 - y0);
  geo.translate(0, (y0 + y1) / 2, 0);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const [u0, u1] = crop.u;
  const [v0, v1] = crop.v;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u1 - uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return geo;
}

/**
 * A flipper's body in its own frame (+x from the pivot to the tip): the physics' outline (shared/table.ts flipperHull),
 * from the playfield to its height; or, with `cap`, that outline shrunk about the pivot and lying on its top.
 */
function flipperGeometry(length: number, cap = false): THREE.BufferGeometry {
  const pts = flipperHull(length, FLIPPER_ROUND).map(([x, y, z]) =>
    cap ? new THREE.Vector3(CAP_SCALE * x, FLIPPER_SHAPE.height + (y > 0 ? CAP_THICK : 0), CAP_SCALE * z) : new THREE.Vector3(x, y, z),
  );
  return new ConvexGeometry(pts);
}

/** An insert: a round light set into the playfield, with its glow material (the stand-in's). */
function insert(x: number, z: number, radius: number, color: number): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial } {
  const mat = new THREE.MeshStandardMaterial({ color: 0x050208, emissive: color, emissiveIntensity: LIT_OFF, roughness: 0.2, transparent: true, opacity: 0.95 });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.006, z);
  return { mesh, mat };
}

/** A soft round glow, white, fading from its middle to nothing at its edge: the glows' map. */
let glowTexture: THREE.DataTexture | null = null;
function glowMap(): THREE.DataTexture {
  if (glowTexture) return glowTexture;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.min(1, Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2));
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * (1 - r) ** 2);
    }
  }
  glowTexture = new THREE.DataTexture(data, n, n);
  // Smooth when drawn larger or smaller than it is (a DataTexture is nearest-filtered unless told).
  glowTexture.magFilter = glowTexture.minFilter = THREE.LinearFilter;
  glowTexture.needsUpdate = true;
  return glowTexture;
}

/**
 * A target's frame on the playfield, as the physics and the picture's build stand it: `u` along its face, `n` out of
 * its face toward the play. One with an angle runs that way, facing the flippers; any other stands along the wall
 * nearest it, facing away from that wall.
 */
export function targetFrame(table: Table, t: Target): { u: [number, number]; n: [number, number] } {
  if (t.angle !== undefined) {
    const a = THREE.MathUtils.degToRad(t.angle);
    const u: [number, number] = [Math.cos(a), Math.sin(a)];
    const n: [number, number] = [-u[1], u[0]];
    return { u, n: n[0] * (CX - t.x) + n[1] * (2 - t.z) < 0 ? [-n[0], -n[1]] : n };
  }
  let best = { d: Infinity, a: [0, 0] as [number, number], b: [0, 1] as [number, number], foot: [0, 0] as [number, number] };
  for (const w of table.walls) {
    for (let i = 0; i + 1 < w.points.length; i++) {
      const a = w.points[i];
      const b = w.points[i + 1];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const k = Math.max(0, Math.min(1, ((t.x - a[0]) * dx + (t.z - a[1]) * dz) / (dx * dx + dz * dz)));
      const foot: [number, number] = [a[0] + k * dx, a[1] + k * dz];
      const d = Math.hypot(t.x - foot[0], t.z - foot[1]);
      if (d < best.d) best = { d, a, b, foot };
    }
  }
  const ul = Math.hypot(best.b[0] - best.a[0], best.b[1] - best.a[1]);
  const nl = Math.hypot(t.x - best.foot[0], t.z - best.foot[1]) || 1;
  return { u: [(best.b[0] - best.a[0]) / ul, (best.b[1] - best.a[1]) / ul], n: [(t.x - best.foot[0]) / nl, (t.z - best.foot[1]) / nl] };
}

/**
 * A ramp's floor height at p, in (x, z): its centre line's height at the point on it nearest p, where the physics
 * stands the diverter's gate (server/sim.ts's floorHeight; pinball-parts-test holds the drawn gate to the physics').
 */
function floorAt(r: Ramp, p: readonly [number, number]): number {
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

/** `now` moved toward `goal` by `step` at most (so it ends on the goal, never past it). */
const toward = (now: number, goal: number, step: number) => (Math.abs(goal - now) <= step ? goal : now + Math.sign(goal - now) * step);

/**
 * A target as drawn: its pivot (at its place, turned to its face), its rest turn, and its turn, drop or rise under way.
 */
export interface TargetView {
  pivot: THREE.Group;
  /** Its gold body (under the mummy's lid), the emblems on its faces. */
  body: THREE.Mesh;
  /** A flip plaque (it turns), or a drop or rising target (it sinks out of sight when down). */
  plaque: boolean;
  /** The pivot's turn about y at rest: its local +x along its face, its local +z out of its front toward the play. */
  rest: number;
  /** A plaque's turn: from and to (0 its front, π its back), and when it started (sim time). */
  from: number;
  to: number;
  start: number;
  /** A drop or rising target's height: 0 up, -drop down. */
  y: number;
  /** How far it sinks when down, out of sight under the playfield: its own height and SINK_PAST. */
  drop: number;
  /** How fast it rises and sinks, units a second. */
  speed: number;
  /** One that stays up when hit (the mummy), which a hit rocks instead (rockMummy). */
  hold: boolean;
  /** The way out of its front, toward the play (targetFrame's n): which side of it a ball met it on. */
  front: [number, number];
  /** How long ago its rock began (s); Infinity when it stands still. */
  rocked: number;
  /** Which way its top goes first: 1 back (from a ball at its front), -1 forward (from one behind it). */
  rockAway: number;
}

/**
 * A glow over the picture: which lamp (a LIT bit's name, a toy's or the frame's), bumper or sling it's over, what
 * lights it and what draws it. A lamp's lies flat on the playfield (or a ramp's floor) over the lamp, behind whatever
 * stands in front of it (the picture's shapes are in the depth buffer: table-mesh.ts's pictureDepth); a bumper's or a
 * sling's faces the camera over it, drawn over everything (it's a flash of light), since a sprite inside the bumper's
 * own unseen shape would be hidden by it, and so do the frame's rail lights and the tomb doorway's LEDs. Every glow is
 * a lamp to the light shows as well.
 */
export interface Glow {
  id: string;
  /**
   * Its LIT bit, or 0: a bumper's or a sling's glows with its flash, a toy's lamp with its toy, and the frame's rail
   * lights and the orbits' arrows with the shows and the quest's look alone.
   */
  bit: number;
  /** A toy's lamp: whether its toy lights it, by the header's bits (the targets down and the toys'). */
  toy?: (down: number, toys: number) => boolean;
  /** The lamp it is to the light shows: its place on the table, and its own colour, the one the game lights it in. */
  lamp: ShowLamp;
  object: THREE.Mesh | THREE.Sprite;
  material: THREE.MeshBasicMaterial | THREE.SpriteMaterial;
}

/**
 * The table's lamps as the light shows see them (light-show.ts): every glow, in the glows' order; the frame's rail
 * lights as a ring, for a chase round the table; double score's ladders; and each god's toy lamps (TOY_LAMP_OF), which
 * a mode's start sweeps into. A show knows its own lamps by which they are, so the ring, the ladders and the toys hold
 * all's own lamps, not copies of them.
 */
export interface PinballLamps {
  all: readonly ShowLamp[];
  ring: readonly ShowLamp[];
  ladders: readonly ShowLamp[];
  toys: Readonly<Record<God, readonly ShowLamp[]>>;
}

export class TableParts {
  readonly group = new THREE.Group();
  /** The stand-in's own looks (the bumper caps, the sling rubbers, the inserts): drawn only without the picture. */
  readonly standIn = new THREE.Group();
  /** The glows over the picture's lamps and bumpers: drawn only over the picture. */
  readonly glowGroup = new THREE.Group();
  /** The flippers in the table's order (left, right, upper right): each turned as a whole, with its body, cap and pin. */
  readonly flippers: { f: Flipper; mesh: THREE.Group; body: THREE.Mesh; cap: THREE.Mesh; pin: THREE.Mesh }[] = [];
  /** Every target, in the table's order (the header's bit numbering). */
  readonly targets: TargetView[] = [];
  /**
   * The tomb's door, on a table with a tomb: its group (at the middle of the door's face, on the playfield), its lapis
   * slab and its scarab seal, how tall it is and how far it has slid up.
   */
  readonly door: { group: THREE.Group; body: THREE.Mesh; seal: THREE.Mesh; height: number; lift: number } | null = null;
  /** The diverter's gate, on a table with one: turned about its hinge (pivot), its gold body, and its angle now. */
  readonly gate: { pivot: THREE.Group; body: THREE.Mesh; spec: Diverter; angle: number } | null = null;
  /** The spinners' plates: the main spinner, then the table's others. */
  readonly spinners: { pivot: THREE.Group }[] = [];
  readonly glows: Glow[] = [];
  /** Every glow as a lamp (in `glows` order), the frame's ring in its order, and the ladders' ten. */
  readonly lamps: PinballLamps;
  /** Each bumper's and sling's flash (1 at a hit, dying away), with the stand-in's cap or rubber that shows it. */
  private readonly flashes = new Map<string, { flash: number; peak: number; mat: THREE.MeshStandardMaterial; rest: number; hot: number }>();
  /** Each stand-in insert, by the LIT bit that lights it. */
  private readonly inserts: { bit: number; mat: THREE.MeshStandardMaterial }[] = [];
  /**
   * Each glow's own rise limit and the shows' light on it, in the glows' order. The light is copied in by setShowLights
   * (a level of 0 where no show lights the lamp), since a player fills its own in again at its next call. The limits
   * are never reset: they count real seconds (update's `real`, or without it the parts' own clock), which never start
   * again, and a glow a viewer saw rise was seen, whatever hello comes next.
   */
  private readonly glowLights: { limit: RiseLimit; show: LampLight }[] = [];
  /**
   * What each glow is to the quest's lasting look, in the glows' order: its place round the ring (-1 off it), whether
   * it's one of the lamps a mode lights in its god's colour (the rail lights and the orbits' arrows), and the god whose
   * toy lamp it is (null for none).
   */
  private readonly questRoles: { place: number; decor: boolean; toyOf: God | null }[] = [];
  /** Each ring lamp's hue in the finale's rainbow laps, by its place round the ring. */
  private readonly rainbow: number[] = [];
  /** The quest's lasting look last set (setQuestLook), and the time it was set at; and the dim last set (setDim). */
  private questGod: God | null = null;
  private questFinale = false;
  private questCurse = false;
  private questSummoned = false;
  private questNow = 0;
  private dim = 1;
  /** The colour finaleChase gives the lamp it was last asked about (a field, so nothing is made per frame). */
  private chaseColor = 0;
  /** The targets down: before the first header, the rising ones (they start down, as on the table). */
  private down = 0;
  /** The plaques turned last set; null before the first (a plaque already turned then is shown turned, not turning). */
  private turned: number | null = null;
  /** The toys' bits last set, and whether the next set is the first (shown as it is, not moving there). */
  private toys = 0;
  private toysFresh = true;
  private lit = 0;
  /** The sum of every frame's dt: the lamps blink by it, and the glows' limits count it where update has no `real`. */
  private clock = 0;

  constructor(table: Table) {
    const g = this.group;
    g.add(this.standIn, this.glowGroup);

    // The flippers, in the physics' shape: cream rubber bodies with a gold cap on top and a gold pin, as the picture's
    // build draws them.
    for (const f of table.flippers) {
      const mesh = new THREE.Group();
      const body = new THREE.Mesh(flipperGeometry(f.length), CREAM);
      const cap = new THREE.Mesh(flipperGeometry(f.length, true), GOLD);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, CAP_THICK, 24), GOLD);
      pin.position.y = FLIPPER_SHAPE.height + CAP_THICK * 1.5;
      body.castShadow = cap.castShadow = true;
      mesh.add(body, cap, pin);
      mesh.position.set(f.pivot[0], 0, f.pivot[1]);
      g.add(mesh);
      this.flippers.push({ f, mesh, body, cap, pin });
    }
    this.setFlippers(table.flippers.map((f) => f.restDeg));

    // The targets: a gold body with its emblem toward the play; a flip plaque has the sun disc on its back and a gold
    // pin over it, and turns about the pin; the mummy is a gold box with a lid and its face on its front. A rising
    // target starts down, out of sight, as it does on the table: until the first header says otherwise, none stands up.
    const sunBack = emblemMaterial(sundisc14, 0.8);
    for (const [i, t] of table.targets.entries()) {
      const { u, n } = targetFrame(table, t);
      // The pivot's local +x along its face and +z along n: a turn of φ about y takes +x to (cos φ, 0, -sin φ) and +z
      // to (sin φ, 0, cos φ), so with n = (-u.z, u.x), φ = atan2(-u.z, u.x); with n the other way, u is turned round.
      const along = n[0] * -u[1] + n[1] * u[0] >= 0 ? u : [-u[0], -u[1]];
      const rest = Math.atan2(-along[1], along[0]);
      const pivot = new THREE.Group();
      pivot.position.set(t.x, 0, t.z);
      // Turned to face first, then (the mummy's rock) tipped about its own face's line.
      pivot.rotation.order = 'YXZ';
      pivot.rotation.y = rest;
      const thick = t.depth ?? TARGET_THICK;
      const height = t.height ?? TARGET_HEIGHT;
      const hold = t.rise === 'hold';
      let body: THREE.Mesh;
      if (hold) {
        body = new THREE.Mesh(new THREE.BoxGeometry(t.width, height - LID, thick), GOLD);
        body.position.y = (height - LID) / 2;
        const lid = new THREE.Mesh(new THREE.BoxGeometry(t.width + 2 * LID_LIP, LID, thick + 2 * LID_LIP), GOLD);
        lid.position.y = height - LID / 2;
        lid.castShadow = true;
        const face = new THREE.Mesh(faceGeometry(t.width - 2 * MUMMY_FACE.inset, MUMMY_FACE.y0, height - MUMMY_FACE.underTop, MUMMY_CROP), emblemMaterial(mummyArt, 0.5));
        face.position.z = thick / 2 + 0.003;
        pivot.add(body, lid, face);
      } else {
        body = new THREE.Mesh(new THREE.BoxGeometry(t.width, height, thick), GOLD);
        body.position.y = height / 2;
        const face = new THREE.Mesh(faceGeometry(t.width - 0.08, EMBLEM_Y0, height - EMBLEM_UNDER_TOP, EMBLEM_CROP), emblemMaterial(EMBLEMS[t.id] ?? ankh31, 0.5));
        face.position.z = thick / 2 + 0.003;
        pivot.add(body, face);
      }
      body.castShadow = true;
      if (t.flip) {
        const back = new THREE.Mesh(faceGeometry(t.width - 0.08, EMBLEM_Y0, height - EMBLEM_UNDER_TOP, EMBLEM_CROP), sunBack);
        back.rotation.y = Math.PI;
        back.position.z = -(thick / 2 + 0.003);
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 16), GOLD);
        pin.position.y = height + 0.06;
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), GOLD);
        cap.position.y = height + 0.12;
        pivot.add(back, pin, cap);
      }
      g.add(pivot);
      const drop = height + SINK_PAST;
      const view: TargetView = {
        pivot,
        body,
        plaque: t.flip === true,
        rest,
        from: 0,
        to: 0,
        start: -Infinity,
        y: t.rise ? -drop : 0,
        drop,
        speed: hold ? drop / MUMMY_SECONDS : TARGET_SPEED,
        hold,
        front: n,
        rocked: Infinity,
        rockAway: 1,
      };
      this.place(view);
      this.targets.push(view);
      if (t.rise) this.down |= 1 << i;
    }

    // The tomb's door, shut, in the doorway the picture carves (table-mesh.ts's doorway): a lapis slab sealed with the
    // scarab on its front, which faces down the table (a half turn about y, its art then reading the right way round).
    const way = doorway(table);
    if (way) {
      const group = new THREE.Group();
      group.position.set((way.x0 + way.x1) / 2, 0, way.front);
      const thick = WALL_THICK; // from the door's face back across the mouth's line, as far again: the physics' door
      const body = new THREE.Mesh(new THREE.BoxGeometry(way.x1 - way.x0 + 2 * DOOR_TUCK, way.height, thick), BLUE_ENAMEL);
      body.position.set(0, way.height / 2, thick / 2);
      body.castShadow = true;
      const s = (way.x1 - way.x0) / 2 - SEAL_INSET;
      const sealY = way.height * SEAL_Y;
      const seal = new THREE.Mesh(faceGeometry(2 * s, sealY - s, sealY + s, SEAL_CROP), emblemMaterial(scarab62, 0.5));
      seal.rotation.y = Math.PI;
      seal.position.z = -0.003;
      group.add(body, seal);
      g.add(group);
      this.door = { group, body, seal, height: way.height, lift: 0 };
    }

    // The diverter's gate, at rest: gold, as thick as a wall and as tall as its ramp's rails, out from its hinge, and
    // standing on the ramp's floor there, as the physics stands it.
    const dv = table.diverter;
    const ramp = dv && table.ramps.find((r) => r.id === dv.ramp);
    if (dv && ramp) {
      const pivot = new THREE.Group();
      pivot.position.set(dv.pivot[0], floorAt(ramp, dv.pivot), dv.pivot[1]);
      const body = new THREE.Mesh(new THREE.BoxGeometry(dv.length, ramp.rail, WALL_THICK), GOLD);
      body.position.set(dv.length / 2, ramp.rail / 2, 0);
      body.castShadow = true;
      pivot.add(body);
      g.add(pivot);
      this.gate = { pivot, body, spec: dv, angle: dv.restDeg };
    }
    this.placeToys();

    // The spinners: gold posts each side of the lane and a gold bar across them, the blue plate hanging from the bar.
    for (const sp of [table.spinner, ...table.spinners]) {
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, SPINNER_BAR, 16), GOLD);
        post.position.set(sp.x + (side * sp.width) / 2, SPINNER_BAR / 2, sp.z);
        post.castShadow = true;
        g.add(post);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, sp.width, 12), GOLD);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(sp.x, SPINNER_BAR, sp.z);
      const pivot = new THREE.Group();
      pivot.position.set(sp.x, SPINNER_BAR, sp.z);
      const plateTop = SPINNER_BAR - 0.04;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(Math.min(0.76, sp.width - 0.1), plateTop - SPINNER_PLATE_Y0, 0.04), BLUE_ENAMEL);
      plate.position.y = (plateTop + SPINNER_PLATE_Y0) / 2 - SPINNER_BAR;
      plate.castShadow = true;
      pivot.add(plate);
      g.add(bar, pivot);
      this.spinners.push({ pivot });
    }

    // The stand-in's bumper caps, each glowing in its own colour; over the picture, a glow over each bumper's dome.
    const capColors = [PINK, CYAN, YELLOW];
    table.bumpers.forEach((b, i) => {
      const y0 = b.y0 ?? 0;
      const mat = new THREE.MeshStandardMaterial({ color: 0x200818, emissive: capColors[i % capColors.length], emissiveIntensity: CAP_REST, roughness: 0.25 });
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(b.radius * 1.15, b.radius * 1.05, 0.12, 32), mat);
      cap.position.set(b.x, y0 + 0.5, b.z);
      this.standIn.add(cap);
      this.flashes.set(b.id, { flash: 0, peak: GLOW_BUMPER, mat, rest: CAP_REST, hot: CAP_FLASH });
      this.addGlow(b.id, 0, b.x, y0 + 0.75, b.z, b.radius * 3.4, BLUE, false);
    });

    // The stand-in's sling rubbers, white, flashing cyan on a kick; over the picture, a glow along each sling.
    for (const s of table.slings) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xf4f4f8, emissive: CYAN, emissiveIntensity: 0.2, roughness: 0.5 });
      this.standIn.add(segmentBox(s.a, s.b, 0.1, 0.32, mat));
      this.flashes.set(s.id, { flash: 0, peak: GLOW_SLING, mat, rest: 0.2, hot: 5.2 });
      this.addGlow(s.id, 0, (s.a[0] + s.b[0]) / 2, 0.3, (s.a[1] + s.b[1]) / 2, 1.3, 0x9fd8ff, false);
    }

    // The stand-in's inserts: one under each top lane's rollover, the lock's ring, the kickback's, double score's and
    // the saver's.
    const rolloverBits = [LIT.rollover0, LIT.rollover1, LIT.rollover2];
    const mid = (table.flippers[0].pivot[0] + table.flippers[1].pivot[0]) / 2;
    table.rollovers.slice(0, 3).forEach((r, i) => this.addInsert(rolloverBits[i], r.x, r.z, 0.28, CYAN));
    this.addInsert(LIT.lock, table.lock.x, table.lock.z, table.lock.radius * 1.3, PINK);
    this.addInsert(LIT.kickback, table.kickback.x, table.kickback.z + 1.4, 0.26, YELLOW);
    this.addInsert(LIT.double, mid, 7, 0.45, YELLOW);
    this.addInsert(LIT.saver, mid, 1.1, 0.32, GREEN);

    // The glows over the picture's lamps, where build_table.py puts them, about one and a half times each lamp's size:
    // the top lanes' rollover lamps, the lock's ring, the kickback's two roundels above it, the ladders up both sides
    // of the pyramid (double score; the left one starts lower, clear of the left ramp's mouth), the centre lane's four
    // lamps, and the ball saver over the sun disc round the drain.
    table.rollovers.slice(0, 3).forEach((r, i) => this.addGlow(`rollover${i}`, rolloverBits[i], r.x, LAMP_Y, r.z, 0.8, AMBER, true));
    this.addGlow('lock', LIT.lock, table.lock.x, LAMP_Y, table.lock.z, table.lock.radius * 3.2, AMBER, true);
    for (const z of [4, 4.7]) this.addGlow('kickback', LIT.kickback, table.kickback.x, LAMP_Y, z, 0.75, BLUE, true);
    for (let k = 0; k < 5; k++) {
      for (const [x, z0] of [[-3.62, 5.55], [2.82, 6.55]]) this.addGlow('double', LIT.double, x, LAMP_Y, z0 + k * 0.6, 1, k % 2 ? BLUE : AMBER, true);
    }
    [LIT.centre0, LIT.centre1, LIT.centre2, LIT.centre3].forEach((bit, k) => this.addGlow(`centre${k}`, bit, CX, LAMP_Y, 2.9 + k * 0.62, 0.9, k % 2 ? BLUE : AMBER, true));
    this.addGlow('saver', LIT.saver, CX, LAMP_Y, DRAIN_Z, 1.9, AMBER, true);

    // The lamps only the light shows light (the game has no bits for them): the frame's rail lights up both sides of
    // the cabinet, and the orbits' amber arrows, three up each orbit lane (build_table.py's arrow loops). The right
    // orbit's lie under the right ramp, which hides most of each glow as it hides most of the picture's arrows.
    const rails = (['left', 'right'] as const).map((side, s) =>
      Array.from({ length: RAIL.count }, (_, k) => this.addGlow(`rail-${side}-${k}`, 0, (s ? 1 : -1) * RAIL.x, RAIL.y, RAIL.z0 + k * RAIL.step, RAIL.size, BLUE, false).lamp),
    );
    for (let k = 0; k < 3; k++) this.addGlow(`orbit-left-${k}`, 0, -4.5, LAMP_Y, 9.9 + k * 0.55, 0.7, AMBER, true);
    for (let k = 0; k < 3; k++) this.addGlow(`orbit-right-${k}`, 0, 3.7, LAMP_Y, 11.3 + k * 0.45, 0.65, AMBER, true);

    // A lamp at each toy, lit by the header's bits while its toy is up, open or over: so a page opening on a toy up
    // shows its lamp lit at once, and a pop-up's lights as its bit clears, as it starts up. The tomb has three: the
    // doorway's two LEDs on its lintel, and one on its doorstep.
    if (way) {
      const open = (_down: number, toys: number) => (toys & TOY.tombOpen) !== 0;
      [way.x0 - DOORWAY_LED.side, way.x1 + DOORWAY_LED.side].forEach((x, k) =>
        this.addGlow(`doorway-${k}`, 0, x, way.height + DOORWAY_LED.over, way.front + DOORWAY_LED.back, DOORWAY_LED.size, AMBER, false, open),
      );
      this.addGlow('doorstep', 0, (way.x0 + way.x1) / 2, LAMP_Y, way.front - DOORSTEP_LAMP.out, DOORSTEP_LAMP.size, DOORSTEP_LAMP.color, true, open);
    }
    table.targets.forEach((t, i) => {
      if (!t.rise) return;
      const look = t.rise === 'hold' ? MUMMY_LAMP : POPUP_LAMP;
      const [nx, nz] = this.targets[i].front;
      const out = (t.depth ?? TARGET_THICK) / 2 + look.out;
      this.addGlow(t.id.replace(/^target-/, ''), 0, t.x + nx * out, LAMP_Y, t.z + nz * out, look.size, look.color, true, (down) => (down & (1 << i)) === 0);
    });
    if (dv && ramp) {
      const a = THREE.MathUtils.degToRad(dv.restDeg);
      const mid: [number, number] = [dv.pivot[0] + (Math.cos(a) * dv.length) / 2, dv.pivot[1] + (Math.sin(a) * dv.length) / 2];
      this.addGlow('gate', 0, mid[0], floorAt(ramp, mid) + LAMP_Y, mid[1], GATE_LAMP.size, GATE_LAMP.color, true, (_down, toys) => (toys & TOY.diverterOver) !== 0);
    }

    // Every glow is a lamp to the light shows, and the ring and the ladders are all's own lamps (a show knows its lamps
    // by which they are). The ring runs up the left rail from the bottom, then down the right one from the top. The
    // right rail is copied and reversed, not toReversed(): that is ES2023, newer than some of the embedded browsers the
    // stage runs in, and there it would throw here and leave no table at all.
    const toys = {} as Record<God, ShowLamp[]>;
    for (const god of GODS) toys[god] = this.glows.filter((g) => TOY_LAMP_OF[god](g.id)).map((g) => g.lamp);
    this.lamps = {
      all: this.glows.map((g) => g.lamp),
      ring: [...rails[0], ...[...rails[1]].reverse()],
      ladders: this.glows.filter((g) => g.id === 'double').map((g) => g.lamp),
      toys,
    };
    // The quest's look, worked out once: which glows it lights, and the rainbow's hues, each ring lamp's by its place
    // (in sRGB as given, as every other colour here is).
    const hue = new THREE.Color();
    this.lamps.ring.forEach((_, place) => this.rainbow.push(hue.setHSL(place / this.lamps.ring.length, 1, 0.5, THREE.SRGBColorSpace).getHex(THREE.SRGBColorSpace)));
    for (const g of this.glows) {
      this.questRoles.push({
        place: this.lamps.ring.indexOf(g.lamp),
        decor: g.id.startsWith('rail-') || g.id.startsWith('orbit-'),
        toyOf: GODS.find((god) => TOY_LAMP_OF[god](g.id)) ?? null,
      });
    }
    this.usePicture(true);
  }

  private addInsert(bit: number, x: number, z: number, radius: number, color: number): void {
    const { mesh, mat } = insert(x, z, radius, color);
    this.standIn.add(mesh);
    this.inserts.push({ bit, mat });
  }

  /**
   * A glow `size` across at (x, y, z): flat on the playfield (a lamp's), or facing the camera over everything (a
   * flash). Each is a lamp to the light shows too, at its place and in its own colour, with a rise limit of its own; a
   * toy's lamp has its `toy`.
   */
  private addGlow(id: string, bit: number, x: number, y: number, z: number, size: number, color: number, flat: boolean, toy?: Glow['toy']): Glow {
    const look = { map: glowMap(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 };
    const lamp: ShowLamp = { x, z, color };
    let glow: Glow;
    if (flat) {
      const material = new THREE.MeshBasicMaterial({ ...look, side: THREE.DoubleSide });
      const object = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
      object.rotation.x = -Math.PI / 2;
      glow = { id, bit, toy, lamp, object, material };
    } else {
      const material = new THREE.SpriteMaterial({ ...look, depthTest: false });
      const object = new THREE.Sprite(material);
      object.scale.set(size, size, 1);
      object.renderOrder = 2;
      glow = { id, bit, toy, lamp, object, material };
    }
    glow.object.position.set(x, y, z);
    glow.object.visible = false;
    this.glowGroup.add(glow.object);
    this.glows.push(glow);
    this.glowLights.push({ limit: new RiseLimit(), show: { level: 0, color } });
    return glow;
  }

  /** A drop or rising target where its height says: sunk out of sight when it's all the way down. */
  private place(t: TargetView): void {
    t.pivot.position.y = t.y;
    t.pivot.visible = t.y > -t.drop + 0.01;
  }

  /** The door at its lift (out of sight once it's all the way up, in the pyramid) and the gate at its angle. */
  private placeToys(): void {
    if (this.door) {
      this.door.group.position.y = this.door.lift;
      this.door.group.visible = this.door.lift < this.door.height;
    }
    // A turn of φ about y takes +x to (cos φ, 0, -sin φ): the table's angle a is a turn of -a.
    if (this.gate) this.gate.pivot.rotation.y = -THREE.MathUtils.degToRad(this.gate.angle);
  }

  /** Over the picture (its glows), or over the stand-in table (its caps, rubbers and inserts). */
  usePicture(on: boolean): void {
    this.standIn.visible = !on;
    this.glowGroup.visible = on;
  }

  /** The flippers at `deg`, in the table's order, in the table's degrees (from +x toward +z). */
  setFlippers(deg: readonly number[]): void {
    // A turn of φ about y takes +x to (cos φ, 0, -sin φ): the table's angle a is a turn of -a.
    this.flippers.forEach(({ mesh }, i) => {
      if (deg[i] !== undefined) mesh.rotation.y = -THREE.MathUtils.degToRad(deg[i]);
    });
  }

  /**
   * The targets: `down`, the drop targets down and the rising ones standing down (they sink in update, or rise back
   * up); `turned`, the flip plaques turned to their backs (bit i for target i). A plaque whose bit changes turns 180°
   * about its pin over TURN_SECONDS from `now` (sim time). At the first call (and the first after reset), each is shown
   * as it is: a page opening on the toys down shows none standing for the moment it would take to sink.
   */
  setTargets(down: number, turned: number, now: number): void {
    this.down = down;
    const was = this.turned;
    this.turned = turned;
    this.targets.forEach((t, i) => {
      if (!t.plaque) {
        if (was === null) {
          t.y = down & (1 << i) ? -t.drop : 0;
          this.place(t);
        }
        return;
      }
      const goal = turned & (1 << i) ? Math.PI : 0;
      if (was === null) {
        t.from = t.to = goal;
        t.start = -Infinity;
      } else if (goal !== t.to) {
        t.from = this.turnAt(t, now);
        t.to = goal;
        t.start = now;
      }
      t.pivot.rotation.y = t.rest + this.turnAt(t, now);
    });
  }

  /** A plaque's turn at `now`: from where its last turn began toward its goal, eased in and out. */
  private turnAt(t: TargetView, now: number): number {
    const k = Math.max(0, Math.min(1, (now - t.start) / TURN_SECONDS));
    return t.from + (t.to - t.from) * k * k * (3 - 2 * k);
  }

  /**
   * The toys' bits (shared/pinball.ts TOY): the tomb open, its door sliding up into the pyramid over DOOR_SECONDS, or
   * shut, the door sliding back down; the diverter's gate over, or at rest, swinging there at DIVERTER_SPEED as the
   * physics' gate does. They move in update; at the first call (and the first after reset) they're shown as they are.
   */
  setToys(bits: number): void {
    this.toys = bits;
    if (!this.toysFresh) return;
    this.toysFresh = false;
    if (this.door) this.door.lift = bits & TOY.tombOpen ? this.door.height : 0;
    if (this.gate) this.gate.angle = bits & TOY.diverterOver ? this.gate.spec.overDeg : this.gate.spec.restDeg;
    this.placeToys();
  }

  /**
   * A ball hit the mummy, which stays up when hit (each hit is the server's cue), `ball` where it met it: it rocks away
   * from the ball, back from one at its front and forward from one behind it.
   */
  rockMummy(ball: { x: number; z: number }): void {
    for (const t of this.targets) {
      if (!t.hold) continue;
      const out = (ball.x - t.pivot.position.x) * t.front[0] + (ball.z - t.pivot.position.z) * t.front[1];
      t.rockAway = out < 0 ? -1 : 1;
      t.rocked = 0;
    }
  }

  /** The spinners' turns, in radians: the main spinner, then the others. */
  setSpinners(angles: readonly number[]): void {
    this.spinners.forEach((s, i) => {
      if (angles[i] !== undefined) s.pivot.rotation.x = angles[i];
    });
  }

  /** The lit lamps (LIT): lit ones glow, and the saver's and the lock's blink while they're on. */
  setLit(bits: number): void {
    this.lit = bits;
  }

  /** The shows' light for each lamp, in lamps.all's order (null leaves a lamp to the game), until the next call. */
  setShowLights(lights: readonly (LampLight | null)[]): void {
    // Copied at once, since a player's lights are its own, filled in again at its next call. A lamp past the end of
    // `lights` has none.
    for (let i = 0; i < this.glowLights.length; i++) {
      const light = lights[i];
      const { show } = this.glowLights[i];
      show.level = light ? light.level : 0;
      if (light) show.color = light.color;
    }
  }

  /**
   * The quest's lasting look, each frame from the state (so a stage opened late shows it): the god whose mode runs, if
   * one does, and whether the finale runs; `now` is the table's clock as drawn (DrawnClock's), which the toy lamp's
   * blink and the finale's chase go by. While a mode runs, the rail lights and the orbits' arrows glow steadily in its
   * god's colour, and its toy's lamp blinks in it twice a second; while the finale runs, the ring chases, gold and the
   * rainbow on alternate laps. Chat's events: while Pharaoh's curse is on, the rail lights and the arrows pulse red
   * once a second in place of a mode's colour (the finale's chase still runs over them); while the summoned mummy is
   * on, its lamp blinks green as a mode's toy lamp does. The game's own lamps keep their colours, because they still
   * mean something.
   */
  setQuestLook(look: QuestLook, now: number): void {
    this.questGod = look.god;
    this.questFinale = look.finale;
    this.questCurse = look.curse;
    this.questSummoned = look.summoned;
    this.questNow = now;
  }

  /**
   * The share of every glow's light to show, each frame from the player's fades (LightShowPlayer.dimAt): 0 dark, 1 as
   * lit. It is taken after the game's light, the quest's look and the shows are mixed, and before each glow's rise
   * limit, so a glow it gives back rises once. A level that isn't a number dims nothing.
   */
  setDim(level: number): void {
    this.dim = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 1;
  }

  /**
   * The finale's chase on the ring lamp at `place`, at the look's `now`: its level (0 to 1 of a show's peak), with its
   * colour left in chaseColor. The head runs a lap every FINALE_LAP seconds, so each lamp is lit once a lap, in the
   * colour of the lap the head passed it in (so a lamp keeps its colour as it fades, across the end of a lap): gold on
   * even laps, its own hue of the rainbow on odd ones.
   */
  private finaleChase(place: number): number {
    const n = this.rainbow.length;
    const laps = this.questNow / FINALE_LAP;
    let lap = Math.floor(laps);
    // How many lamps the head has gone past this one: in this lap, or (not reached yet) in the lap before.
    let behind = (laps - lap) * n - place;
    if (behind < 0) {
      behind += n;
      lap--;
    }
    this.chaseColor = lap % 2 === 0 ? GOD_COLOR.ra : this.rainbow[place];
    return Math.max(0, 1 - behind / CHASE_TAIL);
  }

  flashBumper(id: string): void {
    const f = this.flashes.get(id);
    if (f) f.flash = 1;
  }

  flashSling(id: string): void {
    this.flashBumper(id);
  }

  /** A fresh hello: the next targets and toys are shown as they are, not turning or moving there. */
  reset(): void {
    this.turned = null;
    this.toysFresh = true;
  }

  /**
   * Each frame: the flashes show and die away, the drop targets and the rising ones move toward up or down, the mummy
   * rocks, the door and the gate move toward their bits, the lamps glow or blink, with the quest's look and the shows'
   * light over them and the fades' dim over all, and every glow is held to 3 rises a second. Everything moves by `dt`,
   * the frame's step. `real` is the browser's own clock in seconds (performance.now() / 1000), and the glows' rise
   * limits count it: a host's dt can sum to more than real time (the city's to about 1.5 times it), and a limit
   * counting that would let a glow rise 4 or 5 times in a second as the viewers see it. Without `real` (the tests in
   * Node) the limits count the sum of dt.
   */
  update(dt: number, real?: number): void {
    this.clock += dt;
    const riseClock = real ?? this.clock;
    this.targets.forEach((t, i) => {
      if (t.plaque) return;
      t.y = toward(t.y, this.down & (1 << i) ? -t.drop : 0, t.speed * dt);
      this.place(t);
      if (!t.hold) return;
      // Rocked away from the ball first (a turn about its face's line: negative takes its top back, away from the play,
      // and positive forward), swaying and dying away.
      t.rocked += dt;
      const k = t.rocked;
      t.pivot.rotation.x = k < ROCK_SECONDS ? -t.rockAway * THREE.MathUtils.degToRad(ROCK_DEG) * Math.exp(-k * ROCK_DECAY) * Math.sin((2 * Math.PI * k) / ROCK_PERIOD) : 0;
    });
    if (this.door) this.door.lift = toward(this.door.lift, this.toys & TOY.tombOpen ? this.door.height : 0, (this.door.height / DOOR_SECONDS) * dt);
    if (this.gate) this.gate.angle = toward(this.gate.angle, this.toys & TOY.diverterOver ? this.gate.spec.overDeg : this.gate.spec.restDeg, DIVERTER_SPEED * dt);
    this.placeToys();
    const blink = Math.sin(this.clock * Math.PI * 4) > 0;
    const blinks = (bit: number) => bit === LIT.saver || bit === LIT.lock;
    for (const ins of this.inserts) {
      const on = (this.lit & ins.bit) !== 0;
      ins.mat.emissiveIntensity = on && (!blinks(ins.bit) || blink) ? LIT_ON : on ? LIT_ON * 0.35 : LIT_OFF;
    }
    this.glows.forEach((glow, i) => {
      // The game's light: a lamp by its LIT bit, a toy's lamp by its toy, a bumper or a sling by its flash.
      let level: number;
      if (glow.bit) {
        const on = (this.lit & glow.bit) !== 0;
        level = on ? (!blinks(glow.bit) || blink ? GLOW_LIT : GLOW_DIM) : 0;
      } else if (glow.toy) {
        level = glow.toy(this.down, this.toys) ? GLOW_LIT : 0;
      } else {
        const f = this.flashes.get(glow.id);
        level = f ? f.peak * f.flash : 0;
      }
      let color = glow.lamp.color;
      // The quest's lasting look. While a mode runs, the rail lights and the arrows glow lit in its god's colour, where
      // that's the brighter (the game lights none of them). The mode's toy lamp blinks in place of the game's light on
      // it while its toy is up (by the glow's own toy test, as the game's light goes): the game would hold a standing
      // toy's lamp lit, which would hide the blink. While its toy is down it stays dark, as the game has it, since a
      // lamp blinking at a knocked-down pop-up would say it was there to hit. The blink's two levels are the game's own
      // blinking lamps' (GLOW_LIT and GLOW_DIM), which never count as a rise.
      // Pharaoh's curse pulses the same lamps red at those same two levels, so it never counts as a rise either, in
      // place of a mode's colour; the finale's chase runs over it, at a show's brightness, rising once a lap as it does
      // with no curse. The summoned mummy's lamp blinks green as a mode's toy lamp does, by the mummy's own toy test,
      // dark while it's down.
      const role = this.questRoles[i];
      const god = this.questGod;
      const ringChases = this.questFinale && role.place >= 0;
      if (this.questCurse && role.decor) {
        const pulse = this.questNow / CURSE_PULSE;
        const cursed = pulse - Math.floor(pulse) < 0.5 ? GLOW_LIT : GLOW_DIM;
        if (cursed > level) {
          level = cursed;
          color = CURSE_RED;
        }
      } else if (!ringChases && god !== null && role.decor && GLOW_LIT > level) {
        level = GLOW_LIT;
        color = GOD_COLOR[god];
      }
      if (ringChases) {
        const chased = this.finaleChase(role.place) * GLOW_SHOW;
        if (chased > level) {
          level = chased;
          color = this.chaseColor;
        }
      }
      const blinkGod = god !== null && role.toyOf === god ? god : this.questSummoned && role.toyOf === 'ankh' ? 'ankh' : null;
      if (blinkGod !== null) {
        const phase = this.questNow * 2;
        const up = glow.toy?.(this.down, this.toys) ?? false;
        level = !up ? 0 : phase - Math.floor(phase) < 0.5 ? GLOW_LIT : GLOW_DIM;
        color = GOD_COLOR[blinkGod];
      }
      // The shows' light where it's the brighter, in its colour.
      const { limit, show } = this.glowLights[i];
      if (show.level * GLOW_SHOW > level) {
        level = show.level * GLOW_SHOW;
        color = show.color;
      }
      // The fades' dim over all of it, then, whatever lit it, no more than 3 rises a second (light-show.ts), in real
      // seconds: the limit guards what the viewers see, so it counts the seconds they see it in, not the table's clock
      // the shows go by, nor dt. Dimmed first, a glow a fade gives back rises once.
      level = limit.level((level * this.dim) / GLOW_SHOW, riseClock) * GLOW_SHOW;
      if (level < 0.01) level = 0;
      glow.material.opacity = level;
      glow.material.color.setHex(color);
      glow.object.visible = level > 0;
    });
    const decay = Math.exp(-dt * FLASH_DECAY);
    for (const f of this.flashes.values()) {
      f.mat.emissiveIntensity = f.rest + (f.hot - f.rest) * f.flash;
      f.flash *= decay;
    }
  }
}
