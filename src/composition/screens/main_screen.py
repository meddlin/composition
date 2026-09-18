"""Main page: notes/groups tree + live Markdown preview."""

from __future__ import annotations

from typing import ClassVar

from textual import events
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, VerticalScroll
from textual.screen import Screen
from textual.timer import Timer
from textual.widgets import Footer, Header, Input, Markdown, Tree
from textual.widgets.tree import TreeNode

from composition import frontmatter
from composition.screens.delete_note_modal import ConfirmDeleteModal
from composition.screens.editor_screen import EditorScreen
from composition.screens.new_group_modal import NewGroupModal
from composition.screens.rename_group_modal import RenameGroupModal
from composition.screens.select_group_modal import GroupSelection, SelectGroupModal
from composition.storage import Group, GroupNotEmptyError, Note, NotesStore

SEARCH_DEBOUNCE = 0.35  # seconds

NodeData = dict[str, "int | None | str"]


class MainScreen(Screen):
    """Notes/groups tree + preview, with a search bar above the tree."""

    DEFAULT_CSS = """
    MainScreen #body {
        height: 1fr;
    }
    MainScreen #notes-tree {
        width: 34;
        border-right: solid $primary;
    }
    MainScreen #preview-pane {
        width: 1fr;
        padding: 1 2;
    }
    """

    BINDINGS: ClassVar = [
        Binding("ctrl+d", "delete_note", "Delete"),
        Binding("ctrl+g", "new_group", "New Group"),
        Binding("m", "move_note", "Move Note"),
        Binding("r", "rename_group", "Rename Group"),
        Binding("ctrl+space", "focus_search", "Search"),
    ]

    # Without this, Textual's default AUTO_FOCUS ("*") would focus the search
    # Input first (it's composed before the tree), and Input's own built-in
    # ctrl+d binding (delete-char-right) would shadow the screen's delete
    # action whenever nothing has been focused yet.
    AUTO_FOCUS = "#notes-tree"

    def compose(self) -> ComposeResult:
        yield Header()
        yield Input(placeholder="Search… (tag: title: createdOn:)", id="search-input")
        with Horizontal(id="body"):
            yield Tree("Notes", id="notes-tree")
            with VerticalScroll(id="preview-pane"):
                yield Markdown(id="preview")
        yield Footer()

    def on_mount(self) -> None:
        self._notes_by_id: dict[int, Note] = {}
        self._search_timer: Timer | None = None
        self.query_one("#notes-tree", Tree).show_root = False
        self._refresh_notes()

    def on_screen_resume(self, event: events.ScreenResume) -> None:
        if self._active_search_query():
            self._run_search()
        else:
            self._refresh_notes()

    def _active_search_query(self) -> str:
        return self.query_one("#search-input", Input).value.strip()

    def action_focus_search(self) -> None:
        self.query_one("#search-input", Input).focus()

    def on_input_changed(self, event: Input.Changed) -> None:
        if event.input.id != "search-input":
            return
        if self._search_timer is not None:
            self._search_timer.stop()
        self._search_timer = self.set_timer(SEARCH_DEBOUNCE, self._run_search)

    def _run_search(self) -> None:
        self._search_timer = None
        query = self._active_search_query()
        if not query:
            self._refresh_notes()
            return

        search_index = self.app.search_index  # type: ignore[attr-defined]
        try:
            note_ids = search_index.search(query)
        except Exception:  # noqa: BLE001 - a flaky search must not crash the UI
            return

        notes = [self._notes_by_id[i] for i in note_ids if i in self._notes_by_id]
        self._populate_tree(notes)

    def _refresh_notes(self) -> None:
        store: NotesStore = self.app.notes_store  # type: ignore[attr-defined]
        notes = store.list_notes()
        self._notes_by_id = {note.id: note for note in notes}
        self._populate_tree(notes)

    def _populate_tree(self, notes: list[Note]) -> None:
        tree = self.query_one("#notes-tree", Tree)
        store: NotesStore = self.app.notes_store  # type: ignore[attr-defined]
        groups = store.list_groups()
        previous_key = self._highlighted_key(tree)
        # Don't steal focus from the search input while the user is typing —
        # only Tab should move focus away from it.
        keep_search_focused = self.query_one("#search-input", Input).has_focus

        tree.clear()
        tree.root.expand()

        notes_by_group: dict[int | None, list[Note]] = {}
        for note in notes:
            notes_by_group.setdefault(note.group_id, []).append(note)

        children_by_parent: dict[int | None, list[Group]] = {}
        for group in groups:
            children_by_parent.setdefault(group.parent_id, []).append(group)
        for children in children_by_parent.values():
            children.sort(key=lambda g: g.name)

        nodes_by_key: dict[tuple[str, int | None], TreeNode] = {}

        def build(parent_node: TreeNode, group_id: int | None) -> None:
            for group in children_by_parent.get(group_id, []):
                child = parent_node.add(
                    group.name, data={"type": "group", "id": group.id}, expand=True
                )
                nodes_by_key[("group", group.id)] = child
                build(child, group.id)
                for note in notes_by_group.get(group.id, []):
                    leaf = child.add_leaf(
                        note.title, data={"type": "note", "id": note.id}
                    )
                    nodes_by_key[("note", note.id)] = leaf

        build(tree.root, None)

        ungrouped_notes = notes_by_group.get(None, [])
        if ungrouped_notes or not groups:
            ungrouped = tree.root.add(
                "Ungrouped", data={"type": "group", "id": None}, expand=True
            )
            nodes_by_key[("group", None)] = ungrouped
            for note in ungrouped_notes:
                leaf = ungrouped.add_leaf(
                    note.title, data={"type": "note", "id": note.id}
                )
                nodes_by_key[("note", note.id)] = leaf

        if not notes and not groups:
            self.query_one("#preview", Markdown).update(
                "*No notes yet — press Ctrl+N.*"
            )

        target = nodes_by_key.get(previous_key) if previous_key else None
        if target is None:
            # Prefer landing on a note over a group header, matching the old
            # flat list's default of highlighting the first note.
            target = next(
                (n for k, n in nodes_by_key.items() if k[0] == "note"), None
            )
        if target is None:
            target = next(iter(nodes_by_key.values()), None)
        if target is not None:
            # Force the tree to assign line numbers to the nodes just added -
            # move_cursor needs node._line, which is only populated once the
            # tree has built its lines at least once.
            _ = tree.last_line
            tree.move_cursor(target)
        if not keep_search_focused:
            tree.focus()

    def _highlighted_key(self, tree: Tree) -> tuple[str, int | None] | None:
        node = tree.cursor_node
        if node is None or node.data is None:
            return None
        return (node.data["type"], node.data["id"])

    def highlighted_group_id(self) -> int | None:
        """The group a newly created note/group should land in.

        A highlighted group node contributes its own id; a highlighted note
        contributes the group it already belongs to. Nothing highlighted (or
        the "Ungrouped" bucket) means top-level/ungrouped.
        """
        tree = self.query_one("#notes-tree", Tree)
        node = tree.cursor_node
        if node is None or node.data is None:
            return None
        if node.data["type"] == "group":
            return node.data["id"]
        note = self._notes_by_id.get(node.data["id"])
        return note.group_id if note else None

    def on_tree_node_highlighted(self, event: Tree.NodeHighlighted) -> None:
        data = event.node.data
        note = None
        if data and data["type"] == "note":
            note = self._notes_by_id.get(data["id"])
        preview = self.query_one("#preview", Markdown)
        preview.update(frontmatter.strip(note.content) if note else "")

    def on_tree_node_selected(self, event: Tree.NodeSelected) -> None:
        data = event.node.data
        if not data or data["type"] != "note":
            return
        note = self._notes_by_id.get(data["id"])
        if note is not None:
            self.app.push_screen(EditorScreen(note))

    def action_new_group(self) -> None:
        def handle_result(group: Group | None) -> None:
            if group is not None:
                self._refresh_notes()

        self.app.push_screen(NewGroupModal(self.highlighted_group_id()), handle_result)

    def action_rename_group(self) -> None:
        tree = self.query_one("#notes-tree", Tree)
        node = tree.cursor_node
        if node is None or node.data is None or node.data["type"] != "group":
            return
        group_id = node.data["id"]
        if group_id is None:
            return  # the "Ungrouped" bucket isn't a real, renamable group

        store: NotesStore = self.app.notes_store  # type: ignore[attr-defined]
        group = store.get_group(group_id)
        if group is None:
            return

        def handle_result(renamed: Group | None) -> None:
            if renamed is not None:
                self._refresh_notes()

        self.app.push_screen(RenameGroupModal(group), handle_result)

    def action_move_note(self) -> None:
        tree = self.query_one("#notes-tree", Tree)
        node = tree.cursor_node
        if node is None or node.data is None or node.data["type"] != "note":
            return
        note = self._notes_by_id.get(node.data["id"])
        if note is None:
            return

        store: NotesStore = self.app.notes_store  # type: ignore[attr-defined]
        groups = store.list_groups()

        def handle_result(selection: GroupSelection | None) -> None:
            if selection is not None:
                store.set_note_group(note.id, selection.group_id)
                self._refresh_notes()

        self.app.push_screen(SelectGroupModal(groups), handle_result)

    def action_delete_note(self) -> None:
        tree = self.query_one("#notes-tree", Tree)
        node = tree.cursor_node
        if node is None or node.data is None:
            return

        store: NotesStore = self.app.notes_store  # type: ignore[attr-defined]

        if node.data["type"] == "note":
            note_id = node.data["id"]
            note = self._notes_by_id.get(note_id)
            if note is None:
                return

            def handle_note_result(confirmed: bool | None) -> None:
                if confirmed:
                    store.delete_note(note_id)
                    self._refresh_notes()

            self.app.push_screen(ConfirmDeleteModal(note.title), handle_note_result)
            return

        group_id = node.data["id"]
        if group_id is None:
            return  # the "Ungrouped" bucket isn't a real, deletable group

        group = store.get_group(group_id)
        if group is None:
            return
        if not store.group_is_empty(group_id):
            self.notify(
                f'"{group.name}" still has sub-groups or notes in it — '
                "empty it before deleting.",
                severity="warning",
            )
            return

        def handle_group_result(confirmed: bool | None) -> None:
            if not confirmed:
                return
            try:
                store.delete_group(group_id)
            except GroupNotEmptyError:
                self.notify("Group is no longer empty.", severity="warning")
            else:
                self._refresh_notes()

        self.app.push_screen(ConfirmDeleteModal(group.name), handle_group_result)
