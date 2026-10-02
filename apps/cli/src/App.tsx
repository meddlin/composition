import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { defaultApi, type Api } from "./api";
import { panes as paneLib, type Group, type Note, type Workspace } from "./backend";
import { ConfirmDialog, HelpDialog, PickerDialog, PromptDialog, type PickerOption } from "./components/Dialogs";
import { Pane, type FlushRegistry } from "./components/Pane";
import { Tree } from "./components/Tree";
import { actionFor, footerFor } from "./keymap";
import { paletteFor, syntaxStyleFor } from "./theme";
import { buildTree, groupKey, noteKey, orderedGroups, targetGroupId, type TreeRow } from "./tree";

export const SIDEBAR_WIDTH = 34;
export const SEARCH_DEBOUNCE_MS = 350;
const TOAST_MS = 4000;
/** A pane narrower than this shows the editor or the preview, not both side by side. */
const SPLIT_MIN_COLUMNS = 80;

type Focus = "tree" | "search" | "pane";

type Dialog =
  | { kind: "new-note"; groupId: number | null }
  | { kind: "new-group"; parentId: number | null }
  | { kind: "rename-group"; group: Group }
  | { kind: "move-note"; note: Note }
  | { kind: "delete-note"; note: Note }
  | { kind: "delete-group"; group: Group }
  | { kind: "help" }
  | null;

export type AppProps = {
  initial: Workspace;
  api?: Api;
  /** The color scheme's name; schemes without a palette yet fall back to dark. */
  theme?: string;
};

const NEXT_VIEW: Record<paneLib.PaneView, paneLib.PaneView> = {
  split: "markdown",
  markdown: "preview",
  preview: "split",
};

