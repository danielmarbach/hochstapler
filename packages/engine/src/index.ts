// Public API of @poly/engine. Signatures are the contract; implementations live in sibling modules.
export * from "./types.ts";
export * from "./theme-types.ts";
export * from "./theme-text.ts"; // themeText(theme, lang): texts with fallback to German
export * from "./i18n/index.ts"; // Lang, LANGS, EngineMsgKey, formatMessage, ...
export * from "./protocol.ts";
export * from "./pow.ts"; // proof-of-work bot challenge: ALTCHA v2 format, solver, header codec (docs/DESIGN.md #70)
export * from "./chat.ts"; // chat modes, quick messages, reject reasons, host settings (docs/DESIGN.md #69)
export * from "./cards.ts";
export * from "./schemas.ts"; // zod schemas — use safeParse at every server trust boundary
export * from "./state-schema.ts"; // GameStateSchema: full validation of the persisted state
export * from "./stored.ts"; // StoredLobby/StoredSeat + schemas (what the server persists per game)
export * from "./migrations.ts"; // CURRENT_STATE_VERSION, migrateState: stored state JSON -> GameState

// Implemented by the engine work package:
export { BOARD } from "./board.ts"; // TileDef[52]
export { createGame } from "./game.ts"; // (id, players: NewPlayer[], settings: GameSettings, seed: number, now: number) => ApplyResult
export { applyAction, applyBotAction } from "./game.ts"; // (state, playerId, action, now) => ApplyResult, throws GameError; applyBotAction keeps controller 'away' (server bot steps)
export { handleTimeout } from "./game.ts"; // (state, now) => ApplyResult — bot acts for whoever timed out; bumps missedTurns/away
export { whoMustAct } from "./game.ts"; // (state) => PlayerId[] — players whose decision blocks the game
export { legalActions } from "./game.ts"; // (state, playerId) => GameAction['type'][] — for UI buttons
export { redactState } from "./game.ts"; // (state) => PublicGameState
export { restartClocks } from "./game.ts"; // (state, now) => ApplyResult — fresh clocks after a game waited for its players
export { setController } from "./game.ts"; // (state, playerId, controller) => ApplyResult — e.g. away -> human on return
export { chooseBotAction, chooseBotTradeResponses } from "./bot.ts";
// chooseBotAction(state, playerId) => GameAction | null
// chooseBotTradeResponses(state, playerId) => GameAction[] (respond-trade for pending trades addressed to the bot)
export * from "./helpers.ts"; // netWorth, groupTiles, ownsGroup, canBuild, rentFor, formatMoney(theme, n) ...
export { THEMES, getTheme } from "./themes/index.ts"; // Record<string, Theme>, (id) => Theme
export * from "./result.ts";
export * from "./securities.ts"; // Wertpapiere: price model, lock-up, portfolio helpers (docs/DESIGN.md #48)
