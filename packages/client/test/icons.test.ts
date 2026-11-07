import { describe, expect, it } from "vitest";
import { Icon, ICON_NAMES } from "../src/ui/icons.tsx";

// vite reads the sources as text at transform time (the client tests run without node typings)
const COMPONENTS = import.meta.glob("../src/ui/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});
const DICTIONARIES = import.meta.glob("../src/i18n/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** what the svg element receives (the vnode type only knows `children`) */
const drawn = (name: Parameters<typeof Icon>[0]["name"], size?: number) => {
  const vnode = Icon(size === undefined ? { name } : { name, size });
  const props: Record<string, unknown> = vnode.props;
  return { type: vnode.type, props };
};

describe("drawn icon set", () => {
  it("draws every icon as an inline svg that stays out of the accessibility tree", () => {
    for (const name of ICON_NAMES) {
      const svg = drawn(name);
      expect(svg.type, name).toBe("svg");
      expect(svg.props["aria-hidden"], name).toBe("true");
      expect(svg.props.focusable, name).toBe("false");
      expect(svg.props.viewBox, name).toBe("0 0 24 24");
      expect(svg.props.class, name).toBe("ico");
    }
  });

  it("takes its colour from the surrounding text and keeps the ink stroke weight", () => {
    const svg = drawn("home");
    expect(svg.props.stroke).toBe("currentColor");
    expect(svg.props["stroke-width"]).toBe(2);
    expect(svg.props.fill).toBe("none");
  });

  it("has a name for every control that used an emoji", () => {
    expect([...ICON_NAMES].sort()).toEqual(
      ["bot", "camera", "flag", "glow", "home", "lock", "menu", "phone", "ticket"].sort(),
    );
  });

  it("scales with the size property", () => {
    const svg = drawn("flag", 16);
    expect(svg.props.width).toBe(16);
    expect(svg.props.height).toBe(16);
  });
});

describe("no emoji or Unicode symbols as icons", () => {
  // these rendered differently per OS and clashed with the drawn ink style; the icon set replaced them
  const REPLACED = ["🎥", "✨", "⌂", "⋯", "⚑", "📲", "🎟", "🔒", "🤖"];

  it("keeps them out of the components and the dictionaries", () => {
    const files = { ...COMPONENTS, ...DICTIONARIES };
    const found = Object.entries(files).flatMap(([file, text]) =>
      REPLACED.filter((glyph) => String(text).includes(glyph)).map((glyph) => `${file}: ${glyph}`),
    );
    expect(found).toEqual([]);
  });
});
