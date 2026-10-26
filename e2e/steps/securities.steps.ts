// Securities (docs/DESIGN.md #48): steps for buying, lock period, selling and emergency sale.
// Everything players do or see runs through the UI (desktop: drawer, phone: menu tab);
// prices, positions and rounds are only set through the test-mode fixtures for "Given".
import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures.ts";

// ---- Given ----
Given(
  "{player} owns {int} shares of {string} at purchase price {amount} from round {int}",
  async (
    { world },
    name: string,
    shares: number,
    company: string,
    price: number,
    round: number,
  ) => {
    await world.addHolding(name, {
      secId: world.securityId(company),
      shares,
      buyPrice: price,
      boughtRound: round,
    });
  },
);

Given("it is round {int}", async ({ world }, round: number) => {
  await world.patch({ round });
});

Given("the price of {string} is at {amount}", async ({ world }, company: string, price: number) => {
  await world.patch({ market: { prices: { [world.securityId(company)]: price } } });
});

Given(
  "a headline reports a {word} of {string} by {int} percent",
  async ({ world }, kind: string, company: string, pct: number) => {
    await world.patch({
      market: {
        headline: {
          secId: world.securityId(company),
          kind: kind === "boom" ? "boom" : "crash",
          pct,
        },
      },
    });
  },
);

// ---- When ----
When(
  "{player} creates a game in {country} with securities and a lock period of {int} rounds on the start page",
  async ({ world }, host: string, themeId: string, lock: number) => {
    world.themeId = themeId;
    const actor = await world.actor(host);
    await actor.page.goto("/");
    await actor.page.getByRole("textbox", { name: "Dein Name" }).fill(host);
    await actor.page.locator(`[data-testid="country"][data-theme="${themeId}"]`).click();
    // the house rules are folded away until opened
    await actor.testId("rules-toggle").click();
    await expect(actor.testId("securities-lock")).toBeHidden();
    await actor.testId("toggle-securities").click();
    await expect(actor.testId("lock-rounds")).toHaveText("3");
    for (let rounds = 3; rounds < lock; rounds++) {
      await actor.testId("lock-plus").click();
    }
    await expect(actor.testId("lock-rounds")).toHaveText(String(lock));
    await actor.testId("create-game").click();
    await expect(actor.testId("start-game")).toBeVisible();
  },
);

When(
  "{player} creates a game in {country} with securities and dividends switched off on the start page",
  async ({ world }, host: string, themeId: string) => {
    world.themeId = themeId;
    const actor = await world.actor(host);
    await actor.page.goto("/");
    await actor.page.getByRole("textbox", { name: "Dein Name" }).fill(host);
    await actor.page.locator(`[data-testid="country"][data-theme="${themeId}"]`).click();
    await actor.testId("rules-toggle").click();
    await expect(actor.testId("toggle-dividends")).toBeHidden();
    await actor.testId("toggle-securities").click();
    // on by default and part of the house rules summary; switching it off removes it again
    await expect(actor.testId("rules-summary")).toContainText("Dividenden");
    await actor.testId("toggle-dividends").click();
    await expect(actor.testId("rules-summary")).not.toContainText("Dividenden");
    await actor.testId("create-game").click();
    await expect(actor.testId("start-game")).toBeVisible();
  },
);

When("{player} opens the securities", async ({ world }, name: string) => {
  await world.get(name).openSecurities();
});

When(
  "{player} buys {int} shares of {string}",
  async ({ world }, name: string, shares: number, company: string) => {
    const actor = world.get(name);
    await actor.openSecurities();
    const row = actor.securityRow(company);
    await row.getByTestId("security-buy-open").click();
    for (let n = 1; n < shares; n++) {
      await row.getByTestId("security-shares-plus").click();
    }
    await expect(row.getByTestId("security-shares")).toHaveText(String(shares));
    await row.getByTestId("security-buy-confirm").click();
    await expect(actor.lotRow(company)).toBeVisible();
  },
);

When("{player} sells the position {string}", async ({ world }, name: string, company: string) => {
  const actor = world.get(name);
  await actor.openSecurities();
  await actor.lotRow(company).getByTestId("lot-sell").click();
});

When(
  "{player} sells the position {string} as an emergency sale",
  async ({ world }, name: string, company: string) => {
    const actor = world.get(name);
    await actor.openSecurities();
    await actor.lotRow(company).getByTestId("lot-emergency-sell").click();
  },
);

// ---- Then ----
Then(
  "the lobby for {player} shows the notice {string}",
  async ({ world }, name: string, text: string) => {
    await expect(world.get(name).testId("lobby-securities")).toContainText(text);
  },
);

Then("{player} has no {string} section", async ({ world }, name: string, _area: string) => {
  const actor = world.get(name);
  await expect(actor.testId(actor.phone ? "sheet-tab-securities" : "open-securities")).toHaveCount(
    0,
  );
});

Then(
  "the price list for {player} shows {int} companies with price and price history",
  async ({ world }, name: string, count: number) => {
    const actor = world.get(name);
    await expect(actor.testId("security-row")).toHaveCount(count);
    await expect(actor.testId("security-price")).toHaveCount(count);
    await expect(actor.testId("security-spark")).toHaveCount(count);
    await expect(actor.testId("security-change")).toHaveCount(count);
  },
);

