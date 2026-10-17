// The stage's neon light for metal to reflect, used by the coin pusher's scene (scene.ts) and by any machine's (through
// the kit, src/kit/stage.ts). Kept apart from scene.ts so a machine gets it without the coin pusher.
import * as THREE from 'three';
import type { Look } from './looks';

const PINK = 0xff2bd6;
const CYAN = 0x22e6ff;

/** A small "room" of neon panels, blurred into an environment map so metal reflects pink, cyan and warm light. */
export function neonEnvironment(renderer: THREE.WebGLRenderer, light: Look['env']): THREE.Texture {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x05030a);
  const panel = (color: number, intensity: number, w: number, h: number, x: number, y: number, z: number) => {
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
    glow.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glow);
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    env.add(mesh);
  };
  panel(0xffffff, light.top, 10, 3, 0, 7, 2);
  panel(PINK, light.pink, 3, 7, -7, 1, 0);
  panel(CYAN, light.cyan, 3, 7, 7, 1, 0);
  panel(0xffb060, light.warm, 8, 2, 0, 2, -7);
  panel(0x7040ff, light.violet, 8, 2, 0, 1, 7);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}
