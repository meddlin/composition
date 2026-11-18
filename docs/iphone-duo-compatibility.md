# iPhone Duo compatibility

Tested 2026-11-17 in the iOS 27.1 Simulator ("iPhone Duo", Xcode's foldable iPhone), plus a read-through of `apps/ios` for the
APIs and fixed sizes that break when a screen changes size while the app runs.

The Duo has two screens:

| Pose | Lit screen | Size class |
| --- | --- | --- |
| Closed | outer, 466 x 678 pt, portrait | compact width |
| Half open (110°) | inner, 951 x 669 pt | regular width |
| Open (180°) | inner, 951 x 669 pt | regular width |

Folding or unfolding resizes the running app's scene between those two sizes.

## Status (2026-11-18)

The app is now universal (iPhone and iPad), and the navigation problems below are fixed in the working tree. Nothing is committed yet.

| Item | Status |
| --- | --- |
| B1 iPad-only target | **Fixed.** `TARGETED_DEVICE_FAMILY = "1,2"`; iPhone orientations: portrait, landscape left and right |
| F1 note never loads | **Not an app bug** (see F1). Opening a note took about 25 s because the Mac was overloaded |
| F2 sidebar over the note on unfold | **Fixed** and checked: the open Duo shows the notes list and the note. Three columns only from 1,000 pt (`BrowserView.threeColumnWidth`), so iPads keep their old layout |
| F3 selected notebook can't be reopened | **Fixed** and checked on the Duo. The same fix covers the notes list |
| Home unreachable on a narrow screen | **Fixed** and checked: the Home button opens the Home page in the stack |
| F5 two back arrows | **Fixed** and checked: the history pair becomes one History menu (clock icon) on narrow screens |
| F6 busy overlay the size of a spinner | **Fixed** and checked: it dims the whole window and shows "Opening your notes…" in full |
| A1 `UIScreen.main.scale` | **Fixed.** The scale is read from the drawing context |
| A2 "iPad" in text | **Fixed** in all nine places |
| A4 PDF drawing needs a Pencil | **Fixed.** Defaults to the system's "Only Draw with Apple Pencil" setting (off on an iPhone) until the person sets it |
| A3 PDF reader at phone width | **Fixed, built, not seen on screen** (the Mac's load stopped the Simulator from installing). The selection bar's colours become one menu, the drawing banner shortens, and the reader strip falls back to "12/340" (all via `ViewThatFits`). The contents panel's minimum width is now 280 pt (360 preferred) |
| F4, A5 to A8 | Open |
| N1 (new) View switcher cut off | Open. On the open Duo with the lists showing, the segmented switcher reads "Markd…" |
| N2 (new) restored note on the outer screen | Open. A note left open when the app was ended is chosen again at launch, but the closed Duo shows the list, not the note. Tapping the note opens it |

How the narrow-screen navigation works now (`BrowserView`, `SidebarView`, `NotesColumnView`):
- The split view is bound to `preferredCompactColumn`.
- The sidebar and notes lists show nothing chosen while they are the column in sight. A tap on the row that is already chosen is then a change, which the stack follows.
- The Home button sends the stack to the Home page.
- Choosing a note anywhere makes it the column shown when the window narrows.

Checked only on the iPhone Duo Simulator (iOS 27.1). An iPad was not re-run. The changes for wide windows are the 1,000 pt column rule and the full-window busy overlay. The Release build for a generic iOS device succeeds.

## Verdict (2026-11-17, before the fixes)

**As shipped, the app does not run on the iPhone Duo at all.** The target is iPad-only (`TARGETED_DEVICE_FAMILY = 2`), so
Xcode refuses the Duo as a destination and the App Store would not offer the app on it.

With the iPhone family added (a trial build, `TARGETED_DEVICE_FAMILY=1,2` on the command line, no project change), most of the
app already works on both screens. Years of Slide Over and Split View support carry over. Three things break:

- A note gets stuck on its loading spinner after folding or unfolding (F1).
- Unfolding throws the sidebar over the note (F2).
- A few navigation details misbehave on the narrow outer screen (F3 to F5).

The code read-through adds a list of smaller items. Most of them are in the PDF reader, which was built for an iPad with a
Pencil.

## Blocker

### B1. The app is iPad-only

- **Where:** `apps/ios/Composition.xcodeproj/project.pbxproj`. `TARGETED_DEVICE_FAMILY = 2` appears in all four configurations (app and UI tests, Debug and Release). Only `INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad` is set.
- **Fix:**
  - Set `TARGETED_DEVICE_FAMILY = "1,2"`.
  - Add `INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone`. Portrait is enough to start; add landscape if the outer screen should rotate.
- **Decision (yours):** this makes Benchnote a universal app. It would then appear on every iPhone, not only the Duo. Everything below is then also iPhone work. It shares the iOS record and bundle id (`com.rushinglabs.benchnote.ios`), so no new App Store record is needed.

Already fine:
- Launch screen: `INFOPLIST_KEY_UILaunchScreen_Generation = YES`.
- iPad orientations: all four.
- No `UIRequiresFullScreen`.

## Bugs seen in the Simulator

The trial build was loaded with the 1,001-note test backup (`apps/ios/scripts/make-test-backup.sh`, then `-importBackup <file>`).

### F1. A note never loads after folding or unfolding (not an app bug)

**Update, 2026-11-18:** logging in `NoteDetailView` showed the expected sequence (open, appear, session arrives). The session just arrived 25 seconds late.

The Mac's load average was about 490 on 14 cores while this ran, with nine simulators booted by other sessions. Launches, imports and note opens were all slowed by the same cause.

When the Simulator is not overloaded, a note opens at once. Re-check on a quiet machine or a device before treating any remaining slowness as real.

The original report follows.


**Repro:**
1. Close the Duo.
2. Go to Notebooks, then a notebook, then tap a note.
3. Open the Duo.

**Result:**
- The note column shows its spinner and never loads.
- Choosing a different note in the list doesn't help either: it is selected, and the spinner stays.
- The app is not hung. The main thread is idle in its run loop and no worker thread is busy (checked with `sample`).

**Likely cause:**
- `NoteDetailView` loads the note in `.task(id: noteID) { await open() }` and releases it in `.onDisappear { close() }`.
- When `NavigationSplitView` switches between its collapsed stack (compact) and its columns (regular), the detail view is torn down and rebuilt.
- `open()` returns early on `guard !Task.isCancelled`, which leaves `session` nil. Alternatively, the old view's `close()` runs after the new view's `open()`.
- Either way, the view left on screen has no session and nothing reloads it.

**Note:** this probably also happens on the iPad whenever a window crosses between compact and regular width (Stage Manager, Split View). That is unverified.

### F2. Unfolding pushes the sidebar over the note (medium)

- **What happens:** on unfolding, the notebooks sidebar slides in over the note and the rest of the screen dims.
- **Cause:** `BrowserView` (around line 97) sets `columns = .all` whenever the width crosses 900 pt upward. The threshold was chosen to tell a portrait iPad from a landscape one.
  - The Duo's inner screen is 951 pt, which is just over the line.
  - Three columns don't fit in 951 pt: about 320 pt for the sidebar, 360 for the list, and only ~270 left for the note. The system shows the sidebar as an overlay instead.
- **Fix:** decide by whether three columns fit, not by 900 pt (e.g. ≥ about 1,100 pt). At Duo width, show the list and the note (`.doubleColumn`).

### F3. On the outer screen, tapping the selected notebook does nothing (medium, seen once)

- **Repro:** after going back from a notebook's list to Notebooks, tap the highlighted row again. Nothing opens until a different row is chosen.
- **Cause:** the sidebar's `List(selection:)` setter only acts when the selection changes.
- **Fix:** bind `preferredCompactColumn` (iOS 17), or push explicitly on tap.
- **Related (from the code read-through):** the Home page is the detail shown when no note is selected. In the collapsed stack it is probably unreachable. The Home button calls `model.open(nil)`, which only pops back.

### F4. The sidebar button did nothing with the lists hidden (low, seen once)

On the open screen, with a note in full-screen (lists hidden), the sidebar button at top left had no effect. The "show the lists" button on the right brought the lists back.

### F5. Two back arrows on the outer screen's notes list (low)

The system back button (to Notebooks) and the app's own history Back/Forward pair sit one above the other in the toolbar. Both are "<", which is confusing. On compact width, hide the history pair or move it into a menu.

### F6. Launch shows a blank screen, and the busy overlay is tiny (low, not Duo-specific)

- **Blank screen:**
  - Each Debug launch showed a blank white screen for one to three minutes before anything drew.
  - The main thread was idle while it did.
  - It may be the Simulator or the Debug build. Check on a device.
- **Busy overlay:**
  - While a backup was importing, the busy overlay was a small grey box whose message read only "…".
  - The dimming covered only that box.
  - **Cause:** in `RootView`, `.overlay { BusyOverlay }` and `.background` are attached to `content`. During `.starting`, `content` is just a `ProgressView`, so both are sized to it. Give `content` a full-screen frame (`.frame(maxWidth: .infinity, maxHeight: .infinity)`) before the background and overlay.

## Works well

- **Home page, open screen:** the card grid lays out in three columns.
- **Reading a note, both screens:** comfortable line lengths at 951 pt and at 466 pt.
- **Note toolbar on compact width:** the Markdown/Live/Preview/Split switcher becomes a View menu. Find, Link and Image become an Edit menu.
- **Split mode:** stacks the editor above the preview when narrow (`SplitLayout`, below 800 pt).
- **Outer screen:** the sidebar, notes list, search field and footer all fit.
- **Fold and unfold:** the selected notebook, note and view mode survive. Only the note's text fails to load (F1).
- **Half open (110°):** the inner screen stays lit with the same layout as fully open. The app has no hinge-aware layout, which is fine.

## From the code read-through (not exercised in the Simulator)

### A1. `UIScreen.main.scale`

- **Where:** `LiveDrawing.swift:135`, where it sizes the Live tab's picture thumbnails.
- **Fix:** use the view's `traitCollection.displayScale`. `UIScreen.main` is deprecated and doesn't follow the scene's screen.
- **Note:** `PdfInkLab.swift:481-482` reads the window's screen and `UIDevice` for a dev-lab report only.

### A2. "iPad" in user-visible text

These sentences read wrongly on an iPhone. Say "this device", or pick the word by idiom.
- `AppearanceView.swift:19, 45, 148`
- `PluginsView.swift:34`
- `RootView.swift:52`
- `BrowserView.swift:132`
- `ImagesPage.swift:209`
- `PdfReader.swift:482`
- `HeaderImage.swift:205`

### A3. PDF reader at phone width

- **Selection bar** (`PdfMarksUI.swift:47-64`): about 430 pt with nothing flexible. That probably just fits the Duo's 466 pt outer screen, but it overflows a regular iPhone (about 375-402 pt).
- **Ink banner** (`PdfMarksUI.swift:313-341`): the icon, two lines of text, a fixed-size toggle and Done. Probably too wide.
- **Contents/bookmarks popover** (`PdfReader.swift:408`): minimum 360 x 440.
- **Typed-note box:** forced to stay a popover with a 300 pt editor (`PdfReader.swift:536-537`, `PdfMarksUI.swift:154`).
- **Toolbar strip** (`PdfReader.swift:403-476`): even the compact version is about 400 pt.

### A4. Drawing on a PDF needs a Pencil by default

- **Code:** `fingerDraws` defaults to false (`PdfReader.swift:67`, `PdfInkLayer.swift:95`).
- **Effect:** on an iPhone nothing draws until "Finger draws" is switched on.
- **Copy:** the banner says "Drawing with the Pencil".
- **Fix:** default to finger drawing where no Pencil has been seen.

### A5. A drawing keeps the size of the screen it started on

- **Where:** `InkCanvas.swift:112-121` sets the canvas size once, at first layout.
- **Effect:** a drawing started on the outer screen stays outer-screen sized after unfolding.

### A6. Formatting needs a hardware keyboard

- **Problem:** Bold (⌘B), Italic (⌘I) and Indent/Outdent (Tab, ⇧Tab) have no on-screen control, and the iPhone keyboard has no Tab key.
- **Already have touch alternatives:** Link to Note, Stored Image and Highlight.
- **Why it matters:** this is minor on an iPad with a keyboard, but real on a phone.

### A7. Crowded toolbars on compact width

- **Reading List page** (`ReadingPage.swift:217-240`): three leading and up to three trailing items.
- **Notes list** (`NotesColumnView.swift:66-82`): Back, Forward, New Group, Import PDF and New Note, plus search.

### A8. Small things

- `ExportSheet` allows only the `.medium` detent, which is cramped on a 678 pt-tall screen.
- `verticalSizeClass` is never read. A closed Duo turned to landscape (compact height) was not tried.
- Every window shares one `AppModel`, and the save-on-background observers are app-wide (`UIApplication` notifications). Saving per scene is already handled through `scenePhase`. That is fine for one window. Revisit if iPhone or Duo multi-window matters.

## Not tested yet

- The keyboard on the outer screen.
- The Live tab.
- PDFs and drawing (A3 to A5 come from reading the code).
- The Reading List.
- The outer screen in landscape.
- Several windows.
- A real device.

## Suggested order of work

1. **B1.** Decide whether the app goes universal. Nothing else ships until it does.
2. **F1.** The note-never-loads bug. It also threatens the iPad's Stage Manager and Split View.
3. **F2 and F3.** Column choice on unfold, and compact navigation (`preferredCompactColumn`, reaching Home).
4. **A2 and A4.** Wording, and finger drawing by default.
5. **A3, A5 and A6.** PDF and drawing at phone width, and formatting controls for touch.
6. **F4 to F6, A1, A7 and A8.**
