// The table's live parts, drawn over the Blender picture (src/assets/pinball.png, which leaves them out) from each
// snapshot's header and the stage's cues, in the picture's own look (blender/build_table.py's live parts, the same
// sizes): the three flippers at their angles; a plaque per flip target, its emblem in front and the sun disc behind,
// that turns 180° about its pin when its bit sets (and back when it clears); the two drop targets, which sink when down;
// both spinners' plates at their turns; and soft additive glows over the picture's lamps and bumpers, lit by the
// header's bits (shared/pinball.ts LIT) and the bumper and sling cues.
//
// Without the picture (it failed to load) the stand-in look is drawn instead (`usePicture(false)`): the bumper caps
// and sling rubbers that flash, and the inserts, over the stand-in table (table-mesh.ts).
// In the table's own coordinates, as table-mesh.ts.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import ankh31 from '../assets/plaques/ankh-31.png';
import eye22 from '../assets/plaques/eye-22.png';
import falcon31 from '../assets/plaques/falconplaque-31.png';
import falcon62 from '../assets/plaques/falconplaque-62.png';
import scarab62 from '../assets/plaques/scarab-62.png';
import sundisc14 from '../assets/plaques/sundisc-14.png';
import { LIT } from '../shared/pinball';
import type { Flipper, Table, Target } from '../shared/table';
import { CYAN, PINK, segmentBox } from './table-mesh';

const YELLOW = 0xffd23f;
const GREEN = 0x39ff6a;
/** The table's middle line (the pyramid's, the bumpers' and the main flippers' axis), as build_table.py's CX. */
const CX = -0.4;
/** The flippers as the picture's build draws them: base and tip radius, the body's bottom and top. */
const FLIPPER_BASE_R = 0.25;
const FLIPPER_TIP_R = 0.13;
const FLIPPER_Y0 = 0.02;
const FLIPPER_Y1 = 0.34;
/** A target: its gold body's thickness and height; the emblem's bottom and top. */
const TARGET_THICK = 0.2;
const TARGET_HEIGHT = 0.52;
const EMBLEM_Y0 = 0.06;
const EMBLEM_Y1 = 0.48;
/** How far a drop target sinks, and how fast (units a second); how long a plaque's turn takes (s). */
const TARGET_DROP = 0.56;
const TARGET_SPEED = 6;
const TURN_SECONDS = 0.15;
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
/** A lamp's glow lies this far over the playfield (over the shadow catcher, table-mesh.ts's pictureDepth). */
const LAMP_Y = 0.012;
/** The drain's place up the table, its sun disc round it (build_table.py's drain ring). */
const DRAIN_Z = 0.32;
/** The picture's lamp colours: the amber inserts and the blue ones (build_table.py's AMBER_LAMP and BLUE_LAMP). */
const AMBER = 0xffa030;
const BLUE = 0x4a7dff;

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
};

/** The picture's gold, the flippers' cream rubber and the spinners' blue enamel (build_table.py's, linear colours). */
const linear = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
const GOLD = new THREE.MeshStandardMaterial({ color: linear(1, 0.7, 0.14), metalness: 1, roughness: 0.16 });
const CREAM = new THREE.MeshStandardMaterial({ color: linear(0.92, 0.86, 0.72), roughness: 0.35, metalness: 0.05 });
const BLUE_ENAMEL = new THREE.MeshStandardMaterial({ color: linear(0.02, 0.12, 0.75), roughness: 0.22, metalness: 0.1 });

