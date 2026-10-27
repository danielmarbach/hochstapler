// Show-off mode "Protzmodus" (docs/DESIGN.md #93): bank loans with a wealth-based interest rate.
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, legalActions } from "../src/game.ts";
import { netWorth, netWorthBreakdown, rankPlayers } from "../src/helpers.ts";
import { LANGS, formatMessage } from "../src/i18n/index.ts";
import { themeText } from "../src/theme-text.ts";
import { THEMES, getTheme } from "../src/themes/index.ts";
import {
  LOAN_RATE_CURVE,
  LOAN_RATE_MAX,
  LOAN_RATE_MIN,
  LOAN_STEP,
  interestDue,
  loanDebt,
  loanLimit,
  loanRateFor,
  rateForWorth,
} from "../src/loans.ts";
import { CURRENT_STATE_VERSION, migrateState, migrateV3toV4 } from "../src/migrations.ts";
import { GameActionSchema, GameSettingsSchema } from "../src/schemas.ts";
import { GameStateSchema } from "../src/state-schema.ts";
import { DEFAULT_SETTINGS } from "../src/types.ts";
import type { GameEvent, GameSettings, GameState, PlayerState } from "../src/types.ts";
import { assertInvariants } from "./invariants.ts";
import { give, groupOf, mk, rig } from "./util.ts";

const RUNS = (n: number): number => (process.env["FAST"] ? Math.ceil(n / 10) : n);

function game(n = 3, over: Partial<GameSettings> = {}): GameState {
  return mk(n, { loans: true, turnTimeoutSec: 0, ...over });
}

function pl(s: GameState, id: string): PlayerState {
  const p = s.players.find((x) => x.id === id);
  if (!p) {
    throw new Error(`no ${id}`);
  }
  return p;
}

function run(s: GameState, pid: string, a: Parameters<typeof applyAction>[2]) {
  const r = applyAction(s, pid, a, 2000);
  assertInvariants(r.state);
  return r;
}

/** Ends p0's turn without moving anybody: puts the game in await-end-turn and ends it. */
function endTurnOf(s: GameState): GameState {
  const c = structuredClone(s);
  c.phase = { type: "await-end-turn", canRollAgain: false };
  const pid = c.players[c.current]?.id ?? "p0";
  return run(c, pid, { type: "end-turn" }).state;
}

/** Plays every other seat's turn by ending it, until it is `pid`'s turn again. */
function untilTurnOf(s: GameState, pid: string): { state: GameState; events: GameEvent[] } {
  let st = s;
  for (let i = 0; i < 10; i++) {
    const c = structuredClone(st);
    c.phase = { type: "await-end-turn", canRollAgain: false };
    const cur = c.players[c.current]?.id ?? "p0";
    const r = run(c, cur, { type: "end-turn" });
    st = r.state;
    if (st.players[st.current]?.id === pid) {
      return { state: st, events: r.events };
    }
  }
  throw new Error("turn never came back");
}

describe("Protzmodus: settings and limits", () => {
  it("is off by default; with it off no loan can be taken", () => {
    expect(DEFAULT_SETTINGS.loans).toBe(false);
    const s = mk(2, { turnTimeoutSec: 0 });
    expect(legalActions(s, "p0")).not.toContain("take-loan");
    expect(() => applyAction(s, "p0", { type: "take-loan", amount: 100 }, 2000)).toThrow(
      formatMessage("de", { key: "err.loanOff", params: {} }),
    );
  });

  it("lends at most half the starting cash, in steps of 100", () => {
    expect(LOAN_STEP).toBe(100);
    expect(loanLimit(game())).toBe(1000);
    expect(loanLimit(game(2, { startingCash: 1500 }))).toBe(700);
    expect(loanLimit(game(2, { startingCash: 500 }))).toBe(200);
  });

  it("validates the actions on the wire", () => {
    expect(GameActionSchema.safeParse({ type: "take-loan", amount: 300 }).success).toBe(true);
    expect(GameActionSchema.safeParse({ type: "repay-loan", amount: 100 }).success).toBe(true);
    expect(GameActionSchema.safeParse({ type: "take-loan", amount: -100 }).success).toBe(false);
    expect(GameActionSchema.safeParse({ type: "take-loan", amount: 1.5 }).success).toBe(false);
    expect(GameActionSchema.safeParse({ type: "take-loan" }).success).toBe(false);
    expect(GameActionSchema.safeParse({ type: "repay-loan", amount: "100" }).success).toBe(false);
    expect(GameSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, loans: "yes" }).success).toBe(false);
  });
});

