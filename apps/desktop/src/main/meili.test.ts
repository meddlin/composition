import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freePort, loadOrCreateMasterKey, MeiliError, MeiliProcessManager, reapOrphan } from "./meili";

/**
 * A stand-in for the real binary: same flags, same /health endpoint, plus
 * failure modes chosen through FAKE_MEILI_MODE. The real thing is exercised by
 * `pnpm smoke`.
 */
const FAKE_MEILI = `#!/usr/bin/env node
const http = require("node:http");
const args = process.argv.slice(2);
const addr = args[args.indexOf("--http-addr") + 1];
const [host, port] = addr.split(":");
const mode = process.env.FAKE_MEILI_MODE || "ok";
if (mode === "exit-early") { console.error("fake meili: boom"); process.exit(3); }
if (mode === "ignore-sigterm") process.on("SIGTERM", () => {});
else process.on("SIGTERM", () => process.exit(0));
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.statusCode = mode === "never-healthy" ? 503 : 200;
    res.end('{"status":"available"}');
  } else if (req.url === "/env") {
    res.end(JSON.stringify({ key: process.env.MEILI_MASTER_KEY, env: process.env.MEILI_ENV, args, cwd: process.cwd() }));
  } else if (req.url === "/die") {
    res.end("bye"); setTimeout(() => process.exit(9), 10);
  } else { res.statusCode = 404; res.end(); }
});
server.listen(Number(port), host);
setInterval(() => {}, 1000);
`;

let dir: string;
let binary: string;

