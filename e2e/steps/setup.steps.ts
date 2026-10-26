// "Given": the starting position of a scenario. Games are created through the REST API (fast), the rest of the
// scenario runs through the UI. The test-mode endpoints provide dice sequences and fixtures.
import type { GameSettings } from "@poly/engine";
import { Given, cardByName } from "../support/fixtures.ts";
import type { World } from "../support/fixtures.ts";

async function startGame(
  world: World,
  host: string,
  guest: string,
  themeId: string,
  options: {
    turnTimeoutSec?: number;
    bots?: number;
    settings?: Partial<GameSettings>;
  } = {},
): Promise<void> {
  world.themeId = themeId;
  const bots = options.bots ?? 0;
  const hostSeat = await world.api.createGame({
    host,
    settings: { themeId, turnTimeoutSec: options.turnTimeoutSec ?? 0, ...options.settings },
    bots: Array.from({ length: bots }, () => "normal" as const),
    maxPlayers: 2 + bots,
  });
  const guestSeat = await world.api.join(hostSeat, guest);
  await world.api.start(hostSeat);
  world.game = hostSeat;
  world.seats.set(host, hostSeat);
  world.seats.set(guest, guestSeat);
  for (const [name, seat] of [
    [host, hostSeat],
    [guest, guestSeat],
  ] as const) {
    const actor = await world.actor(name);
    await actor.openGame(seat.gameId, seat.token, seat.inviteCode);
  }
  for (const name of [host, guest]) {
    await world.get(name).testId("hud").waitFor();
  }
}

Given(
  "{player} and {player} play a game in {country}",
  async ({ world }, host: string, guest: string, themeId: string) => {
    await startGame(world, host, guest, themeId);
  },
);

Given(
  "{player} and {player} play a game in {country} with a time limit of {int} seconds",
  async ({ world }, host: string, guest: string, themeId: string, seconds: number) => {
    await startGame(world, host, guest, themeId, { turnTimeoutSec: seconds });
  },
);

Given(
  "{player} and {player} play a game in {country} with securities and a lock period of {int} rounds",
  async ({ world }, host: string, guest: string, themeId: string, lock: number) => {
    await startGame(world, host, guest, themeId, {
      settings: { securities: true, securitiesLockRounds: lock },
    });
  },
);

Given(
  "{player} and {player} play a game in {country} with securities and dividends switched off",
  async ({ world }, host: string, guest: string, themeId: string) => {
    await startGame(world, host, guest, themeId, {
      settings: { securities: true, securitiesDividends: false },
    });
  },
);

Given("it is {player}'s turn", async ({ world }, name: string) => {
  await world.patch({ current: world.playerId(name), phase: { type: "await-roll" } });
});

Given("it is {player}'s turn and the dice have been rolled", async ({ world }, name: string) => {
  await world.patch({
    current: world.playerId(name),
    phase: { type: "await-end-turn", canRollAgain: false },
  });
});

Given("the dice sequence is {rolls}", async ({ world }, rolls: [number, number][]) => {
  await world.api.queueDice(world.gameId, rolls);
});

Given("{player} has cash of {amount}", async ({ world }, name: string, amount: number) => {
  await world.patch({ players: { [world.playerId(name)]: { cash: amount } } });
});

Given("{player} stands on {string}", async ({ world }, name: string, tile: string) => {
  await world.patch({ players: { [world.playerId(name)]: { position: world.tileIndex(tile) } } });
});

Given("{player} already owns {streets}", async ({ world }, name: string, tiles: string[]) => {
  await world.setProperties(tiles, { owner: world.playerId(name) });
});

Given("on {streets} there is/are {building}", async ({ world }, tiles: string[], level: number) => {
  await world.setProperties(tiles, { level: level as 0 | 1 | 2 | 3 | 4 | 5 | 6 });
});

Given("{streets} is/are mortgaged", async ({ world }, tiles: string[]) => {
  await world.setProperties(tiles, { mortgaged: true });
});

Given("{player} is sitting in jail", async ({ world }, name: string) => {
  await world.patch({
    players: { [world.playerId(name)]: { inJail: true, position: 13, jailTurns: 0 } },
  });
});

Given("the next card from the deck is {string}", async ({ world }, card: string) => {
  const { deck, id } = cardByName(card);
  await world.patch({ nextCard: { [deck]: id } });
});

Given(
  "{player} owes {player} {amount}",
  async ({ world }, debtor: string, creditor: string, amount: number) => {
    await world.patch({
      current: world.playerId(debtor),
      phase: {
        type: "debt",
        debtor: world.playerId(debtor),
        creditor: world.playerId(creditor),
        amount,
      },
    });
  },
);

Given("{player} has already exceeded the time limit once", async ({ world }, name: string) => {
  await world.patch({ players: { [world.playerId(name)]: { missedTurns: 1 } } });
});

Given("the time runs out for {player} in one second", async ({ world }, name: string) => {
  await world.patch({
    current: world.playerId(name),
    phase: { type: "await-roll" },
    deadlineInMs: 1000,
  });
});

Given(
  "{player} plays in {country} against a bot",
  async ({ world }, host: string, themeId: string) => {
    world.themeId = themeId;
    const seat = await world.api.createGame({
      host,
      settings: { themeId, turnTimeoutSec: 0 },
      bots: ["normal"],
      maxPlayers: 2,
    });
    await world.api.start(seat);
    world.game = seat;
    world.seats.set(host, seat);
    world.seats.set("Heidi vom Pilatus", { ...seat, playerId: "p2" });
    const actor = await world.actor(host);
    await actor.openGame(seat.gameId, seat.token, seat.inviteCode);
    await actor.testId("hud").waitFor();
  },
);
