# iPad build: plan for the first milestone (M1)

[ipad-app-design.md](ipad-app-design.md) is the design, the feature tracker and the compromises. This page is the **order of work
for M1, "usable notebook"**: what is built first, what each step ends in, which steps can run side by side, and what only you can
decide or do. It is the page that design's Gate A asks for, in the style of [windows-build-plan.md](windows-build-plan.md). M2 (the
Pencil) and M3 (the first release) get their own plans when M1 is in hand. Dates are 2026-11-06.

**In scope (M1):** the sync-ready store, notebooks, groups, notes, favorites and the Trash Can; the Markdown, Preview and Split tabs;
search; images; the MDX components other than `<Ink>` and `<YouTube>`'s player; the six colour schemes and a System scheme; backup and
restore both ways; installed on your iPad from Xcode.
**Out of scope:** `<Ink>` and the Pencil canvas (M2), the release polish and TestFlight (M3), sync, the plugins, **any AI helper
([D19](ipad-app-design.md#decisions))**, and the Live tab ([C12](ipad-app-design.md#compromise-register)): **it is in v1** (you, 2026-11-08) but not in M1: it is built right after M1 closes, before M2 (see [After M1: the Live view](#after-m1-the-live-view)); **it is built and checked in the Simulator (2026-11-09), and Gate L, the author's iPad, is what is left.**

## Where M1 starts

Facts, checked 2026-11-06:

- **Of the 43 M1 rows in the tracker, 15 were built, 3 were spiked and 25 were not started when this plan was written** (after correcting five rows
  that had gone stale: search, its filters, the backup round trip and the stable `uuid`). What existed was the **read side**: the data layer,
  backup and restore, the Trash Can, search with typo tolerance, the Markdown and MDX layer, a Preview that draws all ten components, and a
  prototype app that runs on your iPad with your notes. **Steps 1 to 3 (2026-11-06) added the core's write side**: settings and favorites, the
  store operations for notes, groups and notebooks, and frontmatter. No screen uses them yet. Still missing: images, themes, and everything that
  saves from the app (autosave, the editor, the organization screens).
- **Every port so far was checked against the desktop's own TypeScript** (the Trash Can, search, the MDX scanner and the helpers behind the
  components): a script or corpus is run through the real code, and Swift must give the same answers. 137 Swift tests pass with the fixtures, and
  `apps/ios/scripts/conformance.sh` runs the desktop-to-Swift-and-back check in CI. The plan keeps that rule: **no port without an oracle**.
- **What is left to port is small.** `images.ts` 145 lines and `themes.ts` 30. (`trashRepo.ts`, `notesRepo.ts`, `groupsRepo.ts`, `notebooksRepo.ts`,
  `favorites.ts` and `frontmatter.ts`, 1,000 lines in all, are ported and checked.)
- **S3 (the editor spike) and S4 (Markdown) are done in the Simulator.** The editor stays on TextKit 2; find, a completion list and views
  in the text work; a full re-colour of a 5,030-line note costs 87 ms an edit even in a Release build, so the editor needs an incremental one
  ([S3 status](ipad-app-design.md#s3-status)). Not tried: Scribble, the Pencil, arrow keys across hidden marks, VoiceOver, the iPad's own speed.
- **Settings were a gap (closed by Step 1).** The colour scheme, the saved city and **favorites** live in the desktop's `settings.json`, which a backup carries
  (`backup.ts`). The Swift core used to keep that file as bytes and never write one, so favorites could not round-trip. **And a restore
  replaces the desktop's settings with the backup's** (`service.ts` saves `{ ...staged.settings, appDataDir, dbPath }`, with defaults filled in for
  missing keys), so an iPad backup carrying a partial `settings.json` would reset the desktop's colour scheme ([G5](#decisions-to-make)).
- **Not verified:** the iPad's speed and the Pencil's behaviour in a text view. (The iPad is on iPadOS 27.0.1, and you chose an iPadOS 17 floor on 2026-11-06, so D16 is closed.)

## What M1 is made of

| Piece | Tracker rows | Where it lands | Oracle |
|---|---|---|---|
| Settings and `settings.json` | favorites, colour scheme, city | Core | desktop's `parseWebSettings`, and a backup round trip |
| Notes, groups, notebooks operations | create, edit, delete, move, reorder, notebooks | Core | a script run through the real repos, every table dumped after each step (as the Trash Can) |
| Frontmatter | title, description, tags, dates, header image | Core | the desktop's `parse` and `render` over a corpus |
| Autosave and lifecycle | autosave, state restoration, N5 | App | a scripted type-kill-relaunch in the Simulator |
| The editor | Markdown, Preview and Split tabs, find, Scribble | App | the lab's numbers, then the manual test |
| Organization | sidebar, drag and drop, back and forward, columns | App | UI tests on the main flows |
| Images | store, insert, paste, photo and camera, `<Image>` width | Core and app | the desktop's `sniffImage`, `imageFileName` |
| Typing aids | `<` completion, `[[` links, indent, `<Mark>`, shortcuts | Core and app | the desktop's completion catalogues |
| Appearance | six schemes and System, fonts, Mark and chart colours | App | snapshots of the ten components in every scheme |
| Accessibility and size classes | Dynamic Type, VoiceOver, Split View, N3, N6, N7 | App | Accessibility Inspector, then you |

## Decisions to make

Recommendations are mine. **G1 and G2 were decided on 2026-11-06 (Gate A is passed).** G3 needs your input before M3; the rest I proceed on unless you object.

| # | Decision | Recommendation | Why / what it costs |
|---|---|---|---|
| **G1** | **Gate A: decided 2026-11-06.** Settle D2 (GRDB, `ensureColumn` migrations, no Core Data or SwiftData), D3 (FTS5 plus the typo layer, in its own `search.db`), D7 (the conformance corpus keeps the two sides honest) and D16 (the iPadOS floor). | **You accepted D2, D3 and D7 as written, and the floor is iPadOS 17 (D16)**; the iPad is on 27.0.1. | Evidence is in: S1 (GRDB, FTS5, backups), S2 (search against Meilisearch), the conformance runs. The floor decides which APIs can be used without checks (the design page puts `UIFindInteraction` and the view-provider attachments at iOS 16; Swift Charts' `SectorMark`, which the Preview uses, is iOS 17), and nothing planned here needs more than 17. |
| G2 | **D6: may the web renderer be a temporary preview scaffold?** | **Closed 2026-11-06, as recommended: not needed.** | S4 built a native Preview for all ten components, so there is nothing to scaffold. |
| **G3** | **Bundle id, Apple team, app name and icon, licence notices.** | **Keep the placeholders (`com.rushinglabs.composition.ipad.dev`) for M1; settle them before M3's TestFlight.** | The design says to settle them before M1's first install, but you already have a placeholder install, and a test install that changes id costs a backup and restore. The id becomes effectively permanent at the first release, so decide it deliberately then. The licence notices for GRDB and swift-markdown are small and I will add them in Step 11 whatever you choose. |
| G4 | **Change-capture triggers and the outbox.** | **Fallback stays: the iPad runs on the `uuid` alone.** Re-check `main` at Gate B. | They are not on `main` yet ([D8](ipad-app-design.md#decisions)). Safe for v1; they can arrive as a later `CREATE … IF NOT EXISTS`. |
| G5 | **What the iPad writes to `settings.json` in a backup.** Today it writes none, so favorites are lost both ways; a *partial* file would reset the desktop's colour scheme and city on restore (it replaces, above). | **When the iPad was set up from a desktop backup, keep that backup's `settings.json` and change only the favorites (and city); otherwise write one only after you first favorite something, with defaults for the rest, and say so when you export.** | It makes the round trip keep the desktop's own scheme. The remaining cost: an iPad that never saw a desktop backup still hands the desktop default settings along with its favorites. Step 1 builds it and tests it through the real restore. |
| G6 | **How to read frontmatter's YAML.** | **A small parser for the known keys, checked against the desktop's `js-yaml` over a corpus; Yams only if the corpus shows it is not enough.** | Yams is a new dependency (the design wants a row for it first), and libyaml and `js-yaml` disagree on some edge cases, so a corpus is needed either way. The desktop falls back to "no frontmatter" when the block is not a YAML mapping; the parser must do the same. **Outcome (2026-11-06): neither Yams nor a hand parser; a port of js-yaml's loader and dumper, with no new dependency (Step 3).** |
| G7 | **The Live tab stays after v1.** | **Reversed (you, 2026-11-08): the Live tab is in v1,** built right after M1, before M2. The on-device checks in [manual-tests/ipad.md](manual-tests/ipad.md) (item 17 above all) decide how it is built. | One way of hiding marks works in the Simulator, but arrow keys, selection and VoiceOver are untried. |

## Build order

Each step ends in something checkable. Steps 1 to 3 touch different Swift files and different fixtures, so they can run as **separate
sessions at the same time**; give each its own `conformance-<name>.test.ts` in `apps/web/scripts`, because the one shared fixtures file would
conflict. Steps 4 and 5 are app-side and independent of 1 to 3. Step 6 needs 2 to 5. A cold `xcodebuild` took over ten minutes here, so
the core is developed with `swift test` and the app is built only to look at it.

**Orientation is a rule for every step, not a step** (you, 2026-11-06: mostly landscape, sometimes portrait). Each screen an app step builds is looked at in **landscape first, then portrait**, and turned while
it is in use (typing, a sheet open); a screen is not done until both work. Layout follows the width the view is given, not the orientation ([App structure](ipad-app-design.md#app-structure-windows-and-themes), N3), so Step 11 only
has to add the system's other window sizes. Steps 1 to 6 have been checked that way in the Simulator (an iPad Pro 11-inch, and an iPad mini for portrait).

0. **Gate A** (you). **Passed 2026-11-06**: D2, D3, D7 and D16 decided, D6 closed. Nothing below needs more; G3 can wait.
1. **Settings.** A `Settings` type in the core for the keys the iPad uses (favorites, colour scheme, saved city), read from and written to a
   `settings.json` in the data folder, keeping every key it does not use as it came ([G5](#decisions-to-make)); `Backup` carries it both ways.
   Check: a corpus through the desktop's `parseWebSettings`, and `conformance.sh`'s backup round trip with favorites changed on the iPad and the
   desktop's other settings left as they were, restored through the real `stageBackup` and `applyStagedBackup`.
   **Done 2026-11-06:** `Settings.swift` (`SettingsStore`), `Backup` carrying `settings.json` both ways; 66 of 66 inputs in `settings-cases.json` read as the desktop
   reads them, a Swift backup with changed favorites restores on the desktop with every other key unchanged, and the check fails when an answer is corrupted. 111 tests pass.
2. **Store operations.** Ports of `notesRepo`, `groupsRepo` and `notebooksRepo`: the same SQL, errors (`GroupNotEmptyError`,
   `InvalidGroupMoveError`, `LastNotebookError`…), ordering (`placeNote`, `placeGroup`, `placeNotebook`), `updated_at`, and the `uuid` left to
   the trigger. Every write also keeps `search.db` in step (`upsert` and `remove`, then `markCurrent`). A script like the Trash Can's
   (`fixtures/conformance/store-script.json`) is run through the desktop's real repos, every table dumped after each step; Swift runs the
   same script and compares. Check: the script passes, and a copy of your own database opens, takes a hundred operations and still restores on the desktop.
   **Done 2026-11-06 (the core; no screens yet):** `Store/` has the three repositories (`NotebooksStore`, `GroupsStore`, `NotesStore`: the desktop's SQL, errors and
   ordering) and `NoteStore`, the data operations of `service.ts` with the search index kept in step. The 98 steps of `store-script.json` (every create, save, move,
   place, rename and refusal, the Trash Can through the service, and a database with no notebook left) give the same results and leave the same rows in
   `notes`, `groups`, `notebooks`, `trashed_notes`, `trashed_groups` and `sqlite_sequence` as the desktop's real `service.ts`, and the check fails when an answer or
   a row is corrupted. The backup round trip now also puts about a hundred of those operations through the restored desktop database before Swift backs it up
   again, and the desktop restores the result. Two choices differ from the wording above: a write marks `search.db` as matching the notes only if it matched them
   *before* the write (so a stale index stays stale until the next launch rebuilds it, instead of being blessed), and `listNotebooks` does not re-run the
   desktop's adoption of rows an older CLI wrote, because opening the database already does it. **Not done:** the hundred operations on a *copy of your own
   database* (yours is on your Mac and iPad, and I did not touch it); Step 6 repeats the script from the UI, which is the better place for it.
3. **Frontmatter.** `parse`, `generate`, `render` and `withHeaderImage` ([G6](#decisions-to-make)); the note's `title`, `description` and tags are
   kept in step with the columns as the desktop does. Check: a corpus of frontmatter variants (quoted and unquoted, lists, dates, a block
   that is not a mapping, CRLF) through the desktop's `parse` and `render`, and byte-identical output where the desktop rewrites it.
   **Done 2026-11-06:** G6 went further than "a small parser": the oracle showed that whether a block is a mapping, a title is a string or a date, and a long title is
   folded at 78 columns all depend on js-yaml's details, so `YAML/` is a port of js-yaml 4's loader and dumper (no dependency). 111 of 111 blocks in
   `frontmatter-cases.json` read as the desktop reads them (tabs, anchors, merge keys, block scalars, bad escapes, dates that roll over, CRLF, blocks that are not
   mappings), 123 of 123 titles, descriptions and tag lists are written byte for byte, 16 of 16 header-image edits and the tag helpers agree, and the check fails
   when an answer is corrupted. `NoteFrontmatter.split`, which the Preview and the colouring use, now asks the same reader, so a header block the desktop shows as
   text is text here too. The columns are kept in step with the frontmatter by `saveNoteContent` (in the store, Step 2's script covers it). A document nested past 100
   levels or past the thread's stack, and a list built from aliases of aliases, are refused or cut short rather than crashing.
4. **Autosave and lifecycle (spike S6).** One write path: debounce, then flush on leaving the foreground, on a scene change and on
   termination; a second window shares the one database pool. Check, in the Simulator and scripted: type, `simctl terminate`, relaunch, and
   the text is there; the same with the app backgrounded mid-word. **S6 exit: no lost keystrokes.**
   **Done 2026-11-06 in the Simulator (not on the iPad):** `Autosave/` in the core (`NoteAutosaver`, `NoteDrafts`, `NoteSessions`), a plain-text *Edit* tab in the app to drive it, flushing on every way
   the app leaves the foreground inside a background-task assertion, and `@SceneStorage` for the open note, tab and caret. **The plan's debounce-and-flush was not enough:** with the pause stretched to
   30 s, a kill inside it lost everything typed and a kill mid-burst kept 1 of 26 characters, so each edit is also written to a draft file (coalesced, off the main thread) which the next launch applies; with it, all
   three cases of `apps/ios/scripts/autosave-kill-test.sh` (kill inside the pause, background inside the pause, kill mid-burst) lose nothing, and the checks fail when the draft write or the flushes are disabled.
   17 unit tests. Not done: the same on your iPad (manual-test items 20 to 26), and a second window (not enabled in the target; the shared session is tested in the core).
5. **Incremental colouring (R13).** Re-colour only the paragraphs around an edit, redo the whole note on an idle pause (so what a one-paragraph
   read gets wrong, like a fenced block or a loose list, is corrected a moment later), and read the Markdown off the main thread; the Live-style reveal
   re-colours only the two paragraphs involved. Skip while a composition is under way. Check: the lab's line for *5,000 lines with views* in a
   **Release** build, against a proposed budget of about one frame (16 ms) of our own work per edit ([N7](ipad-app-design.md#the-native-bar)), then the iPad's number from you.
   **Done 2026-11-06 in the Simulator (the iPad's own number is still yours to give):** `HighlightModel` and `EditAccumulator` in the core keep the colours as the note's top-level blocks;
   after an edit only the blocks around it (and one neighbour each side) are read again, and the lab puts those colours on. A pause of 0.3 s starts a full read **off the main thread**, whose
   differences from the quick reads are put right in steps of at most 3,000 characters, and typing stops it. Release build, 5,034 lines with 20 views, 400 keystrokes through `insertText`:
   **our own work per keystroke 0.58 ms median, 0.9 ms worst, against 91 ms median for the whole-note colouring the lab used before** (the whole keystroke, with UIKit taking the character in, is
   3.4 ms median); a typed fence that swallows half the note was corrected by the pause in 11 ms of main-thread steps, the worst one under 1 ms. The quick read agrees with the full one in 97.7% of
   typed characters on the 115 notes of the MDX corpus, and a property test shows that quick reads plus repainting only what `differences` names always end with exactly the full read's colours
   (1,410 corpus edits and 4,000 random ones). **A bug found on the way:** 120,000 random edits made the old highlighter crash on odd Markdown (a quote that swallows a fence gives a child range outside its
   parent's, and a `Range` built backwards traps); fixed. The Live-style reveal re-colours only the paragraph the caret left and the one it entered. A composition (Scribble, dictation) is skipped and its edits
   are read as one when it ends (not tried: Scribble needs the Pencil). The lab's *Typing speed test* button, or `-openLab 1 -labBenchmark 1` on the launch arguments, repeats the measurement and writes `lab-benchmark.json`.
6. **The editor.** The Markdown tab for real notes, replacing the lab: bound to the store (2), frontmatter (3), autosave (4) and the incremental
   colouring (5); the Preview and Split tabs; find; the Trash Can from the note. Check: create, edit, relaunch, search for what you typed, trash and restore,
   on a copy of your notes; the rows written match the desktop's for the same operations (Step 2's script, driven from the UI layer).
   **Done 2026-11-06 in the Simulator (not on your iPad, and not on a copy of your own notes):** the app now has the three tabs of the design, **Markdown** (a TextKit 2 text view on the note's session, coloured by
   Step 5's quick reads, with the system find bar), **Preview** and **Split** (the preview follows what is typed, a quarter of a second after it; side by side from 800 points of width, or one above the other in a narrow window); the
   prototype's read-only *Source* tab is gone, since Markdown is the source. A **+** button makes a note ("Untitled", as the desktop does), opens it in Markdown with the keyboard up and the caret after its
   frontmatter; the Trash Can button on a note flushes it first and goes through `NoteStore`, as do restore and create, so the search index follows each. Every tab shares one `NoteSession`, so what is
   typed is what Preview shows and what autosave writes. **Checks:** `apps/ios/scripts/editor-flow-test.sh` makes a note through the app, types into it, backgrounds the app, trashes the note and restores it,
   then has the desktop's real `service.ts` do the same on a copy of the starting database with the clock set to the moments the app's rows record, and every row of `notes`, `groups`, `notebooks`, `trashed_notes`,
   `trashed_groups` and `sqlite_sequence` is equal (the check fails when the typed text differs); the Step 4 kill test still passes on the new editor. **A finding:** in the first version of the editor each
   keystroke cost **23 ms** in a 5,000-line note, none of it the colouring: `UITextView.text` returns a lazily bridged `NSString`, and comparing it with a native string went one character at a time through Objective-C.
   One native copy of the UTF-8 (0.25 ms) and not handing an editor its own edit back brought the whole `textViewDidChange` to **1.05 ms median, 1.5 ms worst** (Release, Simulator, 100,190 characters, typing in the
   middle); the colouring is 0.7 ms of that. **Orientation** (added the same day, see the rule under Build order): landscape and portrait were looked at on an iPad Pro 11-inch and an iPad mini in the Simulator, turning the iPad while typing in Split kept the text, the caret and the save;
   in a wide view Preview and the Markdown tab now keep to 820 points, centred, and Split stacks below 800 points ([Step 6 status](ipad-app-design.md#step-6-orientation)). Not done: the hundred-operations check on a copy of your own notes (item 27 to 33 of the manual test are for the iPad; items 34 to 36 are the turning checks), and everything of Steps 7 to 11 (groups, notebooks,
   images, completion, schemes, accessibility).
7. **Organization.** The sidebar of notebooks and groups, create, rename, delete, move and reorder, favorites (from Step 1), drag and drop within
   the app and from Files, back and forward, columns. Check: the first **UI tests** (XCUITest) on the main flows, and a pass in the Simulator.
   **Done 2026-11-06 in the Simulator (not on your iPad):** the browser is three columns (a sidebar of All Notes, Favorites and notebooks with their groups; a list of the sub-groups and notes of what is selected; the note), with create, rename, delete, *Move to…*, move up and down for groups and
   notebooks, favorites (`settings.json`, as the desktop keeps them), a compose button that puts a new note in the group you are on, drag and drop (a note onto a group or notebook, a group into another group or notebook or between its siblings, in-list order by the list's own drag, Markdown or text files and selections of
   text dropped on a group or the list become notes through `NoteStore.importNote`), back and forward (⌘[ and ⌘]), and the sidebar's place and open groups restored after a relaunch. **Ports with an oracle:** the desktop's `navHistory.ts`, `dropEdge.ts` and `groupListing.ts`, run over
   72 histories, 552 drags and 183 listings and 182 paths (`organization-cases.json`); Swift agrees with every answer, and breaking each port makes the check fail. **UI tests:** the project's first, `apps/ios/CompositionUITests` (ten tests, all passing, the tenth added with Step 8), run by `apps/ios/scripts/ui-test.sh` on a backup of two notebooks and six groups (`make-organization-backup.sh`). **What the system would not do, found by trying:** a drag that starts and
   ends in one list is the list's own (rows of one list do not see each other as drop targets), so in-list order is `onMove` and nesting inside the sidebar is *Move to…*; a drop must propose *copy*, not *move*; a drop's position is in the list's space, not the row's. Details and the decisions made on the way are in
   [Step 7 status](ipad-app-design.md#step-7-status). Not done: the sort order and date display of the desktop's list, notebook colours, opening a note in another window, dragging out to other apps, and Files drops (a manual-test item; the Simulator cannot drag between apps).
8. **Images.** Port `sniffImage`, `imageFileName` and `storeImage` (no size limit, as on the desktop); insert from the picker, paste with
   `UITextPasteDelegate`, add a photo, a camera shot or a file (HEIC to JPEG, [C18](ipad-app-design.md#compromise-register)); a Markdown image to `<Image />` with
   a width. Check: the pure parts against the desktop's functions; the files in a backup restore on the desktop and the reverse.
   **Done 2026-11-07 in the Simulator (not on your iPad):** an *Image* menu on the Markdown and Split tabs (the system's Photos picker, the camera, the Files browser, and *Turn Images into Image Tags* on ⌘⇧X), paste of pictures from the clipboard, and pictures dropped on the text. A picture is made into PNG, JPEG, GIF or WebP bytes (a HEIC photo becomes JPEG, C18), stored in `app_data/` under the
   desktop's naming (`StoredImages`, no size limit) and written in as `![name](app_data/…)` as a paragraph of its own and never inside the frontmatter. **Ports with an oracle:** `sniffImage`, `imageFileName`, `storeImage` (run for real), `imageAlt`, `imageMarkdown`, `imageTag`, `findImageRefs` and `imagesToMdx`, over `images-cases.json` (75 byte strings, 160 names, 24 stores, 1,504 cursors and selections for the
   conversion); Swift agrees with every answer, and breaking five details makes the check fail. A stored picture goes into a backup and out of it (a unit test). By hand: a PNG and a HEIC through the launch shortcut, two photos through the system's picker, and the conversion from the menu; a UI test checks the picture, its Markdown and the preview. Details and decisions in
   [Step 8 status](ipad-app-design.md#step-8-status). Not done: choosing an already stored picture, the Images page, the header image, attachments, a width control, and everything of the camera, Files, a real clipboard and a drop from another app, which the Simulator cannot do or I did not try.
9. **Typing aids.** The `<` list with props and values from the desktop's catalogues (`completions.ts`, `props.ts`), the `[[` note picker,
   Tab and Shift+Tab, `<Mark>` from the edit menu in both the editor and the preview, hardware shortcuts with the Cmd-hold list. Check:
   the catalogues as JSON through the desktop's code; the rest in the Simulator.
   **Done 2026-11-07 in the Simulator (not on your iPad), except `<Mark>` in the preview:** a list under the caret for `<` (the components, a tag's props and then their values), the frontmatter's properties and `/` snippets, from the desktop's catalogues; the `[[` note picker, a Link button and ⌘⇧K, and `note:` links opening their note from the preview; Tab, Shift+Tab, ⌃], ⌃[, ⌘B, ⌘I and ⌘⇧H as key commands with titles for the ⌘-hold list; and a *Highlight* submenu in the edit menu. **Ports with an oracle:** `completions.ts`, `props.ts`, `frontmatterProps.ts`, `snippets.ts`,
   `indentLines.ts`, `emphasis.ts` and the note-link code, over `editing-cases.json` (95 `<`-list texts, 33 frontmatter, 20 `/`, 948 indent, 1,004 emphasis, 16 `[[` triggers, 52 note matches and more) and the catalogues read through the desktop's own code; Swift agrees (208 tests now), and breaking details on purpose makes the checks fail. **UI tests:** nine more (19), which send the keys. Details, decisions and what is not done in
   [Step 9 status](ipad-app-design.md#step-9-status). **Not done, for your call:** `<Mark>` in the **preview** (SwiftUI `Text` reports no selection; it needs the design's single read-only text view, a larger job), and accessory-bar buttons for Tab and Shift+Tab on the on-screen keyboard. Not tried: a real keyboard on a real iPad, the ⌘-hold list itself, Esc (the UI tests cannot send it), VoiceOver.
10. **Appearance.** A `Theme` of tokens for the six schemes (from `globals.css`) plus **System**, fonts, the `<Mark>` colours per scheme
    (`markContrast`) and the chart colours from tokens. Check: snapshot tests of the ten components in every scheme, in light and dark.
    **Done 2026-11-07 in the Simulator (not on your iPad), without "Follow the sun" and the desktop's font families:** five schemes (Dark, Light, Forest, Wine, Cream) and **System** as a `Theme` of the desktop's tokens, a *More ▸ Appearance…* sheet, kept in `settings.json`, and the whole app drawn in them (sidebar, list, editor and its Markdown colours, preview, `<Mark>` tints per scheme, chart colours from the tokens), plus the system's sans, serif and monospaced faces for the editor and the preview. **Ports with an oracle:** the real `globals.css`, `themes.ts`, `Chart.tsx`
    and the font lists, as `appearance-expected.json`: every token of every scheme and the contrast of text on all 25 `<Mark>` tints agree (225 Swift tests now; breaking five details fails the check). **UI tests:** eight more (27), which read the screen's pixels for each scheme and keep a screenshot of the ten components in each as an attachment. Details and decisions in [Step 10 status](ipad-app-design.md#step-10-status). **Not done, for your call:** the ten bundled font families (font files and licence notices) and "Follow the sun" (M3†, a saved city). Not tried: a real iPad, sunlight, Increase Contrast.
11. **Accessibility and size classes.** Dynamic Type, VoiceOver labels, Reduce Motion, Split View, Slide Over and Stage Manager,
    a third-width window (landscape and portrait are already checked in every step, see the rule under Build order; this step repeats the turn through each of those sizes); the licence notices for GRDB and swift-markdown. Check: Accessibility Inspector, then you ([N3, N5, N6, N7](ipad-app-design.md#the-native-bar)).
    **Done 2026-11-07 in the Simulator (not on your iPad; VoiceOver was tried there by the author on 2026-11-08 and works):** every screen looked at to the largest text size and fixed; a compact toolbar and layout for a narrow window (made in the Simulator by dragging the window's corner); Reduce Motion and Increase Contrast; grey text at a contrast of 5.5 and a selected row that reads in every scheme (Forest's did not); labels, 44-point targets; About ▸ *Open-source licences* with GRDB, swift-markdown and swift-cmark as their authors wrote them. **UI tests:** eight more (35), which run Xcode's accessibility audit
    over the main screens and the largest text size, check our buttons' size, and open each licence. Details, decisions and what is not done in [Step 11 status](ipad-app-design.md#step-11-status). **Not done:** the real Split View, Slide Over and Stage Manager. (The author has since run it on a real iPad, and VoiceOver works there.)
12. **Install and Gate B.** A Release build on your iPad; the manual test page; every M1 row at least built. **Gate B:** the on-device
    answers from the editor lab (Scribble, the Pencil in a text view, arrow keys over hidden marks, VoiceOver, the iPad's speed) decide whether the editor stands
    as designed ([D4, D5](ipad-app-design.md#decisions)) and how the Live tab is to be built, now that it is in v1 ([G7](#decisions-to-make), reversed 2026-11-08). Then the exit criteria below.
    **Prepared 2026-11-07 (nothing installed on your iPad by me):** a **Release** build succeeds for the Simulator and for a device (`generic/platform=iOS`, signed with your Apple Development identity and the team's wildcard profile, no provisioning changes), and the Release build was run in the Simulator (imported 1,001 notes, listed them, opened a note). Every M1 row of the tracker is now at least built: the one that was not, *Insert a stored image* (the desktop's Shift+M list of images already stored; the cut line keeps it), was built the same day (*Image ▸ Stored Image…* and ⌘⇧M; a port of `listImages`, `matchImages` and the usage join with an oracle, two UI tests), and two rows that were marked ⬜ although built are corrected. [manual-tests/ipad.md](manual-tests/ipad.md) has a **first sitting** (an ordered hour, Gate B's items first). **Before the install:** the app icon is in (the desktop's notebook on a terracotta tile, `Assets.xcassets`); the bundle id is still the `.dev` placeholder.

**Your steps** are 0, the on-device checks in Step 5 and Step 12, and G3 when M3 nears. Everything else I can do and show you.

## M1 is done when

From the design: it installs and runs on your iPad; you can create, edit, search, delete and restore from the Trash Can; a backup made on the
desktop restores on the iPad and the reverse, **favorites included**; every M1 row is at least built; Gates A and B are passed; S6 is done; **every screen works in landscape and in portrait** (you: mostly landscape).

## After M1: the Live view

**Decided 2026-11-08 (you):** the Live tab is in v1 and is built right after M1 closes, before M2 (the Pencil and the PDF reader, which work in the same text view). The step-by-step plan is [ipad-live-view-plan.md](ipad-live-view-plan.md) (written 2026-11-08; its six decisions were taken as proposed); a short note on how follows.

- **The spec** is the desktop's Live tab (CodeMirror 6, PRs #223, #234 and #235): the note drawn as it will read, with the syntax shown only where the caret is, headings and rules drawn large, images inline.
- **The starting point** is in the lab: *Hide: tiny and clear* (a tiny, clear font on the marks outside the caret's line), which "works well" on the iPad (item 17), with `HighlightModel` for the marks and `LiveReveal` for what stays showing (the caret's line, or the whole of a code block, so both fences show).
- **To build:** a fourth tab beside Markdown, Preview and Split; headings, rules and images drawn as they will read; the rule for what stays showing, for the other multi-line things (lists, quotes, tables) as well as code; the arrow keys and selection handles across hidden marks; undo and the Pencil (Scribble) with marks hidden; VoiceOver, which reads marks that are only invisible (an accessibility label for the text, or hiding them from VoiceOver too, to be tried on the iPad).
- **Checked by:** unit tests of the reveal rules, UI tests that move the caret through a note, and new items on the manual test page.
- **If it does not come out well,** it ships reduced (the Markdown tab is the fallback, [C12](ipad-app-design.md#compromise-register)).
- **Built (2026-11-08 and 2026-11-09, Simulator): steps L0 to L8 of [the plan](ipad-live-view-plan.md).** The fourth tab, the model checked against the desktop's own `liveDecorations`, headings, bold, italic, strikethrough and code drawn as such, marks hidden away from the caret and shown by construct, rules, pictures, `<Mark>` tints, the frontmatter; **the arrow keys, selection, Backspace and forward delete, undo, paste, ⌘B, ⌘I, Tab and the list after `<` across hidden marks are checked at every press in UI tests** (no hidden character is ever beside the caret), and a composition (Scribble, dictation) leaves the look alone until it ends; VoiceOver is given the text with the hidden marks silenced and headings marked, the other value (without the marks) staying behind the lab's switch; Dynamic Type, Increase Contrast, the dimmed syntax's contrast in every scheme and Xcode's audit are done; **no length limit** (a keystroke is 5 ms at 100,000 characters and 13 ms at 404,609 in a Release Simulator build). **What differs from the desktop's Live tab:** fences hidden outside a block, highlights and pictures at any length, a picture in the middle of a sentence left as text.
- **Gate L passed (the author, 2026-11-09):** the author tried the Live tab on the iPad and it works well. [manual-test](manual-tests/ipad.md) items 91 to 105, 116 to 124 and 125 to 136 (how the keys and a finger feel across hidden marks, the Pencil and dictation, VoiceOver, speed on the iPad, and L4's pictures, tints, rule and frontmatter) were not recorded one by one, and VoiceOver was not singled out.

**M1 is done (the author, 2026-11-08).** The code is merged ([#247](https://github.com/meddlin/composition/pull/247)), every M1 row is built, Gate B was answered on the iPad (typing speed, Scribble and the Pencil in a text view, hidden marks, VoiceOver), and the author has run the manual test page's checks on a Release build and calls it done. What was **not** re-checked by anyone but the author, and so is not in any test: the real Split View, Slide Over and Stage Manager as a person would use them, and the export-and-restore round trip by hand. The next piece of work is [the Live view](ipad-live-view-plan.md).

## Risks

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Typing lags in a long note ([R13](ipad-app-design.md#risks-and-unknowns)) | High / high, measured | Step 5 before the editor is built on it; a frame budget; the lab to prove it. |
| A save is lost when the app is backgrounded or killed ([N5](ipad-app-design.md#the-native-bar)) | Medium / high | Step 4 early, with a scripted kill test, not left to the end. |
| A port drifts from the desktop ([R4](ipad-app-design.md#risks-and-unknowns)) | High / high | An oracle per port; `ios-core.yml` runs the check on every change to the desktop's data layer and plugins. |
| Frontmatter YAML differs between `js-yaml` and the iPad's parser | Medium / medium | [G6](#decisions-to-make); the corpus; the desktop's "not a mapping, so no frontmatter" rule. |
| Restoring an iPad backup changes the desktop's settings | Medium / medium | [G5](#decisions-to-make); Step 1 tests it through the real restore first. |
| The Pencil or Scribble misbehaves in the editor (a composition is cut, a stroke is lost) | Unknown / high | The colouring skips compositions by design; items 14 to 16 of the manual test; Gate B. |
| Hiding marks reads badly to VoiceOver, or the arrow keys and selection handles misbehave across them | Medium / medium: the Live tab is in v1 | [G7](#decisions-to-make), reversed: it is in v1, built right after M1. **Built: the keys are checked across hidden marks at every press in the Simulator and do not misbehave; VoiceOver is the open part** (the marks are silenced and headings marked in the value it is given; whether it honours that is items 100 to 103 and 131). The Live tab can ship reduced, with the Markdown tab as the fallback. |
| Parallel sessions collide on the shared fixtures file | High if ignored | One `conformance-<name>.test.ts` per port. |
| Your notes differ from the synthetic ones (long notes, odd frontmatter, many images) | Medium / medium | Your own backup in every step's check; the manual test asks for notes that look wrong. |
| The CI job runs on a preview Xcode image | Low / low | The fallback is written into [ios-core.yml](../.github/workflows/ios-core.yml). |
