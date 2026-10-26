import { SpanStatusCode, trace } from "@opentelemetry/api";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installInMemoryOtel } from "./otel-harness.ts";
import type { InMemoryOtel } from "./otel-harness.ts";

const otel: InMemoryOtel = installInMemoryOtel();

import { routeTemplate } from "../src/security.ts";
import { spanGameId } from "../src/telemetry.ts";
import {
  AutoPlayer,
  TestClient,
  createGame,
  sleep,
  startGame,
  startTestServer,
} from "./harness.ts";
import type { TestServer } from "./harness.ts";

let ts: TestServer;
beforeAll(async () => {
  ts = await startTestServer();
});
afterAll(async () => {
  await ts.dispose();
  await otel.shutdown();
});

async function waitFor(pred: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error("waitFor timed out");
    await sleep(20);
  }
}

const SECRET_QUERY = "inviteSecret987";
const dump = (): string =>
  JSON.stringify(
    otel.spans().map((s) => [s.name, s.attributes, s.events, s.links, s.resource.attributes]),
  );

describe("route templates", () => {
  it("never contain ids, only placeholders", () => {
    expect(routeTemplate("/api/games")).toBe("/api/games");
    expect(routeTemplate("/api/games/Ab12Cd34")).toBe("/api/games/:id");
    expect(routeTemplate("/api/games/Ab12Cd34/seats/p2")).toBe("/api/games/:id/seats/:seat");
    expect(routeTemplate("/api/games/Ab12Cd34/join")).toBe("/api/games/:id/join");
    expect(routeTemplate("/api/nope/secret")).toBe("unmatched");
    expect(routeTemplate("/assets/index-abc12345.js")).toBe("static");
  });
});

