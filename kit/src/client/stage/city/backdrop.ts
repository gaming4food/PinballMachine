// The video loop playing behind the machine (the fireworks and the blimp stay on top). Its own full-screen layer,
// the first thing drawn each frame: it fades in from dark once the first loop's first frame is ready (so a stage
// that's just loaded never shows anything else), and a new loop crossfades over the old one.
import * as THREE from 'three';

/** Seconds to fade in from dark (or out, with no loop to show). */
const COVER_SEC = 0.6;
/** Seconds to crossfade from one loop to the next. */
const CROSSFADE_SEC = 3;

interface Clip {
  url: string;
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
}

const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLACK.needsUpdate = true;

function openClip(url: string): Clip {
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  video.play().catch(() => {
    // Muted videos may autoplay everywhere (OBS included); if a browser still refuses, the next click retries.
    addEventListener('pointerdown', () => void video.play().catch(() => {}), { once: true });
  });
  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  return { url, video, texture };
}

function closeClip(clip: Clip): void {
  clip.video.pause();
  // Releases the decoder and the file: this runs 24/7, one loop after another.
  clip.video.removeAttribute('src');
  clip.video.load();
  clip.texture.dispose();
}

export class VideoBackdrop {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** 0: dark, 1: the video. */
  cover = 0;
  private readonly uniforms = {
    uFrom: { value: BLACK as THREE.Texture },
    uTo: { value: BLACK as THREE.Texture },
    uMix: { value: 1 },
    uCover: { value: 0 },
    /** Keeps the backdrop a little darker than the video itself, so the machine stays the star. */
    uLevel: { value: 0.85 },
  };
  private wanted: string | null = null;
  private pending: Clip | null = null;
  private from: Clip | null = null;
  private to: Clip | null = null;
  private mix = 1;

  constructor() {
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uFrom;
        uniform sampler2D uTo;
        uniform float uMix;
        uniform float uCover;
        uniform float uLevel;
        varying vec2 vUv;
        void main() {
          vec3 color = mix(texture2D(uFrom, vUv).rgb, texture2D(uTo, vUv).rgb, uMix) * uLevel;
          gl_FragColor = vec4(color, uCover);
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** Plays this loop (crossfading from the current one), or null to fade to dark. */
  show(url: string | null): void {
    if (url === this.wanted) return;
    this.wanted = url;
    if (this.pending) closeClip(this.pending);
    // Loaded in the background; it takes over once its first frame is ready, so nothing flashes black.
    this.pending = url && url !== this.to?.url ? openClip(url) : null;
  }

  update(dt: number): void {
    const pending = this.pending;
    if (pending && pending.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.pending = null;
      if (this.to && this.cover > 0) {
        // A loop is showing: crossfade from it.
        if (this.from) closeClip(this.from);
        this.from = this.to;
        this.mix = 0;
      } else if (this.to) {
        closeClip(this.to);
      }
      this.to = pending;
    }
    if (this.from) {
      this.mix = Math.min(1, this.mix + dt / CROSSFADE_SEC);
      if (this.mix >= 1) {
        closeClip(this.from);
        this.from = null;
      }
    }
    const target = this.wanted && this.to ? 1 : 0;
    const step = dt / COVER_SEC;
    this.cover = target > this.cover ? Math.min(target, this.cover + step) : Math.max(target, this.cover - step);
    if (!this.wanted && this.cover === 0 && this.to) {
      closeClip(this.to);
      this.to = null;
    }
    const u = this.uniforms;
    u.uFrom.value = this.from?.texture ?? BLACK;
    u.uTo.value = this.to?.texture ?? BLACK;
    u.uMix.value = this.from ? this.mix : 1;
    u.uCover.value = this.cover;
  }
}
