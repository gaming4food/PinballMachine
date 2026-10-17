// Thousands of small lights (bulbs, lamps, windows of passing cars, blinking antenna lights) drawn in one call.
// Each light animates on the GPU from its own settings, so none of them cost anything per frame on the CPU.
import * as THREE from 'three';
import { additive, GLSL_COMMON, shared } from './common';

/** How a light behaves over time. */
export const Glow = {
  /** On, with a faint shimmer. */
  Steady: 0,
  /** Short flash once per cycle, like an aviation light. */
  Blink: 1,
  /** Marquee chase: set the phase to the bulb's position in the chain. */
  Chase: 2,
  /** Cycles through the rainbow. */
  Rainbow: 3,
  /** Flickers on and off at random. */
  Sparkle: 4,
} as const;

export interface LightOptions {
  mode?: number;
  /** Offset into the animation cycle, in cycles. */
  phase?: number;
  /** Animation cycles per second. */
  rate?: number;
  /** Drift along x in world units per second, wrapping around (cars, trains of light). */
  velocity?: number;
}

const VERTEX = /* glsl */ `
${GLSL_COMMON}
attribute vec3 aColor;
attribute float aSize;
attribute vec4 aAnim; // mode, phase, rate, velocity
uniform float uPixelScale;
uniform float uWrap;
varying vec3 vColor;
void main() {
  vec3 p = position;
  if (aAnim.w != 0.0) p.x = mod(p.x + aAnim.w * uTime + uWrap, 2.0 * uWrap) - uWrap;
  float t = uTime * aAnim.z + aAnim.y;
  float mode = aAnim.x;
  float b = 1.0;
  vec3 c = aColor;
  if (mode < 0.5) b = 0.9 + 0.1 * sin(t * 6.2832);
  else if (mode < 1.5) b = 0.04 + 1.7 * step(0.86, fract(t));
  else if (mode < 2.5) b = 0.14 + 0.86 * step(0.6667, fract(t));
  else if (mode < 3.5) c = hue(fract(t)) * max(c.r, max(c.g, c.b));
  else b = 0.2 + 0.8 * step(0.45, hash11(floor(t) + aAnim.y * 13.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  // Lights smaller than a pixel keep their total brightness instead of turning into hard dots.
  float px = aSize * uPixelScale / dist;
  float size = clamp(px, 2.0, 160.0);
  vColor = c * b * (1.0 - hazeAmount(dist)) * min(1.0, (px * px) / (size * size));
  gl_PointSize = size;
  gl_Position = projectionMatrix * mv;
}`;

export const GLOW_FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  float a = exp(-r2 * 16.0) + exp(-r2 * 3.2) * 0.3;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

export class LightSet {
  private readonly pos: number[] = [];
  private readonly color: number[] = [];
  private readonly size: number[] = [];
  private readonly anim: number[] = [];

  get count(): number {
    return this.size.length;
  }

  /** Adds one light. Size is the glow's diameter in world units; intensity above ~2 blooms. */
  add(x: number, y: number, z: number, color: THREE.Color, intensity: number, size: number, o: LightOptions = {}): void {
    this.pos.push(x, y, z);
    this.color.push(color.r * intensity, color.g * intensity, color.b * intensity);
    this.size.push(size);
    this.anim.push(o.mode ?? Glow.Steady, o.phase ?? Math.random(), o.rate ?? 0.3, o.velocity ?? 0);
  }

  /** Bulbs hanging between two posts, sagging in the middle. */
  string(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, sag: number, spacing: number, colors: THREE.Color[], intensity: number, size: number, o: LightOptions = {}): void {
    const length = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const n = Math.max(2, Math.round(length / spacing));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const y = y0 + (y1 - y0) * t - sag * 4 * t * (1 - t);
      this.add(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, colors[i % colors.length], intensity, size, { ...o, phase: o.mode === Glow.Chase ? i / 3 : o.phase });
    }
  }

  /** Builds the lights; `wrap` is the half-width drifting lights wrap around in. */
  build(wrap = 1000): THREE.Points {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(this.color, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(this.size, 1));
    geo.setAttribute('aAnim', new THREE.Float32BufferAttribute(this.anim, 4));
    const points = new THREE.Points(geo, additive({ uniforms: { ...shared, uWrap: { value: wrap } }, vertexShader: VERTEX, fragmentShader: GLOW_FRAGMENT }));
    points.frustumCulled = false; // drifting lights leave the bounds they were built with
    return points;
  }
}
