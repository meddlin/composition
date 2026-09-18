import pytest
from _doubles import FakeSearchIndex

from composition.app import CompositionApp
from composition.storage import NotesStore


@pytest.fixture
def app(tmp_path, monkeypatch):
    db_path = tmp_path / "composition.db"
    fake_search = FakeSearchIndex()
    monkeypatch.setattr(
        "composition.app.NotesStore",
        lambda **kwargs: NotesStore(db_path, **kwargs),
    )
    return CompositionApp(search_index=fake_search)


def _titles(app) -> list[str]:
    from textual.widgets import Tree

    tree = app.screen.query_one("#notes-tree", Tree)
    titles: list[str] = []

    def walk(node) -> None:
        for child in node.children:
            if child.data and child.data.get("type") == "note":
                titles.append(str(child.label))
            walk(child)

    walk(tree.root)
    return titles


async def test_typing_filters_list_after_debounce(app):
    app.notes_store.create_note("Roadmap Draft")
    app.notes_store.create_note("Grocery List")
    app.notes_store.create_note("Roadmap Notes")

    async with app.run_test() as pilot:
        await pilot.pause()
        search_input = app.screen.query_one("#search-input")
        search_input.focus()
        search_input.value = "roadmap"
        search_input.post_message(search_input.Changed(search_input, "roadmap"))
        await pilot.pause(0.45)

        titles = _titles(app)
        assert len(titles) == 2
        assert all("roadmap" in str(t).lower() for t in titles)


async def test_list_unchanged_before_debounce_elapses(app):
    app.notes_store.create_note("Roadmap Draft")
    app.notes_store.create_note("Grocery List")

    async with app.run_test() as pilot:
        await pilot.pause()
        search_input = app.screen.query_one("#search-input")
        search_input.focus()
        search_input.value = "roadmap"
        search_input.post_message(search_input.Changed(search_input, "roadmap"))
        await pilot.pause(0.1)

        assert len(_titles(app)) == 2

        await pilot.pause(0.35)
        assert len(_titles(app)) == 1


async def test_clearing_search_restores_full_list(app):
    app.notes_store.create_note("Roadmap Draft")
    app.notes_store.create_note("Grocery List")

    async with app.run_test() as pilot:
        await pilot.pause()
        search_input = app.screen.query_one("#search-input")
        search_input.focus()
        search_input.value = "roadmap"
        search_input.post_message(search_input.Changed(search_input, "roadmap"))
        await pilot.pause(0.45)
        assert len(_titles(app)) == 1

        search_input.value = ""
        search_input.post_message(search_input.Changed(search_input, ""))
        await pilot.pause(0.45)
        assert len(_titles(app)) == 2


async def test_search_input_keeps_focus_until_tab(app):
    app.notes_store.create_note("Roadmap Draft")
    app.notes_store.create_note("Grocery List")

    async with app.run_test() as pilot:
        await pilot.pause()
        search_input = app.screen.query_one("#search-input")
        search_input.focus()
        await pilot.pause()
        assert app.screen.focused is search_input

        search_input.value = "roadmap"
        search_input.post_message(search_input.Changed(search_input, "roadmap"))
        await pilot.pause(0.45)
        assert app.screen.focused is search_input

        await pilot.press("tab")
        await pilot.pause()
        assert app.screen.focused is not search_input


async def test_returning_from_editor_reapplies_active_search(app):
    app.notes_store.create_note("Roadmap Draft")
    app.notes_store.create_note("Grocery List")

    async with app.run_test() as pilot:
        await pilot.pause()
        search_input = app.screen.query_one("#search-input")
        search_input.focus()
        search_input.value = "roadmap"
        search_input.post_message(search_input.Changed(search_input, "roadmap"))
        await pilot.pause(0.45)
        assert len(_titles(app)) == 1

        # Focus stays on the search input after searching; Tab is required
        # to move it to the tree before a note can be opened via Enter.
        await pilot.press("tab")
        await pilot.pause()
        await pilot.press("enter")
        await pilot.pause()
        app.pop_screen()
        await pilot.pause()

        assert len(_titles(app)) == 1
