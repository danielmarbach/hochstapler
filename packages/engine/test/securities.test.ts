// Wertpapiere (securities mode, docs/DESIGN.md #48): scenario tests over the real engine.
import { describe, expect, it } from "vitest";
import { chooseBotAction } from "../src/bot.ts";
import { applyAction, createGame, legalActions } from "../src/game.ts";
import { netWorth, netWorthBreakdown, rankPlayers } from "../src/helpers.ts";
import {
  EMERGENCY_DISCOUNT_PERCENT,
  HEADLINE_KEYS,
  MAX_SHARES_PER_SECURITY,
  SECURITY_SECTORS,
  stepMarket,
} from "../src/securities.ts";
import { getTheme } from "../src/themes/index.ts";
import { DEFAULT_SETTINGS } from "../src/types.ts";
import type { GameState } from "../src/types.ts";
import { formatMessage } from "../src/i18n/index.ts";
import { given, group } from "./scenario.ts";
import { mk, players } from "./util.ts";

const PILATUS = "ch-pilatus"; // tourism, start 80
const KRYPTO = "ch-krypto"; // bank, start 100
const SBB = "ch-sbb"; // rail, start 40
const GOTTHARD = "ch-gotthard"; // energy, start 70
const IMMO = "ch-bahnhofstrass"; // realestate, start 120
const START_PRICE = 80;

const awaitEndTurn = { type: "await-end-turn", canRollAgain: false } as const;
/** Ben is the last player of the round: his end-turn starts round + 1 and updates the market. */
const benEndsRound = (g: ReturnType<typeof given>) =>
  g.tweak((s) => {
    s.current = 1;
    s.phase = awaitEndTurn;
  });

describe("Wertpapiere: Spielstart", () => {
  it("has no market while the mode is off (default)", () => {
    expect(DEFAULT_SETTINGS.securities).toBe(false);
    expect(DEFAULT_SETTINGS.securitiesLockRounds).toBe(3);
    expect(mk(2).market).toBeUndefined();
  });

  it("starts the market at the theme's start prices with a one-entry history", () => {
    const s = mk(2, { securities: true });
    const companies = getTheme("ch").securities;
    expect(companies).toHaveLength(6);
    expect(Object.keys(s.market?.prices ?? {}).sort()).toEqual(companies.map((c) => c.id).sort());
    for (const c of companies) {
      expect(s.market?.prices[c.id]).toBe(c.startPrice);
      expect(s.market?.history[c.id]).toEqual([c.startPrice]);
    }
    expect(s.market?.headline).toBeUndefined();
  });
});

describe("Wertpapiere: kaufen", () => {
  it("pays shares x price, records a lot with buy price and round, emits event and log", () => {
    given()
      .securities()
      .when("Anna")
      .buysSecurities(PILATUS, 5)
      .then()
      .cash("Anna")
      .is(2000 - 5 * START_PRICE)
      .holdings("Anna")
      .is([{ secId: PILATUS, shares: 5, buyPrice: START_PRICE, boughtRound: 1 }])
      .emitted("securities-trade", {
        playerId: "Anna",
        secId: PILATUS,
        shares: 5,
        price: START_PRICE,
        side: "buy",
      })
      .emitted("cash", { playerId: "Anna", delta: -5 * START_PRICE, reason: "securities" })
      .lastLogKey("log.secBought");
  });

  it("merges a second buy at the same price in the same round into one lot", () => {
    given()
      .securities()
      .when("Anna")
      .buysSecurities(PILATUS, 2)
      .and()
      .when("Anna")
      .buysSecurities(PILATUS, 3)
      .then()
      .holdings("Anna")
      .is([{ secId: PILATUS, shares: 5, buyPrice: START_PRICE, boughtRound: 1 }]);
  });

  it("is also allowed after the roll (end of turn phase) but not while a property is offered", () => {
    given()
      .securities()
      .turnState(0, [1, 2], awaitEndTurn)
      .when("Anna")
      .buysSecurities(SBB, 1)
      .then()
      .holdings("Anna")
      .is([{ secId: SBB, shares: 1, buyPrice: 40, boughtRound: 1 }])
      .and()
      .meanwhile((s) => {
        s.phase = { type: "await-buy", tile: 1 };
      })
      .then()
      .legal("Anna")
      .excludes("buy-securities")
      .rejects({ type: "buy-securities", secId: SBB, shares: 1 }, /Jetzt nicht möglich/);
  });

  it("is rejected when the mode is off, for unknown securities and silly share counts", () => {
    given()
      .then()
      .legal("Anna")
      .excludes("buy-securities", "sell-securities")
      .rejects({ type: "buy-securities", secId: PILATUS, shares: 1 }, /Wertpapiere/);
    given()
      .securities()
      .then()
      .rejects({ type: "buy-securities", secId: "ch-nope", shares: 1 }, /Unbekanntes Wertpapier/)
      .rejects({ type: "buy-securities", secId: PILATUS, shares: 0 }, /Stückzahl/)
      .rejects({ type: "buy-securities", secId: PILATUS, shares: 1.5 }, /Stückzahl/)
      .rejects(
        { type: "buy-securities", secId: PILATUS, shares: MAX_SHARES_PER_SECURITY + 1 },
        /Höchstens/,
      );
  });

  it("needs enough cash and the player's own turn", () => {
    given()
      .securities()
      .player("Anna")
      .cash(100)
      .then()
      .rejects({ type: "buy-securities", secId: PILATUS, shares: 2 }, /Zu wenig Geld/)
      .rejects({ type: "buy-securities", secId: PILATUS, shares: 1 }, /Jetzt nicht möglich/, "Ben")
      .legal("Ben")
      .excludes("buy-securities");
  });

  it("is not offered when even the cheapest security is unaffordable", () => {
    given()
      .securities()
      .player("Anna")
      .cash(39)
      .then()
      .legal("Anna")
      .excludes("buy-securities")
      .and()
      .meanwhile((s) => {
        const p = s.players[0];
        if (p) {
          p.cash = 40;
        }
      })
      .then()
      .legal("Anna")
      .contains("buy-securities");
  });

  it("caps one security at MAX_SHARES_PER_SECURITY per player", () => {
    given()
      .securities()
      .player("Anna")
      .cash(100_000)
      .holds(SBB, MAX_SHARES_PER_SECURITY, 40, 1)
      .then()
      .rejects({ type: "buy-securities", secId: SBB, shares: 1 }, /Höchstens/);
  });
});

