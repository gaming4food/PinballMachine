// Things that make the city feel alive: fireworks over the bay (now and then on their own, and whenever the game
// has something to celebrate) and a blimp drifting across the sky with an LED banner naming the high scorer.
import * as THREE from 'three';
import { additive, GLSL_COMMON, GROUND, lerp, NEON, screenX, screenY, shared } from './common';
import { GLOW_FRAGMENT, Glow, LightSet } from './lights';

const MAX_SPARKS = 6000;
const GRAVITY = 7;

const SPARK_VERTEX = /* glsl */ `
${GLSL_COMMON}
attribute vec3 aColor;
attribute float aSize;
uniform float uPixelScale;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = -mv.z;
  float px = aSize * uPixelScale / dist;
  float size = clamp(px, 2.0, 64.0);
  vColor = aColor * min(1.0, (px * px) / (size * size)) * (1.0 - hazeAmount(dist));
  gl_PointSize = size;
  gl_Position = projectionMatrix * mv;
}`;

type Kind = 'peony' | 'ring' | 'willow' | 'double';

interface Shell {
  x: number;
  y: number;
  z: number;
  vy: number;
  fuse: number;
  kind: Kind;
  colors: THREE.Color[];
}

const PALETTE = [NEON.pink, NEON.cyan, NEON.yellow, NEON.violet, NEON.green, NEON.white, NEON.orange];
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

