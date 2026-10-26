import { spawnSync } from "node:child_process";
import { createLogger, defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { e2eHooksDefine } from "./src/build-flags.ts";
import { devProxy } from "./src/dev-proxy.ts";

/**
 * Id of this build (docs/DESIGN.md #44): env BUILD_ID (Docker build arg), else `<git short sha>-<UTC timestamp>`
 * ("local" without git, e.g. inside the Docker build context). The server serves it as `welcome.build`;
 * a client built with another id reloads itself.
 */
function resolveBuildId(): string {
  const fromEnv = process.env["BUILD_ID"]?.trim();
  if (fromEnv) return fromEnv;
  const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  const sha = git.status === 0 ? git.stdout.trim() : "";
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `${sha || "local"}-${stamp}`;
}

/** Writes `dist/version.json` ({"build": "..."}), which the server reads at startup. */
function versionFile(build: string): Plugin {
  return {
    name: "hochstapler-version-file",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify({ build })}\n`,
      });
    },
  };
}

// zod ships explanatory comments next to @__PURE__ annotations that Rollup cannot place and drops
// harmlessly. Vite prints that third-party noise through its logger: hide only it, keep everything else.
const logger = createLogger();
const warn = logger.warn.bind(logger);
logger.warn = (msg, options): void => {
  if (
    msg.includes("node_modules/zod/") &&
    msg.includes("annotation that Rollup cannot interpret")
  ) {
    return;
  }
  warn(msg, options);
};

export default defineConfig(({ command }) => {
  // dev proxy target; the Aspire AppHost (apphost/, docs/DESIGN.md #71) sets POLY_SERVER_URL, otherwise the default port
  const serverUrl = process.env["POLY_SERVER_URL"]?.trim() || "http://localhost:8787";
  const build = command === "build" ? resolveBuildId() : "dev";
  return {
    customLogger: logger,
    plugins: [preact(), ...(command === "build" ? [versionFile(build)] : [])],
    define: {
      __BUILD_ID__: JSON.stringify(build),
      // test hooks of the browser suite (src/e2e-hooks.ts): only in bundles built for it, never in production
      __E2E_HOOKS__: e2eHooksDefine(process.env),
    },
    server: {
      port: 5173,
      proxy: devProxy(serverUrl),
    },
    build: { chunkSizeWarningLimit: 1500 },
  };
});
