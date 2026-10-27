import { BOARD } from "../src/board.ts";
import { CARDS } from "../src/cards.ts";
import { applyAction, legalActions, whoMustAct } from "../src/game.ts";
import { groupTiles } from "../src/helpers.ts";
import { LANGS, formatMessage } from "../src/i18n/index.ts";
import { HISTORY_LENGTH, MAX_PRICE, SECURITY_SECTORS } from "../src/securities.ts";
import { LOAN_RATE_CURVE, LOAN_STEP, loanDebt, loanLimit, loanRoom } from "../src/loans.ts";
import { getTheme } from "../src/themes/index.ts";
import { MAX_COUNTERS } from "../src/types.ts";
import type { GameAction, GameState, PlayerId, TradeOffer } from "../src/types.ts";

export interface InvariantContext {
  /** time of the last applied action; deadline must be strictly after it */
  lastNow?: number;
  /** version before the step (version must be strictly greater) */
  prevVersion?: number;
  /** stored games from before log messages were structured: entries may lack `msg` (additive field) */
  legacyLog?: boolean;
}

const MAX_LOG = 200;
/** entries appended by one step are always within this tail; checking all 200 each step is slow */
const LOG_CHECK_TAIL = 12;
const JAIL_CARD_IDS = CARDS.filter((c) => c.effect.kind === "jail-card").map((c) => c.id);

function fail(s: GameState, msg: string): never {
  throw new Error(`Invariant violated (v${s.version}, phase ${s.phase.type}): ${msg}`);
}

function check(s: GameState, cond: boolean, msg: string): void {
  if (!cond) {
    fail(s, msg);
  }
}