function manager(overrides: Partial<ConstructorParameters<typeof MeiliProcessManager>[0]> = {}) {
  return new MeiliProcessManager({
    binary,
    dataDir: path.join(dir, "meili_data"),
    logPath: path.join(dir, "meili.log"),
    keyPath: path.join(dir, "meili_master_key"),
    pidPath: path.join(dir, "meili.pid"),
    healthTimeoutMs: 3000,
    stopTimeoutMs: 400,
    ...overrides,
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "composition-meili-"));
  binary = path.join(dir, "fake-meilisearch");
  fs.writeFileSync(binary, FAKE_MEILI, { mode: 0o755 });
  vi.stubEnv("FAKE_MEILI_MODE", "ok");
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("MeiliProcessManager", () => {
  it("starts the server, reports a url and key, and stops it cleanly", async () => {
    const m = manager();
    const { url, masterKey } = await m.start();
    const pid = Number(fs.readFileSync(path.join(dir, "meili.pid"), "utf-8"));

    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(masterKey).toMatch(/^[0-9a-f]{64}$/);
    expect(m.running).toBe(true);
    expect(alive(pid)).toBe(true);

    await m.stop();

    expect(m.running).toBe(false);
    expect(alive(pid)).toBe(false);
    expect(fs.existsSync(path.join(dir, "meili.pid"))).toBe(false);
  });

  it("passes the master key through the environment, not the command line, in production mode", async () => {
    const m = manager();
    const { url, masterKey } = await m.start();

    const seen = await (await fetch(`${url}/env`)).json();
    await m.stop();

    expect(seen.key).toBe(masterKey);
    expect(seen.env).toBe("production");
    expect(seen.args).not.toContain(masterKey);
    expect(seen.args).toEqual(
      expect.arrayContaining(["--db-path", path.join(dir, "meili_data"), "--no-analytics"]),
    );
  });

  it("keeps everything it writes inside the app's folder, even when started from a read-only cwd", async () => {
    // A macOS app launched from Finder starts in `/`. Meilisearch writes ./dumps
    // relative to its working directory by default, so the real server died with
    // "Read-only file system" until it was given explicit directories.
    const m = manager();
    const { url } = await m.start();

    const seen = await (await fetch(`${url}/env`)).json();
    await m.stop();

    expect(fs.realpathSync(seen.cwd)).toBe(fs.realpathSync(dir));
    const arg = (flag: string) => seen.args[seen.args.indexOf(flag) + 1];
    expect(arg("--dump-dir")).toBe(path.join(dir, "dumps"));
    expect(arg("--snapshot-dir")).toBe(path.join(dir, "snapshots"));
  });

  it("reuses the same master key across restarts", async () => {
    const first = manager();
    const a = await first.start();
    await first.stop();
    const second = manager();
    const b = await second.start();
    await second.stop();

    expect(b.masterKey).toBe(a.masterKey);
  });

  it("fails fast, with the log tail, when the server exits immediately", async () => {
    vi.stubEnv("FAKE_MEILI_MODE", "exit-early");
    const m = manager();

    // The first line alone (what the UI shows) already says why.
    await expect(m.start()).rejects.toThrow(/^Meilisearch exited early \(code 3\): fake meili: boom/);
    expect(m.running).toBe(false);
  });

  it("gives up, and cleans up, when the server never becomes healthy", async () => {
    vi.stubEnv("FAKE_MEILI_MODE", "never-healthy");
    const m = manager({ healthTimeoutMs: 600 });

    await expect(m.start()).rejects.toThrow(/did not become healthy within 600ms/);
    expect(fs.existsSync(path.join(dir, "meili.pid"))).toBe(false);
  });

  it("reports a binary that can't be executed", async () => {
    const m = manager({ binary: path.join(dir, "does-not-exist") });

    await expect(m.start()).rejects.toThrow(MeiliError);
  });

  it("kills a server that ignores SIGTERM once the stop timeout passes", async () => {
    vi.stubEnv("FAKE_MEILI_MODE", "ignore-sigterm");
    const m = manager();
    await m.start();
    const pid = Number(fs.readFileSync(path.join(dir, "meili.pid"), "utf-8"));

    await m.stop();

    expect(alive(pid)).toBe(false);
  });

  it("tells the app when the server dies after it was healthy, but not when we stop it", async () => {
    const onUnexpectedExit = vi.fn();
    const m = manager({ onUnexpectedExit });
    const { url } = await m.start();

    await fetch(`${url}/die`);
    await vi.waitFor(() => expect(onUnexpectedExit).toHaveBeenCalledWith({ code: 9, signal: null }));
    await m.stop();

    const quiet = vi.fn();
    const m2 = manager({ onUnexpectedExit: quiet });
    await m2.start();
    await m2.stop();
    expect(quiet).not.toHaveBeenCalled();
  });

  it("refuses to start twice", async () => {
    const m = manager();
    await m.start();

    await expect(m.start()).rejects.toThrow(/already running/);
    await m.stop();
  });
});

describe("loadOrCreateMasterKey", () => {
  it("creates a 64-hex-character key readable only by the owner, then reuses it", () => {
    const keyPath = path.join(dir, "nested", "key");

    const key = loadOrCreateMasterKey(keyPath);

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(loadOrCreateMasterKey(keyPath)).toBe(key);
  });
});

describe("reapOrphan", () => {
  function spawnOrphan(args: string[]) {
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", ...args], {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    return child.pid!;
  }

  it("kills a leftover server that was using our data directory", async () => {
    const dataDir = path.join(dir, "meili_data");
    const pid = spawnOrphan(["--db-path", dataDir]);
    const pidPath = path.join(dir, "meili.pid");
    fs.writeFileSync(pidPath, String(pid));

    await reapOrphan(pidPath, dataDir);

    await vi.waitFor(() => expect(alive(pid)).toBe(false));
    expect(fs.existsSync(pidPath)).toBe(false);
  });

  it("leaves alone an unrelated process that happens to have the recorded pid", async () => {
    const pid = spawnOrphan(["--something-else"]);
    const pidPath = path.join(dir, "meili.pid");
    fs.writeFileSync(pidPath, String(pid));

    await reapOrphan(pidPath, path.join(dir, "meili_data"));

    expect(alive(pid)).toBe(true);
    expect(fs.existsSync(pidPath)).toBe(false);
    process.kill(pid, "SIGKILL");
  });

  it("does nothing when there is no pid file or it is garbage", async () => {
    const pidPath = path.join(dir, "meili.pid");
    await reapOrphan(pidPath, "/x");
    fs.writeFileSync(pidPath, "not-a-pid");
    await reapOrphan(pidPath, "/x");
  });
});

describe("freePort", () => {
  it("returns a usable loopback port", async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(1023);
  });
});
