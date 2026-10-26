import { defineConfig } from "vitest/config";

// The abuse limits (docs/DESIGN.md #59) would throttle suites that create hundreds of games from 127.0.0.1; they are
// effectively off here and get their own tests (test/abuse.test.ts passes explicit limits).
const OFF = "1000000";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 15000,
    env: {
      GAME_CREATE_PER_HOUR: OFF,
      GAME_CREATE_BURST: OFF,
      GAME_JOIN_PER_HOUR: OFF,
      GAME_JOIN_BURST: OFF,
      MAX_RUNNING_GAMES: OFF,
      MAX_OPEN_LOBBIES: OFF,
      WS_MAX_PER_IP: OFF,
      // one in-process instance per test server; the lease providers have their own tests (lease-*.test.ts,
      // handover.test.ts passes the file lease explicitly)
      WRITER_LEASE: "none",
    },
  },
});
