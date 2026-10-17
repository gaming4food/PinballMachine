// Supersampling (2026-09-30): the scene is drawn at several times the frame's size each way and shrunk back down, so
// coin edges, rings and the relief on their faces come out smooth, like an offline render, rather than stepped.
// Multisampling alone only smooths outlines, and it blends them before the tone mapping, which makes bright edges
// against dark ones step again; here every drawn pixel is tone-mapped first and then averaged in linear light.
import * as THREE from 'three';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * The last step, drawn to the screen: like three.js's OutputPass (tone mapping, then the display's color space), but
 * each screen pixel takes the factor x factor block of drawn pixels behind it, tone-maps them one by one and averages
 * them. The canvas stays the frame's size; the passes before it work at `factor` times that.
 *
 * Given the bloom's glow (FrameSizeBloomPass.glow), it adds it to each drawn pixel first, just as the bloom pass's own
 * last step would have: the same texture read at the same spot, added before the tone mapping. That step drew the
 * whole drawing over again at full size (0.73 of the RTX 3060's 4.8 ms a frame, 2026-10-04); here it's a few small
 * reads more in a pass that runs anyway. The picture is the same, bar rounding: the sum isn't stored at half
 * precision in between.
 */
export class SupersampleOutputPass extends OutputPass {
  private readonly drawnSize = new THREE.Vector2(1, 1);

  /** `keepAlpha`: average the drawing's transparency too (the corner layout), instead of making every pixel solid. */
  constructor(factor: number, keepAlpha = false, glow: THREE.Texture | null = null) {
    super();
    this.uniforms.tGlow = { value: glow };
    this.uniforms.drawnSize = { value: this.drawnSize };
    // OutputPass rebuilds the material's defines (which tone mapping, which color space) from the renderer's
    // settings; this shader reads the same ones.
    this.material.glslVersion = THREE.GLSL3;
    this.material.vertexShader = /* glsl */ `
      precision highp float;
      uniform mat4 modelViewMatrix;
      uniform mat4 projectionMatrix;
      in vec3 position;
      void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
    this.material.fragmentShader = /* glsl */ `
      precision highp float;
      uniform highp sampler2D tDiffuse;
      uniform highp sampler2D tGlow;
      uniform vec2 drawnSize;
      #include <tonemapping_pars_fragment>
      #include <colorspace_pars_fragment>
      out highp vec4 outColor;
      const int FACTOR = ${Math.round(factor)};

      vec3 toneMapped(vec3 color) {
        #if defined( LINEAR_TONE_MAPPING )
          return LinearToneMapping(color);
        #elif defined( REINHARD_TONE_MAPPING )
          return ReinhardToneMapping(color);
        #elif defined( CINEON_TONE_MAPPING )
          return CineonToneMapping(color);
        #elif defined( ACES_FILMIC_TONE_MAPPING )
          return ACESFilmicToneMapping(color);
        #elif defined( AGX_TONE_MAPPING )
          return AgXToneMapping(color);
        #elif defined( NEUTRAL_TONE_MAPPING )
          return NeutralToneMapping(color);
        #elif defined( CUSTOM_TONE_MAPPING )
          return CustomToneMapping(color);
        #else
          return color;
        #endif
      }

      void main() {
        ivec2 block = ivec2(gl_FragCoord.xy) * FACTOR;
        vec3 sum = vec3(0.0);
        float alpha = 0.0;
        for (int y = 0; y < FACTOR; y++) {
          for (int x = 0; x < FACTOR; x++) {
            ivec2 at = block + ivec2(x, y);
            vec4 c = texelFetch(tDiffuse, at, 0);
            ${glow ? 'c += texture(tGlow, (vec2(at) + 0.5) / drawnSize);' : ''}
            sum += toneMapped(c.rgb);
            alpha += clamp(c.a, 0.0, 1.0);
          }
        }
        outColor = vec4(sum / float(FACTOR * FACTOR), ${keepAlpha ? 'alpha / float(FACTOR * FACTOR)' : '1.0'});
        #ifdef SRGB_TRANSFER
          outColor = sRGBTransferOETF(outColor);
        #endif
      }`;
    this.material.needsUpdate = true;
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    this.drawnSize.set(readBuffer.width, readBuffer.height);
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

/**
 * Bloom that works at the frame's size, however many times bigger the scene is drawn, so the glow spreads just as far
 * and costs no more. Its first step shrinks the drawing to a quarter of the frame (half each way) while picking out
 * the bright parts; that step averages the whole block of drawn pixels behind each of its pixels, so small bright
 * things (sparks) glow steadily instead of flickering in and out between samples. Unless `addsGlowItself`, it leaves
 * its glow for the last pass to add (SupersampleOutputPass) rather than drawing it over the full-size drawing here.
 */
export class FrameSizeBloomPass extends UnrealBloomPass {
  private readonly texel = new THREE.Vector2();

  constructor(
    private readonly factor: number,
    frame: THREE.Vector2,
    strength: number,
    radius: number,
    threshold: number,
    addsGlowItself = true,
  ) {
    super(frame, strength, radius, threshold);
    // three.js skips drawing anything whose material is hidden, so the last step (blending the glow over the drawing)
    // costs nothing.
    this.blendMaterial.visible = addsGlowItself;
    const highPass = this.materialHighPassFilter;
    highPass.uniforms.uTexel = { value: this.texel };
    // three.js's LuminosityHighPassShader, reading factor x factor bilinear taps (each averaging 2x2 drawn pixels)
    // instead of one.
    highPass.fragmentShader = /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec3 defaultColor;
      uniform float defaultOpacity;
      uniform float luminosityThreshold;
      uniform float smoothWidth;
      uniform vec2 uTexel;
      varying vec2 vUv;
      const int FACTOR = ${Math.round(factor)};

      void main() {
        vec4 texel = vec4(0.0);
        for (int y = 0; y < FACTOR; y++) {
          for (int x = 0; x < FACTOR; x++) {
            vec2 offset = vec2(float(2 * x - (FACTOR - 1)), float(2 * y - (FACTOR - 1)));
            texel += texture2D(tDiffuse, vUv + offset * uTexel);
          }
        }
        texel /= float(FACTOR * FACTOR);
        float v = luminance(texel.xyz);
        vec4 outputColor = vec4(defaultColor.rgb, defaultOpacity);
        float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
        gl_FragColor = mix(outputColor, texel, alpha);
      }`;
    highPass.needsUpdate = true;
  }

  /** The finished glow, a quarter of the frame's size, to add over the drawing (its texture stays the same one). */
  get glow(): THREE.Texture {
    return this.renderTargetsHorizontal[0].texture;
  }

  /** Called with the drawing's size; the bloom itself works at the frame's. */
  override setSize(width: number, height: number): void {
    this.texel.set(1 / width, 1 / height);
    super.setSize(width / this.factor, height / this.factor);
  }
}