export function assertInvariants(s: GameState, ctx: InvariantContext = {}): void {
  const ids = new Set<PlayerId>();
  const byId = new Map(s.players.map((p) => [p.id, p]));
  const debtor = s.phase.type === "debt" ? s.phase.debtor : null;

  // ---- log: structured message and legacy German text stay in sync
  const names = {
    player: (id: string) => byId.get(id)?.name ?? `?${id}`,
    tile: (i: number) => `Feld ${i}`,
    security: (id: string) =>
      getTheme(s.settings.themeId).securities.find((c) => c.id === id)?.name ?? id,
  };
  for (const entry of s.log.slice(-LOG_CHECK_TAIL)) {
    check(
      s,
      ctx.legacyLog === true || entry.msg !== undefined,
      `log entry without msg: ${entry.text}`,
    );
    if (entry.msg) {
      check(
        s,
        formatMessage("de", entry.msg, names) === entry.text,
        `log msg ${entry.msg.key} renders differently from text "${entry.text}"`,
      );
      for (const lang of LANGS) {
        const out = formatMessage(lang, entry.msg, names);
        check(s, !/\{\w+\}/.test(out), `unfilled placeholder in ${lang}: ${out}`);
      }
    }
  }

  // ---- players
  for (const p of s.players) {
    check(s, !ids.has(p.id), `duplicate player ${p.id}`);
    ids.add(p.id);
    check(s, Number.isInteger(p.cash), `${p.id} cash not an integer: ${p.cash}`);
    if (p.id !== debtor) {
      check(s, p.cash >= 0, `${p.id} has negative cash ${p.cash} outside debt`);
    }
    check(
      s,
      Number.isInteger(p.position) && p.position >= 0 && p.position < BOARD.length,
      `${p.id} position ${p.position}`,
    );
    if (p.bankrupt) {
      check(s, p.cash === 0, `bankrupt ${p.id} has cash`);
      check(s, p.jailCards.length === 0, `bankrupt ${p.id} holds jail cards`);
      check(s, !p.inJail, `bankrupt ${p.id} is in jail`);
    }
    if (p.inJail) {
      check(s, p.position === 13, `${p.id} in jail but at ${p.position}`);
    }
    check(s, p.jailTurns >= 0 && p.jailTurns < 3, `${p.id} jailTurns ${p.jailTurns}`);
    check(s, p.missedTurns >= 0, `${p.id} missedTurns`);
  }
  assertSecuritiesInvariants(s);
  assertLoanInvariants(s);
  check(s, Number.isInteger(s.freeParkingPot) && s.freeParkingPot >= 0, `pot ${s.freeParkingPot}`);
  if (!s.settings.freeParkingJackpot) {
    check(s, s.freeParkingPot === 0, "pot filled without jackpot setting");
  }

  // ---- properties & buildings
  let houses = 0;
  let hotels = 0;
  let sky = 0;
  for (const t of BOARD) {
    const pr = s.properties[t.index];
    const buyable = t.kind === "street" || t.kind === "station" || t.kind === "utility";
    check(s, buyable === (pr !== undefined), `property record mismatch at ${t.index}`);
    if (!pr) {
      continue;
    }
    if (pr.owner !== null) {
      const o = byId.get(pr.owner);
      check(s, o !== undefined, `tile ${t.index} owner ${pr.owner} unknown`);
      check(s, !o!.bankrupt, `tile ${t.index} owned by bankrupt ${pr.owner}`);
    } else {
      check(s, !pr.mortgaged && pr.level === 0, `unowned tile ${t.index} mortgaged/built`);
    }
    check(
      s,
      Number.isInteger(pr.level) && pr.level >= 0 && pr.level <= 6,
      `tile ${t.index} level ${pr.level}`,
    );
    if (t.kind !== "street") {
      check(s, pr.level === 0, `non-street ${t.index} has level`);
      continue;
    }
    if (pr.level >= 1 && pr.level <= 4) {
      houses += pr.level;
    } else if (pr.level === 5) {
      hotels++;
    } else if (pr.level === 6) {
      sky++;
    }
  }
  for (let g = 0; g < 10; g++) {
    const tiles = groupTiles(g);
    const levels = tiles.map((i) => s.properties[i]!.level);
    const anyBuilt = levels.some((l) => l > 0);
    if (tiles.some((i) => s.properties[i]!.mortgaged)) {
      check(s, !anyBuilt, `group ${g}: mortgaged tile together with buildings`);
    }
    if (anyBuilt) {
      const owner = s.properties[tiles[0]!]!.owner;
      check(
        s,
        owner !== null && tiles.every((i) => s.properties[i]!.owner === owner),
        `group ${g}: buildings without full ownership`,
      );
      if (s.settings.evenBuild) {
        check(
          s,
          Math.max(...levels) - Math.min(...levels) <= 1,
          `group ${g}: uneven levels ${levels.join(",")}`,
        );
      }
    }
    if (levels.some((l) => l === 6)) {
      check(
        s,
        levels.every((l) => l >= 5),
        `group ${g}: skyscraper without hotels ${levels.join(",")}`,
      );
    }
  }
  const lim = s.settings.buildingLimits;
  check(
    s,
    s.bank.houses >= 0 && s.bank.hotels >= 0 && s.bank.skyscrapers >= 0,
    `negative bank stock ${JSON.stringify(s.bank)}`,
  );
  check(
    s,
    houses + s.bank.houses === lim.houses,
    `houses ${houses}+${s.bank.houses} != ${lim.houses}`,
  );
  check(
    s,
    hotels + s.bank.hotels === lim.hotels,
    `hotels ${hotels}+${s.bank.hotels} != ${lim.hotels}`,
  );
  check(
    s,
    sky + s.bank.skyscrapers === lim.skyscrapers,
    `skyscrapers ${sky}+${s.bank.skyscrapers} != ${lim.skyscrapers}`,
  );

  // ---- cards: nothing lost or duplicated
  const held = s.players.flatMap((p) => p.jailCards);
  for (const deck of ["chance", "community"] as const) {
    const expected = CARDS.filter((c) => c.deck === deck).map((c) => c.id);
    const have = [...s.decks[deck], ...held.filter((id) => expected.includes(id))];
    check(
      s,
      have.length === expected.length,
      `${deck}: ${have.length} cards, expected ${expected.length}`,
    );
    check(s, new Set(have).size === have.length, `${deck}: duplicate card`);
    check(
      s,
      expected.every((id) => have.includes(id)),
      `${deck}: card missing`,
    );
  }
  check(s, new Set(held).size === held.length, "duplicate held jail card");
  check(
    s,
    held.every((id) => JAIL_CARD_IDS.includes(id)),
    "held card is not a jail card",
  );

  // ---- phase / actors
  check(s, s.current >= 0 && s.current < s.players.length, "current out of range");
  if (s.status === "running") {
    const cur = s.players[s.current]!;
    check(s, !cur.bankrupt, "current player is bankrupt");
    check(s, s.phase.type !== "game-over", "running game with game-over phase");
    const actors = whoMustAct(s);
    check(s, actors.length > 0, "nobody must act");
    for (const a of actors) {
      check(s, byId.get(a)?.bankrupt === false, `actor ${a} unknown/bankrupt`);
    }
    if (s.phase.type === "debt") {
      const debtor = byId.get(s.phase.debtor);
      check(
        s,
        s.phase.auctionTile !== undefined
          ? debtor?.bankrupt === false && s.phase.creditor === null
          : s.phase.debtor === cur.id,
        "debtor is not the current player",
      );
      check(s, s.phase.amount > 0 && Number.isInteger(s.phase.amount), "debt amount");
      check(
        s,
        s.phase.creditor === null || byId.get(s.phase.creditor)?.bankrupt === false,
        "creditor invalid",
      );
      check(s, (debtor?.cash ?? 0) < s.phase.amount, "debt is already covered");
    }
    if (s.phase.type === "auction") {
      const a = s.phase.auction;
      check(s, a.bidders.length > 0, "auction without bidders");
      check(s, new Set(a.bidders).size === a.bidders.length, "auction duplicate bidders");
      check(
        s,
        a.bidders.every((b) => byId.get(b)?.bankrupt === false),
        "auction bidder bankrupt",
      );
      check(s, a.bidders.includes(a.turn), "auction turn not a bidder");
      check(
        s,
        a.highestBidder === null || a.bidders.includes(a.highestBidder),
        "highest bidder not a bidder",
      );
      check(
        s,
        (a.highestBidder === null) === (a.highestBid === 0),
        "highest bid / bidder mismatch",
      );
      check(s, s.properties[a.tile]?.owner === null, "auctioned tile is owned");
      for (const [pid, max] of Object.entries(a.autoBids ?? {})) {
        check(s, a.bidders.includes(pid), "auto-bid of a player outside the auction");
        check(s, Number.isInteger(max) && max > 0, "auto-bid is not a positive integer");
      }
      check(
        s,
        a.autoBids?.[a.turn] === undefined || a.highestBidder === a.turn,
        "auto-bidder left holding the turn",
      );
    }
    if (s.phase.type === "await-buy") {
      check(s, s.properties[s.phase.tile]?.owner === null, "await-buy on owned tile");
    }
    // deadline
    const actor = byId.get(actors[0]!)!;
    const expectNull = s.settings.turnTimeoutSec <= 0 || actor.controller !== "human";
    if (expectNull) {
      check(
        s,
        s.deadline === null,
        `deadline ${s.deadline} but actor ${actor.id} is ${actor.controller} (timeout ${s.settings.turnTimeoutSec})`,
      );
    } else {
      check(s, s.deadline !== null, `no deadline for human actor ${actor.id}`);
      if (ctx.lastNow !== undefined) {
        check(s, s.deadline! > ctx.lastNow, `deadline ${s.deadline} not after ${ctx.lastNow}`);
      }
    }
  } else {
    check(s, s.phase.type === "game-over", "finished game without game-over phase");
    check(s, s.deadline === null, "finished game has deadline");
    check(s, whoMustAct(s).length === 0, "finished game has actors");
    const winner = s.phase.type === "game-over" ? s.phase.winner : null;
    if (winner !== null) {
      check(s, byId.get(winner)?.bankrupt === false, "winner is bankrupt");
    }
  }
  check(
    s,
    s.players.filter((p) => !p.bankrupt).length >= (s.status === "running" ? 2 : 1),
    "too few active players",
  );

  // ---- trades
  const tradeIds = new Set<string>();
  for (const t of s.trades) {
    check(s, !tradeIds.has(t.id), `duplicate trade id ${t.id}`);
    tradeIds.add(t.id);
    if (t.status === "pending") {
      check(
        s,
        byId.get(t.from)?.bankrupt === false,
        `pending trade from missing/bankrupt ${t.from}`,
      );
      check(s, byId.get(t.to)?.bankrupt === false, `pending trade to missing/bankrupt ${t.to}`);
      check(s, t.from !== t.to, "trade with self");
    }
    const depth = t.counterDepth ?? 0;
    check(s, depth >= 0 && depth <= MAX_COUNTERS, `counter chain too long (${depth}) on ${t.id}`);
    check(s, (t.counterOf !== undefined) === depth > 0, `counter link/depth mismatch on ${t.id}`);
    if (t.counterOf !== undefined) {
      const prev = s.trades.find((x) => x.id === t.counterOf);
      check(s, prev === undefined || prev.status === "countered", `${t.id} answers an open offer`);
      check(
        s,
        prev === undefined || (prev.counterDepth ?? 0) + 1 === depth,
        `${t.id} depth does not follow ${t.counterOf}`,
      );
      check(
        s,
        prev === undefined || (prev.from === t.to && prev.to === t.from),
        "counter not reversed",
      );
    }
    if (t.status === "countered") {
      check(
        s,
        s.trades.filter((x) => x.counterOf === t.id).length === 1,
        `countered trade ${t.id} needs exactly one answer`,
      );
    }
  }
  check(
    s,
    s.trades.filter((t) => t.status === "pending").length <= s.players.length * 5,
    "too many pending trades",
  );

  // ---- end-game vote
  if (s.endVote) {
    const v = s.endVote;
    check(s, s.status === "running", "end vote in a finished game");
    check(s, byId.has(v.by), `end vote by unknown ${v.by}`);
    check(
      s,
      Object.keys(v.votes).every((id) => byId.has(id)),
      "end vote of unknown player",
    );
    check(s, v.votes[v.by] === true, "proposer does not agree to their own vote");
    check(s, !Object.values(v.votes).includes(false), "a refused end vote is still pending");
    const voters = s.players.filter((p) => !p.bankrupt);
    check(s, !voters.every((p) => v.votes[p.id] === true), "unanimous end vote still pending");
    check(
      s,
      voters.every((p) => p.controller === "human" || v.votes[p.id] === true),
      "bot/away player has not agreed automatically",
    );
    check(s, v.expiresAt === null || v.expiresAt > v.createdAt, "end vote expires before creation");
  }
  for (const round of Object.values(s.endVoteCooldown ?? {})) {
    check(s, Number.isInteger(round) && round >= 1, `end vote cooldown round ${round}`);
  }
  if (s.phase.type === "game-over" && s.phase.results !== undefined) {
    const results = s.phase.results;
    check(s, results.length === s.players.length, "results do not cover every player");
    check(
      s,
      results.every((r, i) => r.rank === i + 1),
      "result ranks are not 1..n",
    );
    check(s, results[0]?.bankrupt === false || s.phase.winner === null, "bankrupt result on top");
    check(
      s,
      (results[0]?.playerId ?? null) === s.phase.winner || s.phase.winner === null,
      "winner is not first",
    );
    for (let i = 1; i < results.length; i++) {
      const a = results[i - 1]!;
      const b = results[i]!;
      check(s, a.bankrupt === b.bankrupt ? a.total >= b.total : !a.bankrupt, "results not sorted");
    }
  }

  // ---- bookkeeping
  check(s, s.log.length <= MAX_LOG, `log has ${s.log.length} entries`);
  if (ctx.prevVersion !== undefined) {
    check(s, s.version > ctx.prevVersion, `version ${s.version} not above ${ctx.prevVersion}`);
  }
  check(s, s.round >= 1, "round < 1");
}

