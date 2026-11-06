// The buy offer shows what the decision needs: rent, colour-group progress and the balance after buying.
import { expect } from "@playwright/test";
import { formatMoney } from "@poly/engine";
import { Then } from "../support/fixtures.ts";

Then(
  "{player} sees a rent of {amount} in the buy offer",
  async ({ world }, name: string, amount: number) => {
    await expect(world.get(name).testId("buy-rent")).toHaveText(
      `Miete ${formatMoney(world.theme, amount)}`,
    );
  },
);

Then(
  "{player} sees the colour progress {string} in the buy offer",
  async ({ world }, name: string, progress: string) => {
    await expect(world.get(name).testId("buy-group")).toHaveText(progress);
  },
);

Then(
  "{player} sees a balance of {amount} after buying in the buy offer",
  async ({ world }, name: string, amount: number) => {
    await expect(world.get(name).testId("buy-cash")).toHaveText(
      `danach ${formatMoney(world.theme, amount)}`,
    );
  },
);
