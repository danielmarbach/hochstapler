// Token pictures: a thumbnail rendered from the 3D model (scripts/tokens/render-thumbnails.mjs), with an emoji as fallback.

/** Fallback emoji per token, one distinct emoji each (checked in test/token-icons.test.ts). */
export const TOKEN_EMOJI: Readonly<Record<string, string>> = {
  pretzel: "🥨",
  "beer-stein": "🍺",
  "beetle-car": "🚗",
  "cuckoo-clock": "🕰️",
  "garden-gnome": "🧙",
  bratwurst: "🌭",
  pickelhaube: "🪖",
  train: "🚄",
  baguette: "🥖",
  beret: "🧢",
  rooster: "🐓",
  croissant: "🥐",
  "wine-bottle": "🍷",
  eiffel: "🗼",
  scooter: "🛵",
  perfume: "🧴",
  cow: "🐄",
  "swiss-knife": "🔪",
  cheese: "🧀",
  watch: "⌚",
  chocolate: "🍫",
  "st-bernard": "🐕",
  fondue: "🫕",
  gondola: "🚡",
  vespa: "🏍️",
  pizza: "🍕",
  espresso: "☕",
  "gondola-venice": "🛶",
  colosseum: "🏛️",
  pasta: "🍝",
  gelato: "🍨",
  "tower-pisa": "🏰",
};

const GENERIC_EMOJI = "♟️";
const SAFE_ID = /^[a-z][a-z0-9-]*$/;

export function tokenEmoji(tokenId: string): string {
  return Object.hasOwn(TOKEN_EMOJI, tokenId)
    ? (TOKEN_EMOJI[tokenId] ?? GENERIC_EMOJI)
    : GENERIC_EMOJI;
}

/** same-origin URL of the thumbnail (CSP img-src 'self'); ids that cannot be a file name map to a missing file */
export function tokenImageUrl(tokenId: string): string {
  return `/assets/tokens/${SAFE_ID.test(tokenId) ? tokenId : "unknown"}.webp`;
}