/** A piece of art, loaded once (in Node, where there's no page to load it into, a blank texture). */
const textures = new Map<string, THREE.Texture>();
function art(url: string): THREE.Texture {
  let tex = textures.get(url);
  if (!tex) {
    tex = typeof document === 'undefined' ? new THREE.Texture() : new THREE.TextureLoader().load(url);
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
 * An emblem's face, `width` wide, standing on the playfield and facing local +z, showing the art's printed middle. Its
 * art runs right to left along local +x: the table's turn into the world (tiltTable) mirrors z, which would otherwise
 * show it mirrored.
 */
function emblemGeometry(width: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(width, EMBLEM_Y1 - EMBLEM_Y0);
  geo.translate(0, (EMBLEM_Y0 + EMBLEM_Y1) / 2, 0);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.84 - uv.getX(i) * 0.68, 0.12 + uv.getY(i) * 0.76);
  return geo;
}

/** A flipper's shape in its own frame (+x from the pivot to the tip): its two circles' hull from y0 to y1, `scale` of it. */
function flipperGeometry(length: number, y0: number, y1: number, scale = 1): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const n = 24;
  for (const y of [y0, y1]) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      pts.push(new THREE.Vector3(scale * FLIPPER_BASE_R * Math.cos(a), y, scale * FLIPPER_BASE_R * Math.sin(a)));
      pts.push(new THREE.Vector3(scale * (length + FLIPPER_TIP_R * Math.cos(a)), y, scale * FLIPPER_TIP_R * Math.sin(a)));
    }
  }
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
  glowTexture.needsUpdate = true;
  return glowTexture;
}

/**
 * A target's frame on the playfield, as the physics and the picture's build stand it: `u` along its face, `n` out of
 * its face toward the play. One with an angle runs that way, facing the flippers; any other stands along the wall
 * nearest it, facing away from that wall.
 */
