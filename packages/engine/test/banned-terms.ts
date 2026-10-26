// Trade-dress guard (docs/DESIGN.md #87): names and card formulas of the well-known commercial
// property-trading game must not appear in any user-visible text, in any theme or language.
// Case-insensitive; `\b` is ASCII-only in JS, so accented endings are matched with lookaheads.

/** Applied to every user-visible string (themes, engine messages, UI dictionaries). */
export const BANNED_EVERYWHERE: readonly RegExp[] = [
  // corner names and their local editions
  /\bfrei[- ]parke?n?\b/i,
  /\bgratis parkier/i,
  /\bparc gratuit\b/i,
  /\bparcheggio (libero|gratuito)\b/i,
  /\bfree parking\b/i,
  /\bcaisse (de communaut|commune)/i,
  /\bcommunity chest\b/i,
  /\bgemeinschafts(feld|kasse)/i,
  /\bgmeinschafts(fäld|kasse)/i,
  /\bereignisf/i,
  /\bimprevisti\b/i,
  /\bprobabilit(à|a)(?!\w)/i,
  /\b(go|gehe|gang|allez|va|vai) (directly |direkt |direttamente )?(to|ins|is|en|in) (jail|gef[aä]ngnis|gf[aä]ngnis|prison|prigione)\b/i,
  /\bgo to jail\b/i,
  /\bpass(es)? go\b/i,
  /\bcollect \S+ salary\b/i,
  /\bvia!/i,
  /\b(case|casella) (d[ée]part|start|los|via)\b/i,
  /\b(über|ueber|auf|für|zu|bis|zum|sur|par|dal|dalla|al|alla|a) (los|d[ée]part)\b/i,
  /\bd[ée]part\b/i,
  // card formulas
  /\bnicht über\b/i,
  /\bned über\b/i,
  /\bkommst du über\b/i,
  /\bchunsch über\b/i,
  /\bdo not pass\b/i,
  /\bif you pass\b/i,
  /\bne passe pas\b/i,
  /\bsi tu passes\b/i,
  /\bnon passare\b/i,
  /\bse passi\b/i,
  /\brücke vor\b/i,
  /\bgang vor bis\b/i,
  /\badvance to\b/i,
  /\bavance jusqu/i,
  /\bavanza fino\b/i,
  /\bbis du sie (brauchst|bruchsch)\b/i,
  /\buntil you need it\b/i,
  /\bjusqu'à ce que tu en aies besoin\b/i,
  /\bfinché non ti serve\b/i,
  /get[- ]out[- ]of[- ]jail/i,
  /libéré de prison/i,
  /uscite gratis di prigione/i,
  /\bkommst aus dem gef[aä]ngnis frei\b/i,
  /\bchunsch us em gfängnis frei\b/i,
  /\bbank error\b/i,
  /\bbankirrtum\b/i,
  /\berreur de la banque\b/i,
  /\berrore della banca\b/i,
  /\bfreikart/i,
  /\bfree cards?\b/i,
  /\bcarte de sortie\b/i,
  /\bcarta di uscita\b/i,
  // the jail concept itself was renamed to custody
  /gef[aä]ngnis|gfängnis|\bjail\b|\bprison\b|prigione/i,
];

/** Applied to deck names and the board-space kind labels only ("Quelle chance !" in chat is fine). */
export const BANNED_DECK_LABELS: readonly RegExp[] = [
  /\bchance\b/i,
  /\bcommunity\b/i,
  /\bcommunaut/i,
  /\bcomunit[àa]/i,
  /\bgemeinschaft/i,
  /\bgmeinschaft/i,
  /\bereignis/i,
  /\bevent\b/i,
  /\b[ée]v[ée]nement\b/i,
  /\bevento\b/i,
  /\bimprevisti\b/i,
  /\bprobabilit/i,
  /\bcaisse\b/i,
  /\bchest\b/i,
];

/** Exact tile names that are corner names of the classic property-trading game in some edition. */
export const BANNED_TILE_NAMES: readonly RegExp[] = [/^(los|start|go|via!?|d[ée]part)$/i];

export function bannedHits(text: string, list: readonly RegExp[]): string[] {
  return list.filter((re) => re.test(text)).map((re) => re.source);
}
