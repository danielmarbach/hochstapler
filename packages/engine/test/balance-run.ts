// Balance measurement for counteroffers (docs/DESIGN.md "counteroffers"): plays many seeded all-bot
// games with counteroffers ON and OFF and prints one JSON record per game. Not part of `npm test`.
//
//   node packages/engine/test/balance-run.ts <table> <on|off> <fromSeed> <toSeed>
//   node packages/engine/test/balance-run.ts report <file>...
//
// Tables: "bots" = easy, normal, hard (seats rotate with the seed); "proxy" = a competent human
// seat (bot logic on a human seat, normal level) against easy, normal, hard bots.
import { readFileSync } from "node:fs";
import { chooseBotAction, chooseBotTradeResponses } from "../src/bot.ts";
import { netWorth } from "../src/helpers.ts";
import type { BotLevel, GameAction, GameState } from "../src/types.ts";
import { runSim } from "./sim.ts";
import type { SimConfig } from "./sim.ts";

type Table = "bots" | "proxy";

interface GameRecord {
  table: Table;
  counters: boolean;
  seed: number;
  finished: boolean;
  rounds: number;
  /** level of the winner (or richest player when the round cap ended the game); "proxy" for the human seat */
  winner: string;
  levels: string[];
  accepted: number;
  countered: number;
  counterAccepted: number;
  maxChain: number;
  fullSets: number;
  firstFullSetRound: number | null;
  bankruptcies: number;
}

const LEVELS: BotLevel[] = ["easy", "normal", "hard"];
const ROUND_CAP = 150;

function rotate<T>(xs: T[], by: number): T[] {
  const n = by % xs.length;
  return [...xs.slice(n), ...xs.slice(0, n)];
}

function config(
  table: Table,
  counters: boolean,
  seed: number,
): { cfg: SimConfig; names: string[] } {
  const base = {
    seed,
    settings: { turnTimeoutSec: 0 },
    humanStyle: "always" as const,
    tradeRate: 0,
    returnRate: 0,
    legalEvery: 0,
    roundCap: ROUND_CAP,
    botCounters: counters,
  };
  if (table === "bots") {
    const names = rotate<string>([...LEVELS], seed);
    return {
      names,
      cfg: {
        ...base,
        seats: ["bot", "bot", "bot"],
        levels: names as BotLevel[],
      },
    };
  }
  // the competent proxy sits at a rotating seat; the other seats hold easy, normal, hard
  const names = rotate<string>(["proxy", "easy", "normal", "hard"], seed);
  const levels = names.map((n): BotLevel => (n === "proxy" ? "normal" : (n as BotLevel)));
  const options = { counters };
  return {
    names,
    cfg: {
      ...base,
      seats: names.map((n) => (n === "proxy" ? "human" : "bot")),
      levels,
      humanAction: (s: GameState, pid: string): GameAction | null => chooseBotAction(s, pid),
      humanTrade: (s: GameState, pid: string): GameAction[] =>
        chooseBotTradeResponses(s, pid, options),
    },
  };
}

function play(table: Table, counters: boolean, seed: number): GameRecord {
  const { cfg, names } = config(table, counters, seed);
  const r = runSim(cfg);
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
  return {
    table,
    counters,
    seed,
    finished: r.finished,
    rounds: r.rounds,
    winner: names[winnerIdx] ?? "none",
    levels: names,
    accepted: r.accepted,
    countered: r.countered,
    counterAccepted: r.counterAccepted,
    maxChain: r.maxChain,
    fullSets: r.fullSetRounds.length,
    firstFullSetRound: r.fullSetRounds[0] ?? null,
    bankruptcies: s.players.filter((p) => p.bankrupt).length,
  };
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n: number, d: number): string => `${((100 * n) / Math.max(d, 1)).toFixed(1)}%`;

function report(files: string[]): void {
  const records = files
    .flatMap((f) => readFileSync(f, "utf8").split("\n"))
    .filter((l) => l.trim() !== "")
    .map((l): GameRecord => JSON.parse(l) as GameRecord);
  for (const table of ["bots", "proxy"] as const) {
    console.log(`\n== table "${table}" ==`);
    for (const counters of [false, true]) {
      const rs = records.filter((r) => r.table === table && r.counters === counters);
      if (rs.length === 0) {
        continue;
      }
      const winners = [...new Set(rs.flatMap((r) => r.levels))].sort();
      const win = winners.map(
        (w) => `${w} ${pct(rs.filter((r) => r.winner === w).length, rs.length)}`,
      );
      const firsts = rs.flatMap((r) => (r.firstFullSetRound === null ? [] : [r.firstFullSetRound]));
      console.log(
        [
          `counters ${counters ? "ON " : "OFF"} n=${rs.length}`,
          `win: ${win.join(", ")}`,
          `rounds ${mean(rs.map((r) => r.rounds)).toFixed(1)}`,
          `capped ${pct(rs.filter((r) => !r.finished).length, rs.length)}`,
          `trades ${mean(rs.map((r) => r.accepted)).toFixed(2)}`,
          `countered ${mean(rs.map((r) => r.countered)).toFixed(2)}`,
          `via counter ${mean(rs.map((r) => r.counterAccepted)).toFixed(2)}`,
          `maxChain ${Math.max(...rs.map((r) => r.maxChain))}`,
          `full sets ${mean(rs.map((r) => r.fullSets)).toFixed(2)}`,
          `first full-set round ${mean(firsts).toFixed(1)}`,
          `bankruptcies ${mean(rs.map((r) => r.bankruptcies)).toFixed(2)}`,
        ].join(" | "),
      );
    }
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "report") {
  report(rest);
} else if ((cmd === "bots" || cmd === "proxy") && rest.length === 3) {
  const [mode, from, to] = rest;
  for (let seed = Number(from); seed < Number(to); seed++) {
    console.log(JSON.stringify(play(cmd, mode === "on", seed)));
  }
} else {
  console.error(
    "usage: balance-run.ts <bots|proxy> <on|off> <fromSeed> <toSeed> | report <file>...",
  );
  process.exitCode = 1;
}