export function App({ initial, api = defaultApi, theme = "dark" }: AppProps) {
  const renderer = useRenderer();
  const { width: terminalWidth } = useTerminalDimensions();
  const palette = useMemo(() => paletteFor(theme), [theme]);
  const syntax = useMemo(() => syntaxStyleFor(palette), [palette]);

  const [notes, setNotes] = useState(initial.notes);
  const [groups, setGroups] = useState(initial.groups);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<number[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [paneState, setPaneState] = useState<paneLib.PaneState>(() => paneLib.initialPanes(null));
  const [focus, setFocus] = useState<Focus>("tree");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<string | null>(null);

  // --- saving on the way out ------------------------------------------------
  const flushSet = useRef(new Set<() => Promise<void>>());
  const flushes = useMemo<FlushRegistry>(
    () => ({
      register(flush) {
        flushSet.current.add(flush);
        return () => flushSet.current.delete(flush);
      },
    }),
    [],
  );
  const quit = async () => {
    await Promise.all([...flushSet.current].map((flush) => flush().catch(() => {})));
    renderer.destroy();
  };

  // --- data -----------------------------------------------------------------
  const reload = async () => {
    const workspace = await api.loadWorkspace();
    setNotes(workspace.notes);
    setGroups(workspace.groups);
  };

  /** A save changes the note's title and timestamp; keep the tree in step without reordering it mid-edit. */
  const noteSaved = (stored: Note) => setNotes((current) => current.map((n) => (n.id === stored.id ? stored : n)));

  const notesById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);

  // --- search ---------------------------------------------------------------
  const searchRun = useRef(0);
  useEffect(() => {
    const run = ++searchRun.current;
    if (query.trim() === "") {
      setHits(null);
      setSearchError(null);
      return;
    }
    const handle = setTimeout(async () => {
      const result = await api.searchNotes(query);
      if (run !== searchRun.current) return; // a newer query has taken over
      if (result.error) {
        setSearchError(result.error);
        setHits(null);
      } else {
        setSearchError(null);
        setHits(result.hits.map((hit) => hit.id));
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  // --- the tree -------------------------------------------------------------
  const visibleNotes = useMemo(
    () => (hits ? hits.flatMap((id) => notesById.get(id) ?? []) : notes),
    [hits, notes, notesById],
  );
  const rows = useMemo(
    () => buildTree({ notes: visibleNotes, groups, collapsed, filtering: hits !== null }),
    [visibleNotes, groups, collapsed, hits],
  );
  const selectedIndex = useMemo(() => {
    const found = rows.findIndex((row) => row.key === cursorKey);
    if (found >= 0) return found;
    // Prefer landing on a note over a group header.
    const firstNote = rows.findIndex((row) => row.kind === "note");
    return firstNote >= 0 ? firstNote : 0;
  }, [rows, cursorKey]);
  const highlighted: TreeRow | undefined = rows[selectedIndex];

  const unfold = (groupId: number | null) =>
    setCollapsed((current) => {
      const next = new Set(current);
      next.delete(groupKey(groupId));
      return next;
    });

  const toggleGroup = (row: TreeRow) => {
    if (row.kind !== "group") return;
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      return next;
    });
  };

  // --- toasts ---------------------------------------------------------------
  useEffect(() => {
    if (toast === null) return;
    const handle = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(handle);
  }, [toast]);

  // --- panes ----------------------------------------------------------------
  const openNote = (noteId: number, beside = false) => {
    setPaneState((current) =>
      beside && current.focusedId !== null
        ? paneLib.dropNote(current, noteId, current.focusedId, "right")
        : paneLib.openNote(current, noteId),
    );
    setFocus("pane");
  };

  const goToTree = () => {
    setFocus("tree");
    void reload(); // re-sort: what was just edited moves to the top
  };

  const nextPane = () => {
    const open = paneState.panes;
    const at = open.findIndex((pane) => pane.noteId === paneState.focusedId);
    if (focus === "tree") {
      if (open.length > 0) {
        setPaneState((current) => paneLib.focusPane(current, open[0].noteId));
        setFocus("pane");
      }
    } else if (at >= 0 && at < open.length - 1) {
      setPaneState((current) => paneLib.focusPane(current, open[at + 1].noteId));
    } else {
      goToTree();
    }
  };

  const closeFocusedPane = () => {
    if (paneState.focusedId === null) return;
    const remaining = paneLib.closePane(paneState, paneState.focusedId);
    setPaneState(remaining);
    if (remaining.panes.length === 0) goToTree();
  };

  // --- what the keys do -----------------------------------------------------
  const startDelete = () => {
    if (!highlighted) return;
    if (highlighted.kind === "note") {
      const note = notesById.get(highlighted.noteId);
      if (note) setDialog({ kind: "delete-note", note });
    } else if (highlighted.kind === "group" && highlighted.groupId !== null) {
      const group = groups.find((g) => g.id === highlighted.groupId);
      if (!group) return;
      const hasChildren = groups.some((g) => g.parentId === group.id) || notes.some((n) => n.groupId === group.id);
      if (hasChildren) {
        setToast(`"${group.name}" still has sub-groups or notes in it. Empty it before deleting.`);
      } else {
        setDialog({ kind: "delete-group", group });
      }
    }
  };

  useKeyboard((key) => {
    if (dialog) return;

    if (focus === "search") {
      if (key.name === "escape" || key.name === "return" || key.name === "down") setFocus("tree");
      return;
    }

    if (focus === "pane") {
      switch (actionFor("pane", key)) {
        case "to-tree":
          goToTree();
          break;
        case "next-pane":
          nextPane();
          break;
        case "cycle-view":
          if (paneState.focusedId !== null) {
            const current = paneState.panes.find((pane) => pane.noteId === paneState.focusedId);
            if (current) setPaneState(paneLib.setPaneView(paneState, current.noteId, NEXT_VIEW[current.view]));
          }
          break;
        case "close-pane":
          closeFocusedPane();
          break;
        case "new-note":
          setDialog({ kind: "new-note", groupId: targetGroupId(highlighted, notesById) });
          break;
      }
      return;
    }

    switch (actionFor("tree", key)) {
      case "open-beside":
        if (highlighted?.kind === "note") openNote(highlighted.noteId, true);
        break;
      case "collapse":
        if (highlighted?.kind === "group" && highlighted.expanded) toggleGroup(highlighted);
        break;
      case "expand":
        if (highlighted?.kind === "group" && !highlighted.expanded) toggleGroup(highlighted);
        break;
      case "new-note":
        setDialog({ kind: "new-note", groupId: targetGroupId(highlighted, notesById) });
        break;
      case "new-group":
        setDialog({ kind: "new-group", parentId: targetGroupId(highlighted, notesById) });
        break;
      case "rename-group":
        if (highlighted?.kind === "group" && highlighted.groupId !== null) {
          const group = groups.find((g) => g.id === highlighted.groupId);
          if (group) setDialog({ kind: "rename-group", group });
        }
        break;
      case "move":
        if (highlighted?.kind === "note") {
          const note = notesById.get(highlighted.noteId);
          if (note) setDialog({ kind: "move-note", note });
        }
        break;
      case "delete":
        startDelete();
        break;
      case "search":
        setFocus("search");
        break;
      case "help":
        setDialog({ kind: "help" });
        break;
      case "next-pane":
        nextPane();
        break;
      case "quit":
        void quit();
        break;
    }
  });

  const activate = (index: number) => {
    const row = rows[index];
    if (!row) return;
    if (row.kind === "note") openNote(row.noteId);
    else if (row.kind === "group") toggleGroup(row);
    else if (row.kind === "settings") setToast("Settings arrive in the next step of the port.");
  };

  // --- dialogs --------------------------------------------------------------
  const closeDialog = () => setDialog(null);

  /** Runs a change to the data; if it fails, say so instead of letting the app crash. */
  const attempt = (work: () => Promise<void>) => async () => {
    try {
      await work();
    } catch (error) {
      closeDialog();
      setToast(`That didn't work: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const renderDialog = () => {
    if (!dialog) return null;
    switch (dialog.kind) {
      case "new-note":
        return (
          <PromptDialog
            palette={palette}
            title="New note"
            label="Title"
            onCancel={closeDialog}
            onSubmit={(title) =>
              void attempt(async () => {
                const note = await api.createNote(title, dialog.groupId);
                await reload();
                unfold(dialog.groupId);
                setCursorKey(noteKey(note.id));
                closeDialog();
                openNote(note.id);
              })()
            }
          />
        );
      case "new-group":
        return (
          <PromptDialog
            palette={palette}
            title="New group"
            label="Name"
            onCancel={closeDialog}
            onSubmit={(name) =>
              void attempt(async () => {
                const group = await api.createGroup(name, dialog.parentId);
                await reload();
                unfold(dialog.parentId);
                setCursorKey(groupKey(group.id));
                closeDialog();
              })()
            }
          />
        );
      case "rename-group":
        return (
          <PromptDialog
            palette={palette}
            title="Rename group"
            label="Name"
            initial={dialog.group.name}
            onCancel={closeDialog}
            onSubmit={(name) =>
              void attempt(async () => {
                await api.renameGroup(dialog.group.id, name);
                await reload();
                closeDialog();
              })()
            }
          />
        );
      case "move-note": {
        const options: PickerOption[] = [
          { label: "Ungrouped", value: null },
          ...orderedGroups(groups).map(({ group, depth }) => ({ label: `${"  ".repeat(depth)}${group.name}`, value: group.id })),
        ];
        return (
          <PickerDialog
            palette={palette}
            title="Move note to…"
            options={options}
            onCancel={closeDialog}
            onPick={(groupId) =>
              void attempt(async () => {
                await api.moveNoteToGroup(dialog.note.id, groupId);
                await reload();
                unfold(groupId);
                closeDialog();
              })()
            }
          />
        );
      }
      case "delete-note":
        return (
          <ConfirmDialog
            palette={palette}
            title="Delete note"
            message={`Move "${dialog.note.title}" to the Trash Can?`}
            onCancel={closeDialog}
            onConfirm={() =>
              void attempt(async () => {
                await api.deleteNote(dialog.note.id);
                setPaneState((current) => paneLib.closePane(current, dialog.note.id));
                await reload();
                closeDialog();
                setToast(`Moved "${dialog.note.title}" to the Trash Can.`);
              })()
            }
          />
        );
      case "delete-group":
        return (
          <ConfirmDialog
            palette={palette}
            title="Delete group"
            message={`Delete the empty group "${dialog.group.name}"?`}
            onCancel={closeDialog}
            onConfirm={() =>
              void attempt(async () => {
                const result = await api.deleteGroup(dialog.group.id);
                if (result.error) setToast(result.error);
                await reload();
                closeDialog();
              })()
            }
          />
        );
      case "help":
        return <HelpDialog palette={palette} onClose={closeDialog} />;
    }
  };

  // --- drawing --------------------------------------------------------------
  const openPanes = paneState.panes;
  const totalSize = openPanes.reduce((sum, pane) => sum + pane.size, 0) || 1;
  const paneAreaWidth = Math.max(0, terminalWidth - SIDEBAR_WIDTH);

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={palette.background}>
      <box height={1} paddingLeft={1}>
        <text fg={palette.accent}>{`Composition${searchError ? `   ${searchError}` : ""}`}</text>
      </box>
      <box height={1} flexDirection="row" paddingLeft={1}>
        <text fg={palette.muted}>{"search: "}</text>
        <input
          focused={focus === "search" && !dialog}
          value={query}
          onInput={setQuery}
          placeholder="text, tag: title: description: created: updated:"
          flexGrow={1}
          backgroundColor={palette.background}
          textColor={palette.foreground}
          focusedBackgroundColor={palette.surface}
          focusedTextColor={palette.foreground}
        />
      </box>

      <box flexDirection="row" flexGrow={1}>
        <box
          width={SIDEBAR_WIDTH}
          border
          borderStyle="single"
          borderColor={focus === "tree" ? palette.borderFocused : palette.border}
          title=" Notes "
        >
          <Tree
            rows={rows}
            selectedIndex={selectedIndex}
            focused={focus === "tree" && !dialog}
            palette={palette}
            onMove={(index) => setCursorKey(rows[index]?.key ?? null)}
            onActivate={activate}
          />
        </box>

        <box flexGrow={1} flexDirection="row">
          {openPanes.length === 0 ? (
            <box flexGrow={1} border borderStyle="single" borderColor={palette.border} alignItems="center" justifyContent="center">
              <text fg={palette.muted}>No note open. Press Enter on a note, or ctrl+n for a new one.</text>
            </box>
          ) : (
            openPanes.map((pane) => {
              const note = notesById.get(pane.noteId);
              if (!note) return null;
              const width = (paneAreaWidth * pane.size) / totalSize;
              return (
                <Pane
                  key={pane.noteId}
                  note={note}
                  size={pane.size}
                  view={paneLib.shownView(pane.view, width >= SPLIT_MIN_COLUMNS)}
                  focused={focus === "pane" && paneState.focusedId === pane.noteId && !dialog}
                  api={api}
                  palette={palette}
                  syntax={syntax}
                  flushes={flushes}
                  onSaved={noteSaved}
                />
              );
            })
          )}
        </box>
      </box>

      <box height={1} paddingLeft={1}>
        <text fg={toast ? palette.warning : palette.muted}>{toast ?? footerFor(focus === "pane" ? "pane" : "tree")}</text>
      </box>

      {renderDialog()}
    </box>
  );
}
