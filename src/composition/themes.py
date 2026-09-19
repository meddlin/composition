"""Color schemes the user can choose between in Settings."""

from __future__ import annotations

from textual.theme import Theme

# The app's original look: Textual's built-in dark theme.
DARK_THEME_NAME = "textual-dark"

LIGHT_THEME = Theme(
    name="composition-light",
    primary="#0B62D6",
    secondary="#5B6B7F",
    accent="#C2570C",
    warning="#B7791F",
    error="#C4314B",
    success="#1A7F4B",
    foreground="#24292F",
    background="#F7F7F4",
    surface="#EDEDE8",
    panel="#E2E2DB",
    dark=False,
)

FOREST_THEME = Theme(
    name="composition-forest",
    primary="#3FB876",
    secondary="#2E7D57",
    accent="#E3B341",
    warning="#E0A030",
    error="#D9596B",
    success="#7BD88F",
    foreground="#D5E5DA",
    background="#0C1510",
    surface="#132019",
    panel="#1A2C22",
    dark=True,
)

CUSTOM_THEMES = (LIGHT_THEME, FOREST_THEME)

DEFAULT_THEME = DARK_THEME_NAME

# (label shown in Settings, theme name) in display order.
THEME_CHOICES: tuple[tuple[str, str], ...] = (
    ("Dark", DARK_THEME_NAME),
    ("Light", LIGHT_THEME.name),
    ("Forest (dark green)", FOREST_THEME.name),
)

THEME_NAMES = frozenset(name for _, name in THEME_CHOICES)
