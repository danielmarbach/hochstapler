import { at, need } from "../safe.ts";
import type { Object3D } from "three";
import {
  AmbientLight,
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  Fog,
  Group,
  HemisphereLight,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  Shape,
  Sphere,
  Spherical,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  HalfFloatType,
  MeshBasicMaterial,
  RingGeometry,
  type Texture,
} from "three";
import CameraControls from "camera-controls";
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing";
import {
  BOARD,
  BOARD_SIZE,
  getTheme,
  themeText,
  type BuildingLevel,
  type PlayerState,
  type PublicGameState,
  type Theme,
} from "@poly/engine";
import { BOARD_Y, HALF, LAYOUTS, TILE_H, TILE_TOP, tilePoint } from "./layout.ts";
import { getLang, onLangChange } from "../i18n/lang.ts";
import { tileTexture, titleTexture, deckTexture } from "./labels.ts";
import { instantiate } from "./assets.ts";
import {
  makeHotel,
  makeHouse,
  makeLandmarkFallback,
  makeSkyscraper,
  makeTokenBase,
  makeTokenFallback,
  TOKEN_BASE_HEIGHT,
} from "./models.ts";
import { IS_TOUCH, LITE_RENDER, MAX_PIXEL_RATIO, SHADOW_MAP_SIZE } from "../platform.ts";
import { buildEnvironment, buildSky } from "./environment.ts";
import { buildIsland, decorateIsland, makeIslets, makeWater, WATER_DEPTH } from "./island.ts";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Dice } from "./dice.ts";
import { clearGroup, disposeTree } from "./dispose.ts";
import { RenderScheduler, ACTIVE_FRAME_MS, IDLE_FRAME_MS } from "./schedule.ts";
import { onInvalidate } from "./invalidate.ts";
import {
  fitDistance,
  insetsActive,
  NO_INSETS,
  sameInsets,
  usableSize,
  viewOffsetFor,
  type Insets,
  type Vec3,
} from "./fit.ts";
import {
  clock,
  easeInOut,
  easeOutBack,
  flushTweens,
  onMotionPreference,
  sleep,
  tween,
} from "./tween.ts";

CameraControls.install({
  THREE: {
    Vector2,
    Vector3,
    Vector4,
    Quaternion,
    Matrix4,
    Spherical,
    Box3,
    Sphere,
    Raycaster,
    MathUtils,
  },
});

/** LITE_RENDER (E2E on software WebGL): about 4 frames per second at a quarter of the pixels */
const LITE_FRAME_MS = 250;
const LITE_PIXEL_RATIO = 0.5;
const _goal = new Vector3();

/** render counters for the perf measurements (window.__polyStats); exists in dev builds only, never in production */
interface DevStats {
  renders: number;
  frames: number;
  shadows: number;
  t: number[];
}
function devStats(): DevStats | null {
  if (!import.meta.env.DEV) {
    return null;
  }
  const w = window as unknown as { __polyStats?: DevStats };
  w.__polyStats ??= { renders: 0, frames: 0, shadows: 0, t: [] };
  return w.__polyStats;
}

/** radius (world units) of the circle that must stay visible around the board */
const FIT_RADIUS = 9.4;
/** with HUD insets the board is framed by its real outline: corners of the base plus room for rim and buildings */
const FIT_EXTENT = HALF + 0.45;
const FIT_HEIGHT = 1;
const FIT_POINTS: readonly Vec3[] = [-1, 1].flatMap((sx) =>
  [-1, 1].flatMap((sz) =>
    [0, FIT_HEIGHT].map((y) => ({ x: sx * FIT_EXTENT, y, z: sz * FIT_EXTENT })),
  ),
);
/** distance factor that leaves a small free border around the framed board */
const FIT_MARGIN = 1.04;
/** the corners of the board's top face, used by the e2e hook that checks them against the HUD */
const BOARD_CORNERS: readonly Vec3[] = [-1, 1].flatMap((sx) =>
  [-1, 1].map((sz) => ({ x: sx * HALF, y: TILE_TOP, z: sz * HALF })),
);

interface TileObj {
  group: Group;
  top: Mesh;
  marker: Mesh;
  mortgage: Mesh;
  buildings: Group;
  level: number;
  owner: string | null;
  mortgaged: boolean;
}
/** Same-tile layout: column offset across the tile and row step along its depth (tile is 1 × 2). */
const CROWD_COLUMN_X = 0.25;
const CROWD_ROW_STEP = 0.55;
const CROWD_PAIR_DZ = 0.32;
/** Per-token height offset on a shared tile, avoids z-fighting of the coplanar bases. */
const TOKEN_STACK_LIFT = 0.004;
/** Tokens on a corner (2 × 2) sit on a circle of this radius. */
const CORNER_CIRCLE_RADIUS = 0.55;

interface TokenObj {
  id: string;
  group: Group;
  tile: number;
  color: string;
  inJail: boolean;
  moving: boolean;
}

