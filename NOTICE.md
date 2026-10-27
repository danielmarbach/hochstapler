# Notices

The source code of Hochstapler is licensed under the [MIT License](LICENSE). The following parts are **not** covered by
that license or come with their own terms.

## 3D models and token images (not MIT)

`packages/client/public/assets/models/*.glb` and the token thumbnails rendered from them
(`packages/client/public/assets/tokens/*.webp`) were generated with [Meshy](https://www.meshy.ai) (AI text-to-3D, text
prompts only, no reference images; prompts in `scripts/meshy/assets.ts`) and post-processed with gltf-transform. They are
provided for running this game only and are **not** licensed under MIT. Their terms follow the
[Meshy terms of use](https://www.meshy.ai/terms-of-use) of the plan they were generated with; where those require
attribution (Creative Commons Attribution 4.0 for free-plan output), this notice is the attribution:
"3D models generated with Meshy AI". Do not reuse them outside this project without checking those terms.

## Bundled third-party components

| Component | Where | License |
|---|---|---|
| Fonts Alegreya, Bebas Neue, Inter, Limelight via `@fontsource/*` | npm dependencies | SIL Open Font License 1.1 |
| GSAP | npm dependency | [GSAP Standard "no charge" license](https://gsap.com/standard-license) |
| `obscenity` (English word list of the chat filter) | npm dependency | MIT |
| Top-level domain list `packages/server/src/chat/tlds.json` | generated from the IANA list by `scripts/update-tlds.mjs` | IANA data, freely redistributable |
| Aspire agent skills `.claude/skills/aspire*` | scaffolded by the Aspire CLI from [microsoft/aspire-skills](https://github.com/microsoft/aspire-skills) | see upstream repository |

All other npm dependencies are listed in `package-lock.json`; at the time of writing the production dependencies use MIT,
Apache-2.0, BSD-3-Clause, ISC, OFL-1.1, Zlib and 0BSD licenses.

## Trademarks

Hochstapler is an independent game. Place names, landmarks and everyday objects used as themes and tokens are
descriptive; no affiliation with or endorsement by any trademark owner is implied.
