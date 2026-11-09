# Appearance, Follow the sun and the writing aids (the iPad app)

Source: the iPad app's [`CompositionCore`](../../apps/ios/CompositionCore/Sources/CompositionCore) (`Appearance/`, `Sun/`, `Editing/ReflowText.swift`,
`LiveReflow.swift`, `Writing.swift`) and the screens that use it ([`AppearanceView.swift`](../../apps/ios/Composition/AppearanceView.swift),
[`Look.swift`](../../apps/ios/Composition/Look.swift), [`SunClock.swift`](../../apps/ios/Composition/SunClock.swift),
[`NoteEditorView.swift`](../../apps/ios/Composition/NoteEditorView.swift)). The design is the iPad page's
[Step 10](../ipad-app-design.md#step-10-status) and the M3† rows of its tracker; the desktop's side is
[ui/web-follow-the-sun.md](../ui/web-follow-the-sun.md).

Three things live here: the colour schemes, **Follow the sun** (a sixth scheme that moves with the day), and the **ruler** and **reflow** that help with the shape
of the text. The last two ports of the desktop's TypeScript are checked against it by committed fixtures, like the PDF tables are.

## Colour schemes

A scheme is a `Theme`: the semantic tokens of the desktop's `globals.css` (`background`, `surface`, `panel`, `brand`, the `--syntax-*` colours …). Views ask `Look` for a
token, never for a colour, so a scheme restyles every one of them. The five schemes (Dark, Light, Forest, Wine, Cream) and **System** (Light or Dark as the iPad is
set) are the first ten rows of the Appearance sheet; the choice is the desktop's own `theme` key in `settings.json` (System is the iPad's `followSystem`, which the
desktop ignores). Every token is checked against the real stylesheet by `AppearanceConformanceTests`.

## Follow the sun

The scheme is dark at night and light by day and eases between the two around the sunrise and sunset of a saved city. It is the desktop's `auto` theme, with the
desktop's `sunPair` setting (which two palettes it moves between). Choosing it in the Appearance sheet shows the five pairs, each as a strip from full day to full
night, and a city field.

| Piece | Where | What it is |
|---|---|---|
| `Sun.level`, `Sun.tone`, `Sun.autoLight`, `Sun.fallbackEvents` | `Sun/SunSchedule.swift` | `sunSchedule.ts`: how light the app is at a moment (a 90-minute smoothstep ramp centred on each sunrise and sunset), when the text flips between the two palettes' inks, the `--auto-light` percentage (`toFixed(1)`, a tie going up), and the stand-in 06:30 and 18:30 events on the machine's clock |
| `SunPairName` | `Sun/SunPairs.swift` | `sunPairs.ts`: classic, cream-amber, mint-forest, blush-wine, sky-midnight, each with the point (0.45 to 0.5) where its two inks read equally |
| `Theme.sunOnly`, `Theme.sun(pair:level:)` | `Appearance/Theme+SunPalettes.swift`, `Theme+Sun.swift` | the five palettes that exist only as halves of a pair (a dark amber, a mint, a blush, a sky and a midnight), and the scheme at a level: the text and accents are one palette outright, only the page, the cards and the panel blend (`color-mix(in srgb, day <auto-light>, night)`) |
| `SunLookup`, `SunService` | `Sun/SunTimes.swift` | `sunTimes.ts`: the city lookup and the forecast from [Open-Meteo](https://open-meteo.com), the six-hour cache, the two-minute backoff after a failure, one request for simultaneous callers, today's times in the city's own zone; `saveCity` is the desktop's `saveLocation` (an empty field forgets the city) |
| `SunClock` | `Composition/SunClock.swift` | what the scheme follows now: the times (real, or the stand-ins), asked for only while the scheme is chosen and a city is saved, again every ten minutes while they are missing or used up |
| `ThemedRoot` | `Composition/CompositionApp.swift` | looks the scheme up again every half minute while it is in force (a `TimelineView`), so the fade moves while the app is open |

**What it asks of the network, and when.** Only while Follow the sun is the scheme in force: the city once, when it is saved (`geocoding-api.open-meteo.com`, the text
typed), and the times of that city (`api.open-meteo.com`, its latitude and longitude): at most every six hours, and every ten minutes while they could not be loaded.
Nothing about the person or the iPad is sent. This is the app's only network use; **it is a privacy-label question for M3's distribution checklist.** A request is given
three seconds in all, and the last good answer is served when it fails.

**First paint.** The network cannot be waited for, so the last launch's times are kept in the app's defaults (`sun.lastTimes.v1`, not in `settings.json`, whose backup
must stay the desktop's) and used until the first answer; with nothing kept, or no city, the scheme runs on 6:30 and 6:30.

**In the settings file.** `theme: "auto"`, `sunPair` and the existing `location` (name, latitude, longitude, IANA zone), exactly the desktop's, so a backup restores both
ways: the desktop's Follow the sun is the iPad's, with the same pair and city, and the reverse.

**What it checks.** [`fixtures/conformance/sun.json`](../../fixtures/conformance/README.md) is what the desktop's own code makes of a long list of inputs, and
`SunConformanceTests` replays it: the level at 1,752 moments over 43 event lists in every order (ties, one-sided days, a day shorter than the ramp), the tone of 306 levels at every flip
point, the percentage text for 912 levels (every multiple of 1/800, which is where `toFixed` and `printf` round a tie differently), the stand-in events in fourteen
zones across the days their clocks change (168 cases), today's times in nineteen zones (126 cases) (half-hour and 45-minute offsets, the date line, the same day number in another month or
year), 33 replies to the city lookup (the address asked for, the name made, every bad shape), ten scripted sessions of the cache, 65 steps (what it asks for, what it keeps and for
how long, including a reply that is not iterable and so counts as a failure),, and the palettes and blend endpoints read from the real `globals.css`. Thirty-two deliberate
breakages of the port were each caught by a check (the first round missed four, which are now pinned).

**Where it differs from the desktop**

- A time zone the system does not know gives no times, where the desktop throws a `RangeError`.
- The clock text is written with an ordinary space before AM and PM (this Node's ICU uses one too; a newer ICU uses a narrow no-break space).
- The desktop's city field says what matched; the iPad's does too, below the field.

**A finding, not changed here.** Half way along the fade the page is a mid grey, which neither the day's dark ink nor the night's light ink can read on at 4.5:1. The
desktop flips the ink where the two read equally, which is about 3.2:1 (3.1 to 3.35 in the five pairs), and it stays under 4.5 for about 14 minutes of each 90-minute fade
(levels 0.33 to 0.66; 17 minutes for cream-amber). The iPad carries the same design over, `SunTests` pins how bad it gets and for how long, and whether that is acceptable
for N6 is the author's call.

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

`swift test` runs the two fixture replays (`SunConformanceTests`, `ReflowConformanceTests`), `SunTests` (the scheme at a level, saving a city, the cache across launches, how
legible the fade is) and `AppearanceTests` (the settings). `apps/ios/scripts/conformance.sh` first checks the desktop still makes both fixtures; the UI tests in
`AppearanceUITests` check what the screen paints at the ends and the middle of the fade (to the pixel), the sheet, reflow by typing into a note, and the ruler.
