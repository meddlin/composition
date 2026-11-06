# iPad build: plan for the first milestone (M1)

[ipad-app-design.md](ipad-app-design.md) is the design, the feature tracker and the compromises. This page is the **order of work
for M1, "usable notebook"**: what is built first, what each step ends in, which steps can run side by side, and what only you can
decide or do. It is the page that design's Gate A asks for, in the style of [windows-build-plan.md](windows-build-plan.md). M2 (the
Pencil) and M3 (the first release) get their own plans when M1 is in hand. Dates are 2026-11-06.

**In scope (M1):** the sync-ready store, notebooks, groups, notes, favorites and the Trash Can; the Markdown, Preview and Split tabs;
search; images; the MDX components other than `<Ink>` and `<YouTube>`'s player; the six colour schemes and a System scheme; backup and
restore both ways; installed on your iPad from Xcode.
**Out of scope:** `<Ink>` and the Pencil canvas (M2), the release polish and TestFlight (M3), sync, the plugins, **any AI helper
([D19](ipad-app-design.md#decisions))**, and the Live tab ([C12](ipad-app-design.md#compromise-register)), which stays after v1.

## Where M1 starts

Facts, checked 2026-11-06:

- **Of the 43 M1 rows in the tracker, 15 are built, 3 are spiked and 25 are not started** (after correcting five rows that had gone stale:
  search, its filters, the backup round trip and the stable `uuid`). What exists is the **read side**: the data layer, backup and restore,
  the Trash Can, search with typo tolerance, the Markdown and MDX layer, a Preview that draws all ten components, and a prototype app that
  runs on your iPad with your notes. What does not exist is the **write side**: creating and editing notes, groups, notebooks, favorites,
  images, themes, and anything that saves.
- **Every port so far was checked against the desktop's own TypeScript** (the Trash Can, search, the MDX scanner and the helpers behind the
  components): a script or corpus is run through the real code, and Swift must give the same answers. 103 Swift tests pass, and
  `apps/ios/scripts/conformance.sh` runs the desktop-to-Swift-and-back check in CI. The plan keeps that rule: **no port without an oracle**.
- **What is left to port is small.** `notesRepo.ts` 169 lines, `groupsRepo.ts` 203, `notebooksRepo.ts` 116, `favorites.ts` 47, `images.ts` 145,
  `frontmatter.ts` 183, `themes.ts` 30. (`trashRepo.ts`, 226 lines, is already ported.)
- **S3 (the editor spike) and S4 (Markdown) are done in the Simulator.** The editor stays on TextKit 2; find, a completion list and views
  in the text work; a full re-colour of a 5,030-line note costs 87 ms an edit even in a Release build, so the editor needs an incremental one
  ([S3 status](ipad-app-design.md#s3-status)). Not tried: Scribble, the Pencil, arrow keys across hidden marks, VoiceOver, the iPad's own speed.
- **Settings are a gap.** The colour scheme, the saved city and **favorites** live in the desktop's `settings.json`, which a backup carries
  (`backup.ts`). The Swift core reads that file and keeps it as bytes, but never writes one, so favorites cannot round-trip yet. **And a restore
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
| G6 | **How to read frontmatter's YAML.** | **A small parser for the known keys, checked against the desktop's `js-yaml` over a corpus; Yams only if the corpus shows it is not enough.** | Yams is a new dependency (the design wants a row for it first), and libyaml and `js-yaml` disagree on some edge cases, so a corpus is needed either way. The desktop falls back to "no frontmatter" when the block is not a YAML mapping; the parser must do the same. |
| G7 | **The Live tab stays after v1.** | **Yes. Reopen only if the on-device checks in [manual-tests/ipad.md](manual-tests/ipad.md) (items 14 to 19) go well.** | One way of hiding marks works in the Simulator, but arrow keys, selection and VoiceOver are untried. |

## Build order

Each step ends in something checkable. Steps 1 to 3 touch different Swift files and different fixtures, so they can run as **separate
sessions at the same time**; give each its own `ios-conformance-<name>.test.ts` in `apps/web/scripts`, because the one shared fixtures file would
conflict. Steps 4 and 5 are app-side and independent of 1 to 3. Step 6 needs 2 to 5. A cold `xcodebuild` took over ten minutes here, so
the core is developed with `swift test` and the app is built only to look at it.

0. **Gate A** (you). **Passed 2026-11-06**: D2, D3, D7 and D16 decided, D6 closed. Nothing below needs more; G3 can wait.
1. **Settings.** A `Settings` type in the core for the keys the iPad uses (favorites, colour scheme, saved city), read from and written to a
   `settings.json` in the data folder, keeping every key it does not use as it came ([G5](#decisions-to-make)); `Backup` carries it both ways.
   Check: a corpus through the desktop's `parseWebSettings`, and `conformance.sh`'s backup round trip with favorites changed on the iPad and the
   desktop's other settings left as they were, restored through the real `stageBackup` and `applyStagedBackup`.
2. **Store operations.** Ports of `notesRepo`, `groupsRepo` and `notebooksRepo`: the same SQL, errors (`GroupNotEmptyError`,
   `InvalidGroupMoveError`, `LastNotebookError`…), ordering (`placeNote`, `placeGroup`, `placeNotebook`), `updated_at`, and the `uuid` left to
   the trigger. Every write also keeps `search.db` in step (`upsert` and `remove`, then `markCurrent`). A script like the Trash Can's
   (`apps/ios/conformance/store-script.json`) is run through the desktop's real repos, every table dumped after each step; Swift runs the
   same script and compares. Check: the script passes, and a copy of your own database opens, takes a hundred operations and still restores on the desktop.
3. **Frontmatter.** `parse`, `generate`, `render` and `withHeaderImage` ([G6](#decisions-to-make)); the note's `title`, `description` and tags are
   kept in step with the columns as the desktop does. Check: a corpus of frontmatter variants (quoted and unquoted, lists, dates, a block
   that is not a mapping, CRLF) through the desktop's `parse` and `render`, and byte-identical output where the desktop rewrites it.
4. **Autosave and lifecycle (spike S6).** One write path: debounce, then flush on leaving the foreground, on a scene change and on
   termination; a second window shares the one database pool. Check, in the Simulator and scripted: type, `simctl terminate`, relaunch, and
   the text is there; the same with the app backgrounded mid-word. **S6 exit: no lost keystrokes.**
5. **Incremental colouring (R13).** Re-colour only the paragraphs around an edit, redo the whole note on an idle pause (so what a one-paragraph
   read gets wrong, like a fenced block or a loose list, is corrected a moment later), and read the Markdown off the main thread; the Live-style reveal
   re-colours only the two paragraphs involved. Skip while a composition is under way. Check: the lab's line for *5,000 lines with views* in a
   **Release** build, against a proposed budget of about one frame (16 ms) of our own work per edit ([N7](ipad-app-design.md#the-native-bar)), then the iPad's number from you.
6. **The editor.** The Markdown tab for real notes, replacing the lab: bound to the store (2), frontmatter (3), autosave (4) and the incremental
   colouring (5); the Preview and Split tabs; find; the Trash Can from the note. Check: create, edit, relaunch, search for what you typed, trash and restore,
   on a copy of your notes; the rows written match the desktop's for the same operations (Step 2's script, driven from the UI layer).
7. **Organization.** The sidebar of notebooks and groups, create, rename, delete, move and reorder, favorites (from Step 1), drag and drop within
   the app and from Files, back and forward, columns. Check: the first **UI tests** (XCUITest) on the main flows, and a pass in the Simulator.
8. **Images.** Port `sniffImage`, `imageFileName` and `storeImage` (no size limit, as on the desktop); insert from the picker, paste with
   `UITextPasteDelegate`, add a photo, a camera shot or a file (HEIC to JPEG, [C18](ipad-app-design.md#compromise-register)); a Markdown image to `<Image />` with
   a width. Check: the pure parts against the desktop's functions; the files in a backup restore on the desktop and the reverse.
9. **Typing aids.** The `<` list with props and values from the desktop's catalogues (`completions.ts`, `props.ts`), the `[[` note picker,
   Tab and Shift+Tab, `<Mark>` from the edit menu in both the editor and the preview, hardware shortcuts with the Cmd-hold list. Check:
   the catalogues as JSON through the desktop's code; the rest in the Simulator.
10. **Appearance.** A `Theme` of tokens for the six schemes (from `globals.css`) plus **System**, fonts, the `<Mark>` colours per scheme
    (`markContrast`) and the chart colours from tokens. Check: snapshot tests of the ten components in every scheme, in light and dark.
11. **Accessibility and size classes.** Dynamic Type, VoiceOver labels, Reduce Motion, rotation, Split View, Slide Over and Stage Manager,
    a third-width window; the licence notices for GRDB and swift-markdown. Check: Accessibility Inspector, then you ([N3, N5, N6, N7](ipad-app-design.md#the-native-bar)).
12. **Install and Gate B.** A Release build on your iPad; the manual test page; every M1 row at least built. **Gate B:** the on-device
    answers from the editor lab (Scribble, the Pencil in a text view, arrow keys over hidden marks, VoiceOver, the iPad's speed) decide whether the editor stands
    as designed ([D4, D5](ipad-app-design.md#decisions)) and whether the Live tab stays out of v1 ([G7](#decisions-to-make)). Then the exit criteria below.

**Your steps** are 0, the on-device checks in Step 5 and Step 12, and G3 when M3 nears. Everything else I can do and show you.

## M1 is done when

From the design: it installs and runs on your iPad; you can create, edit, search, delete and restore from the Trash Can; a backup made on the
desktop restores on the iPad and the reverse, **favorites included**; every M1 row is at least built; Gates A and B are passed; S6 is done.

## Risks

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Typing lags in a long note ([R13](ipad-app-design.md#risks-and-unknowns)) | High / high, measured | Step 5 before the editor is built on it; a frame budget; the lab to prove it. |
| A save is lost when the app is backgrounded or killed ([N5](ipad-app-design.md#the-native-bar)) | Medium / high | Step 4 early, with a scripted kill test, not left to the end. |
| A port drifts from the desktop ([R4](ipad-app-design.md#risks-and-unknowns)) | High / high | An oracle per port; `ios-core.yml` runs the check on every change to the desktop's data layer and plugins. |
| Frontmatter YAML differs between `js-yaml` and the iPad's parser | Medium / medium | [G6](#decisions-to-make); the corpus; the desktop's "not a mapping, so no frontmatter" rule. |
| Restoring an iPad backup changes the desktop's settings | Medium / medium | [G5](#decisions-to-make); Step 1 tests it through the real restore first. |
| The Pencil or Scribble misbehaves in the editor (a composition is cut, a stroke is lost) | Unknown / high | The colouring skips compositions by design; items 14 to 16 of the manual test; Gate B. |
| Hiding marks reads badly to VoiceOver, so the Live tab is dropped | Medium / low for M1 | [G7](#decisions-to-make): the Live tab is not in M1. |
| Parallel sessions collide on the shared fixtures file | High if ignored | One `ios-conformance-<name>.test.ts` per port. |
| Your notes differ from the synthetic ones (long notes, odd frontmatter, many images) | Medium / medium | Your own backup in every step's check; the manual test asks for notes that look wrong. |
| The CI job runs on a preview Xcode image | Low / low | The fallback is written into [ios-core.yml](../.github/workflows/ios-core.yml). |