/** Show-off mode: debt only with the mode, never negative or above the limit, rates within bounds. */
function assertLoanInvariants(s: GameState): void {
  check(s, typeof s.settings.loans === "boolean", "loans setting");
  for (const p of s.players) {
    const loans = p.loans;
    if (loans === undefined) {
      continue;
    }
    check(s, s.settings.loans, `${p.id} has loans without the show-off mode`);
    check(s, !p.bankrupt, `bankrupt ${p.id} still owes the bank`);
    check(s, loans.length > 0, `${p.id} has an empty loan list`);
    const rates = new Set<number>();
    for (const t of loans) {
      check(s, Number.isInteger(t.amount) && t.amount > 0, `${p.id} tranche amount ${t.amount}`);
      check(s, t.amount % LOAN_STEP === 0, `${p.id} tranche not in steps: ${t.amount}`);
      check(
        s,
        Number.isInteger(t.ratePct) &&
          t.ratePct >= LOAN_RATE_CURVE.poorest &&
          t.ratePct <= LOAN_RATE_CURVE.richest,
        `${p.id} rate ${t.ratePct} out of bounds`,
      );
      check(s, !rates.has(t.ratePct), `${p.id} has two tranches at ${t.ratePct} %`);
      rates.add(t.ratePct);
    }
    const debt = loanDebt(p);
    check(s, debt > 0 && debt <= loanLimit(s), `${p.id} debt ${debt} above the limit`);
  }
  if (s.phase.type === "debt" && s.phase.loanInterest === true) {
    check(s, s.phase.creditor === null, "interest is owed to the bank");
    check(s, s.phase.auctionTile === undefined, "interest debt is not an auction debt");
  }
}

