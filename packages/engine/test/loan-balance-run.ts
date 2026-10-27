// Balance measurement for the show-off mode (docs/DESIGN.md #93): plays many seeded all-bot games
// with loans OFF and ON (same seeds) and prints one JSON record per game. Not part of `npm test`.
//
//   node packages/engine/test/loan-balance-run.ts <bots|proxy> <off|on> <fromSeed> <toSeed> [curve]
//   node packages/engine/test/loan-balance-run.ts report <file>...
//
// Tables as in balance-run.ts: "bots" = easy, normal, hard (seats rotate with the seed); "proxy" =
// a competent human seat (bot logic, normal level) against easy, normal, hard bots. `curve` =
// "poorest/average/richest" in percent per round (default: the engine's LOAN_RATE_CURVE); the run
// sets it on the exported curve object before the first game, which is how alternatives were measured.
import { readFileSync } from "node:fs";
import { chooseBotAction, chooseBotTradeResponses } from "../src/bot.ts";
import { netWorth } from "../src/helpers.ts";
import { LOAN_RATE_CURVE, interestDue, loanDebt } from "../src/loans.ts";
import type { BotLevel, GameAction, GameState } from "../src/types.ts";
import { runSim } from "./sim.ts";
import type { SimConfig } from "./sim.ts";

type Table = "bots" | "proxy";

interface GameRecord {
  table: Table;
  loans: boolean;
  curve: string;
  seed: number;
  finished: boolean;
  rounds: number;
  /** seat name of the winner (or the richest player when the round cap ended the game) */
  winner: string;
  levels: string[];
  /** seat names that were last / below the average net worth at mid-game */
  midLast: string;
  midBelowAvg: string[];
  midLeader: string;
  /** total borrowed per seat name */
  borrowed: Record<string, number>;
  /** borrowed while being the net-worth leader at that moment */
  borrowedAsLeader: number;
  /** borrowed by the mid-game leader after mid-game */
  leaderBorrowedLate: number;
  interestPaid: number;
  bankruptcies: number;
  /** bankruptcies declared while the debt was loan interest */
  interestBankruptcies: number;
}

const LEVELS: BotLevel[] = ["easy", "normal", "hard"];
const ROUND_CAP = 150;

function rotate<T>(xs: T[], by: number): T[] {
  const n = by % xs.length;
  return [...xs.slice(n), ...xs.slice(0, n)];
}

function config(table: Table, loans: boolean, seed: number): { cfg: SimConfig; names: string[] } {
  const base = {
    seed,
    settings: { turnTimeoutSec: 0, loans },
    humanStyle: "always" as const,
    tradeRate: 0,
    returnRate: 0,
    legalEvery: 0,
    roundCap: ROUND_CAP,
  };
  if (table === "bots") {
    const names = rotate<string>([...LEVELS], seed);
    return { names, cfg: { ...base, seats: ["bot", "bot", "bot"], levels: names as BotLevel[] } };
  }
  const names = rotate<string>(["proxy", "easy", "normal", "hard"], seed);
  const levels = names.map((n): BotLevel => (n === "proxy" ? "normal" : (n as BotLevel)));
  return {
    names,
    cfg: {
      ...base,
      seats: names.map((n) => (n === "proxy" ? "human" : "bot")),
      levels,
      humanAction: (s: GameState, pid: string): GameAction | null => chooseBotAction(s, pid),
      humanTrade: (s: GameState, pid: string): GameAction[] => chooseBotTradeResponses(s, pid),
    },
  };
}

function leaderOf(s: GameState): string | null {
  const alive = s.players.filter((p) => !p.bankrupt);
  if (alive.length === 0) {
    return null;
  }
  return alive.reduce((a, b) => (netWorth(s, b.id) > netWorth(s, a.id) ? b : a)).id;
}