describe("telemetry emission", () => {
  it("emits an action span with game id, action type and seat index, plus DB spans and metrics", async () => {
    const host = await createGame(ts, { host: "Wilhelmine", bots: ["normal"], maxPlayers: 2 });
    const client = await TestClient.connect(ts, host.gameId, host.token);
    await startGame(ts, host);
    // let the host play a few moves, the bot answers by itself
    const player = new AutoPlayer(client, host.playerId, 7, { maxVersion: 14 });
    await client.untilState((s) => s.version >= 14, 8000);
    await sleep(50);
    expect(player.sent.length).toBeGreaterThan(0);

    const actions = otel.spans().filter((s) => s.name === "game.action");
    expect(actions.length).toBeGreaterThan(0);
    const human = actions.find((s) => s.attributes["game.actor"] === "human");
    const bot = actions.find((s) => s.attributes["game.actor"] === "bot");
    for (const s of [human, bot]) {
      expect(s).toBeDefined();
      // L-2: the id is a spectator capability, so only a salted hash leaves the process
      expect(s?.attributes["game.id"]).toBe(spanGameId(host.gameId));
      expect(s?.attributes["game.id"]).not.toBe(host.gameId);
      expect(typeof s?.attributes["game.action.type"]).toBe("string");
      expect(typeof s?.attributes["game.seat.index"]).toBe("number");
    }
    // timers started inside the "start" request must not inherit its trace: every action is its own trace
    // (otherwise one unsampled request would silence a whole game, and one trace would grow forever)
    for (const a of actions) expect(a.parentSpanContext).toBeUndefined();
    // DB writes happen inside the action span
    const save = otel.spans().find((s) => s.name === "db.save");
    expect(save?.attributes["db.system.name"]).toBe("sqlite");
    const parents = new Set(actions.map((a) => a.spanContext().spanId));
    expect(
      otel
        .spans()
        .filter((x) => x.name === "db.save" && x.parentSpanContext)
        .some((x) => parents.has(x.parentSpanContext?.spanId ?? "")),
    ).toBe(true);
    expect(otel.spans().some((s) => s.name === "db.append_action")).toBe(true);

    const m = await otel.metrics();
    const names = [...m.keys()];
    expect(names).toEqual(
      expect.arrayContaining([
        "hochstapler.action.duration",
        "hochstapler.db.write.duration",
        "hochstapler.bot.moves",
        "hochstapler.ws.connections",
        "hochstapler.rooms.loaded",
        "hochstapler.games.running",
      ]),
    );
    const writes = m.get("hochstapler.db.write.duration");
    expect(writes?.dataPoints.length).toBeGreaterThan(0);
    const open = m.get("hochstapler.ws.connections");
    expect(open?.dataPoints[0]?.value).toBe(1);
    await client.close();
    await waitFor(async () => {
      const again = (await otel.metrics()).get("hochstapler.ws.connections");
      return again?.dataPoints[0]?.value === 0;
    });
  });

  it("loading a game from the database is timed", async () => {
    const host = await createGame(ts, { bots: [] });
    ts.srv.hub.sweep(-1); // drop it from memory
    await ts.api("GET", `/api/games/${host.gameId}`);
    expect(otel.spans().some((s) => s.name === "db.load")).toBe(true);
    expect((await otel.metrics()).get("hochstapler.db.load.duration")).toBeDefined();
  });

  it("counts a seat that connects again as a reconnect", async () => {
    const host = await createGame(ts, { bots: [] });
    const first = await TestClient.connect(ts, host.gameId, host.token);
    await first.close();
    const second = await TestClient.connect(ts, host.gameId, host.token);
    await sleep(50);
    await second.close();
    const m = await otel.metrics();
    expect(m.get("hochstapler.ws.reconnects")?.dataPoints[0]?.value).toBe(1);
  });

  it("the retention sweep is a span with counts only and counts expired games by status and trimmed actions", async () => {
    const host = await createGame(ts, { bots: [] });
    const { db } = ts.srv.hub;
    db.touchActivity(host.gameId, Date.now() - 3 * 86_400_000);
    const kept = await createGame(ts, { bots: [] });
    for (let v = 1; v <= 2005; v++) db.logAction(kept.gameId, v, "p1", { type: "note" }, v);
    ts.srv.hub.runRetention();
    const span = otel.spans().findLast((x) => x.name === "retention.sweep");
    expect(span).toBeDefined();
    expect(span?.attributes["retention.games.expired"]).toBe(1);
    expect(span?.attributes["retention.actions.trimmed"]).toBe(5);
    expect(Object.keys(span?.attributes ?? {}).every((k) => k.startsWith("retention."))).toBe(true);
    const m = await otel.metrics();
    const expired = m.get("hochstapler.games.expired")?.dataPoints ?? [];
    expect(expired.map((p) => [p.attributes["game.status"], p.value])).toEqual([["lobby", 1]]);
    expect(m.get("hochstapler.actions.trimmed")?.dataPoints[0]?.value).toBe(5);
  });

  it("counts rejected requests by route template and rejected WebSocket origins", async () => {
    await ts.api("GET", "/api/games/AbCdEfGh/join"); // 405
    await ts.api("GET", "/api/unknown/zzz"); // 404
    const evil = new WebSocket(ts.wsUrl, { headers: { origin: "https://evil.example" } });
    evil.on("error", () => undefined);
    await new Promise((ok) => evil.once("close", ok));
    const m = await otel.metrics();
    expect(m.get("hochstapler.ws.origin_rejected")?.dataPoints[0]?.value).toBe(1);
    const rejected = m.get("hochstapler.http.rejected");
    const points = rejected?.dataPoints.map((p) => p.attributes) ?? [];
    expect(points).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          "http.route": "/api/games/:id/join",
          "http.response.status_code": 405,
        }),
        expect.objectContaining({ "http.route": "unmatched", "http.response.status_code": 404 }),
      ]),
    );
    expect(JSON.stringify(points)).not.toContain("zzz");
  });
});

describe("telemetry redaction", () => {
  it("never exports the player token, query strings, invite codes, names or addresses", async () => {
    const host = await createGame(ts, { host: "Hildegard", bots: ["easy"], maxPlayers: 3 });
    await ts.api("GET", `/api/games/${host.gameId}?secret=${SECRET_QUERY}`, undefined, host.token);
    await fetch(`${ts.base}/api/games/${host.gameId}/start?x=${SECRET_QUERY}`, {
      method: "POST",
      headers: {
        "x-player-token": host.token,
        "content-type": "application/json",
        "user-agent": "agent-007",
      },
      body: "{}",
    });
    await fetch(`${ts.base}/some/static/path?q=${SECRET_QUERY}`);
    const client = await TestClient.connect(ts, host.gameId, host.token);
    await sleep(100);
    await client.close();
    await sleep(50);

    const everything =
      dump() +
      JSON.stringify(otel.logs().map((r) => [r.body, r.attributes, r.resource.attributes])) +
      JSON.stringify(
        [...(await otel.metrics()).values()].map((m) => m.dataPoints.map((p) => p.attributes)),
      );
    expect(everything).toContain("http.route"); // there is something to look at
    for (const forbidden of [
      host.token,
      host.inviteCode,
      host.gameId,
      SECRET_QUERY,
      "Hildegard",
      "agent-007",
      "127.0.0.1",
      "x-player-token",
      "::1",
    ]) {
      expect(everything).not.toContain(forbidden);
    }
    // HTTP spans carry no header attributes at all
    for (const s of otel.spans()) {
      expect(
        Object.keys(s.attributes).filter(
          (k) =>
            k.startsWith("http.request.header") ||
            k.startsWith("http.response.header") ||
            k === "url.query" ||
            k === "url.full" ||
            k === "client.address" ||
            k === "net.peer.ip",
        ),
      ).toEqual([]);
    }
  });
});

