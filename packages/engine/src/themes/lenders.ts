// Who lends the money in the show-off mode (docs/DESIGN.md #93), per theme and language. The German
// base name lives in the theme (`Theme.lender`); this map adds the other languages. Each is the subject
// of a sentence ("{lender} leiht dir bis zu ..."), so it carries its article.
import type { Lang } from "../i18n/lang.ts";

export const LENDER_NAMES: Partial<Record<Lang, Record<string, string>>> = {
  en: {
    ch: "The private banker on Paradeplatz",
    de: "The private banker in Frankfurt's Westend",
    fr: "The banker on Place Vendôme",
    it: "The banker on Piazza Affari",
  },
  gsw: {
    ch: "De Privatbankier am Paradeplatz",
    de: "De Privatbankier im Frankfurter Westend",
    fr: "De Bankier a de Place Vendôme",
    it: "De Bankier a de Piazza Affari",
  },
  fr: {
    ch: "Le banquier privé de la Paradeplatz",
    de: "Le banquier privé du Westend de Francfort",
    fr: "Le banquier de la place Vendôme",
    it: "Le banquier de la Piazza Affari",
  },
  it: {
    ch: "Il banchiere privato della Paradeplatz",
    de: "Il banchiere privato del Westend di Francoforte",
    fr: "Il banchiere di Place Vendôme",
    it: "Il banchiere di Piazza Affari",
  },
};
