// Contact sheet of all generated Meshy models (thumbnails) for visual QA → /tmp/meshy-contact-sheet.jpg
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
const root = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const key = /^MESHY_API_KEY=(.+)$/m.exec(readFileSync(`${root}/.env.local`, "utf8"))[1].trim();
const state = JSON.parse(readFileSync(`${root}/scripts/meshy/state.json`, "utf8"));
const names = Object.keys(state);
const tiles = [];
for (const n of names)
  tiles.push(
    await (async () => {
      const t = await (
        await fetch(`https://api.meshy.ai/openapi/v2/text-to-3d/${state[n].refineId}`, {
          headers: { Authorization: `Bearer ${key}` },
        })
      ).json();
      if (!t.thumbnail_url) {
        throw new Error(`${n}: ${JSON.stringify(t).slice(0, 200)}`);
      }
      const img = Buffer.from(await (await fetch(t.thumbnail_url)).arrayBuffer());
      const label = Buffer.from(
        `<svg width="200" height="24"><rect width="200" height="24" fill="white"/><text x="4" y="17" font-size="13" font-family="sans-serif">${n}</text></svg>`,
      );
      return sharp(img)
        .resize(200, 200)
        .flatten({ background: "#ffffff" })
        .extend({ bottom: 24, background: "#ffffff" })
        .composite([{ input: label, top: 200, left: 0 }])
        .png()
        .toBuffer();
    })(),
  );
const cols = 7,
  rows = Math.ceil(tiles.length / cols);
const out = await sharp({
  create: { width: cols * 200, height: rows * 224, channels: 3, background: "#ffffff" },
})
  .composite(
    tiles.map((t, i) => ({ input: t, left: (i % cols) * 200, top: Math.floor(i / cols) * 224 })),
  )
  .jpeg({ quality: 80 })
  .toBuffer();
writeFileSync("/tmp/meshy-contact-sheet.jpg", out);
console.log(names.length, "tiles");
