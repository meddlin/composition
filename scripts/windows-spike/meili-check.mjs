// Meilisearch on Windows, started the way apps/desktop/src/main/meili.ts starts it. Records:
//   - it starts, answers /health, and how long that took;
//   - a hard kill (what child.kill() is on Windows) in the middle of indexing, then a restart on the same data;
//   - what a SECOND server on the same data directory does while the first is still alive (the "orphan" case);
//   - whether `ps` exists, and how long the PowerShell command-line lookup meili.ts would need instead takes.
//
//   MEILI_BIN=<meilisearch(.exe)> SPIKE_DIR=<scratch> node meili-check.mjs
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { record } from "./record.mjs";

const binary = process.env.MEILI_BIN;
const scratch = path.join(process.env.SPIKE_DIR ?? ".", "meili-check");
if (!binary) throw new Error("MEILI_BIN is not set");
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(scratch, { recursive: true });

const key = crypto.randomBytes(16).toString("hex");
const dataDir = path.join(scratch, "state", "meili_data");
fs.mkdirSync(dataDir, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Same flags and environment as MeiliProcessManager.start. */
async function start(label) {
  const port = await freePort();
  const log = path.join(scratch, `${label}.log`);
  const fd = fs.openSync(log, "a");
  const child = spawn(
    binary,
    [
      "--db-path", dataDir,
      "--http-addr", `127.0.0.1:${port}`,
      "--dump-dir", path.join(scratch, "state", "dumps"),
      "--snapshot-dir", path.join(scratch, "state", "snapshots"),
      "--no-analytics",
    ],
    {
      cwd: path.join(scratch, "state"),
      stdio: ["ignore", fd, fd],
      env: { ...process.env, MEILI_MASTER_KEY: key, MEILI_ENV: "production" },
      windowsHide: true,
    },
  );
  const handle = { child, port, log, url: `http://127.0.0.1:${port}`, exit: null };
  child.once("error", (error) => (handle.exit = { error: error.message }));
  child.once("exit", (code, signal) => (handle.exit = { code, signal }));
  return handle;
}

const tail = (file) => {
  try {
    return fs.readFileSync(file, "utf-8").replace(/\x1b\[[0-9;]*m/g, "").trim().split("\n").slice(-3).join(" | ");
  } catch {
    return "(no log)";
  }
};

async function healthy(handle, timeoutMs = 20_000) {
  const begun = Date.now();
  while (Date.now() - begun < timeoutMs) {
    if (handle.exit) return null;
    try {
      const response = await fetch(`${handle.url}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return Date.now() - begun;
    } catch {
      // not listening yet
    }
    await sleep(100);
  }
  return null;
}

const api = (handle, route, init = {}) =>
  fetch(`${handle.url}${route}`, { ...init, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...init.headers } });

async function stopHard(handle) {
  if (handle.exit) return;
  const gone = new Promise((resolve) => handle.child.once("exit", resolve));
  handle.child.kill();
  await Promise.race([gone, sleep(10_000)]);
}

// 1. Start.
const first = await start("first");
const startedIn = await healthy(first);
record("meilisearch starts and answers /health", startedIn !== null, startedIn !== null ? `${startedIn} ms` : (first.exit ? JSON.stringify(first.exit) : "timed out") + ` ${tail(first.log)}`);
if (startedIn === null) process.exit(0);

// 2. Index enough documents that the task is still running when it is killed.
const documents = Array.from({ length: 30_000 }, (_, id) => ({ id, title: `note ${id}`, body: `lorem ipsum dolor sit amet ${id} `.repeat(20) }));
const enqueue = await api(first, "/indexes/notes/documents?primaryKey=id", { method: "POST", body: JSON.stringify(documents) });
record("indexing task accepted", enqueue.status === 202, `HTTP ${enqueue.status}`);
await sleep(700);
const killedAt = Date.now();
await stopHard(first);
record("hard kill (child.kill) ends the process", first.exit !== null, `${Date.now() - killedAt} ms, ${JSON.stringify(first.exit)}`);

// 3. Restart on the same data.
const second = await start("second");
const restartedIn = await healthy(second);
record("restart on the same data after a hard kill", restartedIn !== null, restartedIn !== null ? `${restartedIn} ms` : `${JSON.stringify(second.exit)} ${tail(second.log)}`);
if (restartedIn !== null) {
  const deadline = Date.now() + 60_000;
  let statuses = "";
  while (Date.now() < deadline) {
    const tasks = await (await api(second, "/tasks?limit=5")).json();
    statuses = (tasks.results ?? []).map((task) => `${task.type}:${task.status}`).join(",");
    if ((tasks.results ?? []).every((task) => !["enqueued", "processing"].includes(task.status))) break;
    await sleep(500);
  }
  const stats = await api(second, "/indexes/notes/stats");
  const count = stats.ok ? (await stats.json()).numberOfDocuments : `HTTP ${stats.status}`;
  // Either outcome is fine for us (the index is rebuilt from SQLite); what matters is that the server is usable.
  record("index after the hard kill is readable", stats.ok || stats.status === 404, `documents=${count}; tasks ${statuses}`);

  // 4. A second server on the same data directory while the first is alive.
  const third = await start("third");
  await sleep(6000);
  const thirdHealthy = third.exit ? null : await healthy(third, 4000);
  record(
    "second server on the same data dir while the first is alive",
    null,
    third.exit ? `exited early ${JSON.stringify(third.exit)}: ${tail(third.log)}` : thirdHealthy !== null ? "STARTED (no lock conflict)" : `still running, not healthy: ${tail(third.log)}`,
  );
  await stopHard(third);

  // 5. What the orphan check in meili.ts needs on Windows.
  const ps = spawnSync("ps", ["-p", String(second.child.pid), "-o", "command="], { encoding: "utf-8" });
  record("`ps -p` exists (what reapOrphan uses today)", null, ps.error ? ps.error.code : `status ${ps.status}`);
  if (process.platform === "win32") {
    const begun = Date.now();
    const lookup = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${second.child.pid}').CommandLine`],
      { encoding: "utf-8", windowsHide: true },
    );
    const line = (lookup.stdout ?? "").trim();
    record("PowerShell command-line lookup finds our data dir", line.includes(dataDir), `${Date.now() - begun} ms; ${line.slice(0, 160)}`);
  }
  await stopHard(second);
}
process.exit(0);
