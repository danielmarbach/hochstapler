// Balance measurement for (decaying) dividends (docs/DESIGN.md #85): plays many seeded all-bot games
// with the securities mode and prints one JSON record per game. Not part of `npm test`.
//
//   node packages/engine/test/dividend-balance-run.ts <off|on> <maxRounds> <fromSeed> <toSeed>
//   node packages/engine/test/dividend-balance-run.ts report <label=file>...
//
// "on" uses the decay curve compiled in (securities.ts; to compare curves temporarily make the three
// DIVIDEND_DECAY_* constants read the environment). maxRounds 0 = play to the bitter end (cap 150
// rounds). 2..6 seats (SEATS=n fixes it), bot levels rotate with the seed, lock 3 rounds.
import { readFileSync } from "node:fs";
import { netWorth } from "../src/helpers.ts";
import { holdingsValue } from "../src/securities.ts";
import type { BotLevel } from "../src/types.ts";
import { runSim } from "./sim.ts";

interface GameRecord {
  seed: number;
  dividends: boolean;
  maxRounds: number;
  finished: boolean;
  rounds: number;
  players: number;
  bankruptcies: number;
  winnerLevel: string;
  levels: string[];
  /** dividends received by everybody, in permille of the total starting cash */
  dividendsPermille: number;
  winnerSecPermille: number;
}

const LEVELS: BotLevel[] = ["easy", "normal", "hard"];
const ROUND_CAP = 150;
const STARTING_CASH = 2000;

function play(dividends: boolean, maxRounds: number, seed: number): GameRecord {
  const n = process.env["SEATS"] ? Number(process.env["SEATS"]) : 2 + (seed % 5);
  const levels = Array.from({ length: n }, (_, i): BotLevel => LEVELS[(seed + i) % 3] ?? "easy");
  const r = runSim({
    seed,
    seats: Array.from({ length: n }, () => "bot" as const),
    levels,
    settings: {
      turnTimeoutSec: 0,
      startingCash: STARTING_CASH,
      securities: true,
      securitiesLockRounds: 3,
      securitiesDividends: dividends,
      maxRounds,
    },
    humanStyle: (process.env["STYLE"] ?? "never") as "never" | "always",
    tradeRate: 0,
    returnRate: 0,
    legalEvery: 0,
    roundCap: ROUND_CAP,
  });
  const s = r.state;
  let winnerIdx: number;
  if (s.phase.type === "game-over" && s.phase.winner !== null) {
    const winnerId = s.phase.winner;
    winnerIdx = s.players.findIndex((p) => p.id === winnerId);
  } else {
    const alive = s.players.filter((p) => !p.bankrupt);
    const richest = alive.reduce((a, b) => (netWorth(s, a.id) >= netWorth(s, b.id) ? a : b));
    winnerIdx = s.players.findIndex((p) => p.id === richest.id);
  }
  const winner = s.players[winnerIdx];
  const worth = winner ? Math.max(1, netWorth(s, winner.id)) : 1;
  return {
    seed,
    dividends,
    maxRounds,
    finished: r.finished,
    rounds: r.rounds,
    players: n,
    bankruptcies: s.players.filter((p) => p.bankrupt).length,
    winnerLevel: levels[winnerIdx] ?? "none",
    levels,
    dividendsPermille: Math.round(
      (1000 * s.players.reduce((sum, p) => sum + (p.dividends ?? 0), 0)) / (n * STARTING_CASH),
    ),
    winnerSecPermille: winner ? Math.round((1000 * holdingsValue(s, winner.id)) / worth) : 0,
  };
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n: number, d: number): string => `${((100 * n) / Math.max(d, 1)).toFixed(1)}%`;

function report(args: string[]): void {
  for (const arg of args) {
    const [label = "", file = ""] = arg.split("=");
    const records = readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l): GameRecord => JSON.parse(l) as GameRecord);
    const win = LEVELS.map((lv) => {
      // win rate relative to the number of seats held by the level (a fair share = 1.0)
      const wins = records.filter((r) => r.winnerLevel === lv).length;
      const expected = records.reduce(
        (sum, r) => sum + r.levels.filter((x) => x === lv).length / r.players,
        0,
      );
      return `${lv} ${(wins / Math.max(expected, 1)).toFixed(2)}`;
    });
    console.log(
      [
        `${label} n=${records.length}`,
        `dividends ${(mean(records.map((r) => r.dividendsPermille)) / 10).toFixed(1)}% of start cash`,
        `rounds ${mean(records.map((r) => r.rounds)).toFixed(1)}`,
        `<=100 ${pct(records.filter((r) => r.finished && r.rounds <= 100).length, records.length)}`,
        `finished ${pct(records.filter((r) => r.finished).length, records.length)}`,
        `bankr/game ${mean(records.map((r) => r.bankruptcies)).toFixed(3)}`,
        `win/seat-share ${win.join(" ")}`,
        `winner sec ${(mean(records.map((r) => r.winnerSecPermille)) / 10).toFixed(1)}%`,
        `winners >50% sec ${pct(records.filter((r) => r.winnerSecPermille > 500).length, records.length)}`,
      ].join(" | "),
    );
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "report") {
  report(rest);
} else if ((cmd === "on" || cmd === "off") && rest.length === 3) {
  const [maxRounds, from, to] = rest.map(Number);
  for (let seed = from ?? 0; seed < (to ?? 0); seed++) {
    console.log(JSON.stringify(play(cmd === "on", maxRounds ?? 0, seed)));
  }
} else {
  console.error(
    "usage: dividend-balance-run.ts <on|off> <maxRounds> <from> <to> | report <label=file>...",
  );
  process.exitCode = 1;
}
