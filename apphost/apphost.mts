// Aspire AppHost for local development: `aspire run` (npm run aspire) starts the game server, the Vite client and the
// Aspire dashboard, with OpenTelemetry wired automatically (docs/DESIGN.md #71). Never used for production.
import { createBuilder } from "./.aspire/modules/aspire.mjs";

const builder = await createBuilder();

// Fixed ports on purpose: the Wi-Fi invite links, the README and the Vite proxy default all assume 8787 / 5173, and
// `npm run dev` keeps working unchanged. Stop one before starting the other.
const SERVER_PORT = 8787;
const CLIENT_PORT = 5173;

// Dependencies come from the root `npm ci --ignore-scripts` (AGENTS.md), so the per-resource `npm install` that Aspire
// would run is switched off (`withNpm({ install: false })`).
// The server is run through its own `dev` script (tsx watch). DATA_DIR is not set: the server falls back to the repo's
// normal `data/` directory, so local games survive. Aspire injects OTEL_EXPORTER_OTLP_ENDPOINT / _PROTOCOL / _HEADERS /
// OTEL_SERVICE_NAME, which the server's telemetry loader and the OTel Node SDK honour as they are.
const server = await builder
  .addJavaScriptApp("server", "../packages/server", { runScriptName: "dev" })
  .withHttpEndpoint({ port: SERVER_PORT, targetPort: SERVER_PORT, env: "PORT", isProxied: false })
  .withHttpHealthCheck({ path: "/api/themes" })
  .withNpm({ install: false });

// The client (Vite dev server) proxies /api and /ws to POLY_SERVER_URL (vite.config.ts), which Aspire fills in.
await builder
  .addViteApp("client", "../packages/client")
  .withHttpEndpoint({ port: CLIENT_PORT, targetPort: CLIENT_PORT, env: "PORT", isProxied: false })
  .withNpm({ install: false })
  .withEnvironment("POLY_SERVER_URL", await server.getEndpoint("http"))
  .waitFor(server);

await builder.build().run();