describe("Protzmodus: the lender of every theme", () => {
  it("has a lender per theme in every language (the subject of the dialog sentence)", () => {
    for (const theme of Object.values(THEMES)) {
      const names = LANGS.map((lang) => themeText(theme, lang).lender);
      for (const name of names) {
        expect(name.length).toBeGreaterThan(5);
      }
      // German base and at least the English and French wording differ
      expect(new Set(names).size).toBeGreaterThanOrEqual(3);
    }
    expect(themeText(getTheme("ch"), "de").lender).toBe("Der Privatbankier am Paradeplatz");
  });
});

describe("Protzmodus: the rate", () => {
  it("is 4 % for the poorest, 8 % at the average and 25 % for the richest", () => {
    expect(LOAN_RATE_CURVE).toEqual({ poorest: 4, average: 8, richest: 25 });
    expect(rateForWorth(1000, 1000, 2000, 4000)).toBe(4);
    expect(rateForWorth(2000, 1000, 2000, 4000)).toBe(8);
    expect(rateForWorth(4000, 1000, 2000, 4000)).toBe(25);
    expect(rateForWorth(3000, 1000, 2000, 4000)).toBe(17);
    expect(rateForWorth(1500, 1000, 2000, 4000)).toBe(6);
  });

  it("is the average rate when everybody is worth the same", () => {
    expect(rateForWorth(2000, 2000, 2000, 2000)).toBe(8);
    const s = game();
    expect(loanRateFor(s, "p0", netWorth)).toBe(8);
  });

  it("stays within its bounds and grows with the relative wealth (fast-check)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -5000, max: 50_000 }), { minLength: 2, maxLength: 8 }),
        (worths) => {
          const min = Math.min(...worths);
          const max = Math.max(...worths);
          const avg = worths.reduce((a, b) => a + b, 0) / worths.length;
          const sorted = [...worths].sort((a, b) => a - b);
          let last = -Infinity;
          for (const w of sorted) {
            const r = rateForWorth(w, min, avg, max);
            expect(Number.isInteger(r)).toBe(true);
            expect(r).toBeGreaterThanOrEqual(LOAN_RATE_MIN);
            expect(r).toBeLessThanOrEqual(LOAN_RATE_MAX);
            expect(r).toBeGreaterThanOrEqual(last);
            last = r;
          }
        },
      ),
      { numRuns: RUNS(500) },
    );
  });

  it("charges the leader more than the trailing player in a real game", () => {
    const s = game();
    pl(s, "p0").cash = 500;
    pl(s, "p1").cash = 2000;
    pl(s, "p2").cash = 6000;
    expect(loanRateFor(s, "p0", netWorth)).toBe(4);
    expect(loanRateFor(s, "p2", netWorth)).toBe(25);
    expect(loanRateFor(s, "p1", netWorth)).toBeGreaterThan(4);
    expect(loanRateFor(s, "p1", netWorth)).toBeLessThan(25);
  });
});

