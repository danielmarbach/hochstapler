// Batch-generate 3D assets with the Meshy API, then optimise them and register them in the client manifest.
//
// Usage (from repo root):
//   npx tsx scripts/meshy/generate.ts --rescale            # recompute manifest scales from GLBs on disk
//   npx tsx scripts/meshy/generate.ts --dry-run            # list assets + credit estimate
//   npx tsx scripts/meshy/generate.ts [--only token-cow,house] [--concurrency 5]
//
// Needs MESHY_API_KEY in .env.local (gitignored). Resumable: progress is kept in scripts/meshy/state.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  center,
  dedup,
  getBounds,
  prune,
  simplify,
  textureCompress,
  weld,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import {
  ASSETS,
  POLYCOUNT,
  geometryPrompt,
  modelFor,
  texturePrompt,
  type AssetSpec,
} from "./assets.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STATE_FILE = join(ROOT, "scripts/meshy/state.json");
const RAW_DIR = join(ROOT, "scripts/meshy/raw");
const MODELS_DIR = join(ROOT, "packages/client/public/assets/models");
const MANIFEST_FILE = join(MODELS_DIR, "manifest.json");
const API = "https://api.meshy.ai/openapi/v2/text-to-3d";
const POLL_MS = 10_000;
const TEXTURE_SIZE = 1024;
const SIMPLIFY_ERROR = 0.002;
const CREDITS = { "meshy-6-lite": 10, "meshy-6": 20, texture: 10 } as const;

const TaskSchema = z.object({
  id: z.string(),
  status: z.enum(["PENDING", "IN_PROGRESS", "SUCCEEDED", "FAILED", "CANCELED"]),
  progress: z.number().optional(),
  model_urls: z.object({ glb: z.string().optional() }).partial().optional(),
  task_error: z.object({ message: z.string().optional() }).nullish(),
});
type Task = z.infer<typeof TaskSchema>;

const AssetStateSchema = z.object({
  previewId: z.string().optional(),
  refineId: z.string().optional(),
  done: z.boolean().default(false),
});
const StateSchema = z.record(z.string(), AssetStateSchema);
type State = z.infer<typeof StateSchema>;

const ManifestSchema = z.record(
  z.string(),
  z.object({
    file: z.string(),
    scale: z.number().optional(),
    rotationY: z.number().optional(),
    yOffset: z.number().optional(),
  }),
);

function readJson<T>(file: string, schema: z.ZodType<T>, fallback: T): T {
  if (!existsSync(file)) {
    return fallback;
  }
  return schema.parse(JSON.parse(readFileSync(file, "utf8")));
}

function loadApiKey(): string {
  const envFile = join(ROOT, ".env.local");
  const fromFile = existsSync(envFile)
    ? /^MESHY_API_KEY=(.+)$/m.exec(readFileSync(envFile, "utf8"))?.[1]?.trim()
    : undefined;
  const key = process.env.MESHY_API_KEY ?? fromFile;
  if (!key) {
    throw new Error("MESHY_API_KEY missing: add it to .env.local (MESHY_API_KEY=msy_...)");
  }
  return key;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

class Meshy {
  readonly #key: string;
  constructor(key: string) {
    this.#key = key;
  }

  async #request(path: string, init?: RequestInit): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${API}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.#key}`, "Content-Type": "application/json" },
      });
      if (res.status === 429 && attempt < 6) {
        await sleep(2 ** attempt * 2_000);
        continue;
      }
      if (!res.ok) {
        throw new Error(`Meshy ${res.status}: ${await res.text()}`);
      }
      return res.json();
    }
  }

  async create(body: Record<string, unknown>): Promise<string> {
    const json = z
      .object({ result: z.string() })
      .parse(await this.#request("", { method: "POST", body: JSON.stringify(body) }));
    return json.result;
  }

  async waitFor(id: string, label: string): Promise<Task> {
    for (;;) {
      const task = TaskSchema.parse(await this.#request(`/${id}`));
      if (task.status === "SUCCEEDED") {
        return task;
      }
      if (task.status === "FAILED" || task.status === "CANCELED") {
        throw new Error(`${label}: ${task.status} ${task.task_error?.message ?? ""}`);
      }
      console.log(`  … ${label} ${task.progress ?? 0}%`);
      await sleep(POLL_MS);
    }
  }
}

/** Largest bounding-box extent: models are normalised to fit a 1×1×1 cube (wide models must fit a tile). */
function maxExtent(min: number[], max: number[]): number {
  return Math.max(...max.map((v, i) => v - (min[i] ?? 0)));
}

function scaleFor(size: number): number {
  return size > 0 ? Number((1 / size).toFixed(4)) : 1;
}

/** Recompute manifest scales from the optimised GLBs already on disk (no API calls). */
async function rescaleManifest(): Promise<void> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const manifest = readJson(MANIFEST_FILE, ManifestSchema, {});
  for (const [name, entry] of Object.entries(manifest)) {
    const doc = await io.read(join(MODELS_DIR, entry.file));
    const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
    if (!scene) {
      continue;
    }
    const { min, max } = getBounds(scene);
    entry.scale = scaleFor(maxExtent(min, max));
    console.log(`${name.padEnd(28)} scale ${entry.scale}`);
  }
  writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function optimise(rawFile: string, outFile: string): Promise<{ size: number }> {
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(rawFile);
  await doc.transform(
    dedup(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, error: SIMPLIFY_ERROR }),
    prune(),
    center({ pivot: "below" }),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [TEXTURE_SIZE, TEXTURE_SIZE] }),
  );
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) {
    throw new Error(`${rawFile}: no scene`);
  }
  const { min, max } = getBounds(scene);
  await io.write(outFile, doc);
  return { size: maxExtent(min, max) };
}

