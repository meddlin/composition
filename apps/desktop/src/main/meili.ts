import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

/**
 * Starts, supervises and stops a local Meilisearch server for the app.
 * Also used by the terminal app (apps/cli reaches it through its backend.ts seam),
 * which started life with a Python version of this class and kept its behavior:
 * random free port, generated master key kept in a 0600 file, health-poll before
 * use, terminate then kill on stop.
 *
 * Differences from the CLI:
 *  - the master key goes in the environment rather than argv (so it isn't
 *    visible in `ps`), and the server runs in production mode, which turns off
 *    Meilisearch's built-in web dashboard;
 *  - dumps and snapshots get explicit directories beside the data directory, and
 *    the working directory is that folder. By default Meilisearch writes
 *    `./dumps` relative to the working directory, and a macOS app launched from
 *    Finder starts in `/`, which is read-only: the server died at startup with
 *    "Read-only file system (os error 30)".
 */

export type MeiliOptions = {
  binary: string;
  dataDir: string;
  logPath: string;
  keyPath: string;
  /** Records our child's pid so a crash of the app can't leave an orphan behind. */
  pidPath: string;
  healthTimeoutMs?: number;
  stopTimeoutMs?: number;
  /** Called if the server dies after it had become healthy. */
  onUnexpectedExit?: (info: { code: number | null; signal: NodeJS.Signals | null }) => void;
};

export type MeiliHandle = { url: string; masterKey: string };

export class MeiliError extends Error {}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}

export function loadOrCreateMasterKey(keyPath: string): string {
  try {
    const existing = fs.readFileSync(keyPath, "utf-8").trim();
    if (existing) return existing;
  } catch {
    // fall through and create one
  }
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  const key = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  fs.chmodSync(keyPath, 0o600);
  return key;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function commandLine(pid: number): string {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf-8" });
  return result.status === 0 ? result.stdout : "";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Kills a Meilisearch left behind by a previous run that died without
 * stopping it. Only a process whose command line mentions our data directory
 * is touched, so a recycled pid belonging to something else is left alone.
 */
export async function reapOrphan(pidPath: string, dataDir: string): Promise<void> {
  let pid: number;
  try {
    pid = Number.parseInt(fs.readFileSync(pidPath, "utf-8"), 10);
  } catch {
    return;
  }
  fs.rmSync(pidPath, { force: true });
  if (!Number.isInteger(pid) || pid <= 1 || !isAlive(pid)) return;
  if (!commandLine(pid).includes(dataDir)) return;

  process.kill(pid, "SIGTERM");
  for (let waited = 0; waited < 3000 && isAlive(pid); waited += 100) await sleep(100);
  if (isAlive(pid)) process.kill(pid, "SIGKILL");
}

export class MeiliProcessManager {
  private process: ChildProcess | null = null;
  private exited: Promise<void> | null = null;
  private logFd: number | null = null;
  private stopping = false;

  constructor(private readonly options: MeiliOptions) {}

  get running(): boolean {
    return this.process !== null && this.process.exitCode === null && !this.stopping;
  }

  async start(): Promise<MeiliHandle> {
    if (this.process) throw new MeiliError("Meilisearch is already running");
    const { binary, dataDir, logPath, keyPath, pidPath } = this.options;

    // Everything Meilisearch writes stays under this folder.
    const stateDir = path.dirname(dataDir);

    await reapOrphan(pidPath, dataDir);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const masterKey = loadOrCreateMasterKey(keyPath);
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;

    this.logFd = fs.openSync(logPath, "a");
    const child = spawn(
      binary,
      [
        "--db-path",
        dataDir,
        "--http-addr",
        `127.0.0.1:${port}`,
        "--dump-dir",
        path.join(stateDir, "dumps"),
        "--snapshot-dir",
        path.join(stateDir, "snapshots"),
        "--no-analytics",
      ],
      {
        cwd: stateDir,
        stdio: ["ignore", this.logFd, this.logFd],
        env: { ...process.env, MEILI_MASTER_KEY: masterKey, MEILI_ENV: "production" },
      },
    );
    this.process = child;
    this.stopping = false;

    let startupFailure: Error | null = null;
    child.once("error", (error) => {
      startupFailure = new MeiliError(`Could not start Meilisearch (${binary}): ${error.message}`);
    });
    let healthy = false;
    this.exited = new Promise<void>((resolve) => {
      child.once("exit", (code, signal) => {
        resolve();
        if (healthy && !this.stopping) this.options.onUnexpectedExit?.({ code, signal });
      });
    });

    if (child.pid) fs.writeFileSync(pidPath, String(child.pid));

    try {
      await this.waitUntilHealthy(url, () => startupFailure);
      healthy = true;
    } catch (error) {
      await this.stop();
      throw error;
    }
    return { url, masterKey };
  }

  private async waitUntilHealthy(url: string, failure: () => Error | null): Promise<void> {
    const timeoutMs = this.options.healthTimeoutMs ?? 10_000;
    const deadline = Date.now() + timeoutMs;
    const child = this.process;

    while (Date.now() < deadline) {
      const error = failure();
      if (error) throw error;
      if (child && child.exitCode !== null) {
        throw new MeiliError(
          `Meilisearch exited early (code ${child.exitCode}): ${this.lastLogLine()}\n${this.logTail()}`,
        );
      }
      try {
        const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) return;
      } catch {
        // not listening yet
      }
      await sleep(100);
    }
    throw new MeiliError(
      `Meilisearch did not become healthy within ${timeoutMs}ms: ${this.lastLogLine()}\n${this.logTail()}`,
    );
  }

  /** The last non-empty line of the server's log, without terminal color codes. */
  private lastLogLine(): string {
    try {
      const lines = fs
        .readFileSync(this.options.logPath, "utf-8")
        // eslint-disable-next-line no-control-regex
        .replace(/\x1b\[[0-9;]*m/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      return lines.at(-1) ?? "(no output)";
    } catch {
      return "(no log)";
    }
  }

  private logTail(): string {
    try {
      const text = fs.readFileSync(this.options.logPath, "utf-8");
      return `Log tail:\n${text.slice(-1500)}`;
    } catch {
      return `See ${this.options.logPath}`;
    }
  }

  async stop(): Promise<void> {
    const child = this.process;
    if (child) {
      this.stopping = true;
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        const stopTimeoutMs = this.options.stopTimeoutMs ?? 5000;
        const timedOut = await Promise.race([
          this.exited?.then(() => false),
          sleep(stopTimeoutMs).then(() => true),
        ]);
        if (timedOut) {
          child.kill("SIGKILL");
          await this.exited;
        }
      }
      this.process = null;
      this.exited = null;
    }
    if (this.logFd !== null) {
      fs.closeSync(this.logFd);
      this.logFd = null;
    }
    fs.rmSync(this.options.pidPath, { force: true });
    this.stopping = false;
  }
}
