// The ball's reflections with the table in them: the kit's neon room (neonEnvironment, kit/src/client/stage/environment.ts)
// plus a floor under the ball carrying the table's picture, so chrome shows the playfield it rolls on. The kit's builder
// stays as it is; this one makes its own five panels with the same colours and the look's strengths.
import * as THREE from 'three';
import type { Look } from '@kit/stage';

const PINK = 0xff2bd6;
const CYAN = 0x22e6ff;

// How far below the origin the floor lies, and how wide it is. From the origin its edge then sits under a third of a
// degree below the horizon, so it fills the whole view below it and no background shows through.
const FLOOR_DEPTH = 1;
const FLOOR_SIZE = 400;

/** The reflection room as a scene, with no renderer needed: the picture on a floor facing up, and the five neon panels. */
export function tableEnvironmentScene(picture: THREE.Texture, light: Look['env']): THREE.Scene {
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
  // The picture is drawn as it is, unlit, so the playfield's own light is what the ball reflects.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE), new THREE.MeshBasicMaterial({ map: picture }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -FLOOR_DEPTH;
  env.add(floor);
  panel(0xffffff, light.top, 10, 3, 0, 7, 2);
  panel(PINK, light.pink, 3, 7, -7, 1, 0);
  panel(CYAN, light.cyan, 3, 7, 7, 1, 0);
  panel(0xffb060, light.warm, 8, 2, 0, 2, -7);
  panel(0x7040ff, light.violet, 8, 2, 0, 1, 7);
  return env;
}

/** The scene blurred into an environment map, made once when the picture has loaded. */
export function tableEnvironment(renderer: THREE.WebGLRenderer, picture: THREE.Texture, light: Look['env']): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(tableEnvironmentScene(picture, light), 0.02).texture;
  pmrem.dispose();
  return tex;
}
