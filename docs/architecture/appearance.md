# Appearance, Follow the sun and the writing aids (the iPad app)

Source: the iPad app's [`CompositionCore`](../../apps/ios/CompositionCore/Sources/CompositionCore) (`Appearance/`, `Sun/`, `Editing/ReflowText.swift`,
`LiveReflow.swift`, `Writing.swift`) and the screens that use it ([`AppearanceView.swift`](../../apps/ios/Composition/AppearanceView.swift),
[`Look.swift`](../../apps/ios/Composition/Look.swift), [`SunClock.swift`](../../apps/ios/Composition/SunClock.swift),
[`NoteEditorView.swift`](../../apps/ios/Composition/NoteEditorView.swift)). The design is the iPad page's
[Step 10](../ipad-app-design.md#step-10-status) and the M3† rows of its tracker; the desktop's side is
[ui/web-follow-the-sun.md](../ui/web-follow-the-sun.md).

Three things live here: the colour schemes, **Follow the sun** (a sixth scheme that moves with the day at hours the person sets), and the **ruler** and **reflow** that help with the shape
of the text. The last two ports of the desktop's TypeScript are checked against it by committed fixtures, like the PDF tables are.

## Colour schemes

A scheme is a `Theme`: the semantic tokens of the desktop's `globals.css` (`background`, `surface`, `panel`, `brand`, the `--syntax-*` colours …). Views ask `Look` for a
token, never for a colour, so a scheme restyles every one of them. The five schemes (Dark, Light, Forest, Wine, Cream) and **System** (Light or Dark as the iPad is
set) are the first ten rows of the Appearance sheet; the choice is the desktop's own `theme` key in `settings.json` (System is the iPad's `followSystem`, which the
desktop ignores). Every token is checked against the real stylesheet by `AppearanceConformanceTests`.

## Follow the sun

The scheme is dark at night and light by day and eases between the two at **four hours the person sets by hand** (Appearance ▸ Follow the sun ▸ *When it changes*). It is
the desktop's `auto` theme, with the desktop's `sunPair` setting (which two palettes it moves between) and its `sunHours` setting. Choosing it in the Appearance sheet shows
the five pairs, each as a strip from full day to full night, and four time pickers with a strip of the whole day in the chosen pair's colours. Until 2026-11-12 it followed a
saved city's sunrise and sunset, looked up on Open-Meteo; that lookup, and every network request in the app, is gone ([the redesign](../ipad-build-plan.md#between-m2-and-m3-the-follow-the-sun-redesign)).

| Piece | Where | What it is |
|---|---|---|
| `Sun.level`, `Sun.msOfLocalDay`, `Sun.tone`, `Sun.autoLight` | `Sun/SunSchedule.swift` | `sunSchedule.ts`: how light the app is at a time of day (a smoothstep over each of the two spans the hours set, in whole milliseconds), the time of day on the wall clock in a zone, when the text flips between the two palettes' inks, and the `--auto-light` percentage (`toFixed(1)`, a tie going up) |
| `SunHours` | `Sun/SunHours.swift` | `sunHours.ts`: the four hours as minutes after midnight; `HH:MM` read and written, the rule that they go once round the clock in order (each at least a minute after the one before), the words for refusing a set, and the defaults (05:45, 07:15, 17:45, 19:15) |
| `SunPairName` | `Sun/SunPairs.swift` | `sunPairs.ts`: classic, cream-amber, mint-forest, blush-wine, sky-midnight, each with the point (0.45 to 0.5) where its two inks read equally |
| `Theme.sunOnly`, `Theme.sun(pair:level:)` | `Appearance/Theme+SunPalettes.swift`, `Theme+Sun.swift` | the five palettes that exist only as halves of a pair (a dark amber, a mint, a blush, a sky and a midnight), and the scheme at a level: the text and accents are one palette outright, only the page, the cards and the panel blend (`color-mix(in srgb, day <auto-light>, night)`) |
| `SettingsStore.sunHours()`, `setSunHours` | `Settings.swift` | the `sunHours` key of `settings.json` (a set that is not all four valid and in order reads as the defaults; `setSunHours` refuses one that does not go round the clock) |
| `SunClock` | `Composition/SunClock.swift` | holds the saved hours and answers `level(at:)`; nothing to fetch, nothing to keep fresh |
| `ThemedRoot` | `Composition/CompositionApp.swift` | looks the scheme up again every half minute while it is in force (a `TimelineView`), so the fade moves while the app is open |

**What it asks of the network: nothing.** The level is a function of the iPad's own clock and the four times, so Follow the sun, like the rest of the app, makes no request.
There is no city, no location, no geocoding and no cache; the app makes no network connection at all (the privacy manifest declares no collected data).

**First paint.** The hours are read from `settings.json` with the rest of the appearance, so the first frame is already at the right point of the fade; there is nothing to wait for.
Earlier builds kept the last launch's sunrise and sunset in the app's defaults (`sun.lastTimes.v1`); the app removes that key when it starts.

**In the settings file.** `theme: "auto"`, `sunPair` and `sunHours` (`{"lightenFrom": "05:45", "lightFrom": "07:15", "darkenFrom": "17:45", "darkFrom": "19:15"}`), exactly the
desktop's, so a backup restores both ways: the desktop's Follow the sun is the iPad's, with the same pair and hours, and the reverse. A city (`location`) that an older version
saved is not read; the store removes it on the next write of any setting, as the desktop's rewrite of the file does. An older desktop that restores a backup with `sunHours` does
not know the key and uses its stand-in times.

