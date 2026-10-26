// The pinball on the stage (spec section 2): the table is the Blender picture (src/assets/pinball.png, rendered through
// this stage's own camera, stageCamera; blender/README.md), drawn full-frame behind the 3D scene and shaking with it,
// with the live parts over it (pinball-parts.ts: the three flippers at the header's angles, the flip plaques turning
// and the drop targets dropping by its bits, the quest's toys by its bits and toy bits (the pop-ups and the mummy
// rising and sinking, the tomb's door sliding up into the pyramid, the diverter's gate swinging), both spinners, glows
// over the lamps and bumpers), the chrome balls (at their heights, so up the ramps and on the dish) with their owners'
// name tags and scores, a coin burst on a ball's payout, and the "+N name" popups. The picture's solid shapes are in
// the depth buffer, unseen (table-mesh.ts's pictureDepth), so a ball behind the pyramid or under the right ramp is
// hidden by it, and a ball the tomb holds at its doorway is seen. If the picture fails to load, the stand-in table
// (table-mesh.ts) is drawn instead. Lit with the stage's neon environment and drawn through the stage's render passes
// (bloom, supersampling), with the city behind, as the claw's stage is (the claw's claw.ts is the model). The camera
// looks down the table from the player's end at about 40°. The server runs the physics; this only draws the snapshots.
//
// The scoreboard over it is PinballHud (pinball-hud.ts), the sounds pinball-sounds.ts, the header's reading
// pinball-header.ts.
//
// The quest's flash plays over the table: the show book (pinball-shows.ts) turns each moment (a hype moment, a toy's
// hit from the server's cues, multiball, a payout) into a light show over the table's lamps (light-show.ts, lit through
// pinball-parts.ts), a flash of the picture (screen-hits.ts, in the picture's own shader), sparks (sparks.ts) and a
// shake, and the open tomb sends up its beam. Chat's sandstorm blows sand across the table (sand.ts) and hazes the
// picture amber, in the same shader, easing in and out over 0.8 s. They run on the table's clock as drawn (DrawnClock),
// so they stand still while the table does, and nothing of theirs flashes more than 3 times a second.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { TexturePass } from 'three/addons/postprocessing/TexturePass.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Vec3 } from '@kit/shared';
import {
  City,
  cssColor,
  FrameSizeBloomPass,
  FULL_QUALITY,
  HEIGHT,
  INVERSE_ACES_GLSL,
  type Look,
  type MachineScene,
  nameFxClass,
  neonEnvironment,
  pictureUniforms,
  type RenderQuality,
  type ScoreMsg,
  type StageNet,
  type StageSounds,
  SupersampleOutputPass,
  type Track,
  WIDTH,
} from '@kit/stage';
import picture from '../assets/pinball.png';
import { pinballCueOf, pinballHypeOf, type PinballState, pinballStateOf, RULES, TOY } from '../shared/pinball';
import { TABLE_IN_USE, TABLE, type Table } from '../shared/table';
import { BallTrails } from './ball-trail';
import { CoinBurst } from './coin-burst';
import { LightShowPlayer } from './light-show';
import { type PinballHeader, readPinballHeader } from './pinball-header';
import { ballSaved, PinballHud } from './pinball-hud';
import { type QuestLook, TableParts } from './pinball-parts';
import { DrawnClock, PinballShows } from './pinball-shows';
import { HAZE, HazeTracker, Sand } from './sand';
import { type DrawnBall, PinballSoundCues, PinballVoice } from './pinball-sounds';
import { ScreenFlash } from './screen-hits';
import { Sparks, TombBeam } from './sparks';
import { tableEnvironment } from './table-environment';
import { CYAN, PINK, pictureDepth, standInTable } from './table-mesh';
import './pinball.css';

export { ballSaved, PinballHud, TITLE_SECONDS } from './pinball-hud';

/** Whether one of chat's events (the state's, until its time on the table's clock) is on at table time `now`. */
const onAt = (event: { until: number } | null | undefined, now: number): boolean => event != null && now < event.until;

/** How far the camera looks down from level, in degrees. */
const CAMERA_PITCH = 40;
const CAMERA_FOV = 32;
/**
 * Where stageCamera's fitted box sits in the frame, in frame pixels from the top. The box is the table's frame by
 * TABLE's size: the side rails' outsides, from the cabinet's front (z -1.7) to past the top rail (z length + 0.6), from
 * the playfield up to the rails' tops (0.9). It is not the rails themselves, and things outside it show past it. The owner
 * placed it by hand (2026-10-26), high in the frame and at 92% of its old size (168 to 1066). As drawn there:
 * - the rails run from about y 22 to 805;
 * - the temple behind the top rail reaches y 3, just inside the frame's top edge;
 * - the cabinet's front with the plunger's knob ends at about y 941.
 * The scoreboard (pinball.css) sits at the frame's foot under it, and covers the cabinet's front only when it's tall.
 */
export const FRAME_TOP = 58;
export const FRAME_BOTTOM = 882;
/**
 * The machine as the picture shows it, in frame pixels (its opaque box: picture-test measures the picture and holds it
 * to these): from the temple's top to the cabinet's foot with the plunger's knob, and across the cabinet.
 */
export const MACHINE = { top: 4, bottom: 942, left: 555, right: 1365 } as const;
/**
 * In the full layout (the scoreboard in the city's right column, not under the table) the machine fills the frame's
 * height: its top at FULL_TOP and its foot at FULL_BOTTOM, a small margin each end (the owner's design, 2026-10-26),
 * centred across. That is a zoom of about 1.134 (fullFrameView).
 */