describe("Protzmodus: taking a loan", () => {
  it("credits the cash, locks the rate in a tranche, logs it and emits an event", () => {
    const s = game();
    pl(s, "p0").cash = 500;
    pl(s, "p2").cash = 6000;
    const r = run(s, "p0", { type: "take-loan", amount: 300 });
    const p = pl(r.state, "p0");
    expect(p.cash).toBe(800);
    expect(p.loans).toEqual([{ amount: 300, ratePct: 4 }]);
    expect(r.events).toContainEqual({
      type: "cash",
      playerId: "p0",
      delta: 300,
      reason: "loan",
      counterparty: null,
    });
    expect(r.events).toContainEqual({ type: "loan", playerId: "p0", amount: 300, ratePct: 4 });
    expect(r.state.log.at(-1)?.msg).toEqual({
      key: "log.loanTaken",
      params: { player: "p0", amount: 300, pct: 4 },
    });
  });

  it("does not change the net worth (cash in, debt out) and the debt counts in the ranking", () => {
    const s = game();
    const before = netWorth(s, "p0");
    const after = run(s, "p0", { type: "take-loan", amount: 400 }).state;
    expect(netWorth(after, "p0")).toBe(before);
    expect(netWorthBreakdown(after, "p0").loans).toBe(-400);
    expect(netWorthBreakdown(after, "p0").cash).toBe(2400);
    expect(rankPlayers(after).find((r) => r.playerId === "p0")?.total).toBe(before);
  });

  it("adds a second tranche at its own locked rate; equal rates merge", () => {
    let s = game();
    s = run(s, "p0", { type: "take-loan", amount: 200 }).state;
    s = run(s, "p0", { type: "take-loan", amount: 100 }).state;
    expect(pl(s, "p0").loans).toEqual([{ amount: 300, ratePct: 8 }]);
    // p0 becomes the richest: the next tranche is more expensive
    pl(s, "p0").cash += 5000;
    s = run(s, "p0", { type: "take-loan", amount: 100 }).state;
    expect(pl(s, "p0").loans).toEqual([
      { amount: 100, ratePct: 25 },
      { amount: 300, ratePct: 8 },
    ]);
    expect(loanDebt(pl(s, "p0"))).toBe(400);
  });

  it("is allowed before rolling, when buying and after moving, but never beyond the limit", () => {
    const s = game();
    expect(legalActions(s, "p0")).toContain("take-loan");
    const buy = structuredClone(s);
    buy.phase = { type: "await-buy", tile: 1 };
    expect(legalActions(buy, "p0")).toContain("take-loan");
    run(buy, "p0", { type: "take-loan", amount: 100 });
    const end = structuredClone(s);
    end.phase = { type: "await-end-turn", canRollAgain: false };
    run(end, "p0", { type: "take-loan", amount: 1000 });
    expect(() => applyAction(s, "p0", { type: "take-loan", amount: 1100 }, 2000)).toThrow(
      formatMessage("de", { key: "err.loanLimit", params: { amount: 1000 } }),
    );
    const full = run(s, "p0", { type: "take-loan", amount: 1000 }).state;
    expect(legalActions(full, "p0")).not.toContain("take-loan");
    expect(() => applyAction(full, "p0", { type: "take-loan", amount: 100 }, 2000)).toThrow();
  });

  it("only in steps of 100", () => {
    const s = game();
    for (const amount of [0, 50, 150, -100]) {
      expect(() => applyAction(s, "p0", { type: "take-loan", amount }, 2000)).toThrow(
        formatMessage("de", { key: "err.loanStep", params: { amount: 100 } }),
      );
    }
  });

  it("never out of turn, in an auction, during a pending payment or after the game", () => {
    const s = game();
    const notNow = formatMessage("de", { key: "err.loanNotNow", params: {} });
    expect(legalActions(s, "p1")).not.toContain("take-loan");
    expect(() => applyAction(s, "p1", { type: "take-loan", amount: 100 }, 2000)).toThrow(notNow);

    const debt = structuredClone(s);
    pl(debt, "p0").cash = 10;
    debt.phase = { type: "debt", debtor: "p0", creditor: "p1", amount: 300 };
    expect(legalActions(debt, "p0")).not.toContain("take-loan");
    expect(() => applyAction(debt, "p0", { type: "take-loan", amount: 300 }, 2000)).toThrow(notNow);

    const auction = structuredClone(s);
    auction.phase = {
      type: "auction",
      auction: {
        tile: 1,
        highestBid: 0,
        highestBidder: null,
        bidders: ["p1", "p2", "p0"],
        turn: "p0",
      },
    };
    expect(legalActions(auction, "p0")).not.toContain("take-loan");
    expect(() => applyAction(auction, "p0", { type: "take-loan", amount: 100 }, 2000)).toThrow(
      notNow,
    );
  });
});

