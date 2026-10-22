import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SettingsSnapshot } from "@/lib/composition/api";
import { AssistantSettings } from "./AssistantSettings";
import { BackupRestore } from "./BackupRestore";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { SettingsForm } from "./SettingsForm";
import { TrashCan } from "./TrashCan";
import { Updates } from "./Updates";

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
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
          <Link href="/">
            <ArrowLeftIcon /> Back to notes
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="general">
        <TabsList aria-label="Settings sections">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="shortcuts">Keyboard shortcuts</TabsTrigger>
        </TabsList>

        {/* Kept mounted when hidden, so a half-edited form survives a look at the shortcuts. */}
        <TabsContent value="general" forceMount>
          <Card size="sm">
            <CardHeader>
              <CardTitle
                role="heading"
                aria-level={2}
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                Current configuration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-1">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Application data directory</dt>
                  <dd className="truncate font-mono">{snapshot.appDataDir}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">
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
                <p className="mt-3 text-muted-foreground">
                  No database file exists at this location yet — a fresh, empty one will be
                  created the first time a note is saved.
                </p>
              )}
            </CardContent>
          </Card>

          <SettingsForm
            currentTheme={snapshot.theme}
            currentPreviewFont={snapshot.previewFont}
            currentCity={snapshot.city}
            currentSunTimes={snapshot.sunTimes}
            currentAppDataDir={snapshot.appDataDir}
            currentDbPath={snapshot.dbPathOverride}
            derivedDbPathPlaceholder={snapshot.derivedDbPath}
          />

          <AssistantSettings initial={snapshot.assistant} />

          <Updates />

          <BackupRestore defaultBackupDir={snapshot.backupDir} />

          <TrashCan initialTrash={snapshot.trash} />
        </TabsContent>

        <TabsContent value="shortcuts">
          <KeyboardShortcuts />
        </TabsContent>
      </Tabs>
    </div>
  );
}
