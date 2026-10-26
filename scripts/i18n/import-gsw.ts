// Import a Swiss German (Luzernerdeutsch) translation produced by GPT/Codex into the typed catalogues.
//
//   npx tsx scripts/i18n/import-gsw.ts <gsw.json>
//
// The JSON must mirror the export (engine catalogue + per-theme texts). The script refuses to write
// anything if keys, {placeholders} or numbers differ from the German source.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { de } from "../../packages/engine/src/i18n/de.ts";
import { THEMES } from "../../packages/engine/src/themes/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENGINE_OUT = join(ROOT, "packages/engine/src/i18n/gsw.ts");
const THEMES_OUT = join(ROOT, "packages/engine/src/themes/gsw.ts");

const ThemeTextsSchema = z.object({
  name: z.string().min(1),
  groupNames: z.array(z.string().min(1)),
  deckNames: z.object({ chance: z.string().min(1), community: z.string().min(1) }),
  tokenNames: z.record(z.string(), z.string().min(1)),
  cardTexts: z.record(z.string(), z.string().min(1)),
});
const TranslationSchema = z.object({
  engine: z.record(z.string(), z.string().min(1)),
  themes: z.record(z.string(), ThemeTextsSchema),
});

const placeholders = (s: string): string[] =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
const numbers = (s: string): string[] =>
  [...s.matchAll(/\d[\d'.,]*/g)].map((m) => m[0].replace(/[',.]/g, "")).sort();

function compare(
  label: string,
  source: string,
  target: string | undefined,
  problems: string[],
): void {
  if (target === undefined) {
    problems.push(`${label}: missing`);
    return;
  }
  if (placeholders(source).join() !== placeholders(target).join()) {
    problems.push(
      `${label}: Platzhalter ${placeholders(source).join()} ≠ ${placeholders(target).join()}`,
    );
  }
  if (numbers(source).join() !== numbers(target).join()) {
    problems.push(`${label}: numbers ${numbers(source).join()} ≠ ${numbers(target).join()}`);
  }
}

function sameKeys(label: string, a: object, b: object, problems: string[]): void {
  const ka = Object.keys(a).sort().join();
  const kb = Object.keys(b).sort().join();
  if (ka !== kb) {
    problems.push(`${label}: keys differ`);
  }
}

function main(): void {
  const file = process.argv[2];
  if (!file) {
    throw new Error("Pfad zu gsw.json angeben");
  }
  const t = TranslationSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const problems: string[] = [];

  sameKeys("engine", de, t.engine, problems);
  for (const [key, text] of Object.entries(de)) {
    compare(`engine.${key}`, text, t.engine[key], problems);
  }
  sameKeys("themes", THEMES, t.themes, problems);
  for (const [id, theme] of Object.entries(THEMES)) {
    const g = t.themes[id];
    if (!g) {
      continue;
    }
    if (g.groupNames.length !== theme.groupNames.length) {
      problems.push(`${id}.groupNames: ${g.groupNames.length} statt ${theme.groupNames.length}`);
    }
    sameKeys(`${id}.cardTexts`, theme.cardTexts, g.cardTexts, problems);
    sameKeys(
      `${id}.tokenNames`,
      Object.fromEntries(theme.tokens.map((k) => [k.id, k])),
      g.tokenNames,
      problems,
    );
    for (const [cardId, text] of Object.entries(theme.cardTexts)) {
      compare(`${id}.cardTexts.${cardId}`, text, g.cardTexts[cardId], problems);
    }
  }
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }

  const header =
    "// Luzernerdeutsch (gsw). Übersetzt mit GPT via Codex-CLI, geprüft mit scripts/i18n/import-gsw.ts.\n";
  writeFileSync(
    ENGINE_OUT,
    `${header}import type { EngineMessages } from "./format.ts";\n\nexport const gsw = ${JSON.stringify(t.engine, null, 2)} as const satisfies EngineMessages;\n`,
  );
  writeFileSync(
    THEMES_OUT,
    `${header}import type { ThemeTexts } from "../theme-types.ts";\n\nexport const GSW_THEME_TEXTS: Record<string, ThemeTexts> = ${JSON.stringify(t.themes, null, 2)};\n`,
  );
  console.log(
    `OK: ${Object.keys(t.engine).length} engine texts, ${Object.keys(t.themes).length} themes written.`,
  );
}

main();
