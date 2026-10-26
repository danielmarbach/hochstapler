import { useEffect, useRef } from "preact/hooks";
import { attemptSync } from "@poly/engine";
import { errorOnError } from "../safe.ts";
import { GameScene } from "../three/scene.ts";
import { director } from "../game/director.ts";
import { app, set, useApp } from "../net/store.ts";
import { exposeTestHooks } from "../e2e-hooks.ts";
import type { Insets } from "../three/fit.ts";
import { Hud } from "./Hud.tsx";
import { useLayout } from "./util.tsx";

/**
 * The strips of the canvas the HUD covers: rail, banner and action bar are fixed per breakpoint (CSS variables
 * `--inset-*` on `.game`); a docked drawer pushes the left edge further in, a full-width one the bottom edge up.
 */
export function readInsets(game: HTMLElement): Insets {
  const style = getComputedStyle(game);
  const px = (name: string): number => Number.parseFloat(style.getPropertyValue(name)) || 0;
  const { r, t } = { r: px("--inset-r"), t: px("--inset-t") };
  let l = px("--inset-l");
  let b = px("--inset-b");
  const drawer = game.querySelector<HTMLElement>(".drawer");
  if (drawer && (l > 0 || b > 0)) {
    if (drawer.offsetWidth < game.clientWidth * 0.6) {
      l = Math.max(l, drawer.offsetLeft + drawer.offsetWidth + 14);
    } else {
      b = Math.max(b, game.clientHeight - drawer.offsetTop + 8);
    }
  }
  return { l, r, t, b };
}

export function GameView() {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GameScene | null>(null);
  const follow = useApp((s) => s.followCam);
  const bloom = useApp((s) => s.bloom);
  const state = useApp((s) => s.state);
  const drawer = useApp((s) => s.drawerOpen);
  const drawerTab = useApp((s) => s.drawerTab);
  const layout = useLayout();

  // HUD and board share the viewport: re-frame the board when the free rectangle changes (resize, breakpoint,
  // drawer), never per frame (UI review T09)
  useEffect(() => {
    const game = host.current?.parentElement;
    if (!game) {
      return undefined;
    }
    let frame = 0;
    const apply = () => {
      frame = 0;
      sceneRef.current?.setInsets(readInsets(game));
    };
    const schedule = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(apply);
      }
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(game);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [layout, drawer, drawerTab]);

  // The floating action bar grows with its content (debt notice, auction): publish how much room it needs from the
  // bottom edge as `--bar-clear`, so a docked drawer stands above it instead of behind it (see `.drawer` in styles.css)
  useEffect(() => {
    const game = host.current?.parentElement;
    if (!game) {
      return undefined;
    }
    const bar = game.querySelector<HTMLElement>(".actionbar:not(.compact)");
    if (!bar) {
      game.style.removeProperty("--bar-clear");
      return undefined;
    }
    const apply = () => {
      const bottom = Number.parseFloat(getComputedStyle(bar).bottom) || 0;
      game.style.setProperty("--bar-clear", `${Math.ceil(bar.offsetHeight + bottom + 6)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      game.style.removeProperty("--bar-clear");
    };
  }, [layout, state]);

  useEffect(() => {
    const el = host.current;
    if (!el) {
      return undefined;
    }
    const created = attemptSync(
      "gameview:scene",
      () =>
        new GameScene(el, (i) => {
          set({ selectedTile: i });
          sceneRef.current?.focusTile(i);
        }),
      errorOnError,
    );
    if (!created.ok) {
      return undefined;
    }
    const scene = created.value;
    sceneRef.current = scene;
    if (import.meta.env.DEV) (window as unknown as { __gs?: GameScene }).__gs = scene;
    scene.setFollow(app.followCam);
    scene.setBloom(app.bloom);
    director.attach(scene);
    exposeTestHooks({
      boardCorners: () => scene.boardCorners(),
      insets: () => scene.currentInsets(),
    });
    return () => {
      exposeTestHooks(null);
      director.detach();
      scene.dispose();
      sceneRef.current = null;
      if (import.meta.env.DEV) {
        delete (window as unknown as { __gs?: GameScene }).__gs;
      }
    };
  }, []);
  useEffect(() => {
    sceneRef.current?.setFollow(follow);
  }, [follow]);
  useEffect(() => {
    sceneRef.current?.setBloom(bloom);
  }, [bloom]);

  return (
    <div class="game">
      <div class="canvas-host" ref={host} />
      {state && <Hud />}
    </div>
  );
}