**What it checks.** [`fixtures/conformance/sun.json`](../../fixtures/conformance/README.md) is what the desktop's own code makes of a long list of inputs, and
`SunConformanceTests` replays it: `HH:MM` read and written (28 inputs), 28 sets of hours accepted, refused (with the desktop's words) or read as the defaults, the level
over 111 sets of hours (7,376 moments, at every edge of a fade and between, all agreeing to the last bit), the tone of 306 levels at every flip point, the percentage text for 912 levels (every
multiple of 1/800, which is where `toFixed` and `printf` round a tie differently), the time of day on the wall clock in fourteen zones across the days and the instants their
clocks change (204 cases), and the palettes and blend endpoints read from the real `globals.css`.

**Where it differs from the desktop**

- A time zone the system does not know is not an input here: the hours are read on the device's own clock.
- The pickers are the iPad's own compact time pickers (12- or 24-hour as the iPad is set); what is kept is `HH:MM` on a 24-hour clock either way.
- The desktop rewrites its settings file from the keys it knows, so any save drops a saved city; the iPad's store keeps every other key and drops only `location`.

**A finding, not changed here.** Half way along a fade the page is a mid grey, which neither the day's dark ink nor the night's light ink can read on at 4.5:1. The
desktop flips the ink where the two read equally, which is about 3.2:1 (3.1 to 3.35 in the five pairs), and it stays under 4.5 for the middle of a fade (levels 0.33 to
0.66, 17 minutes of a 90-minute fade for cream-amber and 14 for the others). The iPad carries the same design over, `SunTests` pins how bad it gets, and whether that is
acceptable for N6 is the author's call. **With hours set by hand the time spent there is the person's choice:** a fade of 90 minutes passes through it in about 14, one of
six hours stays in it for about an hour, and a fade of a minute does not linger at all.

## Reflow and the ruler

The desktop's Settings ▸ Writing has two aids, both off until switched on: a **ruler** (a vertical line at a column) and **reflow** (a line that typing has pushed past its
column is broken at the last space before it). The iPad has both, in the Appearance sheet's Writing section, in the Markdown and Live tabs (one text view serves both).
The settings are the desktop's `writing` object in `settings.json` (`WritingSettings`; the heading rail and word count keys it also holds are read and kept, and are not
this page's).

| Piece | Where | What it is |
|---|---|---|
| `ReflowText.reflowAtCaret`, `changedSpan` | `Editing/ReflowText.swift` | `reflowText.ts`: breaks the line the caret is on, once or as often as it takes, keeping the indent, the `>` quote marks and the text of a list item or task in line; never breaks frontmatter, fences and what is in them, headings, HTML and JSX, indented code, or (when asked) table rows |
| `LiveReflow` | `Editing/LiveReflow.swift` | the decision of `liveReflow.ts`: only typing breaks a line (not a paste, a drop, a deletion, an undo, a return, or a half-composed word), and not a change that brings a new line in |
| `WritingSettings` | `Editing/Writing.swift` | `writing.ts`: parse (a default for anything missing or invalid) and validate (a column of 5 is refused, not made 80) |
| the ruler | `NoteTextView.updateRuler` | a 1-pixel view in the text view at `column` times the width of a "0" in the editor's face from where the text starts (CSS's `ch`); it scrolls with the text; no view exists while it is off |
| the break | `NoteEditorView.Coordinator.breakTypedLine` | after a typed character, a moment later in the same turn of the run loop, so that one undo should take the character and the break back together |

The port is done over UTF-16 units and with **JavaScript's idea of white space** (U+FEFF is white space, U+0085 is not), because the desktop counts and cuts that way and a
`UITextView` does too. The line shapes are scanned by hand rather than with `NSRegularExpression`, whose `\s` and `$` differ from JavaScript's.

**What it checks.** [`fixtures/conformance/reflow.json`](../../fixtures/conformance/README.md) holds what the desktop's code makes of 605 lines (273 broken, 332 left whole: prefixes, quotes, lists,
tasks, tables with every delimiter shape, fences, frontmatter, indented code, odd white space, emoji and combining marks, at carets all along the line), 18 changed spans,
262 single changes through the real CodeMirror filter (which events reflow), and 181 settings inputs; `ReflowConformanceTests` replays it. Thirty-three deliberate breakages
of the port were each caught by a check, except five that change nothing anyone could see (the line that is exactly the column, twice; a space run that starts at the prefix's end;
the caret that is exactly at the end of the spaces; a closing `---` that cannot be broken anyway). The first round missed three more, which are now pinned.

**Where it differs from the desktop**

- On the desktop's Live tab the break is part of the typed character's own transaction. On the iPad it follows the character by a moment, as in the desktop's plain Markdown
  editor, and whether one undo takes both back is a [manual-test item](../manual-tests/ipad.md).
- A change that is not a keystroke is told apart by what UIKit says (a paste is seen, an undo or redo is seen, a change of more than 64 characters or with a line break is not typing),
  not by CodeMirror's event names, so dictation of a long phrase is left as it is.
- The ruler's column in a proportional face (Sans serif, Serif) is that many "0"s wide, as on the desktop.

## Tests

`swift test` runs the two fixture replays (`SunConformanceTests`, `ReflowConformanceTests`), `SunTests` (the scheme at a level, the hours and what keeping them does to the
settings file, how legible the fade is) and `AppearanceTests` (the settings). `apps/ios/scripts/conformance.sh` first checks the desktop still makes both fixtures; the UI tests in
`AppearanceUITests` check what the screen paints at the ends and the middle of the fade (to the pixel), the sheet, reflow by typing into a note, and the ruler.
