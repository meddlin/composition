import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isExecutableFile, listNotes, resolveMeiliBinary, service } from "./backend";
import { ApplicationDataMoveError } from "./dataLocation";
import { startRuntime, type Runtime } from "./runtime";

/** A stand-in Meilisearch: same flags and /health endpoint, nothing else. */
const FAKE_MEILI = `#!/usr/bin/env node
const http = require("node:http");
const args = process.argv.slice(2);
const [host, port] = args[args.indexOf("--http-addr") + 1].split(":");
process.on("SIGTERM", () => process.exit(0));
http.createServer((req, res) => { res.statusCode = req.url === "/health" ? 200 : 404; res.end("{}"); }).listen(Number(port), host);
setInterval(() => {}, 1000);
`;

let home: string;
let dataDir: string;
let runtime: Runtime | null;

const writeSettings = (appDataDir: string) =>
  fs.writeFileSync(process.env.COMPOSITION_SETTINGS_PATH!, JSON.stringify({ appDataDir, theme: "dark" }));

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-runtime-"));
  dataDir = path.join(home, "data");
  vi.stubEnv("COMPOSITION_SETTINGS_PATH", path.join(home, ".composition-cli", "settings.json"));
  fs.mkdirSync(path.join(home, ".composition-cli"), { recursive: true });
  writeSettings(dataDir);
  const fake = path.join(home, "fake-meilisearch");
  fs.writeFileSync(fake, FAKE_MEILI, { mode: 0o755 });
  vi.stubEnv("COMPOSITION_MEILI_BIN", fake);
  runtime = null;
});

afterEach(async () => {
  await runtime?.stop();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("startRuntime", () => {
  it("starts Meilisearch in the data directory and stops it on stop()", async () => {
    runtime = await startRuntime({ home });
    const pidFile = path.join(dataDir, "meili.pid");
    const pid = Number(fs.readFileSync(pidFile, "utf-8"));
    expect(() => process.kill(pid, 0)).not.toThrow();

    await runtime.stop();
    runtime = null;

    expect(() => process.kill(pid, 0)).toThrow();
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  it("keeps notes working, and says why search can't, when there is no Meilisearch binary", async () => {
    vi.stubEnv("COMPOSITION_MEILI_BIN", path.join(home, "does-not-exist"));

    runtime = await startRuntime({ home });
    await service.createNote("Still works");

    expect(listNotes().map((n) => n.title)).toEqual(["Still works"]);
    const result = await service.searchNotes("works");
    expect(result.hits).toEqual([]);
    expect(result.error).toMatch(/Meilisearch binary wasn't found/);
  });

  it("imports the Python CLI's settings on first run", async () => {
    fs.rmSync(process.env.COMPOSITION_SETTINGS_PATH!);
    const legacyDir = path.join(home, ".composition");
    fs.mkdirSync(legacyDir);
    fs.writeFileSync(path.join(legacyDir, "settings.yaml"), `app_data_dir: ${dataDir}\ntheme: composition-forest\n`);

    runtime = await startRuntime({ home });

    expect(JSON.parse(fs.readFileSync(process.env.COMPOSITION_SETTINGS_PATH!, "utf-8"))).toEqual({
      appDataDir: dataDir,
      theme: "forest",
    });
    expect(fs.existsSync(path.join(dataDir, "meili.pid"))).toBe(true);
  });

  it("uses ~/.composition-cli/settings.json when no settings path is configured", async () => {
    vi.stubEnv("COMPOSITION_SETTINGS_PATH", "");
    delete process.env.COMPOSITION_SETTINGS_PATH;

    runtime = await startRuntime({ home });

    expect(process.env.COMPOSITION_SETTINGS_PATH).toBe(path.join(home, ".composition-cli", "settings.json"));
  });
});

describe("moveDataLocation", () => {
  it("moves the database and search data, then reopens both at the new location", async () => {
    runtime = await startRuntime({ home });
    const note = await service.createNote("Moved note");
    const newDir = path.join(home, "new-data");

    await runtime.moveDataLocation(newDir);

    expect(JSON.parse(fs.readFileSync(process.env.COMPOSITION_SETTINGS_PATH!, "utf-8")).appDataDir).toBe(newDir);
    expect(fs.existsSync(path.join(dataDir, "composition.db"))).toBe(false);
    expect(listNotes().map((n) => [n.id, n.title])).toEqual([[note.id, "Moved note"]]);
    expect(fs.existsSync(path.join(newDir, "composition.db"))).toBe(true);
    expect(fs.existsSync(path.join(newDir, "meili.pid"))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, "meili.pid"))).toBe(false);
  });

  it("puts everything back and keeps working when the move is refused", async () => {
    runtime = await startRuntime({ home });
    await service.createNote("Stays put");
    const blocked = path.join(home, "blocked");
    fs.mkdirSync(blocked);
    fs.writeFileSync(path.join(blocked, "composition.db"), "someone else's");

    await expect(runtime.moveDataLocation(blocked)).rejects.toBeInstanceOf(ApplicationDataMoveError);

    expect(JSON.parse(fs.readFileSync(process.env.COMPOSITION_SETTINGS_PATH!, "utf-8")).appDataDir).toBe(dataDir);
    expect(listNotes().map((n) => n.title)).toEqual(["Stays put"]);
    expect(fs.readFileSync(path.join(blocked, "composition.db"), "utf-8")).toBe("someone else's");
    expect(fs.existsSync(path.join(dataDir, "meili.pid"))).toBe(true);
  });
});

// The real thing, when this machine has it (CI doesn't): index a note, find it again.
const realBinary = resolveMeiliBinary({
  env: { PATH: process.env.PATH },
  packaged: false,
  resourcesPath: "",
  platform: process.platform,
  isExecutable: isExecutableFile,
});

describe.skipIf(!realBinary)("with a real Meilisearch", () => {
  it("finds a note by text and by a tag filter", async () => {
    vi.stubEnv("COMPOSITION_MEILI_BIN", realBinary!);
    runtime = await startRuntime({ home });
    const note = await service.createNote("Quarterly planning");
    await service.saveNoteContent(
      note.id,
      "---\ntitle: Quarterly planning\ndescription: budget review\ntags: [work]\n---\nroadmap and budget\n",
    );
    await service.createNote("Groceries");

    // Indexing is asynchronous inside Meilisearch; give it a moment to settle.
    await vi.waitFor(async () => {
      const byText = await service.searchNotes("budget");
      expect(byText.error).toBeUndefined();
      expect(byText.hits.map((h) => h.title)).toEqual(["Quarterly planning"]);
    }, { timeout: 15_000, interval: 300 });
    const byTag = await service.searchNotes("tag: work");
    expect(byTag.hits.map((h) => h.title)).toEqual(["Quarterly planning"]);
    const byDescription = await service.searchNotes("description: budget");
    expect(byDescription.hits.map((h) => h.title)).toEqual(["Quarterly planning"]);
  }, 40_000);
});