const children = (parent: { spanContext(): { spanId: string } }, name: string) =>
  otel
    .spans()
    .filter((x) => x.name === name && x.parentSpanContext?.spanId === parent.spanContext().spanId);

describe("telemetry signals: broadcast, game context, errors, lifecycle, bots", () => {
  it("every action carries round, version and phase; pushes are ws.broadcast children; bots have a bot.decide child", async () => {
    const host = await createGame(ts, { host: "Wilhelmine", bots: ["normal"], maxPlayers: 2 });
    const client = await TestClient.connect(ts, host.gameId, host.token);
    await startGame(ts, host);
    new AutoPlayer(client, host.playerId, 11, { maxVersion: 14 });
    await client.untilState((s) => s.version >= 14, 8000);
    await sleep(50);
    const mine = otel
      .spans()
      .filter(
        (s) => s.name === "game.action" && s.attributes["game.id"] === spanGameId(host.gameId),
      );
    expect(mine.length).toBeGreaterThan(0);
    for (const a of mine) {
      expect(typeof a.attributes["game.round"]).toBe("number");
      expect(typeof a.attributes["game.phase"]).toBe("string");
      expect(typeof a.attributes["game.phase.after"]).toBe("string");
      expect(typeof a.attributes["game.version"]).toBe("number");
    }
    const versions = mine.map((a) => Number(a.attributes["game.version"]));
    expect(Math.max(...versions)).toBeGreaterThanOrEqual(14);

    const withBroadcast = mine.filter((a) => children(a, "ws.broadcast").length > 0);
    expect(withBroadcast.length).toBeGreaterThan(0);
    const b = children(withBroadcast[0]!, "ws.broadcast")[0]!;
    expect(b.attributes["ws.message.type"]).toBe("update");
    expect(b.attributes["ws.recipients"]).toBe(1);
    expect(Number(b.attributes["ws.payload.bytes"])).toBeGreaterThan(100);
    expect(Number(b.attributes["ws.payload.variants"])).toBe(1);

    const botAction = mine.find((a) => a.attributes["game.actor"] === "bot");
    expect(botAction).toBeDefined();
    const decide = children(botAction!, "bot.decide");
    expect(decide).toHaveLength(1);
    expect(["easy", "normal", "hard"]).toContain(decide[0]?.attributes["bot.level"]);
    // the decision happens inside the action span, before the rules are applied
    expect(decide[0]!.startTime[0]).toBeGreaterThanOrEqual(botAction!.startTime[0]);
    // human actions have no decision span
    const human = mine.find((a) => a.attributes["game.actor"] === "human");
    expect(children(human!, "bot.decide")).toHaveLength(0);
    await client.close();
  });

  it("a rejected action is an ERROR span with the engine error code as error.type", async () => {
    const host = await createGame(ts, { bots: ["easy"], maxPlayers: 2 });
    const client = await TestClient.connect(ts, host.gameId, host.token);
    await startGame(ts, host);
    await client.untilState((s) => s.status === "running");
    const before = otel.spans().length;
    client.act({ type: "buy" }); // nothing to buy at the start: always refused
    await client.until((m) => m.t === "error");
    const rejected = otel
      .spans()
      .slice(before)
      .filter(
        (s) => s.name === "game.action" && s.attributes["game.id"] === spanGameId(host.gameId),
      )
      .find((s) => s.status.code === SpanStatusCode.ERROR);
    expect(rejected).toBeDefined();
    const code = rejected?.attributes["error.type"];
    expect(code).toMatch(/^err\.[A-Za-z]+$/);
    expect(rejected?.status.message).toBe(code);
    expect(rejected?.attributes["game.action.type"]).toBe("buy");
    // the German player-facing text never leaves the process
    expect(JSON.stringify([rejected?.attributes, rejected?.status, rejected?.events])).not.toMatch(
      /Du bist|nicht|Nichts/,
    );
    await client.close();
  });

  it("HTTP 4xx/5xx spans carry the status code as error.type (5xx also ERROR status)", async () => {
    await ts.api("GET", "/api/unknown/zzz"); // 404
    await ts.api("GET", "/api/games/AbCdEfGh/join"); // 405
    await ts.api("GET", "/api/themes"); // 200
    await sleep(20);
    const http = otel.spans().filter((s) => s.attributes["http.request.method"] !== undefined);
    const by = (route: string, status: number) =>
      http.find(
        (s) =>
          s.attributes["http.route"] === route &&
          s.attributes["http.response.status_code"] === status,
      );
    expect(by("unmatched", 404)?.attributes["error.type"]).toBe("404");
    expect(by("/api/games/:id/join", 405)?.attributes["error.type"]).toBe("405");
    expect(by("unmatched", 404)?.status.code).toBe(SpanStatusCode.UNSET);
    expect(by("/api/themes", 200)?.attributes["error.type"]).toBeUndefined();
  });

  it("platform health probes (kube-probe user agent) are not traced; normal requests are", async () => {
    const routes = () =>
      otel
        .spans()
        .filter((s) => s.attributes["http.request.method"] !== undefined)
        .map((s) => s.attributes["http.route"]);
    await sleep(20);
    const before = routes().length;
    const probe = await fetch(`${ts.base}/api/themes`, {
      headers: { "user-agent": "kube-probe/1.31" },
    });
    expect(probe.status).toBe(200);
    await fetch(`${ts.base}/api/games/AbCdEfGh`); // a normal request in the same window
    await sleep(20);
    expect(routes().slice(before)).toEqual(["/api/games/:id"]);
  });

  it("game start and end are span events with counts and closed values only", async () => {
    const host = await createGame(ts, {
      host: "Ottilie",
      bots: ["easy", "easy"],
      maxPlayers: 3,
      settings: { securities: true },
    });
    const client = await TestClient.connect(ts, host.gameId, host.token);
    await startGame(ts, host);
    await client.untilState((s) => s.status === "running");
    const started = otel
      .spans()
      .flatMap((s) => s.events)
      .findLast(
        (e) => e.name === "game.started" && e.attributes?.["game.id"] === spanGameId(host.gameId),
      );
    expect(started?.attributes).toMatchObject({
      "game.players": 3,
      "game.bots": 2,
      "game.securities": true,
    });
    expect(typeof started?.attributes?.["game.theme"]).toBe("string");

    client.act({ type: "propose-end-game" });
    await client.untilState((s) => s.status === "finished", 8000);
    await sleep(30);
    const ended = otel
      .spans()
      .filter((s) => s.attributes["game.id"] === spanGameId(host.gameId))
      .flatMap((s) => s.events)
      .find((e) => e.name === "game.ended");
    expect(ended?.attributes).toMatchObject({ "game.end.reason": "vote" });
    expect(typeof ended?.attributes?.["game.rounds"]).toBe("number");
    expect(typeof ended?.attributes?.["game.duration.s"]).toBe("number");
    expect(JSON.stringify(otel.spans().map((s) => s.events))).not.toContain("Ottilie");
    await client.close();
  });

  it("a player who misses turns goes away: event on the timeout action, the bot takes over", async () => {
    const host = await createGame(ts, {
      bots: ["easy"],
      maxPlayers: 2,
      settings: { turnTimeoutSec: 1, awayAfterMissedTurns: 1 },
    });
    const client = await TestClient.connect(ts, host.gameId, host.token);
    await startGame(ts, host);
    await client.untilState((s) => s.players.some((p) => p.controller === "away"), 8000);
    await sleep(30);
    const away = otel
      .spans()
      .filter((s) => s.attributes["game.id"] === spanGameId(host.gameId))
      .flatMap((s) => s.events)
      .find((e) => e.name === "game.player.away");
    expect(away?.attributes).toMatchObject({ "game.bot.took_over": true });
    expect(typeof away?.attributes?.["game.seat.index"]).toBe("number");
    await client.close();
  }, 15_000);
});