function targetFrame(table: Table, t: Target): { u: [number, number]; n: [number, number] } {
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

/** A target as drawn: its pivot (at its place, turned to its face), its rest turn, and its turn or drop under way. */
export interface TargetView {
  pivot: THREE.Group;
  /** A flip plaque (it turns), or a drop target (it sinks). */
  plaque: boolean;
  /** The pivot's turn about y at rest: its local +x along its face, its local +z out of its front toward the play. */
  rest: number;
  /** A plaque's turn: from and to (0 its front, π its back), and when it started (sim time). */
  from: number;
  to: number;
  start: number;
  /** A drop target's height (0 up, -TARGET_DROP down). */
  y: number;
}

/**
 * A glow over the picture: which lamp (a LIT bit's name), bumper or sling it's over, and what draws it. A lamp's lies
 * flat on the playfield over the lamp, behind whatever stands in front of it (the picture's shapes are in the depth
 * buffer: table-mesh.ts's pictureDepth); a bumper's or a sling's faces the camera over it, drawn over everything (it's
 * a flash of light), since a sprite inside the bumper's own unseen shape would be hidden by it.
 */
export interface Glow {
  id: string;
  /** Its LIT bit; 0 for a bumper's or a sling's, which glows with its flash. */
  bit: number;
  object: THREE.Mesh | THREE.Sprite;
  material: THREE.MeshBasicMaterial | THREE.SpriteMaterial;
}

export class TableParts {
  readonly group = new THREE.Group();
  /** The stand-in's own looks (the bumper caps, the sling rubbers, the inserts): drawn only without the picture. */
  readonly standIn = new THREE.Group();
  /** The glows over the picture's lamps and bumpers: drawn only over the picture. */
  readonly glowGroup = new THREE.Group();
  /** The flippers in the table's order (left, right, upper right). */
  readonly flippers: { f: Flipper; mesh: THREE.Group }[] = [];
  /** Every target, in the table's order (the header's bit numbering). */
  readonly targets: TargetView[] = [];
  /** The spinners' plates: the main spinner, then the table's others. */
  readonly spinners: { pivot: THREE.Group }[] = [];
  readonly glows: Glow[] = [];
  /** Each bumper's and sling's flash (1 at a hit, dying away), with the stand-in's cap or rubber that shows it. */
  private readonly flashes = new Map<string, { flash: number; peak: number; mat: THREE.MeshStandardMaterial; rest: number; hot: number }>();
  /** Each stand-in insert, by the LIT bit that lights it. */
  private readonly inserts: { bit: number; mat: THREE.MeshStandardMaterial }[] = [];
  private down = 0;
  /** The plaques turned last set; null before the first (a plaque already turned then is shown turned, not turning). */
  private turned: number | null = null;
  private lit = 0;
  private clock = 0;

  constructor(table: Table) {
    const g = this.group;
    g.add(this.standIn, this.glowGroup);

    // The flippers: cream rubber bodies with a gold cap and a gold pin, as the picture's build draws them.
    for (const f of table.flippers) {
      const mesh = new THREE.Group();
      const body = new THREE.Mesh(flipperGeometry(f.length, FLIPPER_Y0, FLIPPER_Y1), CREAM);
      const cap = new THREE.Mesh(flipperGeometry(f.length, FLIPPER_Y1, FLIPPER_Y1 + 0.03, 0.82), GOLD);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 24), GOLD);
      pin.position.y = FLIPPER_Y1 + 0.045;
      body.castShadow = cap.castShadow = true;
      mesh.add(body, cap, pin);
      mesh.position.set(f.pivot[0], 0, f.pivot[1]);
      g.add(mesh);
      this.flippers.push({ f, mesh });
    }
    this.setFlippers(table.flippers.map((f) => f.restDeg));

    // The targets: a gold body with its emblem toward the play; a flip plaque has the sun disc on its back and a gold
    // pin over it, and turns about the pin.
    const sunBack = emblemMaterial(sundisc14, 0.8);
    for (const t of table.targets) {
      const { u, n } = targetFrame(table, t);
      // The pivot's local +x along its face and +z along n: a turn of φ about y takes +x to (cos φ, 0, -sin φ) and +z
      // to (sin φ, 0, cos φ), so with n = (-u.z, u.x), φ = atan2(-u.z, u.x); with n the other way, u is turned round.
      const along = n[0] * -u[1] + n[1] * u[0] >= 0 ? u : [-u[0], -u[1]];
      const rest = Math.atan2(-along[1], along[0]);
      const pivot = new THREE.Group();
      pivot.position.set(t.x, 0, t.z);
      pivot.rotation.y = rest;
      const body = new THREE.Mesh(new THREE.BoxGeometry(t.width, TARGET_HEIGHT, TARGET_THICK), GOLD);
      body.position.y = TARGET_HEIGHT / 2;
      body.castShadow = true;
      const face = new THREE.Mesh(emblemGeometry(t.width - 0.08), emblemMaterial(EMBLEMS[t.id] ?? ankh31, 0.5));
      face.position.z = TARGET_THICK / 2 + 0.003;
      pivot.add(body, face);
      if (t.flip) {
        const back = new THREE.Mesh(emblemGeometry(t.width - 0.08), sunBack);
        back.rotation.y = Math.PI;
        back.position.z = -(TARGET_THICK / 2 + 0.003);
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 16), GOLD);
        pin.position.y = TARGET_HEIGHT + 0.06;
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), GOLD);
        cap.position.y = TARGET_HEIGHT + 0.12;
        pivot.add(back, pin, cap);
      }
      g.add(pivot);
      this.targets.push({ pivot, plaque: t.flip === true, rest, from: 0, to: 0, start: -Infinity, y: 0 });
    }

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
    // of the pyramid (double score), the centre lane's four lamps, and the ball saver over the sun disc round the drain.
    table.rollovers.slice(0, 3).forEach((r, i) => this.addGlow(`rollover${i}`, rolloverBits[i], r.x, LAMP_Y, r.z, 0.8, AMBER, true));
    this.addGlow('lock', LIT.lock, table.lock.x, LAMP_Y, table.lock.z, table.lock.radius * 3.2, AMBER, true);
    for (const z of [4, 4.7]) this.addGlow('kickback', LIT.kickback, table.kickback.x, LAMP_Y, z, 0.75, BLUE, true);
    for (let k = 0; k < 5; k++) {
      for (const [x, z0] of [[-3.62, 6.75], [2.82, 6.55]]) this.addGlow('double', LIT.double, x, LAMP_Y, z0 + k * 0.6, 1, k % 2 ? BLUE : AMBER, true);
    }
    [LIT.centre0, LIT.centre1, LIT.centre2, LIT.centre3].forEach((bit, k) => this.addGlow(`centre${k}`, bit, CX, LAMP_Y, 2.9 + k * 0.62, 0.9, k % 2 ? BLUE : AMBER, true));
    this.addGlow('saver', LIT.saver, CX, LAMP_Y, DRAIN_Z, 1.9, AMBER, true);
    this.usePicture(true);
  }

  private addInsert(bit: number, x: number, z: number, radius: number, color: number): void {
    const { mesh, mat } = insert(x, z, radius, color);
    this.standIn.add(mesh);
    this.inserts.push({ bit, mat });
  }

  /** A glow `size` across at (x, y, z): flat on the playfield (a lamp's), or facing the camera over everything (a flash). */
  private addGlow(id: string, bit: number, x: number, y: number, z: number, size: number, color: number, flat: boolean): void {
    const look = { map: glowMap(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 };
    let glow: Glow;
    if (flat) {
      const material = new THREE.MeshBasicMaterial({ ...look, side: THREE.DoubleSide });
      const object = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
      object.rotation.x = -Math.PI / 2;
      glow = { id, bit, object, material };
    } else {
      const material = new THREE.SpriteMaterial({ ...look, depthTest: false });
      const object = new THREE.Sprite(material);
      object.scale.set(size, size, 1);
      object.renderOrder = 2;
      glow = { id, bit, object, material };
    }
    glow.object.position.set(x, y, z);
    glow.object.visible = false;
    this.glowGroup.add(glow.object);
    this.glows.push(glow);
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
   * The targets: `down`, the drop targets down (they sink in update, or rise back up); `turned`, the flip plaques
   * turned to their backs (bit i for target i). A plaque whose bit changes turns 180° about its pin over TURN_SECONDS
   * from `now` (sim time); at the first call (and the first after reset), each is shown as it is.
   */
  setTargets(down: number, turned: number, now: number): void {
    this.down = down;
    const was = this.turned;
    this.turned = turned;
    this.targets.forEach((t, i) => {
      if (!t.plaque) return;
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

  flashBumper(id: string): void {
    const f = this.flashes.get(id);
    if (f) f.flash = 1;
  }

  flashSling(id: string): void {
    this.flashBumper(id);
  }

  /** A fresh hello: the next targets are shown as they are, not turning. */
  reset(): void {
    this.turned = null;
  }

  /** Each frame: the flashes show and die away, the drop targets move toward up or down, the lamps glow or blink. */
  update(dt: number): void {
    this.clock += dt;
    this.targets.forEach((t, i) => {
      if (t.plaque) return;
      const goal = this.down & (1 << i) ? -TARGET_DROP : 0;
      const step = TARGET_SPEED * dt;
      t.y = Math.abs(goal - t.y) <= step ? goal : t.y + Math.sign(goal - t.y) * step;
      t.pivot.position.y = t.y;
      t.pivot.visible = t.y > -TARGET_DROP + 0.01;
    });
    const blink = Math.sin(this.clock * Math.PI * 4) > 0;
    const blinks = (bit: number) => bit === LIT.saver || bit === LIT.lock;
    for (const ins of this.inserts) {
      const on = (this.lit & ins.bit) !== 0;
      ins.mat.emissiveIntensity = on && (!blinks(ins.bit) || blink) ? LIT_ON : on ? LIT_ON * 0.35 : LIT_OFF;
    }
    for (const glow of this.glows) {
      let level: number;
      if (glow.bit) {
        const on = (this.lit & glow.bit) !== 0;
        level = on ? (!blinks(glow.bit) || blink ? GLOW_LIT : GLOW_DIM) : 0;
      } else {
        const f = this.flashes.get(glow.id);
        level = f ? f.peak * f.flash : 0;
      }
      if (level < 0.01) level = 0;
      glow.material.opacity = level;
      glow.object.visible = level > 0;
    }
    const decay = Math.exp(-dt * FLASH_DECAY);
    for (const f of this.flashes.values()) {
      f.mat.emissiveIntensity = f.rest + (f.hot - f.rest) * f.flash;
      f.flash *= decay;
    }
  }
}