export class Fireworks {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX_SPARKS * 3);
  private readonly col = new Float32Array(MAX_SPARKS * 3);
  private readonly vel = new Float32Array(MAX_SPARKS * 3);
  private readonly base = new Float32Array(MAX_SPARKS * 3);
  private readonly life = new Float32Array(MAX_SPARKS);
  private readonly span = new Float32Array(MAX_SPARKS);
  private readonly drag = new Float32Array(MAX_SPARKS);
  private readonly crackle = new Uint8Array(MAX_SPARKS);
  private next = 0;
  private readonly shells: Shell[] = [];
  /** Seconds until each queued shell goes up. */
  private readonly queued: number[] = [];
  private ambient = 10;

  constructor() {
    for (let k = 0; k < MAX_SPARKS; k++) this.pos[k * 3 + 1] = -1e4; // parked out of sight until used
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX_SPARKS).fill(2.4), 1));
    this.points = new THREE.Points(geo, additive({ uniforms: { ...shared }, vertexShader: SPARK_VERTEX, fragmentShader: GLOW_FRAGMENT }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  /** Sends up `count` shells, a moment apart. */
  launch(count: number): void {
    let delay = 0;
    for (let i = 0; i < count; i++) {
      this.queued.push(delay);
      delay += lerp(0.2, 0.55, Math.random());
    }
  }

  update(dt: number): void {
    this.ambient -= dt;
    if (this.ambient <= 0) {
      this.ambient = lerp(20, 50, Math.random());
      this.launch(Math.random() < 0.35 ? 2 : 1);
    }
    for (let i = this.queued.length - 1; i >= 0; i--) {
      this.queued[i] -= dt;
      if (this.queued[i] <= 0) {
        this.queued.splice(i, 1);
        this.fireShell();
      }
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.fuse -= dt;
      s.vy -= GRAVITY * dt;
      s.y += s.vy * dt;
      this.spark(s.x, s.y, s.z, (Math.random() - 0.5) * 1.5, -2, (Math.random() - 0.5) * 1.5, NEON.warm, 1.6, 0.45, 2, false);
      if (s.fuse <= 0) {
        this.burst(s);
        this.shells.splice(i, 1);
      }
    }
    for (let k = 0; k < MAX_SPARKS; k++) {
      if (this.life[k] <= 0) continue;
      const i = k * 3;
      this.life[k] -= dt;
      if (this.life[k] <= 0) {
        this.pos[i + 1] = -1e4;
        this.col[i] = this.col[i + 1] = this.col[i + 2] = 0;
        continue;
      }
      const f = Math.exp(-this.drag[k] * dt);
      this.vel[i] *= f;
      this.vel[i + 1] = this.vel[i + 1] * f - GRAVITY * dt;
      this.vel[i + 2] *= f;
      this.pos[i] += this.vel[i] * dt;
      this.pos[i + 1] += this.vel[i + 1] * dt;
      this.pos[i + 2] += this.vel[i + 2] * dt;
      const t = this.life[k] / this.span[k];
      let b = Math.min(1, t / 0.35);
      if (this.crackle[k] && t < 0.4) b *= Math.random() < 0.5 ? 1.8 : 0.15;
      this.col[i] = this.base[i] * b;
      this.col[i + 1] = this.base[i + 1] * b;
      this.col[i + 2] = this.base[i + 2] * b;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aColor.needsUpdate = true;
  }

  private fireShell(): void {
    const z = lerp(-120, -200, Math.random());
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = screenX(side * lerp(0.42, 0.95, Math.random()), z);
    const burstY = screenY(lerp(0.4, 0.85, Math.random()), z);
    const fuse = lerp(1.1, 1.6, Math.random());
    // Launched so gravity brings it to the burst height just as the fuse runs out.
    const vy = (burstY - GROUND + (GRAVITY * fuse * fuse) / 2) / fuse;
    const kind = pick<Kind>(['peony', 'peony', 'ring', 'willow', 'double']);
    const colors = kind === 'willow' ? [NEON.yellow] : [pick(PALETTE), pick(PALETTE)];
    this.shells.push({ x, y: GROUND, z, vy, fuse, kind, colors });
  }

  private burst(s: Shell): void {
    const dir = new THREE.Vector3();
    const tilt = new THREE.Euler(lerp(-1, 1, Math.random()), 0, lerp(-0.6, 0.6, Math.random()));
    const count = s.kind === 'ring' ? 110 : s.kind === 'willow' ? 130 : 160;
    for (let n = 0; n < count; n++) {
      if (s.kind === 'ring') {
        const a = (n / count) * Math.PI * 2;
        dir.set(Math.cos(a), Math.sin(a), 0).applyEuler(tilt);
      } else {
        dir.randomDirection();
      }
      const willow = s.kind === 'willow';
      const inner = s.kind === 'double' && n % 2 === 1;
      const speed = willow ? lerp(15, 19, Math.random()) : inner ? lerp(12, 16, Math.random()) : lerp(25, 31, Math.random());
      const color = inner ? s.colors[1] : s.colors[0];
      const life = willow ? lerp(2.6, 3.4, Math.random()) : lerp(1.5, 2.2, Math.random());
      this.spark(s.x, s.y, s.z, dir.x * speed, dir.y * speed, dir.z * speed, color, 3.4, life, willow ? 0.9 : 1.35, willow || Math.random() < 0.2);
    }
  }

  private spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, intensity: number, life: number, drag: number, crackle: boolean): void {
    const k = this.next;
    this.next = (this.next + 1) % MAX_SPARKS;
    const i = k * 3;
    this.pos[i] = x;
    this.pos[i + 1] = y;
    this.pos[i + 2] = z;
    this.vel[i] = vx;
    this.vel[i + 1] = vy;
    this.vel[i + 2] = vz;
    this.base[i] = color.r * intensity;
    this.base[i + 1] = color.g * intensity;
    this.base[i + 2] = color.b * intensity;
    this.life[k] = this.span[k] = life;
    this.drag[k] = drag;
    this.crackle[k] = crackle ? 1 : 0;
  }
}

const BODY_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying float vDist;
void main() {
  vNormal = normal;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const BODY_FRAGMENT = /* glsl */ `
${GLSL_COMMON}
varying vec3 vNormal;
varying float vDist;
void main() {
  vec3 n = normalize(vNormal);
  vec3 col = vec3(0.07, 0.05, 0.13) * (0.55 + 0.45 * n.y);           // dark hull, lighter on top
  col += vec3(1.0, 0.17, 0.84) * pow(max(0.0, -n.y), 2.0) * 0.3;     // the city's pink glow from below
  col += vec3(0.4, 0.5, 1.0) * pow(1.0 - abs(n.z), 3.0) * 0.07;      // cool rim
  gl_FragColor = vec4(mix(col, uHazeColor, hazeAmount(vDist) * 0.6), 1.0);
}`;

/** Size of the blimp's LED screen, in world units. */
const BANNER_W = 21;
const BANNER_H = 3.4;

/** A blimp drifting across the sky, its LED banner scrolling the city's news. */
export class Blimp {
  readonly group = new THREE.Group();
  private readonly screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private message = 'COIN-OP CITY   •   CHAT TO PLAY   •   !drop 10 FOR A COIN SHOWER   •   ';
  private fontsReady = false;
  private readonly z = -140;
  private readonly baseY: number;
  private readonly span: number;
  /** Banner scroll speed in pixels of the texture per second. */
  private readonly scrollPx = 110;
  private width = 1;

  constructor() {
    this.baseY = screenY(0.8, this.z);
    this.span = screenX(1.25, this.z);
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({ uniforms: { ...shared }, vertexShader: BODY_VERTEX, fragmentShader: BODY_FRAGMENT }));
    hull.scale.set(21, 5.8, 5.8);
    const dark = new THREE.MeshBasicMaterial({ color: 0x140e26 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(4.8, 4.4, 0.4), dark);
    top.position.set(-18.5, 3.6, 0);
    const wings = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.4, 9.6), dark);
    wings.position.set(-18.5, 0, 0);
    const gondola = new THREE.Mesh(new THREE.BoxGeometry(6.3, 1.7, 2.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc27a).multiplyScalar(0.9) }));
    gondola.position.set(0.7, -6.1, 0);
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(BANNER_W, BANNER_H), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 1.9, 1.9) }));
    this.screen.position.set(0, 0.4, 5.65);
    const lights = new LightSet();
    lights.add(-21.4, 0, 0.7, NEON.red, 3, 3, { mode: Glow.Steady });
    lights.add(21.4, 0, 0.7, NEON.green, 3, 3, { mode: Glow.Steady });
    lights.add(0.7, -7.2, 0.8, NEON.white, 6, 4.6, { mode: Glow.Blink, rate: 0.9 });
    this.group.add(hull, top, wings, gondola, this.screen, lights.build());
    this.group.position.set(this.span * 0.45, this.baseY, this.z);
    this.paintBanner();
  }

  /** Puts the current high scorer on the banner (null when nobody has coins yet). */
  setLeader(name: string | null, coins: number): void {
    const lead = name ? `HI-SCORE: ${name.toUpperCase()} ${coins.toLocaleString('en-US')}   •   ` : '';
    const next = `${lead}COIN-OP CITY   •   CHAT TO PLAY   •   !drop 10 FOR A COIN SHOWER   •   `;
    if (next === this.message) return;
    this.message = next;
    this.paintBanner();
  }

  /** Repaints with the pixel font; call once the display fonts have loaded. */
  fontsLoaded(): void {
    this.fontsReady = true;
    this.paintBanner();
  }

  private paintBanner(): void {
    if (!this.fontsReady) return;
    const font = '64px "Press Start 2P"';
    const measure = document.createElement('canvas').getContext('2d')!;
    measure.font = font;
    // One loop of the message is exactly the texture's width, so it scrolls around seamlessly.
    this.width = Math.min(8192, Math.ceil(measure.measureText(this.message).width));
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = 128;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#060309';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.font = font;
    g.textBaseline = 'middle';
    g.fillStyle = '#ffd23f';
    g.shadowColor = '#ff9a2a';
    g.shadowBlur = 12;
    g.fillText(this.message, 0, 70);
    // LED grid: dark lines between the "bulbs".
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(6, 3, 9, 0.75)';
    for (let y = 0; y < 128; y += 6) g.fillRect(0, y, canvas.width, 2);
    for (let x = 0; x < canvas.width; x += 6) g.fillRect(x, 0, 2, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = (128 * (BANNER_W / BANNER_H)) / this.width; // the screen shows a window of the banner
    const old = this.screen.material.map;
    this.screen.material.map = tex;
    this.screen.material.needsUpdate = true;
    old?.dispose();
  }

  update(dt: number, t: number): void {
    const p = this.group.position;
    p.x += 1.6 * dt;
    if (p.x > this.span) p.x = -this.span;
    p.y = this.baseY + Math.sin(t * 0.35) * 0.8;
    const map = this.screen.material.map;
    if (map) map.offset.x = (map.offset.x + (this.scrollPx * dt) / this.width) % 1;
  }
}