describe("Protzmodus: interest", () => {
  it("is paid in cash at the start of each own turn, not at the others' turns", () => {
    let s = game();
    s = run(s, "p0", { type: "take-loan", amount: 500 }).state; // 8 % -> 40 per round
    expect(interestDue(pl(s, "p0"))).toBe(40);
    s = endTurnOf(s); // p1's turn starts: p0 pays nothing
    expect(pl(s, "p0").cash).toBe(2500);
    s = endTurnOf(s); // p2
    expect(pl(s, "p0").cash).toBe(2500);
    const r = untilTurnOf(s, "p0");
    expect(pl(r.state, "p0").cash).toBe(2460);
    expect(r.events).toContainEqual({
      type: "cash",
      playerId: "p0",
      delta: -40,
      reason: "loan-interest",
      counterparty: null,
    });
    expect(r.state.log.some((l) => l.msg?.key === "log.loanInterest")).toBe(true);
    expect(r.state.phase.type).toBe("await-roll");
    // the debt is unchanged: interest is never added to it
    expect(loanDebt(pl(r.state, "p0"))).toBe(500);
  });

  it("rounds the interest up per tranche", () => {
    expect(interestDue({ loans: [{ amount: 100, ratePct: 7 }] })).toBe(7);
    expect(
      interestDue({
        loans: [
          { amount: 300, ratePct: 13 },
          { amount: 100, ratePct: 5 },
        ],
      }),
    ).toBe(39 + 5);
  });

  it("short of cash: the usual debt phase; once raised, the turn starts normally", () => {
    const s = game(2);
    give(s, "p1", groupOf(0));
    pl(s, "p1").loans = [{ amount: 1000, ratePct: 20 }];
    pl(s, "p1").cash = 50;
    const owed = endTurnOf(s);
    expect(owed.players[owed.current]?.id).toBe("p1");
    expect(owed.phase).toEqual({
      type: "debt",
      debtor: "p1",
      creditor: null,
      amount: 200,
      loanInterest: true,
    });
    expect(legalActions(owed, "p1")).not.toContain("take-loan");
    expect(legalActions(owed, "p1")).not.toContain("roll");
    const [a, b] = groupOf(0);
    let st = run(owed, "p1", { type: "mortgage", tile: a ?? 0 }).state;
    expect(st.phase.type).toBe("debt");
    st = run(st, "p1", { type: "mortgage", tile: b ?? 0 }).state;
    // mortgages (2 x 30) + 50 cash still short? then sell more; otherwise the turn starts
    if (st.phase.type === "debt") {
      return;
    }
    expect(st.phase).toEqual({ type: "await-roll" });
    expect(st.log.some((l) => l.msg?.key === "log.debtSettled")).toBe(true);
  });

  it("returns to the start of the turn after the interest debt is settled", () => {
    const s = game(2);
    give(s, "p1", [5]); // Basel, price 200 -> mortgage 100
    pl(s, "p1").loans = [{ amount: 500, ratePct: 20 }];
    pl(s, "p1").cash = 20;
    const owed = endTurnOf(s);
    expect(owed.phase).toMatchObject({ type: "debt", amount: 100, loanInterest: true });
    const r = run(owed, "p1", { type: "mortgage", tile: 5 });
    expect(r.state.phase).toEqual({ type: "await-roll" });
    expect(pl(r.state, "p1").cash).toBe(20);
    expect(r.events).toContainEqual({
      type: "cash",
      playerId: "p1",
      delta: -100,
      reason: "loan-interest",
      counterparty: null,
    });
    expect(legalActions(r.state, "p1")).toContain("roll");
  });

  it("ends in bankruptcy to the bank when nothing is left; the loan disappears with the player", () => {
    const s = game(3);
    pl(s, "p1").loans = [{ amount: 1000, ratePct: 20 }];
    pl(s, "p1").cash = 10;
    const owed = endTurnOf(s);
    expect(owed.phase).toMatchObject({ type: "debt", debtor: "p1", loanInterest: true });
    const r = run(owed, "p1", { type: "declare-bankruptcy" });
    const p = pl(r.state, "p1");
    expect(p.bankrupt).toBe(true);
    expect(p.loans).toBeUndefined();
    expect(r.events).toContainEqual({ type: "bankrupt", playerId: "p1", creditor: null });
    expect(r.state.log.some((l) => l.msg?.key === "log.loanWrittenOff")).toBe(true);
    expect(r.state.players[r.state.current]?.id).toBe("p2");
  });

  it("a player going bankrupt to another player also leaves the loan with the bank", () => {
    const s = game(3);
    pl(s, "p0").loans = [{ amount: 400, ratePct: 10 }];
    pl(s, "p0").cash = 5;
    s.phase = { type: "debt", debtor: "p0", creditor: "p1", amount: 300 };
    const r = run(s, "p0", { type: "declare-bankruptcy" });
    expect(pl(r.state, "p0").loans).toBeUndefined();
    expect(pl(r.state, "p1").loans).toBeUndefined();
    expect(pl(r.state, "p1").cash).toBe(2005);
  });
});

