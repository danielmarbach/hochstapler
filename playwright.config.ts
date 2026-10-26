import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

const PORT = Number(process.env["E2E_PORT"] ?? 8788);

const testDir = defineBddConfig({
  features: "e2e/features/*.feature",
  steps: ["e2e/steps/*.ts", "e2e/support/fixtures.ts"],
});

// Software WebGL so the three.js scene also runs on machines/CI without a GPU.
const launchOptions = {
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
};

// Responsive matrix (DESIGN #18): plain Playwright tests in e2e/responsive, run on every viewport below.
const responsiveDir = "e2e/responsive";
const RESPONSIVE_PROJECTS = [
  { name: "se-320", viewport: { width: 320, height: 568 }, touch: true },
  { name: "phone-390", viewport: { width: 390, height: 844 }, touch: true },
  { name: "phone-landscape", viewport: { width: 844, height: 390 }, touch: true },
  { name: "tablet-portrait", viewport: { width: 768, height: 1024 }, touch: true },
  { name: "tablet-landscape", viewport: { width: 1024, height: 768 }, touch: true },
  { name: "desktop-1440", viewport: { width: 1440, height: 900 }, touch: false },
] as const;

export default defineConfig({
  testDir,
  // baselines live in the repo: e2e/__screenshots__/<project>/<screen>.png
  snapshotPathTemplate: "e2e/__screenshots__/{projectName}/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: process.env["CI"] ? 2 : 4,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "de-CH",
    // under reduced motion the client jumps animations to their final state (packages/client/src/three/tween.ts)
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions,
  },
  projects: [
    ...RESPONSIVE_PROJECTS.map((p) => ({
      name: p.name,
      testDir: responsiveDir,
      use: {
        ...(p.touch ? devices["Pixel 7"] : devices["Desktop Chrome"]),
        viewport: p.viewport,
        // phones/tablets: touch + mobile viewport semantics (pointer: coarse, visual viewport), like a real device
        isMobile: p.touch,
        hasTouch: p.touch,
        deviceScaleFactor: 1,
        timezoneId: "Europe/Zurich",
        launchOptions,
      },
    })),
    {
      // headers/CSP (docs/DESIGN.md #42): real renderer, no lite mode
      name: "security",
      testDir: "e2e/security",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, launchOptions },
    },
    {
      name: "desktop",
      grepInvert: /@mobile/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions },
    },
    {
      name: "mobile",
      grepInvert: /@desktop/,
      use: { ...devices["Pixel 7"], launchOptions },
    },
  ],
  webServer: {
    command: "POLY_E2E_HOOKS=1 npm run build -w @poly/client && npx tsx e2e/support/server.ts",
    url: `http://127.0.0.1:${PORT}/api/themes`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
  },
});
