import {
  ArrowLeftIcon,
  ChartColumnIcon,
  HouseIcon,
  KeyboardIcon,
  PaletteIcon,
  PenLineIcon,
  PuzzleIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
} from "lucide-react";
import Link from "next/link";
import { RouteBackNav } from "@/components/RouteBackNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SettingsSnapshot } from "@/lib/composition/api";
import { AssistantSettings } from "./AssistantSettings";
import { ChatGptSettings } from "./ChatGptSettings";
import { BackupRestore } from "./BackupRestore";
import { FunMetrics } from "./FunMetrics";
import { HomeSettings } from "./HomeSettings";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { PanelSettings } from "./PanelSettings";
import { PluginsProvider } from "./PluginsProvider";
import { PluginsSettings } from "./PluginsSettings";
import { SettingsForm } from "./SettingsForm";
import { SettingsShell, type SettingsPage } from "./SettingsShell";
import { StylingSettings } from "./StylingSettings";
import { TodoSettings } from "./TodoSettings";
import { TrashCan } from "./TrashCan";
import { Updates } from "./Updates";
import { WritingSettings } from "./WritingSettings";

/**
 * The Settings screen, rendered from a snapshot. The web page builds the
 * snapshot on the server; the desktop page loads it over IPC.
 */
export function SettingsScreen({ snapshot }: { snapshot: SettingsSnapshot }) {
  const isOverride = snapshot.dbPathOverride !== "";

  const pages: SettingsPage[] = [
    {
      id: "general",
      label: "General",
      icon: <SlidersHorizontalIcon />,
      content: (
        <>
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
            currentAppDataDir={snapshot.appDataDir}
            currentDbPath={snapshot.dbPathOverride}
            derivedDbPathPlaceholder={snapshot.derivedDbPath}
          />

          <Updates />

          <PanelSettings />

          <TodoSettings />

          <BackupRestore defaultBackupDir={snapshot.backupDir} />

          <TrashCan initialTrash={snapshot.trash} />
        </>
      ),
    },
    {
      id: "styling",
      label: "Styling",
      icon: <PaletteIcon />,
      content: (
        <StylingSettings
          currentTheme={snapshot.theme}
          currentPreviewFont={snapshot.previewFont}
          currentEditorFont={snapshot.editorFont}
          currentNoteBackground={snapshot.noteBackground}
          currentHeadingRail={snapshot.writing.headingRailEnabled}
          currentHeadingRailSide={snapshot.writing.headingRailSide}
          currentCity={snapshot.city}
          currentSunTimes={snapshot.sunTimes}
        />
      ),
    },
    {
      id: "writing",
      label: "Writing",
      icon: <PenLineIcon />,
      content: <WritingSettings initial={snapshot.writing} />,
    },
    {
      id: "home",
      label: "Home page",
      icon: <HouseIcon />,
      content: <HomeSettings initial={snapshot.home} notebooks={snapshot.notebooks} />,
    },
    {
      id: "plugins",
      label: "Plugins",
      icon: <PuzzleIcon />,
      content: <PluginsSettings />,
    },
    {
      id: "ai",
      label: "AI Configuration",
      icon: <SparklesIcon />,
      content: (
        <div className="flex flex-col gap-4">
          <AssistantSettings initial={snapshot.assistant} />
          <ChatGptSettings />
        </div>
      ),
    },
    {
      id: "shortcuts",
      label: "Keyboard shortcuts",
      icon: <KeyboardIcon />,
      content: <KeyboardShortcuts />,
    },
    {
      id: "metrics",
      label: "Metrics",
      icon: <ChartColumnIcon />,
      content: <FunMetrics metrics={snapshot.metrics} />,
    },
  ];

  return (
    <div className="mx-auto flex min-h-screen max-w-240 flex-col gap-6 p-6">
      <RouteBackNav />
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Settings</h1>
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
          <Link href="/">
            <ArrowLeftIcon /> Back to notes
          </Link>
        </Button>
      </div>

      <PluginsProvider initial={snapshot.plugins}>
        <SettingsShell pages={pages} />
      </PluginsProvider>
    </div>
  );
}
