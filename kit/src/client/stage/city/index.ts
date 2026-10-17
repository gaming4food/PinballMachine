// What's behind the machine: a video loop of the city (AI-made, picked in the control panel; see backdrop.ts), with
// fireworks and the leader's blimp playing on top. Its own scenes and camera, drawn first; the machine goes on top.
// (The hand-drawn 3D city that used to be here was removed on 2026-10-02: the video loops replaced it.)
import * as THREE from 'three';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { VideoBackdrop } from './backdrop';
import { shared, VIEW } from './common';
import { Blimp, Fireworks } from './shows';

export class City {
  /** The camera the fireworks and the blimp are seen through, as if from Pusher Pier. */
  readonly camera = new THREE.PerspectiveCamera(VIEW.fov, VIEW.aspect, 1, 4000);
  /** Fireworks and the blimp, drawn over the video. */
  private readonly shows = new THREE.Scene();
  private readonly backdrop = new VideoBackdrop();
  private readonly target = new THREE.Vector3();
  private readonly fireworks = new Fireworks();
  private readonly blimp = new Blimp();
  private clock = 0;

  constructor(screenHeight: number) {
    this.camera.position.copy(VIEW.position);
    const pitch = THREE.MathUtils.degToRad(VIEW.pitchDeg);
    this.target.set(VIEW.position.x, VIEW.position.y + Math.tan(pitch) * 100, VIEW.position.z - 100);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    shared.uPixelScale.value = screenHeight / (2 * Math.tan(THREE.MathUtils.degToRad(VIEW.fov / 2)));
    this.shows.add(this.fireworks.points, this.blimp.group);
  }

  /** Back to front: the video (which starts the picture), then fireworks and the blimp. */
  addPasses(composer: EffectComposer): void {
    composer.addPass(new RenderPass(this.backdrop.scene, this.backdrop.camera));
    const shows = new RenderPass(this.shows, this.camera);
    shows.clear = false;
    composer.addPass(shows);
  }

  /** Paints the blimp's banner; call once the display fonts have loaded. */
  fontsLoaded(): void {
    this.blimp.fontsLoaded();
  }

  /** Plays this video loop behind the machine (crossfading from the last one); null fades to dark. */
  setBackdrop(url: string | null): void {
    this.backdrop.show(url);
  }

  /** Fireworks over the bay: 1 for a gift, more for bigger moments. */
  celebrate(shells: number): void {
    this.fireworks.launch(shells);
  }

  setLeader(name: string | null, coins: number): void {
    this.blimp.setLeader(name, coins);
  }

  /** Advances the shows; `shake` nudges the camera along with the machine's (earthquakes). */
  update(dt: number, shakeX = 0, shakeY = 0): void {
    this.clock += dt;
    const t = this.clock;
    shared.uTime.value = t;
    this.camera.position.set(VIEW.position.x + shakeX * 0.4, VIEW.position.y + shakeY * 0.4, VIEW.position.z);
    this.camera.lookAt(this.target);
    this.backdrop.update(dt);
    this.fireworks.update(dt);
    this.blimp.update(dt, t);
  }
}
