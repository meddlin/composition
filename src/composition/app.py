"""Textual application shell for Composition."""

from typing import ClassVar

from textual.app import App, ComposeResult
from textual.widgets import Footer, Header, Static


class CompositionApp(App):
    """Skeleton TUI shell for the Composition note-taking app."""

    TITLE = "Composition"
    BINDINGS: ClassVar = [("q", "quit", "Quit")]

    def compose(self) -> ComposeResult:
        yield Header()
        yield Static(
            "Composition is running. Press q to quit.",
            id="placeholder",
        )
        yield Footer()


def main() -> None:
    CompositionApp().run()


if __name__ == "__main__":
    main()
