// A Hochstapler server of its own for one scenario that "deploys" a new version: the real server process
// (e2e/support/server.ts) is stopped with SIGTERM like `docker stop` does and started again on the same port and the
// same data directory, but with another build id. The shared webServer of the suite must never be restarted, other
// scenarios play on it.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SERVER_SCRIPT = resolve(import.meta.dirname, "server.ts");
const REPO_ROOT = resolve(import.meta.dirname, "../..");
const STARTUP_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 10_000;

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((ok) => probe.listen(0, "127.0.0.1", ok));
  const address = probe.address();
  await new Promise<void>((ok) => probe.close(() => ok()));
  if (typeof address !== "object" || address === null) {
    throw new Error("Kein freier Port gefunden.");
  }
  return address.port;
}

export class DeployableServer {
  readonly url: string;
  readonly port: number;
  private readonly dataDir: string;
  private readonly extraEnv: NodeJS.ProcessEnv;
  private child: ChildProcess | null = null;

  private constructor(port: number, dataDir: string, extraEnv: NodeJS.ProcessEnv = {}) {
    this.port = port;
    this.dataDir = dataDir;
    this.extraEnv = extraEnv;
    this.url = `http://127.0.0.1:${port}`;
  }

  /** Starts a server announcing `build` (null: the build id of the served client, i.e. no update pending). */
  static async start(
    build: string | null,
    extraEnv: NodeJS.ProcessEnv = {},
  ): Promise<DeployableServer> {
    const server = new DeployableServer(
      await freePort(),
      mkdtempSync(join(tmpdir(), "hochstapler-deploy-")),
      extraEnv,
    );
    await server.run(build);
    return server;
  }

  /**
   * A second instance on another port and the SAME data directory (blue/green): when it starts it asks this one to
   * hand the database over (writer lease, file provider) and resolves once it serves.
   */
  async startSibling(): Promise<DeployableServer> {
    const sibling = new DeployableServer(await freePort(), this.dataDir, this.extraEnv);
    await sibling.run(null);
    return sibling;
  }

  /** Starts the process again on the same data directory (after `stop()`), as the next version. */
  async run(build: string | null): Promise<void> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.extraEnv,
      E2E_PORT: String(this.port),
      E2E_DATA_DIR: this.dataDir,
    };
    if (build === null) {
      delete env["E2E_BUILD_ID"];
    } else {
      env["E2E_BUILD_ID"] = build;
    }
    const child = spawn(process.execPath, ["--import", "tsx", SERVER_SCRIPT], {
      cwd: REPO_ROOT,
      env,
      stdio: "ignore",
    });
    this.child = child;
    await this.untilReady(child);
  }

  /** SIGTERM and wait for the exit: sockets are closed with 1012 after the games are persisted. */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null) {
      return;
    }
    const exited = new Promise<void>((ok) => child.once("exit", () => ok()));
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS);
    await exited;
    clearTimeout(timer);
  }

  async dispose(): Promise<void> {
    await this.stop();
    rmSync(this.dataDir, { recursive: true, force: true });
  }

  private async untilReady(child: ChildProcess): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`The server exited during startup (code ${child.exitCode}).`);
      }
      const ok = await fetch(`${this.url}/api/themes`).then(
        (r) => r.ok,
        () => false,
      );
      if (ok) {
        return;
      }
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error("The server did not start in time.");
  }
}

/**
 * A TCP balancer in front of the instances, like the Container Apps ingress: new connections go to the current target;
 * `switchTo` is the traffic shift of the deploy script. Established connections stay where they are until closed.
 */
export class Balancer {
  readonly url: string;
  private target: number;
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();

  private constructor(server: Server, port: number, target: number) {
    this.server = server;
    this.target = target;
    this.url = `http://127.0.0.1:${port}`;
  }

  static async start(target: number): Promise<Balancer> {
    const port = await freePort();
    let balancer: Balancer | null = null;
    const server = createServer((client) => {
      const upstream = connect(balancer?.target ?? target, "127.0.0.1");
      for (const s of [client, upstream]) {
        balancer?.sockets.add(s);
        s.on("close", () => balancer?.sockets.delete(s));
        s.on("error", () => {
          client.destroy();
          upstream.destroy();
        });
      }
      client.pipe(upstream).pipe(client);
    });
    await new Promise<void>((ok) => server.listen(port, "127.0.0.1", ok));
    balancer = new Balancer(server, port, target);
    return balancer;
  }

  switchTo(port: number): void {
    this.target = port;
  }

  async close(): Promise<void> {
    for (const s of this.sockets) {
      s.destroy();
    }
    await new Promise<void>((ok) => this.server.close(() => ok()));
  }
}