describe("Securities: selling and lock-up period", () => {
  it("sells after the lock-up at the current price: gain = price difference", () => {
    given()
      .securities(3)
      .round(4)
      .player("Anna")
      .holds(PILATUS, 10, 60, 1)
      .when("Anna")
      .sellsSecurities(PILATUS, 0)
      .then()
      .cash("Anna")
      .is(2000 + 10 * START_PRICE)
      .holdings("Anna")
      .is([])
      .emitted("securities-trade", { side: "sell", shares: 10, price: START_PRICE })
      .lastLogKey("log.secSold");
  });

  it("refuses a sale during the lock-up with the remaining rounds", () => {
    given()
      .securities(3)
      .round(3)
      .player("Anna")
      .holds(PILATUS, 10, 60, 1)
      .then()
      .legal("Anna")
      .excludes("sell-securities")
      .rejects({ type: "sell-securities", secId: PILATUS, lot: 0 }, /gesperrt/)
      .and()
      .meanwhile((s) => {
        s.round = 2;
      })
      .then()
      .rejects({ type: "sell-securities", secId: PILATUS, lot: "all" }, /gesperrt/);
  });

  it("honours the configured lock-up (1 round)", () => {
    given()
      .securities(1)
      .round(2)
      .player("Anna")
      .holds(PILATUS, 1, 60, 1)
      .when("Anna")
      .sellsSecurities(PILATUS, 0)
      .then()
      .holdings("Anna")
      .is([]);
  });

  it("'all' sells only the lots whose lock-up is over", () => {
    given()
      .securities(3)
      .round(5)
      .player("Anna")
      .holds(PILATUS, 2, 60, 1)
      .holds(IMMO, 1, 100, 1)
      .holds(PILATUS, 3, 70, 4)
      .when("Anna")
      .sellsSecurities(PILATUS, "all")
      .then()
      .holdings("Anna")
      .is([
        { secId: IMMO, shares: 1, buyPrice: 100, boughtRound: 1 },
        { secId: PILATUS, shares: 3, buyPrice: 70, boughtRound: 4 },
      ])
      .cash("Anna")
      .is(2000 + 2 * START_PRICE);
  });

  it("checks that the lot belongs to the named security and exists", () => {
    given()
      .securities()
      .round(9)
      .player("Anna")
      .holds(PILATUS, 1, 60, 1)
      .then()
      .rejects({ type: "sell-securities", secId: SBB, lot: 0 }, /Position/)
      .rejects({ type: "sell-securities", secId: PILATUS, lot: 3 }, /Position/)
      .rejects({ type: "sell-securities", secId: SBB, lot: "all" }, /Position/);
  });

  it("is only possible on the own turn (outside of debt)", () => {
    given()
      .securities()
      .round(9)
      .player("Ben")
      .holds(PILATUS, 1, 60, 1)
      .then()
      .legal("Ben")
      .excludes("sell-securities")
      .rejects({ type: "sell-securities", secId: PILATUS, lot: 0 }, /Jetzt nicht möglich/, "Ben");
  });
});

