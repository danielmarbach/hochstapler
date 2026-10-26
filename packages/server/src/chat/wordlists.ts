// Word data for the chat filters (docs/DESIGN.md #69). Data only, no logic.
//
// `obscenity` ships an English list. German and Luzernerdeutsch lists live here in obscenity's pattern syntax
// (`|` = word boundary, `?` = optional previous character). Input is folded before matching (see filter.ts: lower case,
// no diacritics, ß -> ss) and obscenity collapses repeated letters, so patterns are written in that folded,
// collapsed form: "Scheisse" -> `scheis`, "Fotze" -> `fotze`. Leet speak (`sch3!ss3`) and look-alike characters are
// resolved by obscenity's transformers.
//
// Deliberately moderate: strong insults, sexual vulgarities and slurs. Mild words ("doof", "Seich", "Löli") are not
// listed: a filter that blocks normal banter teaches children to evade it. This is damage limitation, not a guarantee.

/** Standard German (also covers most of Swiss German spelling). */
export const GERMAN_PATTERNS: readonly string[] = [
  "|arsch", // Arschloch, Arschgeige, ...
  "|scheis", // Scheiss, Scheisse, Scheisser, ...
  "|fick|",
  "|ficken|",
  "|fickt|",
  "|ficker|",
  "|fickst|",
  "|wichs", // Wichser, wichsen
  "|wixer",
  "|hure|",
  "|huren", // Hurensohn, Huren...
  "|nutte|",
  "|nutten|",
  "|schlampe",
  "|fotze",
  "|votze",
  "|fotz|",
  "|schwuchtel",
  "|spast|",
  "|spasti|",
  "|missgeburt",
  "|verpiss",
  "|dreckskerl",
  "|dreckssau",
  "|neger|",
  "|kanak",
  "|vergewaltig",
  "|nazi|",
  "|nazis|",
  "|hitler",
  "|sieg heil",
  "|pimmel",
  "|titten|",
  "|schwanzlutscher",
];

/** Luzernerdeutsch spellings and vulgarities that standard German does not cover. */
export const SWISS_PATTERNS: readonly string[] = [
  "|huere", // huere, hueresiech, huere geil, ... (collapsed: "huere")
  "|hueri",
  "|huora",
  "|huresohn",
  "|schise", // Schiisse / Schiesse
  "|schlampa",
  "|saucha", // Sauchaib, Sauchaip
  "|souhund",
  "|sauhund",
  "|ficka|",
  "|fotzu",
  "|fotzel",
  "|wixer",
];

/** French vulgarities and slurs (folded, collapsed form: "connard" -> `conard`). */
export const FRENCH_PATTERNS: readonly string[] = [
  "|putain", // putain, putains
  "|pute|",
  "|putes|",
  "|conard", // connard, connards
  "|conasse", // connasse
  "|salope", // salope, salopard
  "|salopard",
  "|encule", // enculé, enculer, enculeur
  "|merde|",
  "|merdeux",
  "|nique|", // nique, niquer
  "|niquer|",
  "|negre|",
  "|bougnoule",
  "|pedale|",
  "|tapette|",
];

/** Italian vulgarities and slurs (folded, collapsed form: "cazzo" -> `cazo`, "puttana" -> `putana`). */
export const ITALIAN_PATTERNS: readonly string[] = [
  "|cazo|", // cazzo
  "|cazi|",
  "|vafanculo", // vaffanculo
  "|fanculo",
  "|stronz", // stronzo, stronza, stronzata
  "|putana", // puttana
  "|putane|",
  "|troia|",
  "|troie|",
  "|merda|",
  "|minchia",
  "|coglione",
  "|coglioni|",
  "|frocio",
  "|froci|",
  "|ricchione",
  "|negro|",
  "|porco dio",
];

/**
 * Long, unambiguous terms that are also searched in the message with everything but letters removed, to catch
 * "s c h e i s s e" and "a.r.s.c.h.l.o.c.h". Folded and collapsed form. Only long terms: across word boundaries
 * a short term appears by accident ("Wunsch Eis" contains "scheis").
 */
export const SPACED_TERMS: readonly string[] = [
  "arschloch",
  "hurensohn",
  "schlampe",
  "wichser",
  "motherfucker",
  "fuck",
  "scheise",
  "putain",
  "salope",
  "conard",
  "stronzo",
  "vafanculo",
  "putana",
];

/** Contact platforms; spotted anywhere in the letters-only text (long, unique names). */
export const CONTACT_PLATFORMS: readonly string[] = [
  "whatsapp",
  "telegram",
  "snapchat",
  "instagram",
  "discord",
  "tiktok",
  "skype",
  "threema",
  "wechat",
  "viber",
  "facebook",
  "messenger",
];
/** Short platform words that would produce false positives as substrings; whole word only. */
export const CONTACT_WORDS: readonly string[] = ["insta", "snap", "fb", "kik", "signal app"];

/** Digit words per language (folded form) for spelled-out phone numbers. */
export const DIGIT_WORDS: Readonly<Record<string, string>> = {
  // de
  null: "0",
  eins: "1",
  ein: "1",
  zwei: "2",
  zwo: "2",
  drei: "3",
  vier: "4",
  funf: "5",
  fuenf: "5",
  sechs: "6",
  sieben: "7",
  acht: "8",
  neun: "9",
  // en
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  // gsw (Luzern)
  nul: "0",
  eis: "1",
  zwoi: "2",
  drai: "3",
  vieri: "4",
  foif: "5",
  sachs: "6",
  sibe: "7",
  nuun: "9",
  // fr ("un" and "six" are common words, but only a streak of SPELLED_DIGITS_MIN digit words counts)
  un: "1",
  deux: "2",
  trois: "3",
  quatre: "4",
  cinq: "5",
  sept: "7",
  huit: "8",
  neuf: "9",
  // it
  uno: "1",
  due: "2",
  tre: "3",
  quattro: "4",
  cinque: "5",
  sei: "6",
  sette: "7",
  otto: "8",
  nove: "9",
};
