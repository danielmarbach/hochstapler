// Asset catalogue for Meshy text-to-3D generation. Names match the client manifest (docs/ASSETS.md).

export type AssetKind = "building" | "token" | "landmark";

export interface AssetSpec {
  name: string;
  kind: AssetKind;
  /** what the object is; style suffixes are added per kind */
  subject: string;
  /** extra hints for the texture pass */
  colors: string;
  /** overrides the per-kind model, e.g. when the lite model got the shape wrong */
  model?: "meshy-6-lite" | "meshy-6";
}

const GEOMETRY_STYLE =
  "board game miniature, single solid piece, stylized low-poly, chunky clean bevelled shapes, no text";
const TOKEN_STYLE =
  "board game token miniature standing on a small round plain base, chunky readable silhouette";
export const TEXTURE_STYLE =
  "hand-painted stylized texture, warm storybook colors, soft painterly shading, cozy board game diorama style, matte";

export const POLYCOUNT: Record<AssetKind, number> = {
  building: 4_000,
  token: 6_000,
  landmark: 15_000,
};
export const AI_MODEL: Record<AssetKind, "meshy-6-lite" | "meshy-6"> = {
  building: "meshy-6-lite",
  token: "meshy-6-lite",
  landmark: "meshy-6",
};

export function modelFor(a: AssetSpec): "meshy-6-lite" | "meshy-6" {
  return a.model ?? AI_MODEL[a.kind];
}

export function geometryPrompt(a: AssetSpec): string {
  return a.kind === "token"
    ? `${a.subject}, ${TOKEN_STYLE}, ${GEOMETRY_STYLE}`
    : `${a.subject}, ${GEOMETRY_STYLE}`;
}

export function texturePrompt(a: AssetSpec): string {
  return `${a.subject}; ${a.colors}; ${TEXTURE_STYLE}`;
}

const token = (
  id: string,
  subject: string,
  colors: string,
  model?: AssetSpec["model"],
): AssetSpec => ({
  name: `token-${id}`,
  kind: "token",
  subject,
  colors,
  ...(model ? { model } : {}),
});