export class GameScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private controls: CameraControls;
  private composer: EffectComposer;
  /** bloom + ACES + vignette in one pass, and the same without bloom (only one of the two is enabled) */
  private bloomPass: EffectPass;
  private plainPass: EffectPass;
  private sched = new RenderScheduler(
    LITE_RENDER
      ? { activeMs: LITE_FRAME_MS, idleMs: LITE_FRAME_MS }
      : { activeMs: ACTIVE_FRAME_MS, idleMs: IDLE_FRAME_MS },
  );
  private offInvalidate: () => void;
  private offMotion: () => void;
  private lastDraw = performance.now();
  /** last follow-camera goal handed to controls.moveTo (null: follow inactive, re-issue when it resumes) */
  private followGoal: Vector3 | null = null;
  private raycaster = new Raycaster();
  private tiles: TileObj[] = [];
  private tokens = new Map<string, TokenObj>();
  private themeId = "";
  private theme: Theme | null = null;
  private themeGroup = new Group();
  private board = new Group();
  private dice = new Dice();
  private sun: DirectionalLight;
  private hemi: HemisphereLight;
  private followOn = true;
  /** share of the followed token's position the camera pans by (smaller when the board fills the usable area) */
  private followK = 0.8;
  /** pixels at the canvas edges that HUD panels cover (UI review T09) */
  private insets: Insets = NO_INSETS;
  private followObj: Object3D | null = null;
  private focusUntil = 0;
  private userUntil = 0;
  private raf = 0;
  private timer = 0;
  private running = false;
  private last = performance.now();
  private disposed = false;
  private ro: ResizeObserver;
  private downAt = new Vector2();
  private players: PlayerState[] = [];
  private bloomOn = true;
  private diceShown = false;
  private stillAnimating = 0;
  /** canvas text textures of the current theme, re-created when the language changes */
  private titleMat: MeshBasicMaterial | null = null;
  private decks: { mat: MeshStandardMaterial; deck: "chance" | "community"; color: string }[] = [];
  private offLang: () => void;

  private container: HTMLElement;
  private onTileClick: (i: number) => void;

  constructor(container: HTMLElement, onTileClick: (i: number) => void) {
    this.container = container;
    this.onTileClick = onTileClick;
    this.offLang = onLangChange(() => this.refreshTexts());
    this.offInvalidate = onInvalidate((shadows) => this.invalidate(shadows));
    // reduced motion switched on or off during the session: water and camera follow immediately
    this.offMotion = onMotionPreference(() => {
      this.followGoal = null;
      this.invalidate(true);
    });
    const w = container.clientWidth || 800,
      h = container.clientHeight || 600;
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(
      LITE_RENDER ? LITE_PIXEL_RATIO : Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO),
    );
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping; // ACES is applied in the post chain
    this.renderer.shadowMap.enabled = !LITE_RENDER;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    // shadows are re-rendered only when a caster changed (invalidate(true)), not every frame
    this.renderer.shadowMap.autoUpdate = false;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = "gl";

    this.camera = new PerspectiveCamera(38, w / h, 0.5, 700);
    this.camera.position.set(0, 17, 22);

    this.controls = new CameraControls(this.camera, this.renderer.domElement);
    this.controls.smoothTime = 0.12;
    this.controls.draggingSmoothTime = 0.08;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 48;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minPolarAngle = 0.15;
    this.controls.dollySpeed = 0.7;
    this.controls.setBoundary(new Box3(new Vector3(-9, 0, -9), new Vector3(9, 0, 9)));
    void this.controls.setLookAt(0, 17, 22, 0, 0, 0, false); // not animated: resolves immediately
    this.controls.touches.one = CameraControls.ACTION.TOUCH_ROTATE;
    this.controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY_TRUCK;
    this.controls.touches.three = CameraControls.ACTION.TOUCH_TRUCK;
    this.controls.addEventListener("controlstart", () => {
      this.userUntil = performance.now() + 5000;
      this.followGoal = null;
      this.invalidate(false);
    });
    this.controls.addEventListener("controlend", () => {
      this.userUntil = performance.now() + 4000;
      this.followGoal = null;
      this.invalidate(false);
    });

    // lights: golden hour
    this.hemi = new HemisphereLight("#d6ecff", "#f2dcb4", 1.35);
    this.scene.add(this.hemi);
    this.scene.add(new AmbientLight("#fff1e0", 0.15));
    this.sun = new DirectionalLight("#fff0d0", 2.6);
    this.sun.position.set(-14, 18, 12);
    this.sun.castShadow = !LITE_RENDER;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    const sc = this.sun.shadow.camera;
    sc.left = -14;
    sc.right = 14;
    sc.top = 14;
    sc.bottom = -14;
    sc.near = 1;
    sc.far = 60;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun);
    const fill = new DirectionalLight("#bcd4ff", 0.45);
    fill.position.set(14, 8, -10);
    this.scene.add(fill);

    this.scene.add(this.themeGroup);
    this.scene.add(this.board);
    this.scene.add(this.dice.group);
    this.buildBoardBase();

    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: HalfFloatType,
      multisampling: 0,
    });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Bloom, tone mapping and vignette are plain (non-convolution) effects: one fullscreen pass instead of two.
    // SMAA samples neighbouring pixels of the tone-mapped image, so it stays a pass of its own.
    const bloom = () =>
      new BloomEffect({
        intensity: 0.22,
        luminanceThreshold: 1.25,
        luminanceSmoothing: 0.2,
        mipmapBlur: true,
        radius: 0.7,
      });
    const grade = () => [
      new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
      new VignetteEffect({ offset: 0.4, darkness: 0.3 }),
    ];
    this.bloomPass = new EffectPass(this.camera, bloom(), ...grade());
    this.plainPass = new EffectPass(this.camera, ...grade());
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.plainPass);
    this.composer.addPass(
      new EffectPass(
        this.camera,
        new SMAAEffect({ preset: IS_TOUCH ? SMAAPreset.LOW : SMAAPreset.HIGH }),
      ),
    );

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("webglcontextrestored", this.onContextRestored);

    this.setBloom(!IS_TOUCH && !LITE_RENDER);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.startLoop();
  }

  /**
   * Own rAF loop instead of renderer.setAnimationLoop: while nothing changes it sleeps on a timer at the idle (water)
   * rate, so the page is not woken at every display frame (120 Hz on ProMotion); invalidate() wakes it up.
   */
  private readonly loop = (): void => {
    this.raf = 0;
    const busy = this.frame();
    if (!this.running || this.disposed || this.raf) {
      return;
    }
    if (busy) {
      this.wake();
    } else {
      // wake a little early: the next rAF lands on a vsync
      const delay = Math.max(0, this.sched.idleDelay(performance.now()) - 8);
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        this.wake();
      }, delay);
    }
  };

  private wake(): void {
    if (!this.running || this.raf) {
      return;
    }
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.raf = requestAnimationFrame(this.loop);
  }

  private startLoop(): void {
    this.running = true;
    this.wake();
  }

  private stopLoop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.timer);
    this.raf = 0;
    this.timer = 0;
  }

  /** the picture changed: draw a frame soon. `shadows`: a shadow caster moved/changed too (camera moves do not need it). */
  invalidate(shadows = true): void {
    this.sched.invalidate(shadows);
    this.wake();
  }

  private readonly onContextRestored = (): void => {
    this.invalidate(true);
  };

  /** hidden tab: stop rendering altogether and let queued animations finish instantly */
  private readonly onVisibility = (): void => {
    if (this.disposed) {
      return;
    }
    if (document.hidden) {
      this.stopLoop();
      clock.instant = true;
      flushTweens();
    } else {
      clock.instant = false;
      this.last = performance.now();
      this.startLoop();
      this.invalidate(true);
    }
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.downAt.set(e.clientX, e.clientY);
  };
  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.downAt.distanceTo(new Vector2(e.clientX, e.clientY)) < (IS_TOUCH ? 10 : 5)) {
      this.pick(e);
    }
  };

  // ---------- setup ----------
  private buildBoardBase(): void {
    // floating island plinth + animated water (water colours / decor are themed in setTheme)
    const isl = buildIsland(BOARD_Y - 0.3);
    this.board.add(isl.mesh);
    this.islandHalf = isl.half;
    // rounded-bevel base
    const s = new Shape();
    const r = 0.7,
      hw = HALF + 0.35;
    s.moveTo(-hw + r, -hw);
    s.lineTo(hw - r, -hw);
    s.quadraticCurveTo(hw, -hw, hw, -hw + r);
    s.lineTo(hw, hw - r);
    s.quadraticCurveTo(hw, hw, hw - r, hw);
    s.lineTo(-hw + r, hw);
    s.quadraticCurveTo(-hw, hw, -hw, hw - r);
    s.lineTo(-hw, -hw + r);
    s.quadraticCurveTo(-hw, -hw, -hw + r, -hw);
    const base = new Mesh(
      new ExtrudeGeometry(s, {
        depth: 0.36,
        bevelEnabled: true,
        bevelThickness: 0.1,
        bevelSize: 0.1,
        bevelSegments: 4,
        curveSegments: 10,
      }),
      new MeshStandardMaterial({ color: "#8a5f3e", roughness: 0.8, metalness: 0 }),
    );
    base.rotation.x = -Math.PI / 2;
    base.updateMatrixWorld(true);
    base.position.y = BOARD_Y - 0.002 - new Box3().setFromObject(base).max.y;
    base.castShadow = true;
    base.receiveShadow = true;
    this.board.add(base);
    // felt centre
    const felt = new Mesh(
      new PlaneGeometry(12, 12),
      new MeshStandardMaterial({ color: "#d4e6bf", roughness: 1 }),
    );
    felt.rotation.x = -Math.PI / 2;
    felt.position.y = BOARD_Y + 0.004;
    felt.receiveShadow = true;
    this.board.add(felt);
    const rim = new Mesh(
      new RingGeometry(4.6, 4.75, 64),
      new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.35 }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = BOARD_Y + 0.008;
    this.board.add(rim);

    // tiles (textures set in setTheme)
    const side = new MeshStandardMaterial({ color: "#ead7b2", roughness: 0.85 });
    for (let i = 0; i < BOARD_SIZE; i++) {
      const l = at(LAYOUTS, i);
      const g = new Group();
      g.position.set(l.cx, BOARD_Y, l.cz);
      g.rotation.y = l.rotY;
      const topMat = new MeshStandardMaterial({ color: "#ffffff", roughness: 0.55 });
      const top = new Mesh(new RoundedBoxGeometry(l.w - 0.05, TILE_H, l.d - 0.05, 2, 0.04), [
        side,
        side,
        topMat,
        side,
        side,
        side,
      ]);
      top.position.y = TILE_H / 2;
      top.castShadow = true;
      top.receiveShadow = true;
      top.userData.tileIndex = i;
      g.add(top);
      const marker = new Mesh(
        new BoxGeometry(l.w - 0.18, 0.1, 0.1),
        new MeshStandardMaterial({
          color: "#ffffff",
          roughness: 0.4,
          emissive: new Color("#000000"),
        }),
      );
      marker.position.set(0, TILE_H + 0.03, l.d / 2 - 0.1);
      marker.visible = false;
      marker.castShadow = true;
      g.add(marker);
      const mortgage = new Mesh(
        new PlaneGeometry(l.w - 0.06, l.d - 0.06),
        new MeshBasicMaterial({
          color: "#7d7a84",
          transparent: true,
          opacity: 0.62,
          depthWrite: false,
        }),
      );
      mortgage.rotation.x = -Math.PI / 2;
      mortgage.position.y = TILE_H + 0.012;
      mortgage.visible = false;
      g.add(mortgage);
      const buildings = new Group();
      buildings.position.y = TILE_H;
      g.add(buildings);
      this.board.add(g);
      this.tiles.push({
        group: g,
        top,
        marker,
        mortgage,
        buildings,
        level: 0,
        owner: null,
        mortgaged: false,
      });
    }
  }
  private islandHalf = 9.5;
  private water: ReturnType<typeof makeWater> | null = null;
  private decor: Group[] = [];
  private fontsPending = true;
  private demo = false;
  private demoOffset = { x: 0, y: 0 };
  private centre = new Group();

  setTheme(theme: Theme): void {
    if (this.themeId === theme.id) return;
    this.themeId = theme.id;
    this.theme = theme;
    // dispose old theme objects
    clearGroup(this.themeGroup);
    clearGroup(this.centre);
    this.board.remove(this.centre);

    const env = buildEnvironment(theme.environment);
    const waterY = BOARD_Y - 0.3 - WATER_DEPTH;
    env.group.position.y = waterY + 1.2;
    this.themeGroup.add(env.group);
    this.themeGroup.add(buildSky(env.skyTop, env.skyBottom));
    this.water = makeWater(env.water, this.islandHalf, waterY);
    this.themeGroup.add(this.water.mesh);
    this.themeGroup.add(makeIslets(theme.environment, waterY));
    this.themeGroup.add(decorateIsland(BOARD_Y - 0.3, theme.environment));
    this.scene.fog = new Fog(new Color(env.fog), 80, 260);
    if (this.fontsPending) {
      this.fontsPending = false;
      void Promise.all([
        document.fonts.load("700 30px Alegreya"),
        document.fonts.load("800 30px Alegreya"),
        document.fonts.load("600 28px Inter"),
      ])
        .then(() => {
          if (this.disposed || !this.theme) return;
          const th = this.theme;
          this.themeId = "";
          this.setTheme(th);
        })
        .catch(() => {});
    }

    this.applyTileTextures(theme);

    // centre: title + landmark + decks
    this.titleMat = new MeshBasicMaterial({
      map: titleTexture(theme),
      transparent: true,
      depthWrite: false,
    });
    const title = new Mesh(new PlaneGeometry(6.8, 3.4), this.titleMat);
    title.rotation.x = -Math.PI / 2;
    title.position.set(0, BOARD_Y + 0.02, 1.9);
    this.centre.add(title);
    const lm = instantiate(theme.landmark, () => makeLandmarkFallback(theme.landmark), 3.0);
    lm.position.set(0, BOARD_Y, -1.5);
    this.centre.add(lm);
    const deckC: ["chance" | "community", string, number, number, number][] = [
      // flank the landmark so the title (z ≈ 1.9, ±3.4 wide) stays readable
      ["chance", "#e98a4f", -4.0, -1.9, 0.35],
      ["community", "#4f8fc0", 4.0, -1.9, -0.35],
    ];
    const deckNames = themeText(theme, getLang()).deckNames;
    this.decks = [];
    for (const [deck, color, x, z, rot] of deckC) {
      const top = new MeshStandardMaterial({
        map: deckTexture(deckNames[deck], color),
        roughness: 0.6,
      });
      this.decks.push({ mat: top, deck, color });
      const stack = new Mesh(
        new BoxGeometry(2.1, 0.22, 2.1),
        [0, 1, 2, 3, 4, 5].map((k) =>
          k === 2 ? top : new MeshStandardMaterial({ color: "#fff8ea" }),
        ),
      );
      stack.position.set(x, BOARD_Y + 0.11, z + 0.2);
      stack.rotation.y = rot;
      stack.castShadow = true;
      stack.receiveShadow = true;
      this.centre.add(stack);
    }
    this.board.add(this.centre);
    // keep sun colour consistent per environment
    // refresh building models (skyscraper variants may differ per theme)
    for (let i = 0; i < BOARD_SIZE; i++) this.rebuildBuildings(i, at(this.tiles, i).level, false);
    this.invalidate();
  }

  private applyTileTextures(theme: Theme): void {
    for (let i = 0; i < BOARD_SIZE; i++) {
      const tex = tileTexture(at(BOARD, i), theme);
      const mat = at(at(this.tiles, i).top.material as MeshStandardMaterial[], 2);
      (mat.map as Texture | null)?.dispose();
      mat.map = tex;
      mat.needsUpdate = true;
    }
  }

  /** re-creates every canvas text (tile prices, title, deck labels) after a language change; the game keeps running */
  private refreshTexts(): void {
    const theme = this.theme;
    if (this.disposed || !theme) {
      return;
    }
    this.applyTileTextures(theme);
    if (this.titleMat) {
      this.titleMat.map?.dispose();
      this.titleMat.map = titleTexture(theme);
      this.titleMat.needsUpdate = true;
    }
    const deckNames = themeText(theme, getLang()).deckNames;
    for (const d of this.decks) {
      d.mat.map?.dispose();
      d.mat.map = deckTexture(deckNames[d.deck], d.color);
      d.mat.needsUpdate = true;
    }
    this.invalidate(false);
  }

  // ---------- building / ownership ----------
  private buildingObject(tile: number, level: number, slot: number): Object3D {
    const def = at(BOARD, tile);
    if (level === 6) {
      const custom =
        def.group !== undefined ? this.theme?.skyscraperModels?.[def.group] : undefined;
      const o = instantiate([...(custom ? [custom] : []), "skyscraper"], makeSkyscraper, 0.42);
      o.position.set(0, 0, -0.78);
      return o;
    }
    if (level === 5) {
      const o = instantiate("hotel", makeHotel, 0.27);
      o.position.set(0, 0, -0.78);
      return o;
    }
    const o = instantiate("house", makeHouse, 0.21);
    o.position.set((slot - 1.5) * 0.235, 0, -0.78);
    return o;
  }

  private rebuildBuildings(tile: number, level: number, animate: boolean): void {
    const t = at(this.tiles, tile);
    const prev = t.level;
    clearGroup(t.buildings);
    const fresh: Object3D[] = [];
    if (level >= 1 && level <= 4) {
      for (let i = 0; i < level; i++) {
        const o = this.buildingObject(tile, level, i);
        t.buildings.add(o);
        if (animate && (prev > 4 || i >= prev)) fresh.push(o);
      }
    } else if (level >= 5) {
      const o = this.buildingObject(tile, level, 0);
      t.buildings.add(o);
      if (animate && level !== prev) fresh.push(o);
    }
    t.level = level;
    this.invalidate();
    for (const o of fresh) {
      const s = o.scale.x;
      o.scale.setScalar(0.001);
      void tween(0.5, (k) => o.scale.setScalar(Math.max(0.001, s * k)), easeOutBack);
    }
  }

  async setBuilding(tile: number, level: BuildingLevel, animate = true): Promise<void> {
    const t = this.tiles[tile];
    if (!t || t.level === level) return;
    this.rebuildBuildings(tile, level, animate);
    if (animate) await sleep(0.45);
  }

  setOwner(tile: number, owner: string | null, color?: string): void {
    const t = this.tiles[tile];
    if (!t) return;
    t.owner = owner;
    t.marker.visible = !!owner;
    if (owner && color) {
      const mat = t.marker.material as MeshStandardMaterial;
      mat.color.set(color);
      mat.emissive.set(color).multiplyScalar(0.25);
      t.marker.scale.set(1, 1, 1);
    }
    this.invalidate();
  }

  async popMarker(tile: number): Promise<void> {
    const t = this.tiles[tile];
    if (!t) {
      return;
    }
    await tween(
      0.35,
      (k) =>
        t.marker.scale.set(1, 1 + Math.sin(k * Math.PI) * 1.6, 1 + Math.sin(k * Math.PI) * 0.8),
      easeInOut,
    );
  }

  setMortgaged(tile: number, v: boolean): void {
    const t = this.tiles[tile];
    if (!t) return;
    t.mortgaged = v;
    t.mortgage.visible = v;
    this.invalidate(false); // transparent overlay: no caster
  }

  // ---------- tokens ----------
  private ensureToken(p: PlayerState): TokenObj {
    let t = this.tokens.get(p.id);
    if (t && t.color !== p.color) {
      this.removeToken(t);
      t = undefined;
    }
    if (!t) {
      const group = new Group();
      const tok = instantiate(
        `token-${p.tokenId}`,
        () => makeTokenFallback(p.tokenId, p.color),
        0.62,
      );
      group.add(tok);
      group.add(makeTokenBase(p.color));
      tok.position.y = TOKEN_BASE_HEIGHT;
      this.scene.add(group);
      t = { id: p.id, group, tile: p.position, color: p.color, inJail: p.inJail, moving: false };
      this.tokens.set(p.id, t);
      group.position.copy(this.slot(t, p.position));
      group.scale.setScalar(this.crowdScale(p.position));
    }
    return t;
  }

  private removeToken(t: TokenObj): void {
    this.scene.remove(t.group);
    disposeTree(t.group);
    this.tokens.delete(t.id);
  }

  /** world position of token on tile, offset by occupancy */
  private slot(tok: TokenObj, tile: number): Vector3 {
    const l = at(LAYOUTS, tile);
    const others = [...this.tokens.values()].filter((o) => o.tile === tile && o.group.visible);
    const list = [...new Set([tok, ...others])].sort((a, b) => a.id.localeCompare(b.id));
    const n = list.length,
      k = list.indexOf(tok);
    let lx = 0,
      lz = 0.2;
    if (l.corner) {
      lx = 0;
      lz = 0;
      if (tile === 13) {
        // jail: in-cell vs visiting strip
        if (tok.inJail) {
          lx = 0.45;
          lz = -0.45;
        } else {
          lx = -0.5;
          lz = 0.55;
        }
      }
      if (n > 1) {
        const a = (k / n) * Math.PI * 2;
        lx += Math.cos(a) * CORNER_CIRCLE_RADIUS;
        lz += Math.sin(a) * CORNER_CIRCLE_RADIUS;
      }
    } else if (n === 2) {
      // diagonal: more room than side by side on a 1-wide tile
      lx = (k === 0 ? -1 : 1) * CROWD_COLUMN_X;
      lz = 0.25 + (k === 0 ? -1 : 1) * CROWD_PAIR_DZ;
    } else if (n > 2) {
      // two columns across the tile (1 wide), rows along its depth (2 deep): bases never overlap
      const rows = Math.ceil(n / 2);
      const col = k % 2;
      const row = Math.floor(k / 2);
      const lastAlone = n % 2 === 1 && k === n - 1;
      lx = lastAlone ? 0 : (col === 0 ? -1 : 1) * CROWD_COLUMN_X;
      lz = 0.25 + (row - (rows - 1) / 2) * CROWD_ROW_STEP;
    }
    // lift each token a hair so coplanar bases can never z-fight (flicker) while passing each other
    return tilePoint(tile, lx, lz, TILE_TOP + k * TOKEN_STACK_LIFT);
  }

  /** Tokens shrink when they share a tile so their bases fit side by side. */
  private crowdScale(tile: number): number {
    const n = [...this.tokens.values()].filter((o) => o.tile === tile && o.group.visible).length;
    const l = at(LAYOUTS, tile);
    if (n <= 1) {
      return 1;
    }
    if (l.corner) {
      return n <= 4 ? 0.7 : 0.55;
    }
    if (n === 2) {
      return 0.75;
    }
    return n <= 4 ? 0.5 : 0.45;
  }

  private relayout(tile: number): void {
    const scaleTo = this.crowdScale(tile);
    for (const t of this.tokens.values()) {
      if (t.tile === tile && !t.moving) {
        const to = this.slot(t, tile);
        const from = t.group.position.clone();
        const scaleFrom = t.group.scale.x;
        if (from.distanceTo(to) > 0.01 || Math.abs(scaleFrom - scaleTo) > 0.01) {
          void tween(0.25, (k) => {
            t.group.position.lerpVectors(from, to, k);
            t.group.scale.setScalar(scaleFrom + (scaleTo - scaleFrom) * k);
          });
        }
      }
    }
  }

  async moveToken(
    playerId: string,
    from: number,
    to: number,
    mode: "walk" | "walk-back" | "teleport",
  ): Promise<void> {
    const t = this.tokens.get(playerId);
    if (!t) return;
    this.followObj = t.group;
    const fromTile = t.tile;
    t.moving = true;
    this.stillAnimating++;
    t.tile = to;
    if (mode === "teleport") {
      const a = t.group.position.clone();
      const b2 = this.slot(t, to);
      await tween(
        0.95,
        (k) => {
          t.group.position.lerpVectors(a, b2, k);
          t.group.position.y = TILE_TOP + Math.sin(k * Math.PI) * 3.2;
        },
        easeInOut,
      );
    } else {
      const dir = mode === "walk" ? 1 : -1;
      const steps =
        mode === "walk"
          ? (to - from + BOARD_SIZE) % BOARD_SIZE
          : (from - to + BOARD_SIZE) % BOARD_SIZE;
      const per = Math.min(0.2, 3.0 / Math.max(1, steps));
      let cur = from;
      for (let s = 0; s < steps; s++) {
        const next = (cur + dir + BOARD_SIZE) % BOARD_SIZE;
        const a = t.group.position.clone();
        const last = s === steps - 1;
        const b = last ? this.slot(t, to) : tilePoint(next, 0, 0.1, TILE_TOP);
        await tween(
          per,
          (k) => {
            t.group.position.lerpVectors(a, b, k);
            t.group.position.y = TILE_TOP + Math.sin(k * Math.PI) * 0.42;
            t.group.scale.set(
              1 + Math.sin(k * Math.PI) * -0.06,
              1 + Math.sin(k * Math.PI) * 0.1,
              1 + Math.sin(k * Math.PI) * -0.06,
            );
          },
          "none",
        );
        t.group.scale.set(1, 1, 1);
        cur = next;
      }
    }
    t.moving = false;
    t.group.scale.set(1, 1, 1);
    this.stillAnimating--;
    this.relayout(to);
    this.relayout(fromTile);
  }

  setJail(playerId: string, inJail: boolean): void {
    const t = this.tokens.get(playerId);
    if (!t) return;
    t.inJail = inJail;
    this.relayout(t.tile);
  }

  async rollDice(values: [number, number]): Promise<void> {
    this.diceShown = true;
    this.invalidate();
    await this.dice.roll(values);
  }

  // ---------- state sync ----------
  sync(state: PublicGameState): void {
    this.setTheme(getTheme(state.settings.themeId));
    this.players = state.players;
    const ids = new Set(state.players.map((p) => p.id));
    for (const t of [...this.tokens.values()]) {
      if (!ids.has(t.id)) {
        this.removeToken(t);
      }
    }
    // pass 1: every token knows its tile — pass 2 can then lay out shared tiles with all occupants known
    for (const p of state.players) {
      const t = this.ensureToken(p);
      t.inJail = p.inJail;
      t.group.visible = !p.bankrupt;
      if (!t.moving) {
        t.tile = p.position;
      }
    }
    for (const t of this.tokens.values()) {
      if (!t.moving) {
        const pos = this.slot(t, t.tile);
        if (t.group.position.distanceTo(pos) > 0.02) {
          t.group.position.copy(pos);
        }
        t.group.scale.setScalar(this.crowdScale(t.tile));
      }
    }
    for (let i = 0; i < BOARD_SIZE; i++) {
      const pr = state.properties[i];
      const tile = at(this.tiles, i);
      const owner = pr?.owner ?? null;
      const color = owner ? state.players.find((p) => p.id === owner)?.color : undefined;
      if (owner !== tile.owner || (owner && color)) this.setOwner(i, owner, color);
      this.setMortgaged(i, !!pr?.mortgaged);
      const lv = pr?.level ?? 0;
      if (lv !== tile.level) this.rebuildBuildings(i, lv, false);
    }
    if (state.dice && !this.diceShown) {
      this.dice.show(state.dice);
      this.diceShown = true;
    }
    this.invalidate();
    const cur = state.players[state.current];
    if (cur && !this.stillAnimating) this.followObj = this.tokens.get(cur.id)?.group ?? null;
  }

  /** landing-page mode: slow orbit, island shifted to the side, sprinkled with sample buildings */
  setDemo(offsetX = 0.22, offsetY = 0): void {
    this.demo = true;
    this.followOn = false;
    this.demoOffset = { x: offsetX, y: offsetY };
    this.invalidate(false);
    void this.controls.setLookAt(0, 24, 36, 0, -1, 0, false); // not animated: resolves immediately
    this.fitKey = null;
    this.controls.dollySpeed = 0;
    this.controls.mouseButtons.wheel = CameraControls.ACTION.NONE;
    this.resize();
  }

  demoDecorate(): void {
    const colors = ["#e2704a", "#3e8e8a", "#e8b83c", "#7a6fb5"];
    const streets = BOARD.filter((t) => t.kind === "street" || t.kind === "station").map(
      (t) => t.index,
    );
    let n = 7;
    const r = () => (n = (n * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (const i of streets) {
      if (r() < 0.45) continue;
      this.setOwner(i, "demo", colors[Math.floor(r() * colors.length)]);
      if (at(BOARD, i).kind === "street" && r() < 0.6)
        void this.setBuilding(i, Math.floor(r() * 7) as BuildingLevel, false);
    }
    this.setMortgaged(9, true);
  }

  follow(playerId: string): void {
    this.followObj = this.tokens.get(playerId)?.group ?? null;
    this.followGoal = null;
    this.invalidate(false);
  }
  setFollow(on: boolean): void {
    this.followOn = on;
    this.followGoal = null;
    this.invalidate(false);
  }
  setBloom(on: boolean): void {
    this.bloomOn = on;
    this.bloomPass.enabled = on;
    this.plainPass.enabled = !on;
    this.invalidate(false);
  }
  focusTile(i: number): void {
    const goal = tilePoint(i, 0, 0, TILE_TOP);
    const tgt = this.controls.getTarget(new Vector3());
    const pos = this.controls.getPosition(new Vector3());
    const off = pos.sub(tgt);
    const dist = Math.min(off.length(), 13);
    off.setLength(dist);
    this.focusUntil = performance.now() + 2200;
    this.followGoal = null;
    this.invalidate(false);
    void this.controls.setLookAt(
      goal.x + off.x,
      goal.y + off.y,
      goal.z + off.z,
      goal.x,
      goal.y,
      goal.z,
      !clock.reduced,
    );
  }

  // ---------- picking / loop ----------
  private pick(e: PointerEvent): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.tiles.map((t) => t.top),
      false,
    );
    const idx: unknown = hits[0]?.object.userData.tileIndex;
    if (typeof idx === "number") this.onTileClick(idx);
  }

  private resize(): void {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    const portrait = w / h < 1;
    // wider lens on narrow screens so the whole board stays visible
    this.camera.fov = portrait ? 52 : 38;
    const offsetX = portrait ? 0 : this.demoOffset.x;
    const offsetY = this.demoOffset.y;
    if (this.demo) {
      this.camera.setViewOffset(w, h, w * offsetX, h * offsetY, w, h);
    } else if (insetsActive(this.insets)) {
      const o = viewOffsetFor(this.insets);
      this.camera.setViewOffset(w, h, o.x, o.y, w, h);
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
    // refit on layout changes only (orientation, HUD insets, window size on desktop), never per frame
    const sig = insetsActive(this.insets) && !IS_TOUCH ? `${w}x${h}` : "";
    if (this.fitKey !== portrait || this.fitSig !== sig) {
      this.fitKey = portrait;
      this.fitSig = sig;
      this.fitBoard(portrait);
    }
    // setSize clears the canvas: draw right away (a ResizeObserver callback runs after rAF, before paint) to avoid a blank flash
    this.controls.update(0);
    this.sched.invalidate(true);
    this.draw(performance.now());
  }

  private fitKey: boolean | null = null;
  private fitSig = "";

  /**
   * Tells the scene which strips of the canvas HUD panels cover (player rail, bottom action bar, drawers).
   * The board is re-framed into the free rectangle when they change.
   */
  setInsets(next: Insets): void {
    if (sameInsets(this.insets, next)) {
      return;
    }
    this.insets = next;
    this.fitSig = "\0"; // differs from every signature: resize() refits
    this.resize();
  }

  currentInsets(): Insets {
    return this.insets;
  }

  /** screen positions (CSS px, viewport coordinates) of the four outer corners of the board's top face */
  boardCorners(): { x: number; y: number }[] {
    this.camera.updateMatrixWorld(true);
    const r = this.renderer.domElement.getBoundingClientRect();
    return BOARD_CORNERS.map((c) => {
      const p = new Vector3(c.x, c.y, c.z).project(this.camera);
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    });
  }

  /** auto-fit: distance so the board's bounding circle fits the narrower field of view; portrait looks more top-down */
  private fitBoard(portrait: boolean): void {
    if (!this.demo && insetsActive(this.insets)) {
      this.fitToInsets(portrait ? 0.5 : 0.91);
      return;
    }
    this.followK = portrait ? 0.3 : 0.8;
    const vfov = MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = (portrait ? FIT_RADIUS * 1.12 : FIT_RADIUS) / Math.sin(Math.min(vfov, hfov) / 2);
    const polar = portrait ? 0.5 : this.demo ? 0.98 : 0.91;
    if (this.demo) {
      const d = dist * (portrait ? 1.3 : 1.7);
      this.controls.minDistance = d * 0.75;
      this.controls.maxDistance = d * 1.4;
      void this.controls.dollyTo(d, false);
    } else {
      this.controls.maxDistance = Math.max(48, dist * 1.3);
      void this.controls.dollyTo(Math.min(dist, this.controls.maxDistance), false);
    }
    void this.controls.rotatePolarTo(polar, false);
  }

  /** frames the board's real outline into the rectangle the HUD leaves free */
  private fitToInsets(polar: number): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    void this.controls.moveTo(0, 0, 0, false);
    void this.controls.rotatePolarTo(polar, false);
    this.controls.update(0);
    this.camera.updateMatrixWorld(true);
    const m = this.camera.matrixWorld;
    const axis = (column: number): Vec3 => {
      const v = new Vector3().setFromMatrixColumn(m, column);
      return { x: v.x, y: v.y, z: v.z };
    };
    const focal = h / 2 / Math.tan(MathUtils.degToRad(this.camera.fov) / 2);
    const usable = usableSize(w, h, this.insets);
    const dist =
      fitDistance(FIT_POINTS, { right: axis(0), up: axis(1), toCamera: axis(2) }, focal, usable) *
      FIT_MARGIN;
    this.controls.maxDistance = Math.max(48, dist * 1.3);
    void this.controls.dollyTo(
      MathUtils.clamp(dist, this.controls.minDistance, this.controls.maxDistance),
      false,
    );
    // the free border absorbs the follow camera's pan, so the board stays inside the rectangle
    const slackPx = ((1 - 1 / FIT_MARGIN) / 2) * Math.min(usable.w, usable.h);
    this.followK = MathUtils.clamp((slackPx * dist) / focal / HALF, 0, 0.8);
    this.followGoal = null;
  }

  /** one loop tick; true while the loop must keep running at display rate (something is changing) */
  private frame(): boolean {
    if (this.disposed) return false;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const stats = devStats();
    if (stats) stats.frames++;
    // the landing-page orbit is decoration: it stands still under reduced motion
    if (this.demo && !clock.reduced) this.controls.azimuthAngle += dt * 0.06;

    // camera follow (focusing a tile or user interaction takes precedence). moveTo marks the camera as changed, so it
    // is only called when the goal moved; otherwise a settled camera would keep the scene rendering forever.
    if (now > this.focusUntil && this.followOn && this.followObj && now > this.userUntil) {
      const g = this.followObj.position;
      const k = this.followK; // portrait / reserved HUD areas: stay near the centre so the whole board remains in view
      const gx = g.x * k;
      const gz = g.z * k;
      if (!this.followGoal || this.followGoal.distanceToSquared(_goal.set(gx, 0, gz)) > 1e-6) {
        this.followGoal = (this.followGoal ?? new Vector3()).set(gx, 0, gz);
        void this.controls.moveTo(gx, 0, gz, !clock.reduced);
      }
    } else {
      this.followGoal = null;
    }
    let moving = false;
    if (this.controls.update(dt)) {
      // the landing-page orbit is slow enough for the idle (water) rate; everything else is a real camera move
      moving = !this.demo || now < this.userUntil || now < this.focusUntil;
      if (moving) this.invalidate(false);
    }
    if (this.sched.decide(now) !== "skip") this.draw(now);
    return moving || this.sched.pending;
  }

  private draw(now: number): void {
    const dt = Math.min(0.1, (now - this.lastDraw) / 1000);
    this.lastDraw = now;
    if (this.water)
      need(this.water.uniforms.uTime, "water uTime uniform").value = clock.reduced ? 0 : now / 1000;
    const shadows = this.sched.takeShadowDirty();
    this.renderer.shadowMap.needsUpdate = shadows;
    this.composer.render(dt);
    this.sched.rendered(now);
    const stats = devStats();
    if (stats) {
      stats.renders++;
      if (shadows && this.renderer.shadowMap.enabled) stats.shadows++;
      stats.t.push(now);
      if (stats.t.length > 5000) stats.t.shift();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.offLang();
    this.offInvalidate();
    this.offMotion();
    this.stopLoop();
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("webglcontextrestored", this.onContextRestored);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.controls.dispose();
    // finish pending gsap tweens so nothing keeps animating disposed objects
    clock.instant = false;
    flushTweens();
    this.tokens.clear();
    disposeTree(this.scene);
    this.scene.clear();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
  }
}