function play(table: Table, loans: boolean, seed: number): GameRecord {
  const { cfg, names } = config(table, loans, seed);
  const nameOf = (id: string): string => names[Number(id.slice(1))] ?? id;
  const worthByRound = new Map<number, Record<string, number>>();
  const borrowed: Record<string, number> = {};
  const borrowLog: { round: number; id: string; amount: number }[] = [];
  let borrowedAsLeader = 0;
  let interestPaid = 0;
  let interestBankruptcies = 0;
  cfg.onStep = (prev, next) => {
    if (!worthByRound.has(next.round)) {
      worthByRound.set(
        next.round,
        Object.fromEntries(
          next.players.map((p) => [
            p.id,
            p.bankrupt ? Number.NEGATIVE_INFINITY : netWorth(next, p.id),
          ]),
        ),
      );
    }
    for (const p of next.players) {
      const before = prev.players.find((x) => x.id === p.id);
      if (!before) {
        continue;
      }
      const delta = loanDebt(p) - loanDebt(before);
      if (delta > 0) {
        borrowed[nameOf(p.id)] = (borrowed[nameOf(p.id)] ?? 0) + delta;
        borrowLog.push({ round: next.round, id: p.id, amount: delta });
        if (leaderOf(prev) === p.id) {
          borrowedAsLeader += delta;
        }
      }
      if (p.bankrupt && !before.bankrupt) {
        if (prev.phase.type === "debt" && prev.phase.loanInterest === true) {
          interestBankruptcies++;
        }
      }
    }
    // interest: due at a turn start (paid at once, or later when the debt phase is settled)
    const turnStarted = next.current !== prev.current || next.round !== prev.round;
    const starter = next.players[next.current];
    const owedNow = next.phase.type === "debt" && next.phase.loanInterest === true;
    if (turnStarted && starter && !owedNow && next.status === "running") {
      const was = prev.players.find((x) => x.id === starter.id);
      interestPaid += was ? interestDue(was) : 0;
    }
    if (
      prev.phase.type === "debt" &&
      prev.phase.loanInterest === true &&
      next.phase.type !== "debt"
    ) {
      interestPaid += prev.phase.amount;
    }
  };
  const r = runSim(cfg);
  const s = r.state;
  let winnerIdx: number;
  if (s.phase.type === "game-over" && s.phase.winner !== null) {
    const winnerId = s.phase.winner;
    winnerIdx = s.players.findIndex((p) => p.id === winnerId);
  } else {
    const richest = leaderOf(s) ?? "p0";
    winnerIdx = s.players.findIndex((p) => p.id === richest);
  }
  const midRound = Math.max(1, Math.floor(r.rounds / 2));
  const mid = worthByRound.get(midRound) ?? worthByRound.get(1) ?? {};
  const alive = Object.entries(mid).filter(([, w]) => Number.isFinite(w));
  const avg = alive.reduce((a, [, w]) => a + w, 0) / Math.max(1, alive.length);
  const sorted = [...alive].sort((a, b) => a[1] - b[1]);
  const midLastId = sorted[0]?.[0] ?? "";
  const midLeaderId = sorted.at(-1)?.[0] ?? "";
  return {
    table,
    loans,
    curve: `${LOAN_RATE_CURVE.poorest}/${LOAN_RATE_CURVE.average}/${LOAN_RATE_CURVE.richest}`,
    seed,
    finished: r.finished,
    rounds: r.rounds,
    winner: names[winnerIdx] ?? "none",
    levels: names,
    midLast: nameOf(midLastId),
    midBelowAvg: alive.filter(([, w]) => w < avg).map(([id]) => nameOf(id)),
    midLeader: nameOf(midLeaderId),
    borrowed,
    borrowedAsLeader,
    leaderBorrowedLate: borrowLog
      .filter((b) => b.id === midLeaderId && b.round > midRound)
      .reduce((a, b) => a + b.amount, 0),
    interestPaid,
    bankruptcies: s.players.filter((p) => p.bankrupt).length,
    interestBankruptcies,
  };
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]): number => {
  const ys = [...xs].sort((a, b) => a - b);
  const m = Math.floor(ys.length / 2);
  return ys.length === 0 ? 0 : ys.length % 2 ? (ys[m] ?? 0) : ((ys[m - 1] ?? 0) + (ys[m] ?? 0)) / 2;
};
const pct = (n: number, d: number): string => `${((100 * n) / Math.max(d, 1)).toFixed(1)}%`;

