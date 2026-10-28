import type { DropZone, PanelId } from "./layoutTree";

/** What a notes browser needs done that only the workspace around the panels can do (it owns the dialogs and errors). */
export type SidebarActions = {
  groupError: string | null;
  onToggleFavorite: (type: "group" | "note", id: number) => void;
  onSelectGroup: (id: number) => void;
  onCreate: (groupId: number | null, notebookId: number) => void;
  onDelete: (noteId: number) => void;
  onCreateGroup: (name: string, parentId: number | null, notebookId: number) => void;
  onRenameGroup: (id: number, name: string) => void;
  onDeleteGroup: (id: number) => void;
  onMoveGroup: (id: number, parentId: number | null) => void;
  onPlaceNote: (noteId: number, groupId: number | null, beforeNoteId: number | null) => void;
  onPlaceGroup: (id: number, parentId: number | null, beforeGroupId: number | null) => void;
  onMoveNoteToGroup: (noteId: number, groupId: number | null) => void;
  onMoveGroupToNotebook: (id: number, notebookId: number) => void;
};

/** What the panels need from the workspace around them, which the window's other parts also share. */
export type PanelHost = {
  /** The editor's share of a note panel, one setting for all of them. */
  ratio: number;
  onRatioChange: (ratio: number) => void;
  onRatioCommit: () => void;
  /** Makes a new note and shows it (in the focused panel, if that can take it). */
  onCreateNote: () => void;
  /** The AI helper made an answer into a new note; `fromNoteId` is the note it was asked about. */
  onNewNoteFromText: (fromNoteId: number, text: string) => void;
  /** A note dropped on a panel; asks first if that would show a note that is already open. */
  onDropNote: (noteId: number, panelId: PanelId, zone: DropZone) => void;
  /** "Open to the side" on a note in a notes browser: asks first if the note is already open in a panel. */
  onOpenNoteBeside: (noteId: number) => void;
  sidebar: SidebarActions;
};
