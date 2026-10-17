// Shared pieces of the shows over the city backdrop (fireworks, the blimp): uniforms their shaders read, GLSL helpers,
// the camera's view of the bay, and the neon palette.
import * as THREE from 'three';

/** One set of uniforms shared by every city material: updating a value here updates them all. */
export const shared = {
  uTime: { value: 0 },
  /** Distant things fade into this purple haze, which matches the sky near the horizon. */
  uHazeColor: { value: new THREE.Color(0x3a1450) },
  uHazeNear: { value: 110 },
  uHazeFar: { value: 900 },
  /** Converts a light's size in world units into pixels at distance 1 (screen height / (2 tan(fov/2))). */
  uPixelScale: { value: 1000 },
};

export const GLSL_COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uHazeColor;
uniform float uHazeNear;
uniform float uHazeFar;
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hazeAmount(float dist) { return smoothstep(uHazeNear, uHazeFar, dist) * 0.92; }
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
`;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Ground level across the bay, where the fireworks launch from. */
export const GROUND = 1.2;

/**
 * Where the camera stands and looks, from Pusher Pier across the bay. The machine covers the middle of the screen, so
 * the shows are placed by screen position (see screenX/screenY) to land in the gaps beside it.
 */
export const VIEW = {
  position: new THREE.Vector3(0, 7, 55),
  pitchDeg: 3.1,
  fov: 40,
  aspect: 16 / 9,
};
const tanHalf = Math.tan(THREE.MathUtils.degToRad(VIEW.fov / 2));

/** World x at depth z that appears at horizontal screen position sx (-1 is the left edge, 1 the right). */
export function screenX(sx: number, z: number): number {
  return VIEW.position.x + sx * (VIEW.position.z - z) * tanHalf * VIEW.aspect;
}

/** World y at depth z that appears at vertical screen position sy (-1 is the bottom edge, 1 the top). */
export function screenY(sy: number, z: number): number {
  const angle = THREE.MathUtils.degToRad(VIEW.pitchDeg) + Math.atan(sy * tanHalf);
  return VIEW.position.y + (VIEW.position.z - z) * Math.tan(angle);
}

/** The stage's neon colors, as linear colors ready for shaders. */
export const NEON = {
  pink: new THREE.Color(0xff2bd6),
  cyan: new THREE.Color(0x22e6ff),
  yellow: new THREE.Color(0xffd23f),
  violet: new THREE.Color(0x8a4dff),
  orange: new THREE.Color(0xff7a1a),
  red: new THREE.Color(0xff2a3a),
  green: new THREE.Color(0x3dff8a),
  warm: new THREE.Color(0xffc27a),
  white: new THREE.Color(0xfff4e8),
};

/** A material for glowing, see-through things (fireworks, lights): adds light, never hides what's behind. */
export function additive(params: Omit<THREE.ShaderMaterialParameters, 'blending' | 'transparent' | 'depthWrite'>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ ...params, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
}
