/** Compile-time flags of the client bundle, computed by vite.config.ts (kept here so that they can be unit tested). */

/**
 * Value of the `__E2E_HOOKS__` define (src/e2e-hooks.ts): `"true"` only when the bundle is built for the browser suite
 * with `POLY_E2E_HOOKS=1`; every other build, production included, gets `"false"` and drops the test hooks.
 */
export function e2eHooksDefine(
  env: Readonly<Record<string, string | undefined>>,
): "true" | "false" {
  return env["POLY_E2E_HOOKS"] === "1" ? "true" : "false";
}