Then(
  "the price list for {player} shows the price {amount} for {string}",
  async ({ world }, name: string, price: number, company: string) => {
    const actor = world.get(name);
    await expect(actor.securityRow(company).getByTestId("security-price")).toHaveText(
      `CHF ${price}`,
    );
  },
);

Then(
  "{player} has {int} shares of {string} in the portfolio",
  async ({ world }, name: string, shares: number, company: string) => {
    const actor = world.get(name);
    await actor.openSecurities();
    await expect(actor.lotRow(company).getByTestId("lot-detail")).toContainText(`${shares} Stück`);
  },
);

Then(
  "the portfolio of {player} shows the lock {string} for {string}",
  async ({ world }, name: string, text: string, company: string) => {
    const actor = world.get(name);
    await actor.openSecurities();
    await expect(actor.lotRow(company).getByTestId("lot-lock")).toContainText(text);
  },
);

Then(
  "for {player} selling {string} is blocked with the hint {string}",
  async ({ world }, name: string, company: string, hint: string) => {
    const actor = world.get(name);
    await actor.openSecurities();
    const lot = actor.lotRow(company);
    await expect(lot.getByTestId("lot-sell")).toBeDisabled();
    await expect(lot.getByTestId("lot-blocker")).toContainText(hint);
  },
);

Then(
  "the portfolio of {player} shows a profit of {amount} for {string}",
  async ({ world }, name: string, amount: number, company: string) => {
    const actor = world.get(name);
    await actor.openSecurities();
    await expect(actor.lotRow(company).getByTestId("lot-pl")).toHaveText(`+CHF ${amount}`);
  },
);

Then(
  "the portfolio of {player} shows an emergency sale for {amount} for {string}",
  async ({ world }, name: string, amount: number, company: string) => {
    const actor = world.get(name);
    await actor.openSecurities();
    const lot = actor.lotRow(company);
    await expect(lot.getByTestId("lot-emergency-sell")).toContainText(`CHF ${amount}`);
    await expect(lot.getByTestId("lot-emergency-note")).toContainText("20 %");
  },
);

Then("the portfolio of {player} is empty", async ({ world }, name: string) => {
  const actor = world.get(name);
  await actor.openSecurities();
  await expect(actor.testId("portfolio-empty")).toBeVisible();
  await expect(actor.testId("lot-row")).toHaveCount(0);
});

Then("the round is {int}", async ({ world }, round: number) => {
  for (const actor of world.allActors()) {
    await expect(actor.testId(actor.phone ? "sheet" : "turn-banner")).toContainText(
      `Runde ${round}`,
    );
  }
});

Then(
  "the price of {string} for {player} has a history of {int} prices",
  async ({ world }, company: string, name: string, count: number) => {
    const actor = world.get(name);
    await actor.openSecurities();
    await expect(actor.securityRow(company).getByTestId("security-spark")).toHaveAttribute(
      "aria-label",
      new RegExp(`${count} Kurse`),
    );
  },
);

Then("{player} sees the headline {string}", async ({ world }, name: string, company: string) => {
  const banner = world.get(name).testId("securities-headline");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(company);
  await expect(banner).toHaveAttribute("data-kind", "crash");
});

// ---- dividends (docs/DESIGN.md #83) ----
Then(
  "the price list for {player} shows the yield {string} for {string}",
  async ({ world }, name: string, text: string, company: string) => {
    const actor = world.get(name);
    await actor.openSecurities();
    await expect(actor.securityRow(company).getByTestId("security-yield")).toHaveText(text);
  },
);

Then(
  "the dividend note for {player} says {string}",
  async ({ world }, name: string, text: string) => {
    const actor = world.get(name);
    await actor.openSecurities();
    await expect(actor.testId("dividend-decay")).toContainText(text);
  },
);

Then(
  "the portfolio of {player} shows an expected dividend of {amount}",
  async ({ world }, name: string, amount: number) => {
    const actor = world.get(name);
    await actor.openSecurities();
    await expect(actor.testId("dividend-expected")).toHaveText(`+CHF ${amount}`);
  },
);

Then(
  "the portfolio of {player} shows dividends received of {amount}",
  async ({ world }, name: string, amount: number) => {
    const actor = world.get(name);
    await actor.openSecurities();
    await expect(actor.testId("dividend-total")).toHaveText(`CHF ${amount}`);
  },
);

Then("{player} sees the note that dividends are switched off", async ({ world }, name: string) => {
  await expect(world.get(name).testId("dividends-off")).toContainText("ausgeschaltet");
});

Then("the portfolio of {player} shows no dividends", async ({ world }, name: string) => {
  const actor = world.get(name);
  await actor.openSecurities();
  await expect(actor.testId("dividend-summary")).toHaveCount(0);
});

Then(
  "the dividends received by {player} are above 0 and her balance is {int} plus that amount",
  async ({ world }, name: string, before: number) => {
    const actor = world.get(name);
    await actor.openSecurities();
    const total = actor.testId("dividend-total");
    await expect(total).not.toHaveText("CHF 0");
    const amount = Number((await total.innerText()).replace(/\D/g, ""));
    expect(amount).toBeGreaterThan(0);
    await actor.expectCash(name, before + amount, world.theme);
  },
);
