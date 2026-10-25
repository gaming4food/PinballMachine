// The ball's reflections with the table in them: the kit's neon room (neonEnvironment, kit/src/client/stage/environment.ts)
// plus a floor under the ball carrying the table's picture, so chrome shows the playfield it rolls on. The kit's builder
// stays as it is; this one makes its own five panels with the same colours and the look's strengths.
import * as THREE from 'three';
import type { Look } from '@kit/stage';

const PINK = 0xff2bd6;
const CYAN = 0x22e6ff;

// How far below the origin the floor lies, and how wide it is. At 14 across and 1 down, the picture's edges sit about
// 8 degrees below the horizon from the origin, so the ball's lower half reflects the whole table picture at a size it can
// be read at; a floor much wider would show it only as one blurred colour. Beyond the picture's edge a dark skirt, the
// room's own colour, stands in for the floor. The picture's wrapping is the texture's default, clamp, which is left as it is
// since the plate shares the texture.
const FLOOR_DEPTH = 1;
const FLOOR_SIZE = 14;
const SKIRT_SIZE = 400;
const ROOM = 0x05030a;

/** The reflection room as a scene, with no renderer needed: the picture on a floor facing up, and the five neon panels. */
export function tableEnvironmentScene(picture: THREE.Texture, light: Look['env']): THREE.Scene {
  const env = new THREE.Scene();
  env.background = new THREE.Color(ROOM);
  const panel = (color: number, intensity: number, w: number, h: number, x: number, y: number, z: number) => {
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
    glow.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glow);
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    env.add(mesh);
  };
  // The floor shows the table picture as it is, unlit, so the playfield's own lighting is what the ball reflects.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE), new THREE.MeshBasicMaterial({ map: picture }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -FLOOR_DEPTH;
  env.add(floor);
  const skirt = new THREE.Mesh(new THREE.PlaneGeometry(SKIRT_SIZE, SKIRT_SIZE), new THREE.MeshBasicMaterial({ color: ROOM }));
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = -FLOOR_DEPTH - 0.01;
  env.add(skirt);
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
  const scene = tableEnvironmentScene(picture, light);
  const tex = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  // The scene is thrown away; its geometry and materials go with it, but the picture is the caller's and stays.
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    (o.material as THREE.Material).dispose();
  });
  return tex;
}