describe("Securities: emergency sale on debt", () => {
  const debtOf = (amount: number) =>
    ({ type: "debt", debtor: "p0", creditor: null, amount }) as const;

  it("sells a locked lot with a 20 % discount and settles the debt automatically", () => {
    expect(EMERGENCY_DISCOUNT_PERCENT).toBe(20);
    given()
      .securities(3)
      .round(5)
      .player("Anna")
      .cash(100)
      .holds(PILATUS, 10, 90, 5)
      .turnState(0, [1, 2], debtOf(500))
      .then()
      .legal("Anna")
      .contains("sell-securities", "declare-bankruptcy")
      .when("Anna")
      .sellsSecurities(PILATUS, 0)
      .then()
      .emitted("securities-trade", { side: "emergency-sell", price: START_PRICE, shares: 10 })
      .lastLogKey("log.debtSettled")
      // 10 x 80 = 800, 20 % off = 640; the debt of 500 is paid out of 100 + 640
      .cash("Anna")
      .is(100 + 640 - 500)
      .phaseType()
      .is("await-end-turn")
      .holdings("Anna")
      .is([]);
  });

  it("sells an unlocked lot at the full price even in debt", () => {
    given()
      .securities(3)
      .round(9)
      .player("Anna")
      .cash(100)
      .holds(PILATUS, 10, 90, 1)
      .turnState(0, [1, 2], debtOf(500))
      .when("Anna")
      .sellsSecurities(PILATUS, 0)
      .then()
      .emitted("securities-trade", { side: "sell" })
      .cash("Anna")
      .is(100 + 800 - 500);
  });

  it("stays in debt if the proceeds do not cover it", () => {
    given()
      .securities(3)
      .round(5)
      .player("Anna")
      .cash(0)
      .holds(PILATUS, 1, 90, 5)
      .turnState(0, [1, 2], debtOf(500))
      .when("Anna")
      .sellsSecurities(PILATUS, 0)
      .then()
      .phaseType()
      .is("debt")
      .cash("Anna")
      .is(64);
  });
});

describe("Securities: net worth and bankruptcy", () => {
  it("counts holdings at the current price in the net worth", () => {
    const base = given().securities().player("Anna").build().state;
    const rich = given().securities().player("Anna").holds(PILATUS, 10, 1, 1).build().state;
    expect(netWorth(rich, "p0") - netWorth(base, "p0")).toBe(10 * START_PRICE);
  });

  it("lists holdings as their own line of the net worth breakdown and ranks by it", () => {
    const state = given().securities().player("Anna").holds(PILATUS, 10, 1, 1).build().state;
    const anna = netWorthBreakdown(state, "p0");
    expect(anna.securities).toBe(10 * START_PRICE);
    expect(anna.total).toBe(
      anna.cash + anna.properties + anna.buildings + anna.mortgages + 10 * START_PRICE,
    );
    expect(rankPlayers(state)[0]).toMatchObject({ playerId: "p0", securities: 10 * START_PRICE });
  });

  it("leaves the breakdown unchanged when the securities mode is off", () => {
    expect(netWorthBreakdown(given().player("Anna").build().state, "p0")).not.toHaveProperty(
      "securities",
    );
  });

  it("decides the maxRounds winner by net worth including holdings", () => {
    given()
      .securities()
      .settings({ maxRounds: 1 })
      .player("Anna")
      .cash(100)
      .holds(PILATUS, 100, 80, 1)
      .tweak((s) => {
        s.current = 1;
        s.phase = awaitEndTurn;
      })
      .when("Ben")
      .endsTurn()
      .then()
      .phaseType()
      .is("game-over")
      .winner()
      .is("Anna");
  });

  it("hands the holdings to the creditor player on bankruptcy", () => {
    given()
      .players("Anna", "Ben", "Carl")
      .securities()
      .round(2)
      .player("Anna")
      .cash(0)
      .holds(PILATUS, 4, 60, 2)
      .player("Ben")
      .holds(IMMO, 1, 100, 1)
      .turnState(0, [1, 2], { type: "debt", debtor: "p0", creditor: "p1", amount: 9000 })
      .when("Anna")
      .declaresBankruptcy()
      .then()
      .holdings("Anna")
      .is([])
      .holdings("Ben")
      .is([
        { secId: IMMO, shares: 1, buyPrice: 100, boughtRound: 1 },
        { secId: PILATUS, shares: 4, buyPrice: 60, boughtRound: 2 },
      ]);
  });

  it("sells the holdings to the bank at the current price when the bank is the creditor", () => {
    given()
      .players("Anna", "Ben", "Carl")
      .securities()
      .player("Anna")
      .cash(0)
      .holds(PILATUS, 4, 60, 2)
      .turnState(0, [1, 2], { type: "debt", debtor: "p0", creditor: null, amount: 9000 })
      .when("Anna")
      .declaresBankruptcy()
      .then()
      .holdings("Anna")
      .is([])
      .holdings("Ben")
      .is([])
      .emitted("securities-trade", { side: "bankruptcy-sale", shares: 4, price: START_PRICE });
  });

  it("counts a debtor's holdings in the liquidation value (bots do not give up too early)", () => {
    const s = given()
      .securities()
      .round(5)
      .player("Anna")
      .cash(0)
      .holds(PILATUS, 10, 90, 5)
      .turnState(0, [1, 2], { type: "debt", debtor: "p0", creditor: null, amount: 500 })
      .build().state;
    expect(chooseBotAction(s, "p0")).toEqual({ type: "sell-securities", secId: PILATUS, lot: 0 });
  });
});

