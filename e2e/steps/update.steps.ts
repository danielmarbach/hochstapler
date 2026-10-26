// Rolling out an update: a server just for this scenario is replaced like with `docker stop` / `docker compose up`.
import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures.ts";

/** sessionStorage key in which the client remembers the build it reloaded for (packages/client/src/net/ws.ts) */
const RELOAD_MARKER_KEY = "poly:reloadedFor";

Given("a dedicated server is running", async ({ world }) => {
  await world.useOwnServer();
});

When("the server is shut down for the update", async ({ world }) => {
  await world.ownServer?.stop();
});

When("the new version {string} has started", async ({ world }, build: string) => {
  await world.ownServer?.run(build);
});

Then("{player} sees the notice {string}", async ({ world }, name: string, text: string) => {
  await expect(world.get(name).toast(text)).toBeVisible();
});

Then(
  "{player} has reloaded the page for version {string}",
  async ({ world }, name: string, build: string) => {
    const page = world.get(name).page;
    await expect
      .poll(
        () =>
          page.evaluate((key) => sessionStorage.getItem(key), RELOAD_MARKER_KEY).catch(() => null),
        { timeout: 30_000 },
      )
      .toBe(build);
    await expect(world.get(name).testId("hud")).toBeVisible({ timeout: 30_000 });
  },
);

Then("the page of {player} stays put afterwards", async ({ world }, name: string) => {
  const page = world.get(name).page;
  await page.evaluate(() => Object.assign(window, { stayedPut: true }));
  // the loop guard: the page is still outdated (same dist, new announced build) but must not reload again
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => "stayedPut" in window)).toBe(true);
});