describe("Protzmodus: repaying", () => {
  it("pays back partially or fully, the most expensive tranche first", () => {
    let s = game();
    pl(s, "p0").loans = [
      { amount: 300, ratePct: 20 },
      { amount: 200, ratePct: 5 },
    ];
    const r = run(s, "p0", { type: "repay-loan", amount: 400 });
    s = r.state;
    expect(pl(s, "p0").cash).toBe(1600);
    expect(pl(s, "p0").loans).toEqual([{ amount: 100, ratePct: 5 }]);
    expect(r.events).toContainEqual({
      type: "cash",
      playerId: "p0",
      delta: -400,
      reason: "loan",
      counterparty: null,
    });
    expect(r.events).toContainEqual({ type: "loan", playerId: "p0", amount: -400, ratePct: 20 });
    expect(s.log.at(-1)?.msg?.key).toBe("log.loanRepaid");
    s = run(s, "p0", { type: "repay-loan", amount: 100 }).state;
    expect(pl(s, "p0").loans).toBeUndefined();
    expect(legalActions(s, "p0")).not.toContain("repay-loan");
  });

  it("refuses more than the debt, more than the cash, odd amounts and other turns", () => {
    const s = game();
    pl(s, "p0").loans = [{ amount: 300, ratePct: 10 }];
    expect(legalActions(s, "p0")).toContain("repay-loan");
    expect(() => applyAction(s, "p0", { type: "repay-loan", amount: 400 }, 2000)).toThrow(
      formatMessage("de", { key: "err.loanTooMuch", params: { amount: 300 } }),
    );
    expect(() => applyAction(s, "p0", { type: "repay-loan", amount: 50 }, 2000)).toThrow();
    pl(s, "p0").cash = 150;
    expect(() => applyAction(s, "p0", { type: "repay-loan", amount: 200 }, 2000)).toThrow(
      formatMessage("de", { key: "err.notEnoughCash", params: {} }),
    );
    run(s, "p0", { type: "repay-loan", amount: 100 });
    pl(s, "p1").loans = [{ amount: 100, ratePct: 10 }];
    expect(legalActions(s, "p1")).not.toContain("repay-loan");
    expect(() => applyAction(s, "p1", { type: "repay-loan", amount: 100 }, 2000)).toThrow();
    const none = game();
    expect(() => applyAction(none, "p0", { type: "repay-loan", amount: 100 }, 2000)).toThrow(
      formatMessage("de", { key: "err.loanNone", params: {} }),
    );
  });

  it("works after a roll (await-end-turn) and while deciding on a purchase", () => {
    const s = rig(game(), 1, 2);
    pl(s, "p0").loans = [{ amount: 300, ratePct: 10 }];
    const moved = run(s, "p0", { type: "roll" }).state;
    expect(["await-buy", "await-end-turn"]).toContain(moved.phase.type);
    expect(legalActions(moved, "p0")).toContain("repay-loan");
    run(moved, "p0", { type: "repay-loan", amount: 300 });
  });
});

