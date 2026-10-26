// Board list (UI review T03): every field as a native button, readable without pointing at the 3D board.
import { expect } from "@playwright/test";
import { When, Then } from "../support/fixtures.ts";

When("{player} opens the board list", async ({ world }, name: string) => {
  await world.get(name).openBoard();
});

When("{player} opens the board entry {string}", async ({ world }, name: string, tile: string) => {
  await world.get(name).boardEntry(tile).click();
});

Then(
  "the board list for {player} shows {int} fields",
  async ({ world }, name: string, count: number) => {
    await expect(world.get(name).testId("board-tile")).toHaveCount(count);
  },
);

Then(
  "the board entry {string} for {player} shows {string}",
  async ({ world }, tile: string, name: string, text: string) => {
    await expect(world.get(name).boardEntry(tile)).toContainText(text);
  },
);

Then(
  "the board entry for field {int} for {player} shows {string}",
  async ({ world }, index: number, name: string, text: string) => {
    await expect(world.get(name).boardEntryAt(index)).toContainText(text);
  },
);