/** Securities mode: the market exists exactly when the mode is on; prices, history and lots are sane. */
function assertSecuritiesInvariants(s: GameState): void {
  check(s, (s.market !== undefined) === s.settings.securities, "market present iff securities on");
  const lock = s.settings.securitiesLockRounds;
  check(s, Number.isInteger(lock) && lock >= 1 && lock <= 10, `lock rounds ${lock}`);
  check(s, typeof s.settings.securitiesDividends === "boolean", "securitiesDividends setting");
  for (const p of s.players) {
    const d = p.dividends;
    check(s, d === undefined || (Number.isInteger(d) && d >= 0), "dividends total of a player");
    check(
      s,
      d === undefined || (s.settings.securities && s.settings.securitiesDividends),
      "dividends paid without the rule",
    );
  }
  const m = s.market;
  if (!m) {
    check(
      s,
      s.players.every((p) => p.holdings === undefined),
      "holdings without a market",
    );
    return;
  }
  const companies = getTheme(s.settings.themeId).securities;
  check(
    s,
    Object.keys(m.prices).sort().join() ===
      companies
        .map((c) => c.id)
        .sort()
        .join(),
    "market prices do not match the theme's securities",
  );
  for (const [id, price] of Object.entries(m.prices)) {
    check(
      s,
      Number.isInteger(price) && price >= 1 && price <= MAX_PRICE,
      `price of ${id}: ${price}`,
    );
    const hist = m.history[id] ?? [];
    check(s, hist.length >= 1 && hist.length <= HISTORY_LENGTH, `history length of ${id}`);
    check(s, hist.at(-1) === price, `history of ${id} does not end at the price`);
    check(
      s,
      hist.every((h) => Number.isInteger(h) && h >= 1),
      `history of ${id} has bad entries`,
    );
  }
  for (const v of Object.values(m.activity)) {
    check(s, Number.isInteger(v) && v >= 0, "market activity counter");
  }
  if (m.headline) {
    check(s, SECURITY_SECTORS.includes(m.headline.sector), "headline sector");
    check(
      s,
      companies.find((c) => c.id === m.headline?.secId)?.sector === m.headline.sector,
      "headline sector does not match its company",
    );
    check(s, m.headline.round <= s.round, "headline from the future");
  }
  for (const p of s.players) {
    for (const h of p.holdings ?? []) {
      check(s, m.prices[h.secId] !== undefined, `${p.id} holds unknown ${h.secId}`);
      check(s, Number.isInteger(h.shares) && h.shares >= 1, `${p.id} lot with ${h.shares} shares`);
      check(s, Number.isInteger(h.buyPrice) && h.buyPrice >= 1, `${p.id} lot buy price`);
      check(
        s,
        h.boughtRound >= 1 && h.boughtRound <= s.round,
        `${p.id} lot bought in round ${h.boughtRound}`,
      );
    }
    if (p.bankrupt) {
      check(s, (p.holdings ?? []).length === 0, `bankrupt ${p.id} holds securities`);
    }
  }
}

