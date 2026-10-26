// Chat content rules (docs/DESIGN.md #69). One pure function, no I/O, never logs the text it is given.
// Everything here is damage limitation for a family game, not a guarantee: determined users can evade word filters.
//
// Pipeline: sanitise (unicode abuse, length) -> links / contact data -> family filter.
import { LinkifyIt } from "linkify-it";
import {
  DataSet,
  RegExpMatcher,
  collapseDuplicatesTransformer,
  englishDataset,
  englishRecommendedTransformers,
  parseRawPattern,
  resolveConfusablesTransformer,
  resolveLeetSpeakTransformer,
  toAsciiLowerCaseTransformer,
} from "obscenity";
import { MAX_CHAT_LENGTH } from "@poly/engine";
import type { ChatRejectReason } from "@poly/engine";
import tldFile from "./tlds.json" with { type: "json" };
import {
  CONTACT_PLATFORMS,
  CONTACT_WORDS,
  DIGIT_WORDS,
  FRENCH_PATTERNS,
  GERMAN_PATTERNS,
  ITALIAN_PATTERNS,
  SPACED_TERMS,
  SWISS_PATTERNS,
} from "./wordlists.ts";

export type ChatCheck = { ok: true; text: string } | { ok: false; reason: ChatRejectReason };

const reject = (reason: ChatRejectReason): ChatCheck => ({ ok: false, reason });

// ---------- sanitising ----------
/** direction overrides / isolates / marks (text spoofing) */
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
/** Unicode "tag" characters (U+E0000..U+E007F): invisible, used to smuggle data */
function hasTagCharacters(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0xe0000 && cp <= 0xe007f) return true;
  }
  return false;
}
/** a run of combining marks (zalgo); real text needs at most two or three */
const MAX_COMBINING_RUN = 3;
const MARK = /^\p{M}$/u;
function hasZalgo(text: string): boolean {
  let run = 0;
  for (const ch of text) {
    run = MARK.test(ch) ? run + 1 : 0;
    if (run > MAX_COMBINING_RUN) return true;
  }
  return false;
}
/** a surrogate that is not part of a pair (in unicode mode pairs are one code point) */
const LONE_SURROGATE = /\p{Cs}/u;
const CONTROL = /\p{Cc}/gu;
/** zero-width and other invisible format characters, soft hyphen, hangul/braille fillers */
const INVISIBLE = /[\p{Cf}\u2800\u3164\uFFA0\u115F\u1160\u180E]/gu;
/** the wire allows 2 units per character; anything longer than 4 per character is refused before any work */
const MAX_RAW_UNITS = MAX_CHAT_LENGTH * 4;

function sanitise(
  raw: string,
): { ok: true; text: string } | { ok: false; reason: ChatRejectReason } {
  if (raw.length > MAX_RAW_UNITS) return reject("length");
  if (LONE_SURROGATE.test(raw) || BIDI.test(raw) || hasTagCharacters(raw)) return reject("invalid");
  const text = raw
    .replace(CONTROL, " ")
    .replace(INVISIBLE, "")
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim();
  if (text === "" || hasZalgo(text)) return reject("invalid");
  if (Array.from(text).length > MAX_CHAT_LENGTH) return reject("length");
  return { ok: true, text };
}

// ---------- folding ----------
/** lower case, no diacritics, ß -> ss: "Scheiß" and "Scheiss" and "Schéiss" are one word */
function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replaceAll("ß", "ss")
    .replaceAll("ø", "o")
    .toLowerCase();
}
const collapseRuns = (s: string): string => s.replace(/(.)\1+/gu, "$1");

// ---------- links and addresses (linkify-it) ----------
const linkify = new LinkifyIt({
  fuzzyLink: true,
  fuzzyEmail: true,
  fuzzyIP: true,
  tlds: tldFile.tlds,
});

/** "example[.]com", "example dot com", "max (at) example" and friends -> the plain form linkify understands */
function deobfuscate(text: string): string {
  return text
    .replace(/h(?:xx|tt)p(s?)\s*:/giu, "http$1:")
    .replace(/\s*[[({<]\s*(?:\.|dot|punkt)\s*[\])}>]\s*/giu, ".")
    .replace(/\s+(?:dot|punkt)\s+/giu, ".")
    .replace(/\s*[[({<]\s*(?:@|at)\s*[\])}>]\s*/giu, "@");
}
/** second stage: bare "at" and a lonely " . " between words */
function deobfuscateHard(text: string): string {
  return deobfuscate(text)
    .replace(/\s+at\s+/giu, "@")
    .replace(/(\S)\s+\.\s+(\S)/gu, "$1.$2");
}

const HEX_GROUP = /^[0-9a-f]{1,4}$/iu;
/** "2001:db8::1", "::1", "[fe80::1]:80" and the full eight-group form; a clock time ("18:30") is not one */
function looksLikeIpv6(token: string): boolean {
  const close = token.lastIndexOf("]");
  const bare = token.startsWith("[") && close > 0 ? token.slice(1, close) : token;
  const groups = bare.split(":");
  if (groups.length === 8 && groups.every((g) => HEX_GROUP.test(g))) return true;
  const gap = bare.indexOf("::");
  if (gap < 0 || groups.length > 8) return false;
  return groups.every((g) => g === "" || HEX_GROUP.test(g)) && groups.some((g) => g !== "");
}
const HANDLE = /(?:^|\s)@[\p{L}\p{N}_.]{3,}/u;

