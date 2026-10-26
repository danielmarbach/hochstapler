import { describe, expect, it } from "vitest";
import { e2eHooksDefine } from "../src/build-flags.ts";
import { E2E_HOOKS, exposeTestHooks } from "../src/e2e-hooks.ts";

describe("test hooks of the browser suite", () => {
  it("are compiled out of every normal build, production included", () => {
    expect(e2eHooksDefine({})).toBe("false");
    expect(e2eHooksDefine({ NODE_ENV: "production" })).toBe("false");
    expect(e2eHooksDefine({ POLY_E2E_HOOKS: "0" })).toBe("false");
  });

  it("are compiled in only when the suite's build asks for them", () => {
    expect(e2eHooksDefine({ POLY_E2E_HOOKS: "1" })).toBe("true");
    expect(e2eHooksDefine({ POLY_E2E_HOOKS: "true" })).toBe("false");
  });

  it("do nothing in a bundle without them", () => {
    expect(E2E_HOOKS).toBe(false);
    // no window in this environment: a hook that wrongly ran would throw
    expect(() =>
      exposeTestHooks({ boardCorners: () => [], insets: () => ({ l: 0, r: 0, t: 0, b: 0 }) }),
    ).not.toThrow();
  });
});