describe("Wertpapiere: Kursentwicklung am Rundenende", () => {
  const after = (tweak: (s: GameState) => void): GameState => {
    const sc = benEndsRound(given().securities().player("Anna").cash(2000))
      .tweak(tweak)
      .when("Ben")
      .endsTurn();
    return sc.state;
  };

  it("moves every price at the end of the round, keeping integers >= 1 and the history", () => {
    const s = after(() => undefined);
    expect(s.round).toBe(2);
    for (const c of getTheme("ch").securities) {
      const price = s.market?.prices[c.id];
      expect(Number.isInteger(price) && (price ?? 0) >= 1).toBe(true);
      expect(s.market?.history[c.id]).toEqual([c.startPrice, price]);
    }
    expect(Object.values(s.market?.prices ?? {})).not.toEqual(
      getTheme("ch").securities.map((c) => c.startPrice),
    );
  });

  it("emits a market event and resets the activity counters", () => {
    given()
      .securities()
      .tweak((s) => {
        s.current = 1;
        s.phase = awaitEndTurn;
        if (s.market) {
          s.market.activity.builds = 2;
        }
      })
      .when("Ben")
      .endsTurn()
      .then()
      .emitted("market", { round: 2 })
      .that((s) => {
        expect(s.market?.activity).toEqual({
          builds: 0,
          scenicBuilds: 0,
          rentPaid: 0,
          stationRents: 0,
          utilityRents: 0,
          bankruptcies: 0,
        });
      });
  });

  it("is deterministic: same state, same next market", () => {
    const s = mk(2, { securities: true });
    expect(stepMarket(s)).toEqual(stepMarket(structuredClone(s)));
    const other = { ...structuredClone(s), rng: s.rng + 1 };
    expect(stepMarket(other).market.prices).not.toEqual(stepMarket(s).market.prices);
  });

  it("does not touch the market when the round does not change", () => {
    given()
      .securities()
      .when("Anna")
      .rolls(1, 2)
      .then()
      .that((s) => {
        expect(s.market?.history[PILATUS]).toEqual([START_PRICE]);
      });
  });

  describe("coupling to the game (same rng, with and without activity)", () => {
    const plain = after(() => undefined);
    const priceOf = (s: GameState, id: string): number => s.market?.prices[id] ?? NaN;

    it("buildings in scenic groups lift tourism", () => {
      const s = after((st) => {
        if (st.market) {
          st.market.activity.scenicBuilds = 3;
          st.market.activity.builds = 3;
        }
      });
      expect(priceOf(s, PILATUS)).toBeGreaterThan(priceOf(plain, PILATUS));
      expect(priceOf(s, KRYPTO)).toBe(priceOf(plain, KRYPTO));
    });

    it("a bankruptcy drags the bank down", () => {
      const s = after((st) => {
        if (st.market) {
          st.market.activity.bankruptcies = 1;
        }
      });
      expect(priceOf(s, KRYPTO)).toBeLessThan(priceOf(plain, KRYPTO));
    });

    it("station rents lift rail, utility rents lift energy", () => {
      const s = after((st) => {
        if (st.market) {
          st.market.activity.stationRents = 3;
          st.market.activity.utilityRents = 3;
        }
      });
      expect(priceOf(s, SBB)).toBeGreaterThan(priceOf(plain, SBB));
      expect(priceOf(s, GOTTHARD)).toBeGreaterThan(priceOf(plain, GOTTHARD));
    });

    it("much rent paid and many buildings lift real estate", () => {
      const s = after((st) => {
        if (st.market) {
          st.market.activity.rentPaid = 600;
          st.market.activity.builds = 4;
        }
      });
      expect(priceOf(s, IMMO)).toBeGreaterThan(priceOf(plain, IMMO));
    });
  });

  describe("recording the activity", () => {
    it("counts builds (scenic groups separately), rent by tile kind and bankruptcies", () => {
      given()
        .player("Anna")
        .owns(group(0))
        .withLevel(0)
        .securities()
        .when("Anna")
        .does({ type: "build", tile: group(0)[0] ?? 0 })
        .then()
        .that((s) => {
          expect(s.market?.activity.builds).toBe(1);
          expect(s.market?.activity.scenicBuilds).toBe(1);
        });
      // station rent: Ben owns tile 5, Anna lands on it from tile 3
      given()
        .securities()
        .player("Ben")
        .owns(5)
        .player("Anna")
        .at(3)
        .when("Anna")
        .rolls(1, 1)
        .then()
        .that((s) => {
          expect(s.market?.activity.stationRents).toBe(1);
          expect(s.market?.activity.rentPaid).toBeGreaterThan(0);
        });
      // bankruptcy
      given()
        .securities()
        .player("Anna")
        .cash(0)
        .turnState(0, [1, 2], { type: "debt", debtor: "p0", creditor: null, amount: 50 })
        .when("Anna")
        .declaresBankruptcy()
        .then()
        .that((s) => expect(s.market?.activity.bankruptcies).toBe(1));
    });
  });
});

