// A machine drawn over a picture of itself (the coin pusher's photo look, the claw): the picture goes through the stage's
// final tone mapping, so it's drawn through inverseAces first (through src/kit/stage.ts).
import * as THREE from 'three';

// three.js's ACES filmic tone mapping, run backwards, so the picture comes out of the stage's final tone mapping
// looking as it went in. Capped below the bloom threshold, so the picture's own neon doesn't glow a second time. A
// machine drawn over a picture of its own uses the same (inverseAces and its uniforms, through src/kit/stage.ts).
const ACES_IN = new THREE.Matrix3().set(0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777);
const ACES_OUT = new THREE.Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602);
export const INVERSE_ACES_GLSL = /* glsl */ `
  uniform mat3 uInvAcesIn;
  uniform mat3 uInvAcesOut;
  uniform float uExposure;
  vec3 inverseAces(vec3 c) {
    vec3 y = clamp(uInvAcesOut * c, 0.0, 1.0);
    // RRTAndODTFit(v) = (v (v + 0.0245786) - 0.000090537) / (v (0.983729 v + 0.432951) + 0.238081), solved for v.
    vec3 a = 1.0 - 0.983729 * y;
    vec3 b = 0.0245786 - 0.432951 * y;
    vec3 c2 = -(0.000090537 + 0.238081 * y);
    vec3 v = (-b + sqrt(max(b * b - 4.0 * a * c2, 0.0))) / (2.0 * max(a, 1e-4));
    return min(max(uInvAcesIn * v, 0.0) * 0.6 / uExposure, vec3(2.0));
  }
`;

export function pictureUniforms(map: THREE.Texture, exposure: number): Record<string, THREE.IUniform> {
  return {
    uMap: { value: map },
    uExposure: { value: exposure },
    uInvAcesIn: { value: ACES_IN.clone().invert() },
    uInvAcesOut: { value: ACES_OUT.clone().invert() },
  };
}
