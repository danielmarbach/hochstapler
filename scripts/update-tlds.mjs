// Regenerates packages/server/src/chat/tlds.json from the IANA root zone list (docs/DESIGN.md #69).
// The chat link filter (linkify-it) needs every top-level domain to catch bare domains such as `example.xyz`.
// The npm package `tlds` was rejected (no release for 12 months, already missing .web); IANA is the source of truth.
//   node scripts/update-tlds.mjs
import { writeFileSync } from "node:fs";
import { domainToUnicode } from "node:url";
import { resolve } from "node:path";

const SOURCE = "https://data.iana.org/TLD/tlds-alpha-by-domain.txt";
const response = await fetch(SOURCE);
if (!response.ok) {
  throw new Error(`IANA answered ${response.status}`);
}
const lines = (await response.text()).split("\n").map((l) => l.trim());
const tlds = lines
  .filter((l) => l !== "" && !l.startsWith("#"))
  .map((l) => domainToUnicode(l.toLowerCase()))
  .sort();
if (tlds.length < 1000) {
  throw new Error(`suspiciously short TLD list: ${tlds.length}`);
}
const target = resolve(import.meta.dirname, "../packages/server/src/chat/tlds.json");
writeFileSync(target, `${JSON.stringify({ source: SOURCE, version: lines[0], tlds }, null, 0)}\n`);
console.log(`${tlds.length} TLDs (${lines[0]})`);
