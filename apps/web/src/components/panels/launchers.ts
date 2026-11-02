import { BookmarkIcon, LibraryBigIcon, ListChecksIcon, RssIcon, SparklesIcon, type LucideIcon } from "lucide-react";
import type { PluginSettings } from "@/lib/composition/plugins";
import { KINDS } from "./kinds";
import type { KindId } from "./panelsState";

/** The kinds that can be opened without first making an empty panel: every kind but those two. */
export type LauncherKind = Exclude<KindId, "empty" | "note">;

export type Launcher = {
  kind: LauncherKind;
  label: string;
  icon: LucideIcon;
  /** Other words that find it in the command palette. */
  keywords: readonly string[];
  /**
   * What opening it does when the window already has a panel of the kind: "focus" goes to that panel, "new" makes another
   * (a second notes browser is the point of that kind).
   */
  reuse: "focus" | "new";
};

/**
 * The panel kinds a user can open directly, in the order they are listed (the empty panel's order: the built-in ones,
 * then the plugins'). The empty panel, the command palette and the rail all read this list, so a new kind is added here once. Whether a launcher is offered at all is the kind's own
 * `plugin` in `kinds.ts`, not repeated here. (A note is opened from the sidebar, so `note` is not a launcher; the empty
 * panel adds its own Note button.)
 */
export const LAUNCHERS: readonly Launcher[] = [
  { kind: "notes-browser", label: "Notes browser", icon: LibraryBigIcon, keywords: ["notebook", "notes list", "second list"], reuse: "new" },
  { kind: "ai", label: "AI helper", icon: SparklesIcon, keywords: ["assistant", "chat", "ask"], reuse: "focus" },
  { kind: "todo", label: "To-do", icon: ListChecksIcon, keywords: ["todo", "tasks", "checklist"], reuse: "focus" },
  { kind: "reading-list", label: "Reading List", icon: BookmarkIcon, keywords: ["links", "articles", "read later", "bookmarks"], reuse: "focus" },
  { kind: "rss", label: "RSS Reader", icon: RssIcon, keywords: ["feeds", "news", "atom", "subscribe"], reuse: "focus" },
];

export function launcherFor(kind: LauncherKind): Launcher {
  return LAUNCHERS.find((launcher) => launcher.kind === kind)!;
}

export function isLauncherKind(kind: KindId): kind is LauncherKind {
  return LAUNCHERS.some((launcher) => launcher.kind === kind);
}

/** Whether a kind is offered: it belongs to no plugin, or to one that is on. */
export function isKindAvailable(kind: KindId, enabled: PluginSettings): boolean {
  const plugin = KINDS[kind].plugin;
  return plugin === undefined || enabled[plugin];
}

/** The launchers whose plugin is on, in list order. */
export function availableLaunchers(enabled: PluginSettings): Launcher[] {
  return LAUNCHERS.filter((launcher) => isKindAvailable(launcher.kind, enabled));
}
