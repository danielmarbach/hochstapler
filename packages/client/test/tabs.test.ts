import { describe, expect, it } from "vitest";
import { nextTab, panelId, panelProps, tabId, tabProps } from "../src/ui/tabs.ts";
import { NEAR_BOTTOM_PX, nearBottom } from "../src/ui/Log.tsx";

describe("tabs (WAI-ARIA tabs pattern)", () => {
  const ids = ["players", "props", "trades", "log"];

  it("arrow keys wrap around, Home and End jump to the ends", () => {
    expect(nextTab(ids, "players", "ArrowRight")).toBe("props");
    expect(nextTab(ids, "log", "ArrowRight")).toBe("players");
    expect(nextTab(ids, "players", "ArrowLeft")).toBe("log");
    expect(nextTab(ids, "trades", "Home")).toBe("players");
    expect(nextTab(ids, "props", "End")).toBe("log");
  });

  it("ignores other keys, up/down arrows and unknown tabs", () => {
    expect(nextTab(ids, "props", "Enter")).toBeNull();
    expect(nextTab(ids, "props", "ArrowDown")).toBeNull();
    expect(nextTab(ids, "missing", "ArrowRight")).toBeNull();
    expect(nextTab([], "x", "ArrowRight")).toBeNull();
  });

  it("only the selected tab is in the tab order and controls its panel", () => {
    const on = tabProps("sheet", "props", "props");
    expect(on).toMatchObject({
      id: tabId("sheet", "props"),
      role: "tab",
      "aria-selected": true,
      "aria-controls": panelId("sheet", "props"),
      tabIndex: 0,
    });
    const off = tabProps("sheet", "log", "props");
    expect(off).toMatchObject({ "aria-selected": false, tabIndex: -1 });
    expect(off["aria-controls"]).toBeUndefined();
  });

  it("the panel is labelled by its tab", () => {
    expect(panelProps("sheet", "props")).toEqual({
      id: "sheet-panel-props",
      role: "tabpanel",
      "aria-labelledby": "sheet-tab-props",
    });
  });
});

describe("chat auto-scroll", () => {
  it("counts as at the bottom only within 24px of the end", () => {
    expect(NEAR_BOTTOM_PX).toBe(24);
    const el = (top: number) => ({ scrollHeight: 1000, clientHeight: 200, scrollTop: top });
    expect(nearBottom(el(800))).toBe(true);
    expect(nearBottom(el(776))).toBe(true);
    expect(nearBottom(el(775))).toBe(false);
    expect(nearBottom({ scrollHeight: 100, clientHeight: 200, scrollTop: 0 })).toBe(true);
  });
});
