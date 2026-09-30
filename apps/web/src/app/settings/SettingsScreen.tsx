import Link from "next/link";
import type { SettingsSnapshot } from "@/lib/composition/api";
import { SettingsForm } from "./SettingsForm";

/**
 * The Settings screen, rendered from a snapshot. The web page builds the
 * snapshot on the server; the desktop page loads it over IPC.
 */
export function SettingsScreen({ snapshot }: { snapshot: SettingsSnapshot }) {
  const isOverride = snapshot.dbPathOverride !== "";

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
            <dd className="truncate font-mono">{snapshot.appDataDir}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-foreground/60">
              Database file {isOverride ? "(override)" : "(default)"}
            </dt>
            <dd className="truncate font-mono">{snapshot.dbPath}</dd>
          </div>
        </dl>
        {!snapshot.dirWritable && (
          <p className="mt-3 text-warning">
            Warning: the application data directory doesn&apos;t exist yet or isn&apos;t
            writable. It will be created when you save.
          </p>
        )}
        {snapshot.dirWritable && !snapshot.dbExists && (
          <p className="mt-3 text-foreground/60">
            No database file exists at this location yet — a fresh, empty one will be
            created the first time a note is saved.
          </p>
        )}
      </section>

      <SettingsForm
        currentTheme={snapshot.theme}
        currentAppDataDir={snapshot.appDataDir}
        currentDbPath={snapshot.dbPathOverride}
        derivedDbPathPlaceholder={snapshot.derivedDbPath}
      />
    </div>
  );
}
