// The table's live parts, drawn from each snapshot's header and the stage's cues: both flippers at their angles, the
// bumper caps that flash on a hit, the sling rubbers that flash on a kick, the drop targets that drop by the header's
// bitmask (and come back up when the bank resets), the spinner's blade at its turn, and the inserts lit by the
// header's bits (shared/pinball.ts LIT). These stay when the owner's picture replaces the stand-in table (Task 8).
// In the table's own coordinates, as table-mesh.ts.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { LIT } from '../shared/pinball';
import type { Flipper, Table } from '../shared/table';
import { CYAN, PINK, segmentBox } from './table-mesh';

const YELLOW = 0xffd23f;
const GREEN = 0x39ff6a;
/** The flippers' shape, as the physics has it (server/sim.ts): base and tip radius, and height. */
const FLIPPER_BASE_R = 0.22;
const FLIPPER_TIP_R = 0.1;
const FLIPPER_HEIGHT = 0.45;
/** How tall a drop target stands, and how fast it drops and comes back (units a second). */
const TARGET_HEIGHT = 0.55;
const TARGET_SPEED = 6;
/** How bright a cap glows at rest, at a hit's flash, and how fast a flash dies away (per second, exponential). */
const CAP_REST = 0.6;
const CAP_FLASH = 9;
const FLASH_DECAY = 7;
/** An insert's glow lit, and unlit. */
const LIT_ON = 3.2;
const LIT_OFF = 0.12;

/** A flipper's shape in its own frame: +x from the pivot to the tip, standing on the playfield. */
function flipperGeometry(length: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const n = 16;
  for (const y of [0, FLIPPER_HEIGHT]) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      pts.push(new THREE.Vector3(FLIPPER_BASE_R * Math.cos(a), y, FLIPPER_BASE_R * Math.sin(a)));
      pts.push(new THREE.Vector3(length - FLIPPER_TIP_R + FLIPPER_TIP_R * Math.cos(a), y, FLIPPER_TIP_R * Math.sin(a)));
    }
  }
  return new ConvexGeometry(pts);
}

/** An insert: a round light set into the playfield, with its glow material. */
function insert(x: number, z: number, radius: number, color: number): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial } {
  const mat = new THREE.MeshStandardMaterial({ color: 0x050208, emissive: color, emissiveIntensity: LIT_OFF, roughness: 0.2, transparent: true, opacity: 0.95 });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.006, z);
  return { mesh, mat };
}

export class TableParts {
  readonly group = new THREE.Group();
  private readonly flippers: { f: Flipper; mesh: THREE.Mesh }[] = [];
  private readonly caps = new Map<string, { mat: THREE.MeshStandardMaterial; flash: number }>();
  private readonly rubbers = new Map<string, { mat: THREE.MeshStandardMaterial; flash: number }>();
  private readonly targets: { mesh: THREE.Mesh; y: number }[] = [];
  private readonly spinner: THREE.Mesh;
  /** Each insert, by the LIT bit that lights it. */
  private readonly inserts: { bit: number; mat: THREE.MeshStandardMaterial }[] = [];
  private targetBits = 0;
  private lit = 0;
  private clock = 0;