export const ASSETS: AssetSpec[] = [
  // ---- buildings (all themes) ----
  {
    name: "house",
    kind: "building",
    subject: "small cute gabled house with chimney, door and two windows",
    colors: "fresh green walls, white window frames, dark green roof",
  },
  {
    name: "hotel",
    kind: "building",
    subject: "small boutique hotel, three floors, flat roof with a tiny sign board",
    colors: "warm red walls, cream balconies, dark red roof",
  },
  {
    name: "skyscraper",
    kind: "building",
    subject: "slender modern skyscraper with stepped crown and glass facade",
    colors: "pale blue glass with warm lit windows, silver frame",
  },

  // ---- landmarks / special skyscrapers ----
  {
    name: "landmark-matterhorn",
    kind: "landmark",
    subject:
      "stylized Matterhorn mountain, iconic crooked pyramid peak with snowy summit and rocky faces, the wide mountain foot with alpine meadow forms the flat bottom, no plinth, no pedestal",
    colors: "grey rock, white snow, green alpine meadow",
  },
  {
    name: "landmark-eiffel",
    kind: "landmark",
    subject: "Eiffel tower on a small round base with a tiny park",
    colors: "warm bronze iron, green lawn",
  },
  {
    name: "landmark-brandenburg",
    kind: "landmark",
    subject: "Brandenburg Gate with quadriga on a small round paved base",
    colors: "sandstone beige, green copper quadriga",
  },
  {
    name: "landmark-colosseum",
    kind: "landmark",
    subject: "Roman Colosseum on a small round base",
    colors: "warm travertine, terracotta accents",
  },
  {
    name: "skyscraper-prime-tower",
    kind: "landmark",
    subject: "Prime Tower Zurich, tall angular green glass tower",
    colors: "mint green glass, silver frame",
  },
  {
    name: "skyscraper-la-defense",
    kind: "landmark",
    subject: "modern La Defense office tower with curved glass facade",
    colors: "blue glass, white frame",
  },
  {
    name: "skyscraper-fernsehturm",
    kind: "landmark",
    subject: "Berlin TV tower Fernsehturm, sphere on a slender concrete shaft with antenna",
    colors: "light concrete, silver sphere, red and white antenna",
  },

  // ---- Switzerland ----
  token(
    "cow",
    "cute Swiss cow with a big bell",
    "white with brown patches, golden bell, pink nose",
  ),
  token(
    "swiss-knife",
    "Swiss army pocket knife standing upright, partly opened",
    "bright red handle with white cross, silver blades",
  ),
  token("cheese", "wedge of Swiss Emmental cheese with holes", "warm yellow cheese, light rind"),
  token(
    "watch",
    "classic Swiss wristwatch standing on its strap",
    "silver case, white dial, brown leather strap",
  ),
  token(
    "chocolate",
    "stack of Swiss chocolate bars, one bar half unwrapped",
    "brown chocolate, red and gold wrapper",
  ),
  token(
    "st-bernard",
    "cute sitting St. Bernard dog with a small barrel on its collar",
    "brown and white fur, wooden barrel",
  ),
  token(
    "fondue",
    "Swiss cheese fondue caquelon pot on a small burner stand with a fondue fork and bread cube",
    "red caquelon with white Swiss dots, golden melted cheese, dark iron stand",
  ),
  token(
    "gondola",
    "cable car gondola cabin hanging from a short cable segment on a stand",
    "red cabin with white cross, silver cable",
  ),
  // ---- France ----
  token(
    "baguette",
    "French baguette standing upright in a small paper bag",
    "golden crust, kraft paper bag",
  ),
  // regenerated with the full model: the lite result read as a black ball on a pole
  token(
    "beret",
    "a smooth faceless wooden milliner's hat block head (egg-shaped, no face, no neck details) on a round base, wearing a classic French beret tilted to one side: wide flat soft felt cap overhanging the block, small stalk on top",
    "dark navy felt beret, pale light wood hat block and base",
    "meshy-6",
  ),
  token("rooster", "proud Gallic rooster", "blue, white and red plumage, red comb"),
  token("croissant", "croissant on a small plate", "golden buttery croissant, white plate"),
  token("wine-bottle", "wine bottle with a glass", "dark green bottle, cream label, red wine"),
  token("eiffel", "small Eiffel tower figurine", "bronze iron"),
  token("scooter", "classic French scooter", "pastel blue, cream seat"),
  token("perfume", "elegant perfume bottle with atomizer", "pink glass, gold cap"),
  // ---- Germany ----
  token(
    "pretzel",
    "Bavarian pretzel standing upright on a small base",
    "glossy brown crust, white salt",
  ),
  token(
    "beer-stein",
    "beer stein with foam",
    "grey stoneware with blue pattern, pewter lid, white foam",
  ),
  token("beetle-car", "classic Beetle car", "pastel yellow, chrome details"),
  token("cuckoo-clock", "Black Forest cuckoo clock", "dark wood, carved leaves, white dial"),
  token("garden-gnome", "cheerful garden gnome", "red hat, blue coat, white beard"),
  token(
    "bratwurst",
    "bratwurst in a bread roll with mustard",
    "browned sausage, golden roll, yellow mustard",
  ),
  token(
    "pickelhaube",
    "19th-century German Pickelhaube: a smooth rounded leather helmet dome with a tall pointed brass spike on the very top, a small flat front peak visor and a short neck peak, resting on a low round wooden base; not a knight helmet, no face guard, no grille, no head, no pole",
    "smooth glossy black leather dome, polished brass spike, small brass eagle plate on the front",
    "meshy-6",
  ),
  token("train", "small steam locomotive", "dark green and black, red wheels, gold trim"),
  // ---- Italy ----
  token("vespa", "classic Vespa scooter", "mint green, cream seat, chrome"),
  token(
    "pizza",
    "pizza on a wooden peel",
    "golden crust, red tomato, white mozzarella, green basil",
  ),
  token("espresso", "espresso cup on a saucer", "white porcelain, dark coffee with crema"),
  token(
    "gondola-venice",
    "Venetian gondola boat shown large, standing upright on a small display stand, tall curved bow and stern",
    "black lacquer, gold ornaments, red cushion",
  ),
  token("colosseum", "small Colosseum figurine", "warm travertine"),
  token(
    "pasta",
    "bowl of spaghetti with a fork twirled in",
    "white bowl, golden pasta, red tomato sauce",
  ),
  token(
    "gelato",
    "gelato cone with three scoops",
    "waffle cone, pistachio, strawberry and vanilla",
  ),
  token("tower-pisa", "Leaning Tower of Pisa figurine", "white marble, slight warm tint"),
];