describe("Wertpapiere: Schlagzeilen", () => {
  const withSeed = (rng: number): GameState => ({ ...mk(2, { securities: true }), rng });

  it("has a themed text key for every sector and direction", () => {
    for (const sector of SECURITY_SECTORS) {
      for (const kind of ["boom", "crash"] as const) {
        const key = HEADLINE_KEYS[sector][kind];
        for (const lang of ["de", "en", "gsw", "fr", "it"] as const) {
          expect(formatMessage(lang, { key, params: { security: "X", pct: 20 } })).toContain("20");
        }
      }
    }
  });

  it("happens in about 5 % of the rounds and moves the sector by 15-35 %", () => {
    let hits = 0;
    const runs = 2000;
    for (let seed = 1; seed <= runs; seed++) {
      const s = withSeed(seed);
      const { market } = stepMarket(s);
      const h = market.headline;
      if (!h) {
        continue;
      }
      hits++;
      expect(h.pct).toBeGreaterThanOrEqual(15);
      expect(h.pct).toBeLessThanOrEqual(35);
      expect(h.round).toBe(s.round + 1);
      const company = getTheme("ch").securities.find((c) => c.id === h.secId);
      expect(company?.sector).toBe(h.sector);
      const before = s.market?.prices[h.secId] ?? 0;
      const afterPrice = market.prices[h.secId] ?? 0;
      if (h.kind === "boom") {
        expect(afterPrice).toBeGreaterThan(before);
      } else {
        expect(afterPrice).toBeLessThan(before);
      }
    }
    expect(hits / runs).toBeGreaterThan(0.03);
    expect(hits / runs).toBeLessThan(0.08);
  });

  it("is announced in the log and in the state when it hits", () => {
    let seed = 1;
    while (!stepMarket(withSeed(seed)).market.headline) {
      seed++;
    }
    const sc = given()
      .securities()
      .settings({ securitiesDividends: false }) // the dividend event would draw from the same rng
      .tweak((s) => {
        s.current = 1;
        s.phase = awaitEndTurn;
        s.rng = seed;
      })
      .when("Ben")
      .endsTurn();
    sc.then()
      .that((s) => {
        expect(s.market?.headline?.round).toBe(2);
        expect(s.log.some((e) => e.msg?.key.startsWith("log.headline."))).toBe(true);
      })
      .emitted("market", {});
  });
});

describe("Securities: server and Zod contracts", () => {
  it("keeps legalActions consistent with applyAction for securities", () => {
    const s = createGame("g", players(2), { ...DEFAULT_SETTINGS, securities: true }, 7, 1000).state;
    expect(legalActions(s, "p0")).toContain("buy-securities");
    expect(() =>
      applyAction(s, "p0", { type: "buy-securities", secId: PILATUS, shares: 1 }, 2000),
    ).not.toThrow();
  });
});
