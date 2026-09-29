import fs from "node:fs";
import Link from "next/link";
import { defaultDatabasePath } from "@/lib/composition/paths";
import { loadWebSettings, resolvedDbPath } from "@/lib/composition/webSettings";
import { SettingsForm } from "./SettingsForm";

// Reads live local disk state and can't safely run in a build-time worker
// thread (see the note in app/page.tsx) — always render at request time.
export const dynamic = "force-dynamic";

function isWritableDir(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export default function SettingsPage() {
  const settings = loadWebSettings();
  const dbPath = resolvedDbPath(settings);
  const isOverride = Boolean(settings.dbPath);
  const dirWritable = isWritableDir(settings.appDataDir);
  const dbExists = fs.existsSync(dbPath);

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Settings</h1>
        <Link href="/" className="text-sm text-foreground/60 hover:text-foreground">
          ← Back to notes
        </Link>
      </div>

      <section className="rounded-md border border-foreground/10 p-4 text-sm">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground/50">
          Current configuration
        </h2>
        <dl className="space-y-1">
          <div className="flex justify-between gap-4">
            <dt className="text-foreground/60">Application data directory</dt>
            <dd className="truncate font-mono">{settings.appDataDir}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-foreground/60">
              Database file {isOverride ? "(override)" : "(default)"}
            </dt>
            <dd className="truncate font-mono">{dbPath}</dd>
          </div>
        </dl>
        {!dirWritable && (
          <p className="mt-3 text-amber-600 dark:text-amber-400">
            Warning: the application data directory doesn&apos;t exist yet or isn&apos;t
            writable. It will be created when you save.
          </p>
        )}
        {dirWritable && !dbExists && (
          <p className="mt-3 text-foreground/60">
            No database file exists at this location yet — a fresh, empty one will be
            created the first time a note is saved.
          </p>
        )}
      </section>

      <SettingsForm
        currentAppDataDir={settings.appDataDir}
        currentDbPath={settings.dbPath ?? ""}
        derivedDbPathPlaceholder={defaultDatabasePath(settings.appDataDir)}
      />
    </div>
  );
}