export const FULL_TOP = 8;
export const FULL_BOTTOM = 1072;
/**
 * The picture is rendered at this many times the frame's size each way (npm run picture: 2880 x 1620), so the full
 * layout's zoom still has more than a texel for each screen pixel and the picture stays sharp. The plate stretches it
 * over the frame whatever its size, so nothing else depends on it.
 */
export const PICTURE_SCALE = 1.5;

/** A rectangle of the frame (frame pixels, y down) drawn over the whole screen: the stage's view of its frame. */
export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** The whole frame: the corner and vertical layouts' view, as fitStageCamera frames it. */
export const WHOLE_FRAME: ViewRect = { x: 0, y: 0, width: WIDTH, height: HEIGHT };

/**
 * The full layout's view: the rectangle of the frame (as fitStageCamera frames it) that is drawn over the whole screen,
 * so that MACHINE's top and foot land on FULL_TOP and FULL_BOTTOM. It has the frame's shape (one zoom both ways) and is
 * centred across, as the machine is.
 */
export function fullFrameView(): ViewRect {
  const zoom = (FULL_BOTTOM - FULL_TOP) / (MACHINE.bottom - MACHINE.top);
  const width = WIDTH / zoom;
  const height = HEIGHT / zoom;
  return { x: (WIDTH - width) / 2, y: MACHINE.top - FULL_TOP / zoom, width, height };
}

/**
 * Draws `view` of the frame over the whole screen, shaken (dx, dy) screen pixels (dy down): one 2D zoom of the 3D
 * camera and of the picture alike. The 3D camera keeps its place and aim (fitStageCamera's) and only its view offset
 * changes, to the view's sub-rectangle of the frame it was fitted for (moved by `viewY`, its own offset); the plate
 * camera takes the same sub-rectangle of the picture. A pinhole camera's sub-rectangle is exactly a zoom of its image,
 * so the live parts stay on the picture's pixels (picture-test). The shake is divided by the zoom, so it moves the
 * screen by the same pixels zoomed or not. The city behind is drawn through its own camera and never zooms.
 */
export function setStageView(camera: THREE.PerspectiveCamera, viewY: number, plateCamera: THREE.OrthographicCamera, plate: THREE.Object3D, view: ViewRect, dx: number, dy: number): void {
  const k = view.width / WIDTH;
  camera.setViewOffset(WIDTH, HEIGHT, view.x - dx * k, viewY + view.y - dy * k, view.width, view.height);
  plateCamera.setViewOffset(WIDTH, HEIGHT, view.x, view.y, view.width, view.height);
  plate.position.set(dx * k, -dy * k, 0);
}

/**
 * Whether the stage draws the full layout, as the overlay was last told (pinballOverlay): the scenes on the page frame
 * the machine by it. The scene and the overlay are made apart, from the machine's pages, the scene first.
 */
let fullFrame = false;
const scenes = new Set<PinballScene>();
/** Whether the overlay was last made for the full layout (a panel given). */
export const isFullFrame = (): boolean => fullFrame;

/**
 * The pinball's overlay (its pages' OverlayFactory): the scoreboard and the big titles (PinballHud), and the layout
 * for the scene. A `panel` (the city's right column) is given in the full layout only, so it is what says the layout:
 * with one, the scoreboard goes there and the machine fills the frame's height (fullFrameView); without, the
 * scoreboard is under the table and the frame is whole. The stand-in host gives a panel too.
 */
export function pinballOverlay(root: HTMLElement, panel: HTMLElement | null): PinballHud {
  fullFrame = panel !== null;
  for (const scene of scenes) scene.frameFull(fullFrame);
  return new PinballHud(root, panel);
}

/** How hard the view shakes in a quake (frame pixels), and the city behind it (scene units), as the claw's. */
const QUAKE_PIXELS = 22;
const QUAKE_SHAKE = 0.28;
/** Places in the trails' pools beyond the most balls at once, so a ball a frame late to leave never takes another's. */
const TRAIL_SPARE = 2;
/** Snapshot headers kept to draw between. */
const MAX_SAMPLES = 6;
/** A ball despawned and another of the same owner spawned within this long (sim time) is the same ball, saved. */
const SAVED_WITHIN = 0.05;
/** How long a drain's place is kept for its payout's coin burst (s). */
const DRAIN_KEPT = 3;
/** Where a payout's coins burst from when no drain was seen: just above the drain. */
const DRAIN_Z = 0.8;
/** How high a ball's tag floats over it. */
const TAG_HEIGHT = 0.8;

/**
 * The table's place in the world: z mirrored (the table's z runs up it, away from the camera) and tilted up by
 * TABLE.tiltDeg. The stage's table group and the Blender picture's (tools/export-scene.ts) are both placed by it.
 */
export function tiltTable<T extends THREE.Object3D>(group: T): T {
  group.scale.z = -1;
  group.rotation.x = THREE.MathUtils.degToRad(TABLE.tiltDeg);
  return group;
}

/**
 * The stage's camera, for a frame `width` × `height`: at the player's end, looking down the table at CAMERA_PITCH, as
 * far back as it must be for the table's frame (the box FRAME_TOP describes: the side rails' outsides, the cabinet's
 * front to past the top rail, the playfield to the rails' tops, by the table's size, TABLE) to fit between FRAME_TOP and
 * FRAME_BOTTOM; then moved in the frame by a view offset of `viewY` pixels to put it there.
 * `matrix` is the camera's world matrix (column-major, three's Y-up world, with the table tilted in it as the stage
 * tilts it) and `fovY` its vertical field of view in degrees. The stage (fitCamera) and the Blender picture
 * (tools/export-scene.ts) both use it, so the picture lines up with the live parts drawn over it.
 */
