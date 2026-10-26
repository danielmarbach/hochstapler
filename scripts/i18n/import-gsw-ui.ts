// Import a Swiss German (Luzernerdeutsch) translation of the client UI texts produced by GPT/Codex.
//
//   npx tsx scripts/i18n/import-gsw-ui.ts <gsw-ui.json>
//
// Keys in the JSON replace the matching values in packages/client/src/i18n/gsw.ts; keys added to the
// client since the export keep their current value. Refuses to write if {placeholders} or numbers
// differ from the German source.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { de } from "../../packages/client/src/i18n/de.ts";
import { gsw } from "../../packages/client/src/i18n/gsw.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "packages/client/src/i18n/gsw.ts");

const placeholders = (s: string): string =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1] ?? "")
    .sort()
    .join();
const numbers = (s: string): string =>
  [...s.matchAll(/\d+/g)]
    .map((m) => m[0])
    .sort()
    .join();

function main(): void {
  const file = process.argv[2];
  if (!file) {
    throw new Error("Provide the path to the JSON file");
  }
  const translated = z.record(z.string(), z.string()).parse(JSON.parse(readFileSync(file, "utf8")));
  const source: Record<string, string> = de;
  const problems: string[] = [];
  for (const [key, text] of Object.entries(translated)) {
    const original = source[key];
    if (original === undefined) {
      problems.push(`${key}: gibt es in de.ts nicht (mehr)`);
      continue;
    }
    if (placeholders(original) !== placeholders(text)) {
      problems.push(`${key}: Platzhalter ${placeholders(original)} ≠ ${placeholders(text)}`);
    }
    if (numbers(original) !== numbers(text)) {
      problems.push(`${key}: numbers ${numbers(original)} ≠ ${numbers(text)}`);
    }
  }
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  const current: Record<string, string> = gsw;
  const merged = Object.fromEntries(
    Object.keys(source).map((key) => [key, translated[key] ?? current[key] ?? source[key]]),
  );
  const keptFromCurrent = Object.keys(source).filter((k) => translated[k] === undefined);
  writeFileSync(
    OUT,
    `// Luzernerdeutsch (gsw). Übersetzt mit GPT via Codex-CLI, importiert mit scripts/i18n/import-gsw-ui.ts.\nimport type { UiMessages } from "./index.ts";\n\nexport const gsw = ${JSON.stringify(merged, null, 2)} as const satisfies UiMessages;\n`,
  );
  console.log(
    `OK: ${Object.keys(translated).length} translated, ${keptFromCurrent.length} kept unchanged (${keptFromCurrent.join(", ")}).`,
  );
}

main();