function linkOrContact(text: string): ChatRejectReason | null {
  const view = text.normalize("NFKC").replace(/[。｡․‧]/gu, ".");
  let link = false;
  for (const candidate of [view, deobfuscate(view), deobfuscateHard(view)]) {
    const matches = linkify.match(candidate);
    if (matches?.some((m) => m.schema === "mailto:")) return "contact";
    link ||= matches !== null;
  }
  if (link) return "link";
  if (view.split(/\s+/u).some(looksLikeIpv6)) return "link";
  if (HANDLE.test(view)) return "contact";
  return null;
}

// ---------- phone numbers, messengers ----------
/** how many digits make a phone number: a Swiss number has 9-10, a million is 7 (1.500.000 stays fine) */
const PHONE_MIN_DIGITS = 8;
const PHONE_MIN_CONTIGUOUS = 7;
const SPELLED_DIGITS_MIN = 7;
/** characters that may sit between the digit groups of a number, and how many in a row */
const PHONE_SEPARATORS = new Set([" ", "(", ")", ".", "/", "-", "+"]);
const PHONE_MAX_SEPARATOR_RUN = 2;
const DIGIT = /^\d$/u;

/** digits in one stretch of digits and short separators ("079 123 45 67", "(030) 1234-5678") */
function longestDigitStretch(folded: string): { total: number; contiguous: number } {
  let total = 0;
  let contiguous = 0;
  let bestTotal = 0;
  let bestContiguous = 0;
  let gap = 0;
  for (const ch of folded) {
    if (DIGIT.test(ch)) {
      total++;
      contiguous++;
      gap = 0;
    } else if (PHONE_SEPARATORS.has(ch) && ++gap <= PHONE_MAX_SEPARATOR_RUN && total > 0) {
      contiguous = 0;
    } else {
      total = 0;
      contiguous = 0;
      gap = 0;
    }
    bestTotal = Math.max(bestTotal, total);
    bestContiguous = Math.max(bestContiguous, contiguous);
  }
  return { total: bestTotal, contiguous: bestContiguous };
}

function hasPhoneNumber(folded: string): boolean {
  const { total, contiguous } = longestDigitStretch(folded);
  if (total >= PHONE_MIN_DIGITS || contiguous >= PHONE_MIN_CONTIGUOUS) return true;
  // spelled out: "null sieben neun ..."
  let streak = 0;
  for (const word of folded.split(/[^\p{L}\p{N}]+/u)) {
    if (Object.hasOwn(DIGIT_WORDS, word)) {
      if (++streak >= SPELLED_DIGITS_MIN) return true;
    } else if (DIGIT.test(word)) {
      streak++;
    } else {
      streak = 0;
    }
  }
  return false;
}

function hasMessenger(folded: string): boolean {
  const letters = folded.replace(/[^a-z]/gu, "");
  if (CONTACT_PLATFORMS.some((p) => letters.includes(p))) return true;
  const words = new Set(folded.split(/[^\p{L}\p{N}]+/u));
  return CONTACT_WORDS.some((w) => words.has(w));
}

// ---------- family filter (obscenity: English list + our German, Swiss German, French and Italian lists) ----------
const GERMAN_SET = new DataSet<{ lang: "de" | "gsw" | "fr" | "it" }>();
for (const raw of GERMAN_PATTERNS) {
  GERMAN_SET.addPhrase((p) => p.setMetadata({ lang: "de" }).addPattern(parseRawPattern(raw)));
}
for (const raw of SWISS_PATTERNS) {
  GERMAN_SET.addPhrase((p) => p.setMetadata({ lang: "gsw" }).addPattern(parseRawPattern(raw)));
}
for (const raw of FRENCH_PATTERNS) {
  GERMAN_SET.addPhrase((p) => p.setMetadata({ lang: "fr" }).addPattern(parseRawPattern(raw)));
}
for (const raw of ITALIAN_PATTERNS) {
  GERMAN_SET.addPhrase((p) => p.setMetadata({ lang: "it" }).addPattern(parseRawPattern(raw)));
}
const english = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });
const german = new RegExpMatcher({
  ...GERMAN_SET.build(),
  blacklistMatcherTransformers: [
    resolveConfusablesTransformer(),
    resolveLeetSpeakTransformer(),
    toAsciiLowerCaseTransformer(),
    collapseDuplicatesTransformer({ defaultThreshold: 1 }),
  ],
});

function isProfane(folded: string): boolean {
  if (english.hasMatch(folded) || german.hasMatch(folded)) return true;
  // "s c h e i s s e", "a.r.s.c.h.l.o.c.h": long terms in the letters only
  const letters = collapseRuns(folded.replace(/[^a-z]/gu, ""));
  return SPACED_TERMS.some((t) => letters.includes(t));
}

/** Cleans a typed message and decides whether it may be published. Pure; never logs. */
export function checkChatText(raw: string): ChatCheck {
  const clean = sanitise(raw);
  if (!clean.ok) return clean;
  const linked = linkOrContact(clean.text);
  if (linked !== null) return reject(linked);
  const folded = fold(clean.text);
  if (hasPhoneNumber(folded) || hasMessenger(folded)) return reject("contact");
  if (isProfane(folded)) return reject("language");
  return { ok: true, text: clean.text };
}
