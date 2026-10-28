import type { ReactNode } from "react";
import type { SidebarActions } from "../panels/host";
import type { DropZone, PanelId } from "../panels/layoutTree";
import type { WorkspaceStore } from "./workspaceStore";

/**
 * How the workspace shows notes, which differs by app: the web app has a single row of panes, the desktop app a grid
 * of panels. The workspace asks the surface to do the showing, and the surface holds whatever it needs to ask first.
 * (`noteSurface.tsx` is the web's, and `noteSurface.desktop.tsx` the desktop's; see next.config.ts.)
 */
export type NoteSurface = {
  /** The note the user is working in, if any: highlighted in the sidebar and counted as opened. */
  focusedNoteId: number | null;
  /** Shows a note the way picking it in the sidebar does. */
  openNote(noteId: number): void;
  /** The sidebar's "Open to the side". */
  openNoteBeside(noteId: number): void;
  /** A note dropped on a panel (the desktop's grid); the web's panes take drops themselves. */
  dropNote(noteId: number, panelId: PanelId, zone: DropZone): void;
  /** Rendered once by the workspace: whatever the surface asks the user with. */
  dialog: ReactNode;
};

/** What the part of the workspace that shows the open notes is given. */
export type NoteAreaProps = {
  store: WorkspaceStore;
  surface: NoteSurface;
  /** The editor's share of a note, one setting for all of them. */
  layout: { editorRatio: number; setEditorRatio: (ratio: number) => void; commit: () => void };
  /** Makes a new note (in the given group, or the open notebook's top level) and shows it. */
  onCreateNote: (groupId?: number | null) => void;
  /** The AI helper made an answer into a new note; `fromNoteId` is the note it was asked about. */
  onNewNoteFromText: (fromNoteId: number, text: string) => void;
  /** What a notes browser needs the workspace for. */
  sidebar: SidebarActions;
};
