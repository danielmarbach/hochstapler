# 3D models (GLB) for Hochstapler

Put `.glb` files here and register them in `manifest.json`. If a model is missing,
the client automatically draws a procedural fallback geometry – the game stays playable.

## Format

```json
{
  "token-matterhorn": { "file": "token-matterhorn.glb", "scale": 1, "rotationY": 0, "yOffset": 0 },
  "house":            { "file": "house.glb" },
  "skyscraper-zurich": { "file": "skyscraper-zurich.glb" }
}
```

- `file`: file name in this folder. `scale` (default 1), `rotationY` in radians (default 0) and `yOffset` (default 0) are optional.

## Asset names

| Name | Usage |
|---|---|
| `token-<tokenId>` | Game token (`tokenId` from the theme) |
| `house` | House (levels 1-4, up to 4 per space) |
| `hotel` | Hotel (level 5) |
| `skyscraper` | Skyscraper (level 6) |
| `skyscraper-<custom>` | Group-specific, see `Theme.skyscraperModels` |
| `landmark-<x>` | Landmark in the board centre (`Theme.landmark`) |
| `dice` | Die (optional) |

## Model requirements

- Y-up, origin at the centre of the base (ground at y = 0).
- About 1 unit tall (the client scales per type: token, house etc.). Landmarks: about 1 unit tall, scaled to ~5 board spaces.
- Fewer than 10k triangles, one material per part, no lights/cameras.
