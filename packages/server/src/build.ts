import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attemptSync } from "@poly/engine";
import { z } from "zod";

/** Build id of a server without a built client (development): clients never reload because of it. */
export const DEV_BUILD = "dev";

const VersionFile = z.object({ build: z.string().min(1) });

/**
 * The id of the deployed client build, written by the client build to `<dist>/version.json`
 * (packages/client/vite.config.ts). "dev" when there is no built client or no readable version file.
 */
export function readBuildId(staticDir: string | null): string {
  if (!staticDir) return DEV_BUILD;
  const parsed = attemptSync("build:version", () =>
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- STATIC_DIR is operator config, fixed file name
    VersionFile.parse(JSON.parse(readFileSync(join(staticDir, "version.json"), "utf8"))),
  );
  return parsed.ok ? parsed.value.build : DEV_BUILD;
}

/** The built client served in production (`packages/client/dist`); null in development (Vite serves the client). */
export function defaultStaticDir(nodeEnv: string | undefined): string | null {
  return nodeEnv === "production"
    ? resolve(fileURLToPath(new URL("../../client/dist", import.meta.url)))
    : null;
}