export function stageCamera(table: Table, width: number, height: number): { matrix: number[]; fovY: number; viewY: number } {
  void table; // the fit is to the table's frame (TABLE's size), the same for any table drawn in it
  const tilted = tiltTable(new THREE.Group());
  tilted.updateMatrixWorld(true);
  const world = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(tilted.matrixWorld);
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, width / height, 0.5, 200);
  const half = TABLE.width / 2 + 0.8;
  const corners: THREE.Vector3[] = [];
  for (const x of [-half, half]) for (const z of [-1.7, TABLE.length + 0.6]) for (const y of [0, 0.9]) corners.push(world(x, y, z));
  const aim = world(0, 0, TABLE.length * 0.45);
  const pitch = THREE.MathUtils.degToRad(CAMERA_PITCH);
  const back = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
  const band = ((FRAME_BOTTOM - FRAME_TOP) / height) * 2;
  const ndc = new THREE.Vector3();
  let top = 1;
  let bottom = -1;
  for (let d = 8; d < 120; d += 0.05) {
    camera.position.copy(aim).addScaledVector(back, d);
    camera.lookAt(aim);
    camera.updateMatrixWorld(true);
    top = -Infinity;
    bottom = Infinity;
    let wide = 0;
    for (const c of corners) {
      ndc.copy(c).project(camera);
      top = Math.max(top, ndc.y);
      bottom = Math.min(bottom, ndc.y);
      wide = Math.max(wide, Math.abs(ndc.x));
    }
    if (top - bottom <= band && wide < 0.95) break;
  }
  // The table's middle at NDC (top + bottom) / 2 goes to the band's middle: a view offset moves it up by its pixels.
  const want = 1 - (FRAME_TOP + FRAME_BOTTOM) / height;
  const viewY = ((want - (top + bottom) / 2) * height) / 2;
  return { matrix: [...camera.matrixWorld.elements], fovY: CAMERA_FOV, viewY };
}

/**
 * A camera set as the stage sets its own (stageCamera, for a frame `width` × `height`): placed and aimed, and moved in
 * the frame by its view offset. Returns the offset (pixels), which shaking the view moves it from.
 */
export function fitStageCamera(camera: THREE.PerspectiveCamera, width: number, height: number): number {
  const fit = stageCamera(TABLE_IN_USE, width, height);
  camera.fov = fit.fovY;
  camera.aspect = width / height;
  camera.matrix.fromArray(fit.matrix);
  camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
  camera.updateMatrixWorld(true);
  camera.setViewOffset(width, height, 0, fit.viewY, width, height);
  return fit.viewY;
}

/** A ball as drawn: its chrome sphere and its name tag. */
interface BallView {
  mesh: THREE.Mesh;
  tag: CSS2DObject | null;
  tagText: string;
  /** Whether its launch has been heard (a ball already there at hello has none). */
  launched: boolean;
}

