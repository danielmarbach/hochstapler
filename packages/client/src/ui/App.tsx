import { useCallback, useEffect, useState } from "preact/hooks";
import { useLang } from "../i18n/lang.ts";
import { resetGame, useApp } from "../net/store.ts";
import { connect, disconnect } from "../net/ws.ts";
import { parseRoute } from "../net/route.ts";
import { Home } from "./Home.tsx";
import { Join } from "./Join.tsx";
import { Lobby } from "./Lobby.tsx";
import { GameView } from "./GameView.tsx";
import { Resume, ResumeProblem } from "./Resume.tsx";
import { GameGone } from "./GameGone.tsx";

export function App() {
  // a language switch re-renders the whole tree (texts are read while rendering); the 3D canvas stays mounted
  useLang();
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const h = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  const resumed = useCallback(() => setRoute(parseRoute(location.hash)), []);
  if (route.name === "resume")
    return (
      <Resume gameId={route.gameId} token={route.token} lang={route.lang} onResumed={resumed} />
    );
  if (route.name === "bad-resume") return <ResumeProblem gameId={null} />;
  if (route.name === "join") return <Join gameId={route.gameId} code={route.code} />;
  if (route.name === "game") return <GameRoute gameId={route.gameId} />;
  return <Home />;
}

function GameRoute({ gameId }: { gameId: string }) {
  useEffect(() => {
    resetGame(gameId);
    connect(gameId);
    return () => {
      disconnect();
      resetGame(null);
    };
  }, [gameId]);
  const status = useApp((s) => s.lobby?.status);
  const hasState = useApp((s) => !!s.state);
  const seatRejected = useApp((s) => s.seatRejected);
  const gameGone = useApp((s) => s.gameGone);
  if (gameGone) return <GameGone />;
  if (seatRejected) return <ResumeProblem gameId={gameId} />;
  if (hasState || status === "running" || status === "finished") return <GameView />;
  return <Lobby />;
}
