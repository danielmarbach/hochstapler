# Asset-Briefs (Meshy.ai / Blender / Codex)

The game runs **without** assets: every missing model has a procedural fallback geometry.
To add new models:

1. Copy the GLB to `packages/client/public/assets/models/<assetName>.glb`.
2. Add an entry to `packages/client/public/assets/models/manifest.json`:
   ```json
   { "house": { "file": "house.glb", "scale": 1, "rotationY": 0, "yOffset": 0 } }
   ```
3. Reload the browser – done.

## Technical requirements for all 3D models

- Format **GLB** (glTF binary), Y-up, origin **at the bottom centre** (model stands on y=0).
- Height about 1 unit (scaling happens in the manifest), facing direction +Z.
- Meshy: topology "Low Poly" or polycount **≤ 10k triangles** (game tokens ≤ 5k), PBR textures on, 1024px textures are enough.
- Uniform style for all models: **"stylized low-poly diorama, soft pastel colors, clean bevelled shapes, board game miniature, matte finish"**.
- Post-processing (optional, Blender): set the origin (`Set Origin → Origin to Geometry`, then move it down), Decimate, export glTF Binary with "+Y Up".

## General models (all countries)

| Asset-Name | Meshy-Prompt (Text to 3D) |
|---|---|
| `house` | small cute gabled house, board game miniature, single piece, stylized low-poly diorama, soft pastel green walls, white roof trim, matte |
| `hotel` | small boutique hotel building, 3 floors, flat roof with tiny sign, board game miniature, stylized low-poly, soft pastel red, matte |
| `skyscraper` | slender modern glass skyscraper, stepped crown, board game miniature, stylized low-poly, soft blue glass with warm window lights, matte base |
| `dice` | single six-sided game die, rounded edges, ivory white with dark pips, stylized (optional – the procedural die is already good) |

## Country-specific models

The token IDs come from `packages/engine/src/themes/*.ts` (field `tokens`). Asset name = `token-<id>`.
Prompt template for tokens: **"<object>, board game token miniature, single solid piece on small round base, stylized low-poly, soft pastel colors, matte, chunky silhouette"**.

| Country | Token IDs (Asset `token-<id>`) |
|---|---|
| 🇨🇭 CH | cow, swiss-knife, cheese, watch, chocolate, st-bernard, fondue, gondola |
| 🇫🇷 FR | baguette, beret, rooster, croissant, wine-bottle, eiffel, scooter, perfume |
| 🇩🇪 DE | pretzel, beer-stein, beetle-car, cuckoo-clock, garden-gnome, bratwurst, pickelhaube, train |
| 🇮🇹 IT | vespa, pizza, espresso, gondola-venice, colosseum, pasta, gelato, tower-pisa |

Example: `token-cow` → "cute swiss cow with bell, board game token miniature, single solid piece on small round base, stylized low-poly, soft pastel colors, matte, chunky silhouette".

Priority when free credits are scarce: first `house`, `hotel`, `skyscraper`, then the tokens of the most played country (CH), then the landmarks.

| Asset-Name | Prompt |
|---|---|
| `landmark-matterhorn` | Matterhorn mountain peak miniature with snow cap on small round base, stylized low-poly diorama, pastel |
| `landmark-eiffel` | Eiffel tower miniature on small round base, stylized low-poly, pastel bronze |
| `landmark-brandenburg` | Brandenburg Gate miniature with quadriga, stylized low-poly diorama, pastel sandstone |
| `landmark-colosseum` | Colosseum Rome miniature, stylized low-poly diorama, pastel travertine |
| `skyscraper-prime-tower` | Prime Tower Zurich, green glass tower, board game miniature, stylized low-poly |
| `skyscraper-la-defense` | La Défense style modern office tower, board game miniature, stylized low-poly |
| `skyscraper-fernsehturm` | Berlin TV tower Fernsehturm miniature, sphere on slender shaft, stylized low-poly |

## 2D graphics (Codex / image generation)

| File | Purpose | Prompt idea |
|---|---|---|
| `packages/client/public/assets/img/logo.png` | Logo "Hochstapler" | playful premium board game logo "Hochstapler", serif lettering, small globe and house icons, transparent background |
| `packages/client/public/assets/img/card-chance.png` | Card back, Chance (Ereignis) | elegant card back, question mark motif, pastel orange, art deco frame |
| `packages/client/public/assets/img/card-community.png` | Card back, Community (Gemeinschaft) | elegant card back, treasure chest motif, pastel blue, art deco frame |
| `packages/client/public/assets/img/board-center-<theme>.png` | Board centre per country (optional) | stylized illustrated map of <country> in pastel colors, board game centre art |

Codex can also draw canvas/SVG icons for station, utility, tax etc.; the icons live in the client under `src/three/` (procedural drawing functions).

## Provenance and license

All models in `packages/client/public/assets/models/` were generated through the Meshy API (`scripts/meshy/generate.ts`)
on a paid Meshy Pro plan: the initial set of 42 models on 2026-10-24, the beret and pickelhaube tokens regenerated on
2026-10-26. Earlier experiments made with free credits in the Meshy web app were never added to the repository. Models
and the token thumbnails rendered from them are licensed under CC BY 4.0 (see `NOTICE.md`).