// ------------------------------------------------------------------ legal action probing

/** Plausible concrete instances of an action type for `pid`. */
export function candidates(s: GameState, pid: PlayerId, type: GameAction["type"]): GameAction[] {
  const me = s.players.find((p) => p.id === pid)!;
  const others = s.players.filter((p) => p.id !== pid && !p.bankrupt);
  switch (type) {
    case "roll":
    case "pay-jail-fine":
    case "use-jail-card":
    case "buy":
    case "decline-buy":
    case "pass-auction":
    case "end-turn":
    case "declare-bankruptcy":
    case "propose-end-game":
      return [{ type }];
    case "vote-end-game":
      return [
        { type, accept: true },
        { type, accept: false },
      ];
    case "buy-securities": {
      const ids = Object.keys(s.market?.prices ?? {});
      return ids.flatMap((secId) => [
        { type, secId, shares: 1 },
        { type, secId, shares: 5 },
      ]);
    }
    case "sell-securities":
      return (me.holdings ?? []).flatMap((h, lot) => [
        { type, secId: h.secId, lot },
        { type, secId: h.secId, lot: "all" as const },
      ]);
    case "take-loan": {
      const room = loanRoom(s, me);
      return [
        { type, amount: LOAN_STEP },
        { type, amount: Math.max(LOAN_STEP, room) },
        { type, amount: room + LOAN_STEP },
      ];
    }
    case "repay-loan": {
      const debt = loanDebt(me);
      return [
        { type, amount: LOAN_STEP },
        { type, amount: Math.max(LOAN_STEP, debt) },
        { type, amount: debt + LOAN_STEP },
      ];
    }
    case "set-auto-bid": {
      const hb = s.phase.type === "auction" ? s.phase.auction.highestBid : 0;
      return [
        { type, max: null },
        { type, max: hb + 1 },
      ];
    }
    case "bid": {
      const hb = s.phase.type === "auction" ? s.phase.auction.highestBid : 0;
      return [
        { type, amount: hb + 1 },
        { type, amount: Math.max(hb + 1, Math.min(me.cash, hb + 20)) },
      ];
    }
    case "build":
    case "sell-building":
    case "mortgage":
    case "unmortgage":
      return BOARD.filter((t) => s.properties[t.index]?.owner === pid).map((t) => ({
        type,
        tile: t.index,
      }));
    case "respond-trade":
      return s.trades
        .filter((t) => t.status === "pending" && t.to === pid)
        .flatMap((t) => [
          { type, tradeId: t.id, accept: false },
          { type, tradeId: t.id, accept: true },
        ]);
    case "counter-trade":
      return s.trades
        .filter((t) => t.status === "pending" && t.to === pid)
        .flatMap((t) => {
          const back = (over: Partial<TradeOffer>): GameAction => ({
            type,
            tradeId: t.id,
            offer: {
              to: t.from,
              giveCash: 0,
              giveTiles: [],
              giveJailCards: 0,
              wantCash: 0,
              wantTiles: [],
              wantJailCards: 0,
              ...over,
            },
          });
          return [
            // the same deal reversed with a different price, a plain cash ask, and a nonsense one
            back({ giveTiles: t.wantTiles, wantTiles: t.giveTiles, wantCash: t.giveCash + 10 }),
            back({ giveTiles: t.wantTiles, wantTiles: t.giveTiles, giveCash: t.wantCash }),
            back({ wantCash: 1 }),
            back({ giveCash: 1 }),
          ];
        });
    case "cancel-trade":
      return s.trades
        .filter((t) => t.status === "pending" && t.from === pid)
        .map((t) => ({ type, tradeId: t.id }));
    case "propose-trade": {
      const out: GameAction[] = [];
      const empty = (to: PlayerId): TradeOffer => ({
        to,
        giveCash: 0,
        giveTiles: [],
        giveJailCards: 0,
        wantCash: 0,
        wantTiles: [],
        wantJailCards: 0,
      });
      for (const o of others) {
        out.push({ type, offer: { ...empty(o.id), giveCash: 1 } });
        out.push({ type, offer: { ...empty(o.id), wantCash: 1 } });
        const mine = BOARD.find(
          (t) =>
            s.properties[t.index]?.owner === pid &&
            applyOk(s, pid, { type, offer: { ...empty(o.id), giveTiles: [t.index] } }),
        );
        if (mine) {
          out.push({ type, offer: { ...empty(o.id), giveTiles: [mine.index] } });
        }
        const theirs = BOARD.find((t) => s.properties[t.index]?.owner === o.id);
        if (theirs) {
          out.push({ type, offer: { ...empty(o.id), wantTiles: [theirs.index] } });
        }
      }
      return out;
    }
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

export function applyOk(s: GameState, pid: PlayerId, a: GameAction): boolean {
  try {
    applyAction(s, pid, a, (s.log[s.log.length - 1]?.at ?? 0) + 1);
    return true;
  } catch {
    return false;
  }
}

const ALL_TYPES: GameAction["type"][] = [
  "roll",
  "pay-jail-fine",
  "use-jail-card",
  "buy",
  "decline-buy",
  "bid",
  "pass-auction",
  "set-auto-bid",
  "build",
  "sell-building",
  "mortgage",
  "unmortgage",
  "buy-securities",
  "sell-securities",
  "take-loan",
  "repay-loan",
  "propose-trade",
  "respond-trade",
  "counter-trade",
  "cancel-trade",
  "end-turn",
  "declare-bankruptcy",
  "propose-end-game",
  "vote-end-game",
];

/**
 * Every listed action type must have an instance applyAction accepts;
 * unlisted types must have no accepted instance.
 */
export function assertLegalActionsConsistent(s: GameState, pid: PlayerId): void {
  if (s.status !== "running") {
    return;
  }
  const listed = new Set(legalActions(s, pid));
  for (const type of ALL_TYPES) {
    const cands = candidates(s, pid, type);
    const accepted = cands.some((a) => applyOk(s, pid, a));
    if (listed.has(type)) {
      if (!accepted) {
        fail(
          s,
          `legalActions lists ${type} for ${pid} but no instance is accepted (${cands.length} tried)`,
        );
      }
    } else if (accepted) {
      fail(s, `${type} accepted for ${pid} although legalActions does not list it`);
    }
  }
}
