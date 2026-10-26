// Test harness: ephemeral server, WebSocket TestClient and a seeded "human brain" that plays legal actions.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import {
  BOARD,
  CARDS,
  POW_HEADER,
  PowChallengeSchema,
  encodePowPayload,
  solvePow,
  groupTiles,
  JAIL_INDEX,
  applyAction,
  buildBlocker,
  groupHasBuildings,
  legalActions,
  mortgageBlocker,
  playerProperties,
  sellBlocker,
  unmortgageBlocker,
  whoMustAct,
} from "@poly/engine";
import type {
  BotLevel,
  ClientMessage,
  GameAction,
  GameSettings,
  GameState,
  JoinResponse,
  LobbyInfo,
  PlayerId,
  PublicGameState,
  ServerMessage,
} from "@poly/engine";
import { startServer } from "../src/server.ts";
import type { RunningServer, ServerOptions } from "../src/server.ts";

// ------------------------------------------------------------------ server

/**
 * The header a client must send to create a game: asks for a challenge and solves it (test difficulty, a few ms).
 * Game creation is never bypassed in tests either (docs/DESIGN.md #70), only made cheap.
 */
export async function solvedPowHeaders(base: string): Promise<Record<string, string>> {
  const r = await fetch(`${base}/api/pow/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "create-game" }),
  });
  const body = (await r.json()) as { challenge?: unknown };
  const challenge = PowChallengeSchema.parse(body.challenge);
  const solution = await solvePow(challenge);
  return { [POW_HEADER]: encodePowPayload({ challenge, solution }) };
}

export interface ApiResult<T> {
  status: number;
  json: T;
}

export interface TestServer {
  srv: RunningServer;
  dir: string;
  port: number;
  base: string;
  wsUrl: string;
  api<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<ApiResult<T>>;
  /** close the server (keeps the data dir) */
  stop(): Promise<void>;
  /** close and delete the data dir */
  dispose(): Promise<void>;
  /** stop and start a new server on the same data dir */
  restart(opts?: ServerOptions): Promise<void>;
}

export async function startTestServer(
  opts: ServerOptions = {},
  existingDir?: string,
): Promise<TestServer> {
  const dir = existingDir ?? mkdtempSync(join(tmpdir(), "poly-h-"));
  const options: ServerOptions = {
    port: 0,
    dataDir: dir,
    botDelayMs: 0,
    host: "127.0.0.1",
    wsRate: { burst: 100_000, perSec: 100_000 },
    allowLowSettings: true,
    ...opts,
    // the AutoPlayer fence is a chat message: tests that do not test chat limits must not run into them
    limits: {
      chatBurst: 1_000_000,
      chatPerHour: 1_000_000_000,
      powBurst: 1_000_000,
      powPerHour: 1_000_000_000,
      ...opts.limits,
    },
    // cheap proof of work (never absent): a counter below 16 is solved in microseconds
    pow: { difficulty: 16, ...opts.pow },
  };
  const ts: TestServer = {
    srv: await startServer(options),
    dir,
    port: 0,
    base: "",
    wsUrl: "",
    async api<T>(
      method: string,
      path: string,
      body?: unknown,
      token?: string,
    ): Promise<ApiResult<T>> {
      const r = await fetch(ts.base + path, {
        method,
        headers: {
          "content-type": "application/json",
          ...(token ? { "x-player-token": token } : {}),
          ...(method === "POST" && path === "/api/games" ? await solvedPowHeaders(ts.base) : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: r.status, json: (await r.json()) as T };
    },
    async stop() {
      await ts.srv.close();
    },
    async dispose() {
      await ts.srv.close();
      rmSync(dir, { recursive: true, force: true });
    },
    async restart(o: ServerOptions = {}) {
      await ts.srv.close();
      ts.srv = await startServer({ ...options, ...o });
      bind();
    },
  };
  const bind = () => {
    ts.port = ts.srv.port;
    ts.base = `http://127.0.0.1:${ts.port}`;
    ts.wsUrl = `ws://127.0.0.1:${ts.port}/ws`;
  };
  bind();
  return ts;
}

export interface Seat {
  gameId: string;
  playerId: PlayerId;
  token: string;
  inviteCode: string;
}

