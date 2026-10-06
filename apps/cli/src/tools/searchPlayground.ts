import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { listNotes, service } from "../backend";
import { startRuntime } from "../runtime";
import { generateNotes } from "./dummyNotes";
import { indexEverything, seedNotes } from "./seedNotes";

/**
 * `pnpm search:playground`
 *
 * Loads 100 dummy notes into a temporary database, starts a temporary Meilisearch of its
 * own, and gives a `search>` prompt to try queries against them. Everything it makes is
 * removed on the way out. It never touches ~/.composition.
 */
const home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-search-playground-"));
const dataDir = path.join(home, ".composition");
const settings = path.join(home, ".composition-cli", "settings.json");
fs.mkdirSync(path.dirname(settings), { recursive: true });
fs.writeFileSync(settings, JSON.stringify({ appDataDir: dataDir, theme: "dark" }));
process.env.COMPOSITION_SETTINGS_PATH = settings;

console.log(`Temp home: ${home}`);
console.log("Starting a temporary Meilisearch…");
const runtime = await startRuntime({ home });

let exitCode = 0;
try {
  console.log("Loading 100 dummy notes…");
  await seedNotes(generateNotes(100));
  await indexEverything();

  // An unavailable search says why (for instance, no Meilisearch binary on the PATH).
  const probe = await service.searchNotes("lorem");
  if (probe.error) {
    console.error(probe.error);
    exitCode = 1;
  } else {
    console.log("Indexed 100 notes. Try queries like:");
    console.log("  sofware              (typo-tolerant match)");
    console.log("  tag: software");
    console.log("  title: Next.js");
    console.log("  created: >2026-05-30");
    console.log("  tag: infra created: >=2026-01-01 roadmap");
    console.log("An empty line quits.\n");

    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    for (;;) {
      let query: string;
      try {
        query = (await prompt.question("search> ")).trim();
      } catch {
        break; // end of input
      }
      if (!query) break;

      const { hits, error } = await service.searchNotes(query);
      if (error) {
        console.log(`  ${error}`);
        continue;
      }
      if (hits.length === 0) {
        console.log("  (no results)");
        continue;
      }
      const byId = new Map(listNotes().map((note) => [note.id, note]));
      for (const hit of hits.slice(0, 20)) {
        const note = byId.get(hit.id);
        if (note) console.log(`  [${note.id}] ${JSON.stringify(note.title)} tags=${JSON.stringify(note.tags)} createdAt=${note.createdAt}`);
      }
    }
    prompt.close();
  }
} finally {
  await runtime.stop();
  fs.rmSync(home, { recursive: true, force: true });
  console.log("Cleaned up the temporary database and Meilisearch.");
}
process.exit(exitCode);
