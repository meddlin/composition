import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedNotes } from "./seedNotes";
import { generateNotes } from "./dummyNotes";

/**
 * `pnpm seed [--count 100] [--home <folder>]`
 *
 * Puts dummy notes in a scratch home (a new temp folder unless you name one) and says how
 * to open them. It never touches ~/.composition: the settings file and the data folder are
 * both inside the scratch home.
 */
function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const count = Number(option("count") ?? 100);
if (!Number.isInteger(count) || count < 1) {
  console.error("--count must be a whole number of at least 1.");
  process.exit(1);
}
const home = path.resolve(option("home") ?? fs.mkdtempSync(path.join(os.tmpdir(), "composition-seed-")));
const dataDir = path.join(home, ".composition");
fs.mkdirSync(dataDir, { recursive: true });
const settings = path.join(home, ".composition-cli", "settings.json");
fs.mkdirSync(path.dirname(settings), { recursive: true });
fs.writeFileSync(settings, JSON.stringify({ appDataDir: dataDir, theme: "dark" }));
process.env.COMPOSITION_SETTINGS_PATH = settings;

const added = await seedNotes(generateNotes(count));
console.log(`Added ${added} dummy notes to ${dataDir}.`);
console.log("Open them with:");
console.log(`  COMPOSITION_DEV_HOME=${home} pnpm dev`);
process.exit(0);