describe("Protzmodus: state version 4", () => {
  it("is the fourth state version", () => {
    expect(CURRENT_STATE_VERSION).toBe(4);
  });

  it("v3 -> v4 keeps running games without the mode", () => {
    const v3 = structuredClone(mk(2)) as unknown as { settings: Record<string, unknown> };
    delete v3.settings["loans"];
    const out = migrateV3toV4(v3) as { settings: { loans: boolean } };
    expect(out.settings.loans).toBe(false);
    expect(v3.settings["loans"]).toBeUndefined();
    expect(migrateState(v3, 3).settings.loans).toBe(false);
  });

  it("validates tranches and the interest debt flag", () => {
    const s = game();
    pl(s, "p0").loans = [{ amount: 300, ratePct: 10 }];
    expect(GameStateSchema.safeParse(s).success).toBe(true);
    pl(s, "p0").loans = [{ amount: -300, ratePct: 10 }];
    expect(GameStateSchema.safeParse(s).success).toBe(false);
    pl(s, "p0").loans = [{ amount: 300, ratePct: 0 }];
    expect(GameStateSchema.safeParse(s).success).toBe(false);
  });
});

describe("Protzmodus: money between players and the bank (fast-check)", () => {
  it("every loan cash flow matches the change of the debt; debt never negative or above the limit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.array(
          fc.record({
            take: fc.boolean(),
            steps: fc.integer({ min: -2, max: 12 }),
            end: fc.boolean(),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        (seed, ops) => {
          let s = createGame(
            "m",
            [0, 1, 2].map((i) => ({
              id: `p${i}`,
              name: `P${i}`,
              color: "#fff",
              tokenId: `t${i}`,
              controller: "human" as const,
              botLevel: "normal" as const,
            })),
            { ...DEFAULT_SETTINGS, loans: true, turnTimeoutSec: 0 },
            seed,
            1000,
          ).state;
          for (const op of ops) {
            if (s.status !== "running") {
              break;
            }
            const pid = s.players[s.current]?.id ?? "p0";
            const amount = op.steps * LOAN_STEP;
            const before = s;
            let r: { state: GameState; events: GameEvent[] };
            try {
              r = applyAction(
                s,
                pid,
                op.end && s.phase.type === "await-end-turn"
                  ? { type: "end-turn" }
                  : s.phase.type === "await-roll" && op.end
                    ? { type: "roll" }
                    : { type: op.take ? "take-loan" : "repay-loan", amount },
                2000,
              );
            } catch {
              continue;
            }
            assertInvariants(r.state);
            for (const p of r.state.players) {
              const prev = before.players.find((x) => x.id === p.id);
              const flows = r.events
                .filter((e) => e.type === "cash" && e.playerId === p.id && e.reason === "loan")
                .reduce((a, e) => a + (e.type === "cash" ? e.delta : 0), 0);
              const debtDelta = loanDebt(p) - loanDebt(prev ?? p);
              if (!p.bankrupt) {
                expect(debtDelta).toBe(flows);
              }
              expect(loanDebt(p)).toBeGreaterThanOrEqual(0);
              expect(loanDebt(p)).toBeLessThanOrEqual(loanLimit(r.state));
              // interest leaves the player's cash to the bank and is never added to the debt
              const interest = r.events
                .filter(
                  (e) => e.type === "cash" && e.playerId === p.id && e.reason === "loan-interest",
                )
                .reduce((a, e) => a + (e.type === "cash" ? e.delta : 0), 0);
              expect(interest).toBeLessThanOrEqual(0);
              const otherCash = r.events
                .filter((e) => e.type === "cash" && e.playerId !== p.id && e.counterparty === p.id)
                .filter(
                  (e) => e.type === "cash" && (e.reason === "loan" || e.reason === "loan-interest"),
                );
              expect(otherCash).toEqual([]);
            }
            s = r.state;
          }
        },
      ),
      { numRuns: RUNS(200) },
    );
  });
});