export async function createGame(
  ts: TestServer,
  o: {
    host?: string;
    bots?: BotLevel[];
    maxPlayers?: number;
    settings?: Partial<GameSettings>;
  } = {},
): Promise<Seat> {
  const r = await ts.api<JoinResponse>("POST", "/api/games", {
    hostName: o.host ?? "Host",
    settings: { turnTimeoutSec: 0, ...(o.settings ?? {}) },
    bots: o.bots ?? [],
    maxPlayers: o.maxPlayers ?? (o.bots?.length ?? 0) + 2,
  });
  if (r.status !== 201) {
    throw new Error(`create failed ${r.status} ${JSON.stringify(r.json)}`);
  }
  return {
    gameId: r.json.gameId,
    playerId: r.json.playerId,
    token: r.json.playerToken,
    inviteCode: r.json.inviteCode,
  };
}

export async function joinGame(ts: TestServer, host: Seat, name: string): Promise<Seat> {
  const r = await ts.api<JoinResponse>("POST", `/api/games/${host.gameId}/join`, {
    name,
    inviteCode: host.inviteCode,
  });
  if (r.status !== 201) {
    throw new Error(`join failed ${r.status} ${JSON.stringify(r.json)}`);
  }
  return {
    gameId: r.json.gameId,
    playerId: r.json.playerId,
    token: r.json.playerToken,
    inviteCode: r.json.inviteCode,
  };
}

export async function startGame(ts: TestServer, host: Seat): Promise<LobbyInfo> {
  const r = await ts.api<LobbyInfo>("POST", `/api/games/${host.gameId}/start`, {}, host.token);
  if (r.status !== 200) {
    throw new Error(`start failed ${r.status} ${JSON.stringify(r.json)}`);
  }
  return r.json;
}

// ------------------------------------------------------------------ client