function report(files: string[]): void {
  const records = files
    .flatMap((f) => readFileSync(f, "utf8").split("\n"))
    .filter((l) => l.trim() !== "")
    .map((l): GameRecord => JSON.parse(l) as GameRecord);
  const cells = [...new Set(records.map((r) => `${r.table} ${r.loans ? r.curve : "off"}`))].sort();
  for (const cell of cells) {
    const rs = records.filter((r) => `${r.table} ${r.loans ? r.curve : "off"}` === cell);
    const seats = [...new Set(rs.flatMap((r) => r.levels))].sort();
    const win = seats.map((w) => `${w} ${pct(rs.filter((r) => r.winner === w).length, rs.length)}`);
    const anyLoan = rs.filter((r) => Object.values(r.borrowed).some((v) => v > 0));
    const leaderLate = rs.filter((r) => r.leaderBorrowedLate > 0);
    const leaderNoLate = rs.filter((r) => r.leaderBorrowedLate === 0);
    const volume = rs.map((r) => Object.values(r.borrowed).reduce((a, b) => a + b, 0));
    const perSeat = seats.map((w) => `${w} ${mean(rs.map((r) => r.borrowed[w] ?? 0)).toFixed(0)}`);
    console.log(
      [
        `${cell} n=${rs.length}`,
        `win: ${win.join(", ")}`,
        `rounds avg ${mean(rs.map((r) => r.rounds)).toFixed(1)} median ${median(rs.map((r) => r.rounds))}`,
        `capped ${pct(rs.filter((r) => !r.finished).length, rs.length)}`,
        `catch-up: mid-last wins ${pct(rs.filter((r) => r.winner === r.midLast).length, rs.length)}, below-avg wins ${pct(rs.filter((r) => r.midBelowAvg.includes(r.winner)).length, rs.length)}, mid-leader wins ${pct(rs.filter((r) => r.winner === r.midLeader).length, rs.length)}`,
        `games with a loan ${pct(anyLoan.length, rs.length)}`,
        `borrowed/game ${mean(volume).toFixed(0)} (${perSeat.join(", ")})`,
        `as leader ${pct(
          rs.reduce((a, r) => a + r.borrowedAsLeader, 0),
          volume.reduce((a, b) => a + b, 0),
        )} of volume`,
        `mid-leader borrows late ${pct(leaderLate.length, rs.length)} (wins ${pct(leaderLate.filter((r) => r.winner === r.midLeader).length, leaderLate.length)} vs ${pct(leaderNoLate.filter((r) => r.winner === r.midLeader).length, leaderNoLate.length)} without)`,
        `interest/game ${mean(rs.map((r) => r.interestPaid)).toFixed(0)}`,
        `bankruptcies ${mean(rs.map((r) => r.bankruptcies)).toFixed(2)}, by interest ${mean(rs.map((r) => r.interestBankruptcies)).toFixed(3)}`,
      ].join(" | "),
    );
  }
}

function setCurve(spec: string | undefined): void {
  if (spec === undefined) {
    return;
  }
  const [poorest, average, richest] = spec.split("/").map(Number);
  if (poorest === undefined || average === undefined || richest === undefined) {
    throw new Error(`bad curve ${spec}`);
  }
  Object.assign(LOAN_RATE_CURVE, { poorest, average, richest });
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "report") {
  report(rest);
} else if ((cmd === "bots" || cmd === "proxy") && rest.length >= 3) {
  const [mode, from, to, curve] = rest;
  setCurve(curve);
  for (let seed = Number(from); seed < Number(to); seed++) {
    console.log(JSON.stringify(play(cmd, mode === "on", seed)));
  }
} else {
  console.error(
    "usage: loan-balance-run.ts <bots|proxy> <off|on> <fromSeed> <toSeed> [p/a/r] | report <file>...",
  );
  process.exitCode = 1;
}