  constructor(table: Table) {
    const g = this.group;
    // The flippers: white bats with a pink rubber ring round their tops.
    const bat = new THREE.MeshStandardMaterial({ color: 0xf2f0f8, roughness: 0.3, metalness: 0.1, emissive: PINK, emissiveIntensity: 0.12 });
    for (const f of table.flippers) {
      const mesh = new THREE.Mesh(flipperGeometry(f.length), bat);
      mesh.position.set(f.pivot[0], 0, f.pivot[1]);
      mesh.castShadow = true;
      g.add(mesh);
      this.flippers.push({ f, mesh });
      this.setFlipper(f.side, f.restDeg);
    }

    // The bumper caps, each glowing in its own colour, and flashing on a hit.
    const capColors = [PINK, CYAN, YELLOW];
    table.bumpers.forEach((b, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x200818, emissive: capColors[i % capColors.length], emissiveIntensity: CAP_REST, roughness: 0.25 });
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(b.radius * 1.15, b.radius * 1.05, 0.12, 32), mat);
      cap.position.set(b.x, 0.5, b.z);
      cap.castShadow = true;
      g.add(cap);
      this.caps.set(b.id, { mat, flash: 0 });
    });

    // The slings' rubber faces, white, flashing cyan on a kick.
    for (const s of table.slings) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xf4f4f8, emissive: CYAN, emissiveIntensity: 0.2, roughness: 0.5 });
      const face = segmentBox(s.a, s.b, 0.1, 0.32, mat);
      g.add(face);
      this.rubbers.set(s.id, { mat, flash: 0 });
    }

    // The drop targets, yellow, standing on the wall's face of the playfield.
    const targetMat = new THREE.MeshStandardMaterial({ color: 0x3a2a00, emissive: YELLOW, emissiveIntensity: 0.9, roughness: 0.3 });
    for (const t of table.targets) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, TARGET_HEIGHT, t.width * 0.9), targetMat);
      mesh.position.set(t.x, TARGET_HEIGHT / 2, t.z);
      mesh.castShadow = true;
      g.add(mesh);
      this.targets.push({ mesh, y: TARGET_HEIGHT / 2 });
    }

    // The spinner's blade: a thin chrome plate across its lane, turning about the line between its posts.
    const sp = table.spinner;
    this.spinner = new THREE.Mesh(new THREE.BoxGeometry(sp.width * 0.92, 0.36, 0.03), new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: 0.2, emissive: CYAN, emissiveIntensity: 0.15 }));
    this.spinner.position.set(sp.x, 0.42, sp.z);
    g.add(this.spinner);

    // The inserts: one under each rollover, the lock's ring, the kickback's, double score's and the ball saver's.
    const rolloverBits = [LIT.rollover0, LIT.rollover1, LIT.rollover2];
    table.rollovers.forEach((r, i) => this.addInsert(rolloverBits[i] ?? 0, r.x, r.z, 0.28, CYAN));
    this.addInsert(LIT.lock, table.lock.x, table.lock.z, table.lock.radius * 1.3, PINK);
    this.addInsert(LIT.kickback, table.kickback.x, table.kickback.z + 1.4, 0.26, YELLOW);
    const mid = (table.flippers[0].pivot[0] + table.flippers[1].pivot[0]) / 2;
    this.addInsert(LIT.double, mid, 7, 0.45, YELLOW);
    this.addInsert(LIT.saver, mid, 1.1, 0.32, GREEN);
  }

  private addInsert(bit: number, x: number, z: number, radius: number, color: number): void {
    const { mesh, mat } = insert(x, z, radius, color);
    this.group.add(mesh);
    if (bit) this.inserts.push({ bit, mat });
  }

  /** A flipper at `deg`, the table's degrees: from +x toward +z (a turn of φ about y takes +x to (cos φ, 0, -sin φ)). */
  setFlipper(side: 'left' | 'right', deg: number): void {
    for (const { f, mesh } of this.flippers) if (f.side === side) mesh.rotation.y = -THREE.MathUtils.degToRad(deg);
  }

  /** The drop targets down (bit i for target i): they sink out of sight, or rise back up. */
  setTargets(bits: number): void {
    this.targetBits = bits;
  }

  /** The spinner's turn, in radians. */
  setSpinner(angle: number): void {
    this.spinner.rotation.x = angle;
  }

  /** The lit inserts (LIT): lit ones glow, and the saver's and double's blink while they're on. */
  setLit(bits: number): void {
    this.lit = bits;
  }

  flashBumper(id: string): void {
    const cap = this.caps.get(id);
    if (cap) cap.flash = 1;
  }

  flashSling(id: string): void {
    const rubber = this.rubbers.get(id);
    if (rubber) rubber.flash = 1;
  }

  /** Each frame: the flashes die away, the targets move toward up or down, the inserts glow or blink. */
  update(dt: number): void {
    this.clock += dt;
    const decay = Math.exp(-dt * FLASH_DECAY);
    for (const cap of this.caps.values()) {
      cap.mat.emissiveIntensity = CAP_REST + (CAP_FLASH - CAP_REST) * cap.flash;
      cap.flash *= decay;
    }
    for (const rubber of this.rubbers.values()) {
      rubber.mat.emissiveIntensity = 0.2 + 5 * rubber.flash;
      rubber.flash *= decay;
    }
    this.targets.forEach((t, i) => {
      const goal = this.targetBits & (1 << i) ? -TARGET_HEIGHT / 2 : TARGET_HEIGHT / 2;
      const step = TARGET_SPEED * dt;
      t.y = Math.abs(goal - t.y) <= step ? goal : t.y + Math.sign(goal - t.y) * step;
      t.mesh.position.y = t.y;
      t.mesh.visible = t.y > -TARGET_HEIGHT / 2 + 0.01;
    });
    const blink = Math.sin(this.clock * Math.PI * 4) > 0;
    for (const ins of this.inserts) {
      const on = (this.lit & ins.bit) !== 0;
      const blinks = ins.bit === LIT.saver || ins.bit === LIT.lock;
      ins.mat.emissiveIntensity = on && (!blinks || blink) ? LIT_ON : on ? LIT_ON * 0.35 : LIT_OFF;
    }
  }
}
