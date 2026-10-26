// Blue/green handover: two server processes on the same data directory behind a balancer (docs/DESIGN.md writer-lease
// row). The second one takes the writer lease over; the balancer then sends the traffic to it.
import { Given, When } from "../support/fixtures.ts";

Given("a dedicated server behind a load balancer is running", async ({ world }) => {
  await world.useBalancedServer();
});

When("a new server instance takes over", async ({ world }) => {
  await world.handOver();
});
