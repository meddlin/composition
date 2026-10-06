import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, service } from "../backend";
import { APPS, dataDirFor, inspectBackup, keepSearchOffline, loadFixture, setupFixture, settingsFileFor, verifyFixture, wipeFixture, type App, type Check } from "./backupFixture";

/**
 * `node dist/backup-manual.mjs <command> [options]` — the helper behind the guided manual
 * backup and restore tests (scripts/manual-tests/backup-restore.sh; docs/manual-tests/backup-restore.md).
 *
 *   setup    --app cli|web|desktop --home DIR   create DIR with known notes, an image, an attachment, settings
 *   verify   --home DIR                          does DIR still hold exactly what setup created?
 *   wipe     --home DIR [--force]                simulate losing everything (quit the app first)
 *   inspect  --file BACKUP [--home DIR]          list a backup file, and check it against DIR's test data
 *   backup   --home DIR [--dir FOLDER]           make a backup without the app (default folder: DIR/backups)
 *   restore  --home DIR --file BACKUP            restore without the app
 *   selftest                                     the whole round trip, headless, for all three apps' layouts
 *   launch   --app ... --home DIR                print the command that starts the app on DIR
 *
 * Nothing here ever touches the real ~/.composition or the apps' real settings.
 */

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function required(name: string): string {
  const value = option(name);
  if (!value) {
    console.error(`Missing --${name}.`);
    process.exit(2);
  }
  return path.resolve(value);
}

function appOption(): App {
  const app = option("app");
  if (!APPS.includes(app as App)) {
    console.error(`--app must be one of: ${APPS.join(", ")}.`);
    process.exit(2);
  }
  return app as App;
}

const mark = (ok: boolean) => (ok ? "PASS" : "FAIL");

function report(checks: Check[]): boolean {
  for (const { name, ok, detail } of checks) console.log(`${mark(ok)}  ${name}${!ok && detail ? `\n        ${detail}` : ""}`);
  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed === 0 ? `\nAll ${checks.length} checks passed.` : `\n${failed} of ${checks.length} checks failed.`);
  return failed === 0;
}

/** The command that starts `app` on a scratch home, from the repo root. */
export function launchCommand(app: App, home: string): string {
  switch (app) {
    case "cli":
      return `COMPOSITION_DEV_HOME=${JSON.stringify(home)} pnpm --dir apps/cli dev`;
    case "web":
      // HOME is changed for Next only (not pnpm), so the default backup folder lands in the scratch home too.
      return `(cd apps/web && HOME=${JSON.stringify(home)} ./node_modules/.bin/next dev --port 3000)`;
    case "desktop":
      return `COMPOSITION_DEV_HOME=${JSON.stringify(home)} pnpm --dir apps/desktop dev`;
  }
}

async function selftest(): Promise<boolean> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "composition-backup-selftest-"));
  const realHome = process.env.HOME;
  let allOk = true;
  try {
    for (const app of APPS) {
      console.log(`\n== ${app}`);
      const home = path.join(root, app);
      // The safety backup a restore makes goes to ~/Composition Backups; keep that in the scratch home.
      process.env.HOME = home;
      await setupFixture(app, home);
      const { closeDb } = await import("../backend");
      const made = await service.createBackup(path.join(home, "backups"));
      if (made.error || !made.file) throw new Error(made.error ?? "no backup file");
      const inspected = await inspectBackup(made.file, home);
      allOk = report(inspected.checks) && allOk;

      closeDb();
      wipeFixture(home);
      const damaged = verifyFixture(home);
      const lost = damaged.some((c) => !c.ok);
      console.log(`${mark(lost)}  wiping really lost the data (verify fails, as it should)`);
      allOk = lost && allOk;

      const restored = await service.restoreBackup(made.file);
      console.log(`${mark(!restored.error)}  restore${restored.error ? `: ${restored.error}` : ""}`);
      allOk = !restored.error && allOk;
      closeDb();
      allOk = report(verifyFixture(home)) && allOk;
    }
  } finally {
    if (realHome === undefined) delete process.env.HOME;
    else process.env.HOME = realHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
  return allOk;
}

keepSearchOffline();
// With search off, every save logs a (harmless) failed attempt to index it; that is noise here.
const logError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("[search]")) return;
  logError(...args);
};

const command = process.argv[2];
try {
  switch (command) {
    case "setup": {
      const app = appOption();
      const home = required("home");
      const fixture = await setupFixture(app, home);
      console.log(`Created test data for the ${app} app in ${home}`);
      console.log(`  notes:        ${fixture.notes.map((n) => n.title).join(", ")}`);
      console.log(`  groups:       ${fixture.groups.map((g) => g.name).join(", ")}`);
      console.log(`  Trash Can:    ${fixture.trashedNotes.map((n) => n.title).join(", ")}`);
      console.log(`  image:        ${fixture.images.map((i) => i.name).join(", ")}`);
      console.log(`  attachment:   ${fixture.attachments.map((a) => a.fileName).join(", ")}`);
      console.log(`  settings:     ${settingsFileFor(app, home)} (${fixture.settings.theme}, ${fixture.settings.city}, 1 favorite)`);
      console.log(`  data folder:  ${dataDirFor(home)}`);
      break;
    }
    case "launch":
      console.log(launchCommand(appOption(), required("home")));
      break;
    case "verify":
      process.exitCode = report(verifyFixture(required("home"))) ? 0 : 1;
      break;
    case "wipe":
      wipeFixture(required("home"), { force: process.argv.includes("--force") });
      console.log("Wiped: no database, no images, no attachments, default settings.");
      break;
    case "inspect": {
      const home = option("home") ? path.resolve(option("home")!) : undefined;
      const { lines, checks } = await inspectBackup(required("file"), home);
      console.log(lines.join("\n"));
      if (checks.length > 0) {
        console.log();
        process.exitCode = report(checks) ? 0 : 1;
      }
      break;
    }
    case "backup":
    case "restore": {
      const home = required("home");
      // Same settings the app would use, and a safety backup that stays inside the scratch home.
      process.env.COMPOSITION_SETTINGS_PATH = settingsFileFor(loadFixture(home).app, home);
      process.env.HOME = home;
      const result = command === "backup" ? await service.createBackup(option("dir") ? path.resolve(option("dir")!) : path.join(home, "backups")) : await service.restoreBackup(required("file"));
      if (result.error) throw new Error(result.error);
      console.log(`${command === "backup" ? "Backed up to" : "Restored from"} ${result.file}${result.safetyBackup ? ` (previous data saved in ${result.safetyBackup})` : ""}`);
      break;
    }
    case "selftest":
      process.exitCode = (await selftest()) ? 0 : 1;
      break;
    default:
      console.error("Usage: backup-manual <setup|verify|wipe|inspect|backup|restore|selftest|launch> [--app cli|web|desktop] [--home DIR] [--file BACKUP]");
      process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
// Close cleanly, so SQLite folds its -wal file back into the database: `wipe` takes a leftover one for a running app.
closeDb();
process.exit(process.exitCode ?? 0);