export class PinballScene implements MachineScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, WIDTH / HEIGHT, 0.5, 200);
  private readonly composer: EffectComposer;
  private backdropComposer: EffectComposer | null = null;
  private backdrop: TexturePass | null = null;
  /** The table's picture, full-frame in its own scene behind the 3D one: it shakes with the 3D view (shake). */
  private readonly plateScene = new THREE.Scene();
  private readonly plateCamera = new THREE.OrthographicCamera(-WIDTH / 2, WIDTH / 2, HEIGHT / 2, -HEIGHT / 2, -10, 10);
  private readonly plate: THREE.Mesh;
  /** The stand-in table (drawn only if the picture fails to load), and the picture's unseen shapes (drawn with it). */
  private readonly standIn: THREE.Group;
  private readonly depth: THREE.Group;
  private readonly labelRenderer: CSS2DRenderer;
  private readonly city: City | null;
  /**
   * The table, in its own coordinates (shared/table.ts: x across, y up, z up the table), turned into the world's: z
   * mirrored, so the table runs away from a camera at the player's end with its left on the left, and tilted up toward
   * its top by TABLE.tiltDeg.
   */
  private readonly table = new THREE.Group();
  private readonly parts: TableParts;
  private readonly burst = new CoinBurst();
  private readonly cues: PinballSoundCues;
  // The quest's flash, public so that the browser's console can look inside while testing (window.pinballScene).
  /** The light shows over the table's lamps (parts.lamps.all), mixed into one light for each. */
  readonly player: LightShowPlayer;
  /** The screen flash over the table's picture, under its cap. */
  readonly flash = new ScreenFlash();
  /** The sparks' fixed pool, in the table group. */
  readonly sparks = new Sparks();
  /** The balls' trails and glows, in the table group: pools for the most balls at once, and a spare. */
  readonly trails = new BallTrails(1 + RULES.maxExtraBalls + TRAIL_SPARE, TABLE.ballRadius);
  /** The open tomb's beam, in the table group: its motes are sparks. */
  readonly beam = new TombBeam(TABLE_IN_USE, this.sparks);
  /** The sandstorm's sand, a pool of its own, in the table group. */
  readonly sand = new Sand();
  /** The show book: what each moment plays, through the player, the sparks, the flash and the view's quake. */
  readonly shows: PinballShows;
  /**
   * The table's clock as drawn, for every effect (the shows, the flash, the sparks, the beam and the coins): it holds
   * still where the drawn time slips back a little, starts again where the table's clock does, and steps at most 0.1 s.
   */
  private readonly tableClock = new DrawnClock();
  /** The quest's lasting look: refilled each frame from the state and handed to the parts, which keep it. */
  private readonly questLook: QuestLook = { god: null, finale: false, curse: false, summoned: false };
  /** The screen flash on the picture's shader (below): the colour added over the picture, and how much of it. */
  private readonly flashUniforms = { uFlash: { value: new THREE.Color(0, 0, 0) }, uFlashAmount: { value: 0 } };
  /** The sandstorm's haze on the picture's shader: its colour, and how much of the picture is mixed toward it. */
  private readonly hazeUniforms = { uHaze: { value: new THREE.Color(HAZE.color) }, uHazeAmount: { value: 0 } };
  /** The haze as drawn, from the state's storm; and the browser's clock at the last frame (s), null at first. */
  private readonly haze = new HazeTracker();
  private lastReal: number | null = null;
  private readonly ballGeo = new THREE.SphereGeometry(TABLE.ballRadius, 32, 24);
  private readonly ballMat = new THREE.MeshStandardMaterial({ color: 0xd4d8e2, metalness: 1, roughness: 0.12, envMapIntensity: 1.4 });
  private readonly balls = new Map<number, BallView>();
  private readonly samples: PinballHeader[] = [];
  /** The pinball's state as the server last said: the names and scores for the tags. */
  private state: PinballState | null = null;
  /** Where balls drained lately (sim time), for their payouts' coin bursts; and the payouts waiting to burst. */
  private readonly drains: { x: number; z: number; at: number }[] = [];
  private readonly payouts: { x: number; amount: number }[] = [];
  private readonly neonLights: THREE.PointLight[] = [];
  private readonly effects: { update(dt: number): boolean }[] = [];
  /** The view's place in the frame (fitCamera), and until when (the scene's clock) it shakes (quake). */
  private viewY = 0;
  /** The rectangle of the frame drawn over the screen: the whole frame, or the full layout's zoom (frameFull). */
  private view: ViewRect = fullFrame ? fullFrameView() : WHOLE_FRAME;
  private shakeUntil = 0;
  private readonly p = [0, 0, 0];
  private readonly q = [0, 0, 0, 1];
  private clock = 0;
  private popCount = 0;

  constructor(
    canvas: HTMLCanvasElement,
    labelsEl: HTMLElement,
    private readonly look: Look,
    sounds?: StageSounds,
    withCity = true,
    cityOnly = false,
    quality: RenderQuality = FULL_QUALITY,
    /** See-through: nothing behind the machine. */
    transparent = false,
  ) {
    // The pinball's own sounds on the stage's synth (pinball-sounds.ts); the bumpers and slings flash with theirs.
    const voice = new PinballVoice(sounds?.synth() ?? null);
    this.parts = new TableParts(TABLE_IN_USE);
    // The show book plays each moment on the light-show player over the table's lamps, the sparks, the screen flash and
    // the view's quake. Where the table's clock starts again, the old clock's shows and flashes go together.
    this.player = new LightShowPlayer(this.parts.lamps.all);
    this.shows = new PinballShows(TABLE_IN_USE, this.parts.lamps, {
      play: (show, at) => this.player.play(show, at),
      sparks: (x, y, z, color, count) => this.sparks.burst(x, y, z, color, count),
      flash: (color, strength, at) => this.flash.flash(color, strength, at),
      shake: (seconds) => this.quake(seconds),
      fade: (f, at) => this.player.fade(f, at),
      coinRain: (coins) => this.burst.rain(coins),
      clear: () => {
        this.player.clear();
        this.flash.clear();
      },
    });
    this.cues = new PinballSoundCues({
      flip: () => voice.flip(),
      bumper: (id) => {
        voice.bumper();
        this.parts.flashBumper(id);
      },
      sling: (id) => {
        voice.sling();
        this.parts.flashSling(id);
      },
      target: (index, ball) => {
        voice.target();
        // Each of the mummy's hits is a cue from the server, with where the ball was (pinball-sounds.ts): it stays up
        // when hit, so it rocks away from that ball.
        if (TABLE_IN_USE.targets[index]?.rise === 'hold' && ball) this.parts.rockMummy(ball);
      },
      rise: () => voice.rise(),
      door: () => voice.door(),
      gate: () => voice.gate(),
      drain: () => voice.drain(),
      launch: () => voice.launch(),
      // The cues decide multiball once, for a press and for the lock alike, so its show is played from here, at the
      // table's time drawn last.
      multiball: () => {
        voice.multiball();
        this.shows.multiball(this.tableClock.now);
      },
      saved: () => voice.saved(),
      jackpot: () => voice.jackpot(),
      wind: () => voice.wind(),
      curse: () => voice.curse(),
    });
    const w = Math.round(WIDTH * quality.scale);
    const h = Math.round(HEIGHT * quality.scale);
    const ss = quality.supersample;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: transparent });
    if (transparent) this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = look.exposure;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.city = withCity ? new City(h) : null;
    this.scene.environment = neonEnvironment(this.renderer, look.env);
    this.scene.environmentIntensity = look.envIntensity;

    // The picture, full-frame (it was rendered at the stage's size through its camera), drawn through inverseAces so
    // the stage's tone mapping gives it back as it was rendered. Hidden until it loads; if it can't, the stand-in
    // table.
    const map = new THREE.TextureLoader().load(
      picture,
      () => {
        this.plate.visible = true;
        // The balls now reflect the table they roll on. The neon room it replaces is let go; on an error it stays.
        const neon = this.scene.environment;
        this.scene.environment = tableEnvironment(this.renderer, map, look.env);
        neon?.dispose();
      },
      undefined,
      () => {
        console.warn(`pinball: the table's picture (${picture}) didn't load; drawing the stand-in table`);
        this.plate.visible = false;
        this.standIn.visible = true;
        this.depth.visible = false;
        this.parts.usePicture(false);
      },
    );
    map.colorSpace = THREE.SRGBColorSpace;
    // Drawn flat over the frame at PICTURE_SCALE texels a screen pixel, or that over the full layout's zoom (1.32):
    // both under 2, where a plain linear filter is sharp, and mipmaps would blend in their half-size level and blur it.
    map.generateMipmaps = false;
    map.minFilter = THREE.LinearFilter;
    this.plate = new THREE.Mesh(
      new THREE.PlaneGeometry(WIDTH, HEIGHT),
      new THREE.ShaderMaterial({
        uniforms: {
          ...pictureUniforms(map, look.exposure),
          // The screen flash (screen-hits.ts): the colour to add over the picture, and how much of it, set each frame
          // (update). At 0 the picture is drawn as it was rendered.
          ...this.flashUniforms,
          // The sandstorm's haze, likewise: the colour the picture is mixed toward, and how much (0 with no storm).
          ...this.hazeUniforms,
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform vec3 uFlash;
          uniform float uFlashAmount;
          uniform vec3 uHaze;
          uniform float uHazeAmount;
          varying vec2 vUv;
          ${INVERSE_ACES_GLSL}
          void main() {
            vec4 texel = texture2D(uMap, vUv);
            // The flash is added to the picture as it was rendered, before the tone mapping is run back, and by the
            // picture's alpha, so it lights the table and not the city that shows through the picture's clear parts.
            // The haze is mixed in first, by the picture's alpha as the flash is, so the flash shows bright through it.
            vec3 hazed = mix(texel.rgb, uHaze, uHazeAmount * texel.a);
            gl_FragColor = vec4(inverseAces(hazed + uFlash * uFlashAmount * texel.a), texel.a);
          }`,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.plate.visible = false;
    this.plateScene.add(this.plate);

    tiltTable(this.table);
    this.standIn = standInTable(TABLE_IN_USE, look, TABLE.width, TABLE.length);
    this.standIn.visible = false;
    this.depth = pictureDepth(TABLE_IN_USE, TABLE.width, TABLE.length);
    // The sparks, the beam and the sand are in the table's own coordinates, as the parts are.
    this.table.add(this.standIn, this.depth, this.parts.group, this.burst.group, this.trails.group, this.sparks.points, this.beam.group, this.sand.points);
    this.scene.add(this.table);
    this.table.updateMatrixWorld(true);
    this.addLights();
    this.fitCamera();

    // The render passes, as the claw's: the city at the canvas's size, the 3D table over it (supersampled), the glow
    // folded into the last pass.
    const target = new THREE.WebGLRenderTarget(w * ss, h * ss, { type: THREE.HalfFloatType, samples: quality.msaa });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.setPixelRatio(1);
    this.composer.setSize(w * ss, h * ss);
    // The picture over the city, behind the 3D table (with nothing behind, over the look's background).
    const platePass = cityOnly ? null : new RenderPass(this.plateScene, this.plateCamera);
    if (platePass && this.city) platePass.clear = false;
    else if (platePass && !transparent) this.plateScene.background = new THREE.Color(look.background);
    let backdrop = this.composer;
    if (ss > 1 && (this.city || platePass)) {
      const backdropTarget = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: quality.msaa });
      backdropTarget.texture.minFilter = backdropTarget.texture.magFilter = THREE.NearestFilter;
      backdrop = this.backdropComposer = new EffectComposer(this.renderer, backdropTarget);
      backdrop.setPixelRatio(1);
      backdrop.setSize(w, h);
      backdrop.renderToScreen = false;
      this.backdrop = new TexturePass(backdrop.readBuffer.texture);
      if (transparent) this.backdrop.clear = true;
      this.composer.addPass(this.backdrop);
    }
    this.city?.addPasses(backdrop);
    if (platePass) backdrop.addPass(platePass);
    if (!cityOnly) {
      // Over the city and the picture, keeping them.
      const machine = new RenderPass(this.scene, this.camera);
      machine.clear = false;
      machine.clearDepth = true;
      this.composer.addPass(machine);
    }
    const { strength, radius, threshold } = look.bloom;
    const separateGlow = quality.separateGlow === true;
    const bloom = new FrameSizeBloomPass(ss, new THREE.Vector2(w, h), strength, radius, threshold, separateGlow);
    this.composer.addPass(bloom);
    this.composer.addPass(new SupersampleOutputPass(ss, transparent, separateGlow ? null : bloom.glow));

    this.labelRenderer = new CSS2DRenderer({ element: labelsEl });
    this.labelRenderer.setSize(WIDTH, HEIGHT);
    // For looking inside from the browser's console while testing (as the claw's window.clawScene).
    (window as unknown as { pinballScene: PinballScene }).pinballScene = this;
    scenes.add(this);
  }

  /** The full layout (true: the machine fills the frame's height, fullFrameView) or not (the whole frame). */
  frameFull(full: boolean): void {
    this.view = full ? fullFrameView() : WHOLE_FRAME;
    this.shake(0, 0);
  }

  /** A point on the table (its own coordinates) in the world. */
  private world(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.table.matrixWorld);
  }

  /**
   * The camera where stageCamera puts it: its place and aim, and its place in the frame (a view offset), with the
   * layout's view over it (setStageView).
   */
  private fitCamera(): void {
    this.viewY = fitStageCamera(this.camera, WIDTH, HEIGHT);
    this.shake(0, 0);
  }

  /**
   * The view and the picture moved (dx, dy) screen pixels (dy down) from where fitCamera and the layout's view put them;
   * (0, 0) puts them back (setStageView).
   */
  private shake(dx: number, dy: number): void {
    setStageView(this.camera, this.viewY, this.plateCamera, this.plate, this.view, dx, dy);
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x9d8cff, 0x1a0b24, this.look.hemi));
    const key = new THREE.SpotLight(0xfff1e0, this.look.key, 0, 0.7, 0.55, 2);
    key.position.copy(this.world(0, 18, 6));
    key.target.position.copy(this.world(0, 0, 9));
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.camera.near = 4;
    key.shadow.camera.far = 50;
    this.scene.add(key, key.target);
    for (const [color, x] of [[PINK, -8], [CYAN, 8]] as const) {
      const light = new THREE.PointLight(color, this.look.accents, 34, 2);
      light.position.copy(this.world(x, 4, 8));
      this.neonLights.push(light);
      this.scene.add(light);
    }
  }

  /**
   * The pinball's own messages: its state (the tags' names and scores, multiball's sound), its hype moments and the
   * toys' hits (its cues), each of the last two for the sounds and for the show book.
   */
  machineMessage(msg: unknown): void {
    const hype = pinballHypeOf(msg);
    if (hype) {
      this.cues.hype(hype);
      this.shows.hype(hype);
    }
    const cue = pinballCueOf(msg);
    if (cue) {
      this.cues.cue(cue);
      this.shows.cue(cue);
    }
    const state = pinballStateOf(msg);
    if (state) {
      this.state = state;
      this.cues.state(state);
      this.shows.state(state);
    }
  }

  /**
   * Each pinball snapshot's header: the flippers, the lit lamps, the targets, the spinners and the toys
   * (SNAP_TYPE_PINBALL).
   */
  snapshotHeader(view: DataView, _simTime: number): void {
    this.samples.push(readPinballHeader(view));
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  /**
   * The table at render time t, between its snapshots: every flipper's and spinner's angle blended (the spinners the
   * short way round), the bits the earlier snapshot's. Null before the first.
   */
  private headerAt(t: number): PinballHeader | null {
    const s = this.samples;
    if (!s.length) return null;
    if (t <= s[0].time) return s[0];
    let i = s.length - 1;
    while (i > 0 && s[i - 1].time > t) i--;
    if (i === 0 || t >= s[s.length - 1].time) return s[s.length - 1];
    const a = s[i - 1];
    const b = s[i];
    const k = (t - a.time) / Math.max(1e-6, b.time - a.time);
    const spinners = a.spinners.map((sa, n) => {
      let spin = (b.spinners[n] ?? sa) - sa;
      if (spin > Math.PI) spin -= 2 * Math.PI;
      else if (spin < -Math.PI) spin += 2 * Math.PI;
      return sa + spin * k;
    });
    return { ...a, time: t, flippers: a.flippers.map((fa, n) => fa + ((b.flippers[n] ?? fa) - fa) * k), spinners };
  }

  /** A payout: a burst of coins where the ball drained (in update); the stage's own coin chime plays for it. */
  score(msg: ScoreMsg): boolean {
    this.payouts.push({ x: msg.x, amount: msg.amount });
    return false;
  }

  /** The text of a ball's tag: its owner's name and score, from its spawn's label or the state. Empty: no tag. */
  private tagFor(track: Track): string {
    let ball: PinballState['balls'][number] | undefined;
    if (track.owner !== undefined && this.state) {
      for (const b of this.state.balls) {
        if (b.owner === track.owner) {
          ball = b;
          break;
        }
      }
    }
    const name = track.label ?? ball?.name ?? null;
    if (!name) return '';
    return ball ? `${name} · ${ball.score.toLocaleString('en-US')}` : name;
  }

  /** The colour of a ball's owner, from the state (null: a house ball, or a server too old to send one). */
  private colourOf(track: Track): number | null {
    if (track.owner === undefined || !this.state) return null;
    for (const b of this.state.balls) if (b.owner === track.owner) return b.color ?? null;
    return null;
  }

  /** A ball at this.p, this.q, with its tag over it (the tag isn't the ball's child, so it doesn't spin with it). */
  private drawBall(track: Track): void {
    let view = this.balls.get(track.id);
    if (!view) {
      const mesh = new THREE.Mesh(this.ballGeo, this.ballMat);
      mesh.castShadow = true;
      this.table.add(mesh);
      view = { mesh, tag: null, tagText: '', launched: track.spawnAt === -Infinity };
      this.balls.set(track.id, view);
    }
    if (!view.launched) {
      view.launched = true;
      this.cues.launched();
    }
    view.mesh.position.set(this.p[0], this.p[1], this.p[2]);
    view.mesh.quaternion.set(this.q[0], this.q[1], this.q[2], this.q[3]);
    // A saved ball respawns with a new id, and a teleport or an unstick is seen by show()'s own check (a move of more
    // than 4 ball diameters, faster than any ball flies, starts the path again), so jump() is never needed here. The
    // state doesn't say a ball is held (in the lock, on a flipper), so none is passed as held: a held ball isn't
    // moving, and its trail is dark.
    this.trails.show(track.id, this.p[0], this.p[1], this.p[2], this.colourOf(track), false, this.tableClock.now);
    const text = this.tagFor(track);
    if (text !== view.tagText) {
      view.tagText = text;
      if (!view.tag && text) {
        const el = document.createElement('div');
        el.className = 'tag pinball-tag';
        el.style.setProperty('--c', cssColor(CYAN));
        const inner = document.createElement('span');
        if (track.fx) inner.className = nameFxClass(track.fx);
        el.append(inner);
        view.tag = new CSS2DObject(el);
        this.table.add(view.tag);
      }
      const span = view.tag?.element.firstElementChild;
      // A chat name is text, never markup.
      if (span) span.textContent = text;
      if (view.tag) view.tag.visible = text !== '';
    }
    view.tag?.position.set(this.p[0], this.p[1] + TAG_HEIGHT, this.p[2]);
  }

  private dropBall(id: number): void {
    const view = this.balls.get(id);
    if (!view) return;
    if (view.tag) {
      this.table.remove(view.tag);
      view.tag.element.remove();
    }
    this.table.remove(view.mesh);
    this.trails.end(id);
    this.balls.delete(id);
  }

  update(net: StageNet, t: number, dt: number): void {
    this.clock += dt;
    // Balls gone: a drain (its place kept for the payout's coins), or a drain given straight back (saved).
    for (const gone of net.collectDespawned(t)) {
      const last = gone.samples[gone.samples.length - 1]?.p;
      this.dropBall(gone.id);
      if (gone.despawnReason !== 'lost') continue;
      if (last) this.drains.push({ x: last[0], z: last[2], at: gone.despawnAt });
      const back = [...net.tracks.values()].some((tr) => tr.id !== gone.id && tr.owner === gone.owner && Math.abs(tr.spawnAt - gone.despawnAt) < SAVED_WITHIN);
      if (back) {
        this.cues.saved();
        ballSaved(gone.despawnAt);
      } else {
        this.cues.drained();
      }
    }
    while (this.drains.length && this.drains[0].at < t - DRAIN_KEPT) this.drains.shift();

    // The table's live parts, from the header at this time.
    const h = this.headerAt(t);
    if (h) {
      this.parts.setFlippers(h.flippers);
      this.parts.setSpinners(h.spinners);
      this.parts.setTargets(h.targetsDown, h.targetsTurned, t);
      this.parts.setToys(h.toys);
      this.parts.setLit(h.lit);
      this.cues.flippers(t, h.flippers[0], h.flippers[1]);
      this.cues.targets(h.targetsDown, h.targetsTurned);
      this.cues.toys(h.toys);
      this.beam.set((h.toys & TOY.tombOpen) !== 0);
    }

    // The flash runs on the table's clock as drawn, which stops when the table does. It goes by `now` (DrawnClock), not
    // by the drawn time itself, which slips back a little after the table pauses: `now` holds still through a slip, and
    // the screen flash's 3 a second holds only on a clock that never goes back. The moments due by now play first, so
    // that the lamps and the picture show them in this frame.
    const step = h ? this.tableClock.step(h.time) : 0;
    const now = this.tableClock.now;
    // The rise limits of the glows and of the picture's flash count real seconds, from the browser's own clock: they
    // guard what the viewers see, and the host's dt and the drawn table time can both run faster than real time (the
    // city's dt sums to about 1.5 times it).
    const real = performance.now() / 1000;
    const realStep = this.lastReal === null ? 0 : real - this.lastReal;
    this.lastReal = real;
    this.shows.frame(now);
    this.parts.setShowLights(this.player.lights(now));
    // The quest's lasting look comes from the state, so a stage opened late shows it. The dim is asked every frame,
    // since the player lets go of its finished fades only there.
    this.questLook.god = this.state?.quest.mode?.god ?? null;
    this.questLook.finale = this.state ? this.state.quest.finale !== null : false;
    // Chat's events, each on until its time on the table's clock. They're looked at only once there is a header (after
    // a hello too), since until then `now` isn't the table's time and an event already over would show.
    const events = h ? this.state?.events : undefined;
    this.questLook.curse = onAt(events?.curse, now);
    this.questLook.summoned = onAt(events?.mummy, now);
    this.parts.setQuestLook(this.questLook, now);
    // The sandstorm: its wind's sand, and its haze, eased from when the stage first saw it and out to its end. Without
    // a state and a header the haze stays as it was drawn.
    const storm = events?.sandstorm ?? null;
    this.sand.blow(storm && now < storm.until ? storm.dir : 0, now);
    if (events) this.hazeUniforms.uHazeAmount.value = this.haze.frame(storm, now, step, realStep);
    this.parts.setDim(this.player.dimAt(now));
    // Both results are the player's and the flash's own, filled in again at their next call: read at once.
    const flashed = this.flash.at(now, real);
    this.flashUniforms.uFlash.value.setHex(flashed.color);
    this.flashUniforms.uFlashAmount.value = flashed.amount;
    this.parts.update(dt, real);

    // The balls, with their tags.
    const drawn: DrawnBall[] = [];
    for (const track of net.tracks.values()) {
      if (!track.sampleAt(t, this.p, this.q)) continue;
      this.drawBall(track);
      drawn.push({ id: track.id, x: this.p[0], z: this.p[2] });
    }
    const shown = new Set(drawn.map((b) => b.id));
    for (const id of [...this.balls.keys()]) if (!shown.has(id)) this.dropBall(id);
    // The trails' and glows' RiseLimits count real seconds, as the parts' do.
    this.trails.frame(now, real);
    this.cues.balls(drawn);
    this.cues.frame(t);

    // Payouts: the coins burst from the drain nearest across, or just above the drain, and so does the show book's
    // burst of light (queued at now, it plays with the next frame's moments).
    for (const pay of this.payouts.splice(0)) {
      let at = { x: pay.x, z: DRAIN_Z };
      let best = Infinity;
      for (const d of this.drains) {
        const off = Math.abs(d.x - pay.x);
        if (off < best) {
          best = off;
          at = { x: d.x, z: Math.max(d.z, 0.3) };
        }
      }
      this.burst.burst(pay.amount, at.x, at.z);
      this.shows.payout(at.x, at.z, pay.amount, now);
    }
    // The sparks (the beam's motes among them), the beam and the coins move on by the table clock's step (at most
    // 0.1 s), where the shows and the flash above go by its `now`.
    this.sparks.update(step);
    this.beam.update(step);
    this.sand.update(step);
    this.burst.update(step);
    for (let i = this.effects.length - 1; i >= 0; i--) if (!this.effects[i].update(dt)) this.effects.splice(i, 1);

    // The neon lights breathe.
    const breathe = Math.sin(this.clock * Math.PI * 2 * 0.3);
    for (const light of this.neonLights) light.intensity = this.look.accents * (1 + 0.25 * breathe);

    // A quake: smooth wobbles easing off over its last half second, as the claw's.
    let shakeX = 0;
    let shakeY = 0;
    if (this.clock < this.shakeUntil) {
      const amp = Math.min(1, (this.shakeUntil - this.clock) * 2);
      const c = this.clock;
      shakeX = amp * (Math.sin(c * 47.3) * 0.5 + Math.sin(c * 29.1 + 1.7) * 0.3);
      shakeY = amp * (Math.sin(c * 41.7 + 0.6) * 0.5 + Math.sin(c * 23.3 + 2.9) * 0.3);
    }
    this.shake(shakeX * QUAKE_PIXELS, -shakeY * QUAKE_PIXELS);
    this.city?.update(dt, shakeX * QUAKE_SHAKE, shakeY * QUAKE_SHAKE);
    if (this.backdropComposer && this.backdrop) {
      this.backdropComposer.render(dt);
      this.backdrop.map = this.backdropComposer.readBuffer.texture;
    }
    this.composer.render(dt);
    this.labelRenderer.render(this.scene, this.camera);
  }

  /** A "+N name" popup over the lower table, rising up it and fading (the stage's .pop style). */
  popScore(text: string, color: number, x: number, fx?: string): void {
    const el = document.createElement('div');
    el.className = 'pop';
    el.style.setProperty('--c', cssColor(color));
    const inner = document.createElement('span');
    inner.textContent = text;
    if (fx) inner.className = nameFxClass(fx);
    el.append(inner);
    const obj = new CSS2DObject(el);
    const z0 = 2 + (this.popCount++ % 4) * 0.7;
    obj.position.set(Math.max(-3.5, Math.min(3, x)), 1, z0);
    this.table.add(obj);
    let age = 0;
    this.effects.push({
      update: (dt) => {
        age += dt;
        obj.position.z = z0 + age * 1.4;
        if (age < 1.8) return true;
        this.table.remove(obj);
        el.remove();
        return false;
      },
    });
  }

  paintSigns(): void {
    this.city?.fontsLoaded();
  }

  setBackdrop(url: string | null): void {
    this.city?.setBackdrop(url);
  }

  celebrate(shells: number): void {
    this.city?.celebrate(shells);
  }

  setLeader(name: string | null, coins: number): void {
    this.city?.setLeader(name, coins);
  }

  /** Viewers' pictures go on coins; balls carry names, not pictures. */
  setAvatar(_owner: number, _url: string): void {}

  /**
   * A fresh hello: the table is drawn from the new connection's snapshots and bodies only. The new server's clock may
   * have started again from 0, so the flash forgets the old clock: the show book lets go of its moments and clears the
   * player and the flash (its sinks' clear), the table's clock takes the next drawn time as its first, the sparks and
   * the sand go out, and the beam shows the tomb as it is at the next header, as the toys are shown. The haze eases
   * toward the new connection's storm.
   */
  reset(): void {
    this.samples.length = 0;
    this.cues.reset();
    this.parts.reset();
    this.shows.reset();
    this.tableClock.reset();
    this.sparks.clear();
    this.trails.clear();
    this.beam.reset();
    // The haze isn't reset: it eases from what the picture shows toward what the new connection says.
    this.sand.clear();
    for (const id of [...this.balls.keys()]) this.dropBall(id);
    this.drains.length = 0;
    this.payouts.length = 0;
  }

  forget(_tracks: Track[]): void {}

  impact(_kind: string, _p: Vec3): void {}

  /** The table shaking (a quake from the city): the view shakes for `seconds`, as the claw's. */
  quake(seconds: number): void {
    this.shakeUntil = Math.max(this.shakeUntil, this.clock + seconds);
  }

  turbo(_seconds: number): void {}

  donation(_p: Vec3, _tier: number, _windup: number): void {}

  /** A blast: fireworks over the city. */
  explosion(_p: Vec3): void {
    this.city?.celebrate(4);
  }
}