describe("telemetry logs", () => {
  const TOKEN_IN_MESSAGE = "tokenInErrorMessage-8d3f";

  it("exports warn/error through the Logs API, correlated with the active span, without error messages", async () => {
    const host = await createGame(ts, { host: "Brunhilde", bots: [] });
    const room = ts.srv.hub.get(host.gameId);
    const db = ts.srv.hub.db;
    const save = vi.spyOn(db, "save").mockImplementation(() => {
      throw new Error(`disk says no for ${TOKEN_IN_MESSAGE} ${host.token} ${host.gameId}`);
    });
    const noisy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let traceId = "";
    let spanId = "";
    trace.getTracer("test").startActiveSpan("test.op", (span) => {
      traceId = span.spanContext().traceId;
      spanId = span.spanContext().spanId;
      room?.persist(true);
      span.end();
    });
    save.mockRestore();
    // the console output stays as it was
    expect(noisy).toHaveBeenCalled();
    noisy.mockRestore();

    const record = otel.logs().findLast((r) => r.severityText === "ERROR");
    expect(record).toBeDefined();
    expect(record?.body).toBe("operation failed");
    expect(record?.spanContext?.traceId).toBe(traceId);
    expect(record?.spanContext?.spanId).toBe(spanId);
    expect(record?.attributes).toMatchObject({ operation: "db:save", "exception.type": "Error" });
    const dumped = JSON.stringify(otel.logs().map((r) => [r.body, r.attributes, r.severityText]));
    for (const forbidden of [
      TOKEN_IN_MESSAGE,
      host.token,
      host.gameId,
      host.inviteCode,
      "Brunhilde",
    ]) {
      expect(dumped).not.toContain(forbidden);
    }
    expect(otel.logs().every((r) => r.resource.attributes !== undefined)).toBe(true);
  });

  it("the retention sweep logs a summary (counts only) inside its span", async () => {
    const before = otel.logs().length;
    ts.srv.hub.runRetention();
    const record = otel
      .logs()
      .slice(before)
      .find((r) => r.body === "retention sweep");
    expect(record?.severityText).toBe("INFO");
    expect(record?.attributes).toMatchObject({
      "retention.games.expired": expect.any(Number),
      "retention.actions.trimmed": expect.any(Number),
    });
    const span = otel.spans().findLast((s) => s.name === "retention.sweep");
    expect(record?.spanContext?.spanId).toBe(span?.spanContext().spanId);
  });

  it("a schema migration logs one info record, a failing one an error record without its message", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { migrateSchema } = await import("../src/migrations/schema.ts");
    const before = otel.logs().length;
    const ok = new DatabaseSync(":memory:");
    migrateSchema(ok, {
      migrations: [{ version: 1, name: "a", up: () => undefined }],
      dbFile: null,
      log: () => undefined,
    });
    ok.close();
    const bad = new DatabaseSync(":memory:");
    expect(() =>
      migrateSchema(bad, {
        migrations: [
          {
            version: 1,
            name: "b",
            up: () => {
              throw new Error(`broken ${TOKEN_IN_MESSAGE}`);
            },
          },
        ],
        dbFile: null,
        log: () => undefined,
      }),
    ).toThrow();
    bad.close();
    const records = otel.logs().slice(before);
    expect(records.map((r) => [r.severityText, r.body])).toEqual([
      ["INFO", "schema migration applied"],
      ["ERROR", "schema migration failed"],
    ]);
    expect(records[0]?.attributes).toMatchObject({ "schema.from": 0, "schema.to": 1 });
    expect(JSON.stringify(records.map((r) => r.attributes))).not.toContain(TOKEN_IN_MESSAGE);
  });

  it("drops attributes that are not on the allow-list (a caller cannot leak by mistake)", async () => {
    const { emitLog } = await import("../src/telemetry.ts");
    const before = otel.logs().length;
    emitLog("warn", "unit", {
      "game.id": "abc",
      "player.name": "Egon",
      token: "t0k",
      operation: "x",
    });
    const r = otel.logs().slice(before)[0];
    expect(r?.severityText).toBe("WARN");
    expect(r?.attributes).toEqual({ "game.id": "abc", operation: "x" });
  });
});
