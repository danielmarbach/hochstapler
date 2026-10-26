import { useEffect, useRef } from "preact/hooks";
import { attemptSync, getTheme } from "@poly/engine";
import { errorOnError } from "../safe.ts";
import { GameScene } from "../three/scene.ts";
import { usePalette } from "./util.tsx";

/** live 3D island behind the landing/lobby pages (slow orbit, themed by the picked country); offsetX shifts the island sideways on wide screens, offsetY downwards (below the poster headline) */
export function Backdrop({
  themeId,
  offsetX = 0.2,
  offsetY = -0.16,
}: {
  themeId: string;
  offsetX?: number;
  offsetY?: number;
}) {
  usePalette(themeId);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<GameScene | null>(null);
  // the scene is created once per mount from the initial props; later theme changes are handled by the effect below
  const initial = useRef({ themeId, offsetX, offsetY });
  useEffect(() => {
    const el = host.current;
    if (!el) {
      return undefined;
    }
    const created = attemptSync("backdrop:scene", () => new GameScene(el, () => {}), errorOnError);
    if (!created.ok) {
      return undefined;
    }
    const s = created.value;
    scene.current = s;
    s.setDemo(initial.current.offsetX, initial.current.offsetY);
    s.setTheme(getTheme(initial.current.themeId));
    s.demoDecorate();
    return () => {
      s.dispose();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    scene.current?.setTheme(getTheme(themeId));
  }, [themeId]);
  return <div class="backdrop" ref={host} />;
}