interface Waiter {
  pred: (m: ServerMessage) => boolean;
  from: number;
  resolve: (m: ServerMessage) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class TestClient {
  readonly ws: WebSocket;
  readonly msgs: ServerMessage[] = [];
  state: PublicGameState | null = null;
  you: PlayerId | null | undefined = undefined;
  lobby: LobbyInfo | null = null;
  connected: PlayerId[] = [];
  closeCode: number | null = null;
  closeReason: string | null = null;
  private waiters: Waiter[] = [];
  private listeners: ((m: ServerMessage) => void)[] = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (d: WebSocket.RawData) =>
      this.receive(JSON.parse(d.toString()) as ServerMessage),
    );
    ws.on("close", (code: number, reason: Buffer) => {
      this.closeCode = code;
      this.closeReason = reason.toString();
    });
    ws.on("error", () => undefined);
  }

  static async open(url: string): Promise<TestClient> {
    const c = new TestClient(new WebSocket(url));
    await new Promise<void>((ok, fail) => {
      c.ws.once("open", () => ok());
      c.ws.once("error", fail);
    });
    return c;
  }

  /** open + hello (does not wait for the welcome) */
  static async connect(ts: TestServer, gameId: string, token: string | null): Promise<TestClient> {
    const c = await TestClient.open(ts.wsUrl);
    c.send({ t: "hello", gameId, playerToken: token });
    return c;
  }

  /** open + hello + wait for welcome */
  static async join(
    ts: TestServer,
    seat: Pick<Seat, "gameId" | "token"> | { gameId: string; token: null },
  ): Promise<TestClient> {
    const c = await TestClient.connect(ts, seat.gameId, seat.token);
    await c.until((m) => m.t === "welcome");
    return c;
  }

  private receive(m: ServerMessage): void {
    this.msgs.push(m);
    switch (m.t) {
      case "welcome":
        this.you = m.you;
        this.lobby = m.lobby;
        this.state = m.state;
        break;
      case "lobby":
        this.lobby = m.lobby;
        break;
      case "update":
        this.state = m.state;
        break;
      case "presence":
        this.connected = m.connected;
        break;
      default:
        break;
    }
    for (const l of [...this.listeners]) {
      l(m);
    }
    for (const w of [...this.waiters]) {
      if (w.pred(m)) {
        this.waiters = this.waiters.filter((x) => x !== w);
        clearTimeout(w.timer);
        w.resolve(m);
      }
    }
  }

  onMessage(fn: (m: ServerMessage) => void): void {
    this.listeners.push(fn);
  }

  mark(): number {
    return this.msgs.length;
  }

  /** Resolves with the first message (from `from` on, default: whole history) matching pred. */
  until(pred: (m: ServerMessage) => boolean, timeoutMs = 5000, from = 0): Promise<ServerMessage> {
    for (let i = from; i < this.msgs.length; i++) {
      const m = this.msgs[i]!;
      if (pred(m)) {
        return Promise.resolve(m);
      }
    }
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(
          new Error(
            `TestClient.until timed out after ${timeoutMs}ms (${this.msgs.length} msgs, last: ${this.msgs.at(-1)?.t})`,
          ),
        );
      }, timeoutMs);
      this.waiters.push({ pred, from, resolve, reject, timer });
    });
  }

  /** Waits (from now on) for a state satisfying pred; resolves immediately if the current state does. */
  async untilState(
    pred: (s: PublicGameState) => boolean,
    timeoutMs = 5000,
  ): Promise<PublicGameState> {
    if (this.state && pred(this.state)) {
      return this.state;
    }
    const m = await this.until(
      (x) => (x.t === "update" || x.t === "welcome") && x.state !== null && pred(x.state),
      timeoutMs,
      this.msgs.length,
    );
    return (m.t === "update" || m.t === "welcome") && m.state
      ? m.state
      : Promise.reject(new Error("unreachable"));
  }

  errors(from = 0): string[] {
    return this.msgs.slice(from).flatMap((m) => (m.t === "error" ? [m.message] : []));
  }

  updates(): Extract<ServerMessage, { t: "update" }>[] {
    return this.msgs.flatMap((m) => (m.t === "update" ? [m] : []));
  }

  send(m: ClientMessage): void {
    this.ws.send(JSON.stringify(m));
  }

  sendRaw(data: string): void {
    this.ws.send(data);
  }

  act(action: GameAction): void {
    this.send({ t: "action", action });
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) {
      return;
    }
    await new Promise<void>((ok) => {
      this.ws.once("close", () => ok());
      this.ws.close();
    });
  }

  async untilClosed(timeoutMs = 3000): Promise<number | null> {
    const end = Date.now() + timeoutMs;
    while (this.ws.readyState !== WebSocket.CLOSED) {
      if (Date.now() > end) {
        throw new Error("socket did not close");
      }
      await sleep(10);
    }
    return this.closeCode;
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ brain

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rebuild an engine GameState from the redacted public state (rng/decks are dummies; fine for dry-running non-random actions). */
export function toFull(pub: PublicGameState): GameState {
  return { ...structuredClone(pub), rng: 1, decks: { chance: [], community: [] } };
}

function dryRunOk(state: GameState, me: PlayerId, a: GameAction): boolean {
  try {
    applyAction(state, me, a, Date.now());
    return true;
  } catch {
    return false;
  }
}

export interface BrainOptions {
  /** probability to attempt an optional extra (build, mortgage, trade ...) when allowed */
  extraRate?: number;
  /** stop acting once the state version reaches this */
  maxVersion?: number;
  /** let the brain withdraw its own open trades (racy against the target's answer, so off by default) */
  allowCancel?: boolean;
  /** AutoPlayer idles while this returns true */
  stopWhen?: (s: PublicGameState) => boolean;
}

/** Picks a legal action for `me` from a public state, or null when it is not required/possible to act. */
export class Brain {
  private rnd: () => number;
  readonly me: PlayerId;
  private extraRate: number;
  private allowCancel: boolean;
  readonly stats: Record<string, number> = {};
  constructor(me: PlayerId, seed: number, opts: BrainOptions = {}) {
    this.me = me;
    this.rnd = mulberry(seed);
    this.extraRate = opts.extraRate ?? 0.35;
    this.allowCancel = opts.allowCancel ?? false;
  }

  private pick<T>(xs: T[]): T | null {
    return xs.length ? xs[Math.floor(this.rnd() * xs.length)]! : null;
  }

  decide(pub: PublicGameState): GameAction | null {
    if (pub.status !== "running") {
      return null;
    }
    const st = toFull(pub);
    const me = this.me;
    const legal = new Set(legalActions(st, me));
    const must = whoMustAct(st).includes(me);
    const mine = playerProperties(st, me);

    const pendingForMe = st.trades.filter((t) => t.status === "pending" && t.to === me);
    const respond = (): GameAction | null => {
      const t = this.pick(pendingForMe);
      return t ? { type: "respond-trade", tradeId: t.id, accept: this.rnd() < 0.5 } : null;
    };
    const outgoing = st.trades.filter((t) => t.status === "pending" && t.from === me);
    const extra = (): GameAction | null => {
      if (this.rnd() >= this.extraRate) {
        return null;
      }
      const cands: GameAction[] = [];
      for (const t of mine) {
        if (legal.has("build") && buildBlocker(st, me, t) === null) {
          cands.push({ type: "build", tile: t });
        }
        if (legal.has("mortgage") && mortgageBlocker(st, me, t) === null && this.rnd() < 0.3) {
          cands.push({ type: "mortgage", tile: t });
        }
        if (legal.has("unmortgage") && unmortgageBlocker(st, me, t) === null) {
          cands.push({ type: "unmortgage", tile: t });
        }
        if (legal.has("sell-building") && sellBlocker(st, me, t) === null && this.rnd() < 0.3) {
          cands.push({ type: "sell-building", tile: t });
        }
      }
      const trade = this.proposeTrade(st, mine);
      if (trade && legal.has("propose-trade") && this.rnd() < 0.5) {
        cands.push(trade);
      }
      const stale = outgoing[0];
      if (stale && this.allowCancel && this.rnd() < 0.3) {
        cands.push({ type: "cancel-trade", tradeId: stale.id });
      }
      if (outgoing.length > 0) {
        // wait for the answer before touching cash/tiles (avoids self-inflicted stale actions)
        return this.pick(cands.filter((c) => c.type === "cancel-trade"));
      }
      return this.pick(cands.filter((c) => dryRunOk(st, me, c)));
    };

    if (pendingForMe.length > 0 && legal.has("respond-trade")) {
      return respond();
    }
    if (outgoing.length > 0 && !this.allowCancel) {
      // wait for the answer: the target's reply changes cash/tiles and would make any action of ours racy
      return null;
    }
    if (!must) {
      return null;
    }
    const ph = st.phase;
    switch (ph.type) {
      case "await-roll":
      case "await-end-turn": {
        const x = extra();
        if (x) {
          return x;
        }
        if (
          ph.type === "await-roll" &&
          st.players.find((p) => p.id === me)?.inJail &&
          legal.has("pay-jail-fine") &&
          this.rnd() < 0.3
        ) {
          return { type: "pay-jail-fine" };
        }
        return legal.has("roll") ? { type: "roll" } : { type: "end-turn" };
      }
      case "await-buy":
        if (legal.has("buy") && this.rnd() < 0.7) {
          return { type: "buy" };
        }
        return { type: "decline-buy" };
      case "auction": {
        const me2 = st.players.find((p) => p.id === me)!;
        if (legal.has("bid") && this.rnd() < 0.5) {
          const room = me2.cash - ph.auction.highestBid;
          const amount =
            ph.auction.highestBid +
            1 +
            Math.floor(this.rnd() * Math.min(60, Math.max(1, room - 1)));
          const a: GameAction = { type: "bid", amount: Math.min(amount, me2.cash) };
          if (dryRunOk(st, me, a)) {
            return a;
          }
        }
        if (legal.has("pass-auction")) {
          return { type: "pass-auction" };
        }
        return legal.has("bid") ? { type: "bid", amount: ph.auction.highestBid + 1 } : null;
      }
      case "debt": {
        for (const t of mine) {
          if (legal.has("sell-building") && sellBlocker(st, me, t) === null) {
            return { type: "sell-building", tile: t };
          }
        }
        for (const t of mine) {
          if (legal.has("mortgage") && mortgageBlocker(st, me, t) === null) {
            return { type: "mortgage", tile: t };
          }
        }
        return { type: "declare-bankruptcy" };
      }
      case "game-over":
        return null;
      default: {
        const exhaustive: never = ph;
        return exhaustive;
      }
    }
  }

  private proposeTrade(st: GameState, mine: number[]): GameAction | null {
    const others = st.players.filter((p) => p.id !== this.me && !p.bankrupt);
    const target = this.pick(others);
    if (!target) {
      return null;
    }
    const tradable = (owner: PlayerId) =>
      playerProperties(st, owner).filter((t) => {
        const g = BOARD[t]!.group;
        return (
          (st.properties[t]?.level ?? 0) === 0 && (g === undefined || !groupHasBuildings(st, g))
        );
      });
    const give = this.pick(tradable(this.me).filter((t) => mine.includes(t)));
    const want = this.pick(tradable(target.id));
    const me = st.players.find((p) => p.id === this.me)!;
    return {
      type: "propose-trade",
      offer: {
        to: target.id,
        giveCash: Math.min(me.cash, Math.floor(this.rnd() * 150)),
        giveTiles: give !== null && this.rnd() < 0.5 ? [give] : [],
        giveJailCards: 0,
        wantCash: Math.min(target.cash, Math.floor(this.rnd() * 150)),
        wantTiles: want !== null && this.rnd() < 0.5 ? [want] : [],
        wantJailCards: 0,
      },
    };
  }
}

/**
 * Plays for a client: whenever a new state arrives and the brain wants to act, it sends one action.
 * The loop stops once `maxVersion` is reached or the game is finished.
 */
export class AutoPlayer {
  readonly brain: Brain;
  readonly client: TestClient;
  readonly sent: GameAction[] = [];
  private maxVersion: number;
  private stopWhen: ((s: PublicGameState) => boolean) | undefined;
  private fence: boolean = false;
  paused = false;

  /**
   * After every action a quick-chat "fence" message is sent (its content cannot trip the chat filters): the room
   * processes socket messages in order, so once the fence is echoed back the action (and its update) has been handled and the next decision is made on fresh state.
   * This avoids self-inflicted stale/duplicate actions that a real UI avoids by disabling buttons while waiting.
   */
  constructor(client: TestClient, me: PlayerId, seed: number, opts: BrainOptions = {}) {
    this.client = client;
    this.brain = new Brain(me, seed, opts);
    this.maxVersion = opts.maxVersion ?? Number.POSITIVE_INFINITY;
    this.stopWhen = opts.stopWhen;
    client.onMessage((m) => {
      if (m.t === "quick-chat" && this.fence && m.from === me) {
        this.fence = false;
        this.step();
      } else if (!this.fence && (m.t === "update" || m.t === "welcome")) {
        this.step();
      }
    });
    this.step();
  }

  step(): void {
    const s = this.client.state;
    if (
      this.paused ||
      this.fence ||
      !s ||
      s.version >= this.maxVersion ||
      this.stopWhen?.(s) === true
    ) {
      return;
    }
    const a = this.brain.decide(s);
    if (a) {
      this.sent.push(a);
      this.fence = true;
      this.client.act(a);
      this.client.send({ t: "quick-chat", id: "e-smile" });
    }
  }
}

/** Waits until all clients agree on a state version and nothing changes for `quietMs`. */
export async function settle(
  clients: TestClient[],
  quietMs = 300,
  timeoutMs = 8000,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  let lastSig = "";
  let lastChange = Date.now();
  for (;;) {
    const sig = clients.map((c) => `${c.state?.version}:${c.msgs.length}`).join("|");
    if (sig !== lastSig) {
      lastSig = sig;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= quietMs) {
      return;
    }
    if (Date.now() > end) {
      throw new Error("settle timeout");
    }
    await sleep(25);
  }
}

// ------------------------------------------------------------------ scenario helpers

export interface Table {
  host: Seat;
  friend: Seat;
  a: TestClient;
  b: TestClient;
}

/** Host (p1) + friend (p2) + optional bots, both connected; game started and first update received. */
export async function startedTable(
  ts: TestServer,
  o: { bots?: BotLevel[]; settings?: Partial<GameSettings> } = {},
): Promise<Table> {
  const bots = o.bots ?? ["normal"];
  const host = await createGame(ts, {
    host: "Anna",
    bots,
    maxPlayers: bots.length + 2,
    ...(o.settings ? { settings: o.settings } : {}),
  });
  const friend = await joinGame(ts, host, "Ben");
  const a = await TestClient.join(ts, host);
  const b = await TestClient.join(ts, friend);
  await startGame(ts, host);
  await a.untilState(() => true);
  await b.untilState(() => true);
  return { host, friend, a, b };
}

/** The client whose seat has to act first (current player must be human for this to be meaningful). */
export function currentOf(t: Table): TestClient {
  const s = t.a.state!;
  return s.players[s.current]!.id === t.host.playerId ? t.a : t.b;
}

export function otherOf(t: Table, c: TestClient): TestClient {
  return c === t.a ? t.b : t.a;
}

// ------------------------------------------------------------------ invariants

/** Structural invariants every public state must satisfy; returns human readable violations. */
export function invariantViolations(s: PublicGameState): string[] {
  const out: string[] = [];
  const bad = (msg: string) => out.push(`v${s.version}: ${msg}`);
  const ids = new Set(s.players.map((p) => p.id));
  if (ids.size !== s.players.length) {
    bad("duplicate player ids");
  }
  const lim = s.settings.buildingLimits;
  let houses = 0;
  let hotels = 0;
  let skys = 0;
  for (const [k, pr] of Object.entries(s.properties)) {
    const tile = Number(k);
    if (pr.owner !== null && !ids.has(pr.owner)) {
      bad(`tile ${tile} owned by unknown ${pr.owner}`);
    }
    if (pr.owner !== null && s.players.find((p) => p.id === pr.owner)?.bankrupt) {
      bad(`tile ${tile} owned by bankrupt ${pr.owner}`);
    }
    if (pr.level > 0) {
      if (pr.owner === null) {
        bad(`tile ${tile} has buildings but no owner`);
      }
      if (pr.mortgaged) {
        bad(`tile ${tile} mortgaged with buildings`);
      }
      const g = BOARD[tile]!.group;
      if (g !== undefined && groupTiles(g).some((t) => s.properties[t]?.owner !== pr.owner)) {
        bad(`tile ${tile} has buildings but group ${g} is not owned by ${pr.owner}`);
      }
    }
    if (pr.level >= 1 && pr.level <= 4) {
      houses += pr.level;
    } else if (pr.level === 5) {
      hotels++;
    } else if (pr.level === 6) {
      skys++;
    }
  }
  if (
    s.bank.houses !== lim.houses - houses ||
    s.bank.hotels !== lim.hotels - hotels ||
    s.bank.skyscrapers !== lim.skyscrapers - skys
  ) {
    bad(
      `bank stock ${JSON.stringify(s.bank)} does not match board (houses ${houses}, hotels ${hotels}, skyscrapers ${skys}, limits ${JSON.stringify(lim)})`,
    );
  }
  if (s.bank.houses < 0 || s.bank.hotels < 0 || s.bank.skyscrapers < 0) {
    bad("negative bank stock");
  }
  const held = { chance: 0, community: 0 };
  const seen = new Set<string>();
  for (const p of s.players) {
    if (p.cash < 0) {
      bad(`${p.id} has negative cash ${p.cash}`);
    }
    if (p.position < 0 || p.position >= BOARD.length) {
      bad(`${p.id} position ${p.position}`);
    }
    if (p.inJail && p.position !== JAIL_INDEX) {
      bad(`${p.id} in jail at ${p.position}`);
    }
    if (
      p.bankrupt &&
      p.cash !== 0 &&
      s.status === "running" &&
      s.players.filter((x) => !x.bankrupt).length > 1
    ) {
      bad(`bankrupt ${p.id} keeps cash ${p.cash}`);
    }
    for (const c of p.jailCards) {
      if (seen.has(c)) {
        bad(`jail card ${c} held twice`);
      }
      seen.add(c);
      const def = CARDS.find((x) => x.id === c);
      if (def) {
        held[def.deck]++;
      } else {
        bad(`unknown card ${c}`);
      }
    }
  }
  const total = (d: "chance" | "community") => CARDS.filter((c) => c.deck === d).length;
  if (
    s.decks.chance + held.chance !== total("chance") ||
    s.decks.community + held.community !== total("community")
  ) {
    bad(`deck sizes ${JSON.stringify(s.decks)} + held ${JSON.stringify(held)} != totals`);
  }
  if (s.freeParkingPot < 0) {
    bad("negative pot");
  }
  const cur = s.players[s.current];
  if (!cur || (cur.bankrupt && s.status === "running")) {
    bad("current player invalid");
  }
  if (s.status === "running" && whoMustAct(toFull(s)).length === 0) {
    bad("running game with nobody to act");
  }
  if (s.status === "running" && s.settings.turnTimeoutSec === 0 && s.deadline !== null) {
    bad("deadline set although timeouts are off");
  }
  if (s.status === "running" && s.settings.turnTimeoutSec > 0) {
    const actor = whoMustAct(toFull(s))[0];
    const p = s.players.find((x) => x.id === actor);
    if (p && p.controller === "human" && s.deadline === null) {
      bad(`human ${p.id} must act but no deadline`);
    }
    if (p && p.controller !== "human" && s.deadline !== null) {
      bad(`bot-controlled ${p.id} must act but deadline is set`);
    }
  }
  for (const t of s.trades) {
    if (
      t.status === "pending" &&
      (s.players.find((x) => x.id === t.from)?.bankrupt ||
        s.players.find((x) => x.id === t.to)?.bankrupt)
    ) {
      bad(`pending trade ${t.id} with a bankrupt party`);
    }
  }
  if (s.log.length > 200) {
    bad("log not capped");
  }
  return out;
}