async function processAsset(
  meshy: Meshy,
  asset: AssetSpec,
  state: State,
  save: () => void,
): Promise<void> {
  const s = (state[asset.name] ??= { done: false });
  const model = modelFor(asset);

  if (!s.previewId) {
    s.previewId = await meshy.create({
      mode: "preview",
      prompt: geometryPrompt(asset),
      ai_model: model,
      should_remesh: true,
      topology: "triangle",
      target_polycount: POLYCOUNT[asset.kind],
      target_formats: ["glb"],
    });
    save();
    console.log(`▶ ${asset.name}: Geometrie gestartet`);
  }
  await meshy.waitFor(s.previewId, `${asset.name} (Geometrie)`);

  if (!s.refineId) {
    s.refineId = await meshy.create({
      mode: "refine",
      preview_task_id: s.previewId,
      texture_prompt: texturePrompt(asset),
      enable_pbr: false,
      target_formats: ["glb"],
    });
    save();
    console.log(`▶ ${asset.name}: Textur gestartet`);
  }
  const refined = await meshy.waitFor(s.refineId, `${asset.name} (Textur)`);
  const glbUrl = refined.model_urls?.glb;
  if (!glbUrl) {
    throw new Error(`${asset.name}: no GLB URL`);
  }

  const rawFile = join(RAW_DIR, `${asset.name}.glb`);
  const res = await fetch(glbUrl);
  if (!res.ok) {
    throw new Error(`${asset.name}: Download ${res.status}`);
  }
  writeFileSync(rawFile, Buffer.from(await res.arrayBuffer()));

  const file = `${asset.name}.glb`;
  const { size } = await optimise(rawFile, join(MODELS_DIR, file));
  const manifest = readJson(MANIFEST_FILE, ManifestSchema, {});
  manifest[asset.name] = {
    file,
    scale: scaleFor(size),
    rotationY: 0,
    yOffset: 0,
  };
  writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  s.done = true;
  save();
  console.log(`✔ ${asset.name} → ${file}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      only: { type: "string" },
      concurrency: { type: "string", default: "5" },
      "dry-run": { type: "boolean", default: false },
      rescale: { type: "boolean", default: false },
    },
  });
  if (values.rescale) {
    await rescaleManifest();
    return;
  }
  const only = values.only ? new Set(values.only.split(",").map((n) => n.trim())) : null;
  const state = readJson(STATE_FILE, StateSchema, {});
  const todo = ASSETS.filter((a) => (only ? only.has(a.name) : true) && !state[a.name]?.done);
  const credits = todo.reduce((sum, a) => sum + CREDITS[modelFor(a)] + CREDITS.texture, 0);
  console.log(`${todo.length} assets open, estimated ${credits} credits`);
  if (values["dry-run"]) {
    for (const a of todo) {
      console.log(`  ${a.name.padEnd(28)} ${modelFor(a)}`);
    }
    return;
  }

  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(MODELS_DIR, { recursive: true });
  const meshy = new Meshy(loadApiKey());
  const save = (): void => writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  const queue = [...todo];
  const failures: string[] = [];
  const worker = async (): Promise<void> => {
    for (let asset = queue.shift(); asset; asset = queue.shift()) {
      try {
        await processAsset(meshy, asset, state, save);
      } catch (err: unknown) {
        failures.push(asset.name);
        console.error(`✖ ${asset.name}:`, err instanceof Error ? err.message : err);
      }
    }
  };
  await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));
  console.log(
    failures.length
      ? `Fertig, fehlgeschlagen: ${failures.join(", ")} (erneut starten setzt fort)`
      : "Alle Assets fertig.",
  );
}

await main();
