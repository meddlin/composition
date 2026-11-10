# Manual test: the iPad app (prototype)

A viewer on the Swift core, to try your own notes on the iPad before the real app exists. It can import a
desktop backup, list and search the notes (typos included), draw a note's Markdown and the ten components (or show its source),
use the Trash Can, and export a backup the desktop can restore. Since build plan Steps 4 to 6 it also **edits**: a *Markdown* tab with colours and find, a *Split* tab, a + button, and autosave. Since Steps 7 to 9 it also has notebooks and groups, pictures, and
typing aids (the lists after `<` and `[[`, indenting, bold, italic and highlighting). It cannot show attachments, or draw ink: see
[What it leaves out](#what-it-leaves-out). Design and status: [ipad-app-design.md](../ipad-app-design.md).

**You have run it on your iPad with a backup of your real notes** (reported 2026-11-06). **The preview is newer than that run and has
been tried in the iPad Simulator only**, so items 7 and 13 below are the first time on the device.

## Install it on your iPad

You need Xcode 27 (it was built with 27.2) on a Mac, and an iPad on iPadOS 17 or later. A free Apple ID is enough to
install it for yourself (the build then expires after 7 days).

1. Open `apps/ios/Composition.xcodeproj` in Xcode.
2. Select the **Composition** target, then **Signing & Capabilities**. Tick *Automatically manage signing* and choose your **Team**.
3. The bundle id is `com.rushinglabs.composition.ipad.dev`. It is a **placeholder for this prototype, not the id the real
   app will keep**. If Xcode says it cannot register it, change it to any id of yours.
4. Connect the iPad (cable or Wi-Fi) and choose it as the run destination at the top of the window. Press Run (⌘R).
5. First time only, on the iPad: **Settings, Privacy & Security, Developer Mode, on** (it restarts), then **Settings,
   General, VPN & Device Management**, and trust your developer certificate.
6. **For a fair speed reading, run the Release build:** Product, Scheme, Edit Scheme, Run, Build Configuration, **Release**.
   A Debug build is what Xcode runs by default, and search is 10 to 20 times slower in it. *About this build* in the app says which you have.

If it will not build or install, the useful things to send are the Xcode error and the iPadOS version.

## Get notes in

- **Your notes (the real test):** in the desktop app, Settings, **Backup**. Get the `.tar.gz` to the iPad (AirDrop, iCloud
  Drive, or the Files app over a cable). In the app, choose **Choose a backup…** and pick it.
- **Generated notes (nothing of yours):** `apps/ios/scripts/make-test-backup.sh` writes a backup of 1,000 made-up notes
  (technology titles and lorem ipsum, so they will not feel like yours).

Importing **replaces** everything in the app with the backup: nothing is merged and nothing is kept.

## A first sitting (build plan Step 12, Gate B)

The page below is long. For the first time on the iPad with the Release build, this is the order I would take, most important first, about an hour. **Use a copy of your notes** (they get edited). Stop at the first thing that goes wrong and tell me; the rest can wait.

1. **It runs and your notes are in** (items 1, 11): install the Release build, restore your backup, quit and reopen.
2. **The editor, which Gate B turns on** (items 14, 15, 16, 17, 19; **first turn Scribble on**: Settings, Apple Pencil, Scribble, or the Pencil only scrolls the page): Scribble, typing in a long note and the *Typing speed test* line (please send me that line), the Pencil in a canvas, the arrow keys over hidden marks, turning the iPad. These are the answers that settle [D4 and D5](../ipad-app-design.md#decisions) and whether the Live tab stays out of v1 ([G7](../ipad-build-plan.md#decisions-to-make)).
3. **Nothing typed is lost** (items 20, 21, 26): type and leave, type and swipe the app away, come back to where you were.
4. **The round trip with the desktop** (items 9, 25, 39, 52): export a backup, restore it in the desktop app, and back.
5. **Writing for real** (items 27, 33, 53, 57, 82): a new note, Scribble in the editor, the `<` list, the `[[` picker, a stored picture put back.
6. **The way you hold it** (items 34, 36): landscape, and turning it with the keyboard up.
7. **Looks and access** (items 65, 73, 74, 75, 78): the schemes in your light, VoiceOver, the largest text, a narrow window.

Gate B needs from you: the speed line, whether Scribble and the Pencil behaved, and how the hidden marks behaved under the arrow keys and the selection handles (item 17): the Live tab is in v1, so this decides how it is built.

## What to try

Search is the main thing to judge ([risk R7](../ipad-app-design.md#risks-and-unknowns)): is it as good as the desktop's on *your* notes?

1. **Import.** The alert counts what it restored. The list is newest first. Does the count match the desktop's?
2. **Search a word you know is in a title, then a word only in a note's text.** Title hits should come first.
3. **Search with a mistake:** a letter missing, an extra one, two swapped, a wrong letter, including the first letter
   (`dedis` for Redis). Words of 5 to 8 letters allow one mistake and 9 or more allow two. This app is *more forgiving than
   the desktop*: a wrong first letter counts as one mistake, not two, and when a search finds nothing, words of 3 and 4 letters
   are allowed one mistake too (`teh`, `rsut`). Try the same queries in the desktop app. Where this one finds something the
   desktop does not, is it what you meant? Where it finds too much, say which query. *About this build* says search is forgiving.
4. **Search the start of a word** (`kube` for Kubernetes), and two words (`redis cheat`).
5. **Filters:** `tag: yourtag`, `created: >2026-01-01`, `updated: <2026-01-01`, `title: something`. Text must come before a
   filter (`roadmap tag: infra`), as on the desktop.
6. **Speed.** The line under the list gives how long each search took. Note the typical figure and the first search after launch.
7. **Open a note.** It opens as a **Preview** (Markdown and components; **Markdown** is the switch beside it, with the frontmatter, as
   stored, and **Split** shows both). Open one of your own notes that uses components (`<Info>`, `<Chart>`, footnotes) and compare it with the desktop: see 13.
8. **Trash Can:** swipe a note, or use the trash button on an open one. Open the Trash Can (top left): swipe a row right
   to restore, left to delete for good. A trashed note must stop appearing in search, and appear again once restored.
9. **Export a backup** (the ⋯ menu, then **Save or share…**) and restore it in the desktop app (Settings, Restore).
   Everything, including the Trash Can, should be there.
10. **Replace with a backup,** and choose a file that is not a backup (any other file). It must say so and change nothing.
11. **Quit and reopen.** The notes are still there, and *About this build* says the search index was **not** rebuilt at launch.
12. **Turn the iPad, then use Split View and Slide Over.** Does the list and note still make sense? (Items 34 to 36 go through the turning in detail; this one is for the window sizes.)
13. **The preview, against the desktop's.** The generated backup (`make-test-backup.sh`) ends with a note, **Preview showcase**, that
   uses every component; open it, and open the same note in the desktop app (restore that backup there). Tap an entry in the
   contents box (it scrolls). Known differences, so you need not report them: no video player (a link card), no code colouring, charts are
   plainer, no ↩ back-links on footnotes, highlight colours are not tinted per colour scheme, and a picture at a web address is a link
   (list in [S4 status](../ipad-app-design.md#s4-status)). Please report anything else: a note that comes out differently, a component
   that does not draw, a note shown as plain Markdown with a notice that the desktop draws fine.

## The editor lab (spike S3)

**More menu, Editor lab (spike S3).** It is a lab, not the editor: nothing in it is saved, and *Text* offers a sample, the note selected in the list (to type in
without changing it), and a 5,000-line note with and without views in it. The line under the text says whether it is still on TextKit 2 and what the colouring
costs. It has been run in the Simulator only (what it showed is in [S3 status](../ipad-app-design.md#s3-status)); these are the things only the iPad can show.
Use a **Release** build (install step 6) for the numbers.

14. **Scribble.** (It must be on in the iPad's Settings, Apple Pencil, Scribble; with it off, the Pencil only scrolls the page, as a finger does. If unsure, try it in Safari's address bar first.) With the Pencil, write a few words into the text on the *Sample* note, between lines and at the end. They should turn into text, and the colours
   should carry on (a stray half-word of colouring while you write is fine; text lost or doubled is not). Try it inside a bold word too.
15. **Typing in a long note.** Choose *5,000 lines*, tap into the middle, and type for a few seconds on the on-screen keyboard and on a hardware one. Does it keep up?
   Since build plan Step 5 only the paragraphs around what you type are coloured at once (the rest is checked a third of a second after you stop), so it should keep up easily: in the Simulator it
   cost 0.6 ms a keystroke where the whole-note way cost 91 ms. Read *colour per edit* (last and worst) in the line under the text. Then *5,000 lines with views*, and scroll all the way down and up.
   **Then tap *Typing speed test* (the speedometer button, in a Release build):** it types 400 characters into the middle of *5,000 lines with views* and shows a line with the median, 95th percentile and
   worst of our own work per keystroke. Please send me that line: it is the iPad's number for the 16 ms budget.
   Also try typing a line of three backticks (a code fence) in the middle of the note: the colours below it should change to code within about half a second, in a blink and not a freeze.
16. **Views in the text.** In *5,000 lines with views* (or with the **+** button, *Insert a view*, then *Ink canvas*: a grey box that says "draw here with the Pencil"), draw in the grey canvas with the **Pencil**. The text must not scroll under the stroke, and
   the stroke must be there after you scroll away and back.
17. **Hide syntax.** (Answered 2026-11-08: it works well; moving into a code block now shows both fences, not only the caret's line's.) Choose *Hide: tiny and clear* on the *Sample* note. Tap into a paragraph (its marks should come back), and into the code block (both its fences should show), then use the arrow keys to cross from one
   paragraph to the next, and drag the selection handles over a hidden mark. Note anything odd: the caret stuck for a press or two, a selection that includes marks you
   cannot see, a jump when a paragraph reflows. If you use VoiceOver, move over a bold word and note whether it says "asterisk".
18. **Find, and the `<` list.** *Find* should open the system find bar and mark every match. Type `<` at the start of a line: the list should sit by the caret, also with the
   keyboard up and the caret near the bottom of the screen.
19. **Rotate and Split View** with the lab open, with a canvas in the text. Does it lay out again without a jump or a blank?

What to tell me for each: what you did, what you expected, what happened, and Debug or Release.

## Saving what you type (build plan Step 4, spike S6)

The *Markdown* tab beside *Preview* and *Split* is the editor (build plan Step 6). What you type is written to a small file at once, and into the notes after a pause of about a second (at the latest five seconds
into non-stop typing), and every time the app is about to leave the front. In the Simulator, ending the app in the middle of typing lost nothing; these
check it on the iPad. **Use a copy of your notes: this does edit them.**

20. **Type, then leave.** In *Markdown*, type a sentence and at once swipe up to the Home screen. Open the app again: the sentence is there, and so in *Preview*.
21. **Type, then end the app at once.** Type a sentence and immediately swipe the app away in the app switcher (or hold the side button and restart the iPad, if you dare). Open the app:
    an alert says the app was closed while you were typing, and the sentence is back. Tell me if any of it is missing, and how fast you were.
22. **Type without stopping** for half a minute. Watch the list on the left: the note should move to the top, and its date change, *while* you are still typing (within about five seconds).
23. **Edit, then look.** After a pause, *Preview* shows what you typed, and a search for a word you typed finds the note.
24. **The frontmatter at the top of the note.** Change the `title:` line: after a pause the list shows the new title. Make it wrong (`title: [oops`): the title in the list stays as it was, and the text stays exactly as you typed it.
25. **Back up right after typing.** Type a sentence, open the ⋯ menu at once and export a backup, and restore it in the desktop app: the sentence is in the note.
26. **Come back to where you were.** Open a note, choose *Markdown*, put the caret mid-note, press Home, then swipe the app away. Open it again from the Home screen: it should be on the same note, in *Markdown*, with the caret about where it was.

What to tell me for each: what you did, what you expected, what happened, and Debug or Release.

## The editor (build plan Step 6)

The note screen has **Markdown** (the editor), **Preview** and **Split**. **Use a copy of your notes: this edits them.**

27. **Make a note.** Tap the + button (top of the list). A note called *Untitled* opens in *Markdown* with the keyboard up and the caret after the frontmatter. Type a heading (`# Hello`), a line with **bold**,
    a link and a list. The colours should follow as you type, and the frontmatter at the top is dimmed. Change the `title:` line: a moment later the list shows the new title.
28. **Colours while typing fast,** on a hardware keyboard and on the on-screen one, in a long note of yours. Nothing should lag, and no text should flicker to a wrong colour for more than a moment. Type three backticks on a line of their
    own in the middle of a note: the text below should turn into code within about half a second, without a freeze.
29. **Preview and Split.** Type in *Split*: the preview follows about a quarter of a second after you stop. Turn the iPad: the halves should stack when the note's pane is narrower than 800 points and sit side by side when it is wider, without losing the keyboard or your place.
30. **Find** (the magnifying glass, or ⌘F with a hardware keyboard). It marks every match in the colours' place, and the next and previous buttons move between them.
31. **Search for what you typed.** Type an unusual word into a note, wait a second, then search for it in the list: the note is found, with no relaunch. Then trash the note from its own screen (the trash button, top right) and
    restore it from the Trash Can: it is back, and still found.
32. **Undo and redo** (⌘Z, ⇧⌘Z, or the shake and the three-finger swipe) after typing and after a paste. The colours should be right afterwards.
33. **Scribble and dictation in the editor.** With the Pencil, write a few words between lines (item 14 did this in the lab). The colours should carry on once you stop writing; text lost or doubled is a bug.
34. **Landscape, the way you hold it.** Go through everything with the iPad on its side: the list, each of the three tabs, the + button, Find, the Trash Can, the ⋯ menu and *About this build*. With the list open, *Split* puts the editor
    and the preview side by side. **Hide the list** (the button at the top left): the *Preview* and the *Markdown* text should now keep to a comfortable width in the middle of the screen, not run from edge to edge, and *Split* gives each half
    half the screen. In the empty sides of the *Markdown* tab, drag to scroll and tap to put the caret in the line: both should work as they do over the text. Anything cut off, overlapping, or too small to tap is a bug.
35. **Portrait.** The same walk with the iPad upright. *Split* sits the halves one above the other when the note's pane is narrower than 800 points (the list open, on most iPads) and side by side when it is wider (the list hidden, on an 11-inch or
    larger). The tab picker, Find and the trash button should all stay in the bar. (On an iPad mini the list's title shows as "N…": known.)
36. **Turn the iPad while you use it.** In *Split*, with the keyboard up and the caret in the middle of a long note, type a few words, then turn the iPad to the other side, and again to each of the four ways up (landscape both ways, portrait both ways).
    The text you typed, the caret, the keyboard and the preview should all still be there, with no jump to the top and nothing lost; wait two seconds and check the note in the list's search. Also turn it with a sheet open (the Trash Can, *About this build*) and with
    the + button's new note open. Rotation lock (Control Centre) should hold the layout as it is.

What to tell me for each: what you did, what you expected, what happened, and Debug or Release. For item 28, the *Typing speed test* in the editor lab (item 15) still gives the number for the 16 ms budget; the editor adds about a millisecond to it.

## Notebooks, groups and favorites (build plan Step 7)

The first column lists **All Notes**, **Favorites** and each **notebook**; the small arrow beside a notebook or a group opens the groups beneath it. The second column lists what is selected: a notebook's
or group's sub-groups (tap one to go into it) and then its notes. For something to organize, make the backup with `apps/ios/scripts/make-organization-backup.sh` (the 1,000 test notes, a second notebook
*Work* and six groups) and restore it, or use a copy of your own notes. **This changes the notes' groups and the favorites.**

37. **The tree.** Open each notebook and group in the first column. The number beside a row is how many notes it holds, with everything beneath it. Tap a group in the second column: the first column
    opens the way to it and selects it. In the notes list, a new note made with the compose button lands in the group you are in.
38. **Make, rename, delete.** The folder button makes a group in the notebook or group you are on; the **+** at the top of the first column makes a notebook. Press and hold a group or notebook for its
    menu: *Rename…*, *Move to…* (a list of everywhere it may go), *Move Up* and *Move Down*, *Delete*. A group or notebook that still holds something refuses to be deleted and says why; an empty one goes to the
    Trash Can (groups) or is gone (notebooks, as on the desktop). The last notebook cannot be deleted.
39. **Favorites.** Swipe a note or a group to the right, or use *Add to Favorites* in its menu. A star shows on it, the **Favorites** row counts it, and the list shows pinned groups and notes in the order they
    were pinned. Make a backup and restore it in the desktop app: they are favorites there too (and the reverse).
40. **Move things by dragging.** Hold a note in the list and drag it onto a group in the first column: it moves there. Onto its own notebook's row: out of its group. Drag a group (from the second column) onto
    a notebook row: it moves to that notebook with its notes and sub-groups. The place you are aiming at is tinted (onto it) or has a line above or below it (beside it). Dropping a group onto itself or
    beneath itself must do nothing. (The drag may show a **+** badge: that is the system's way of showing it will be accepted.)
41. **Put things in order.** In a group's list, hold a note and drag it up or down: it stays where you put it, also after quitting and reopening. The same for the groups in a list. All Notes and Favorites
    cannot be reordered (All Notes is by the last edit).
42. **Back and forward.** The two arrows at the top of the second column, or ⌘[ and ⌘] on a hardware keyboard, retrace what you looked at: notebooks, groups and notes. A note, group or notebook that has since been
    deleted is passed over.
43. **Text dropped in.** With the Files app beside this one (Split View or Slide Over), drag a Markdown or text file onto a group in the first column or onto the list: a note appears, named after the file, with
    the file's text. A file that has frontmatter of its own keeps it. Dragging a selection of text from Safari or Notes does the same, named after its first line. **This has not been tried in the Simulator, which cannot drag
    between apps:** please tell me what happens.
44. **Where it was.** Quit the app from the app switcher after opening a group and a note, then reopen: the same group and note, with the groups above it open.

What to tell me for each: what you did, what you expected, what happened.

## Pictures in a note (build plan Step 8)

On the *Markdown* or *Split* tab, the **Image** button (a picture with a plus, beside Find) opens a menu: *Photo Library…*, *Take Photo…*, *Choose File…* and *Turn Images into Image Tags*. **Use a copy of your notes: this edits them, and every picture is copied into the app.**

45. **A photo from the library.** Put the caret in a note, then Image, *Photo Library…*, and choose one or several (the picker holds up to ten). Each appears in the text as `![photo](app_data/…)` on a line of its own, after the frontmatter if the caret was in it, and the *Preview* shows it. Try a photo
    taken with the camera app (HEIC): it must show correctly, the right way up, and the file the note points to ends in `.jpg`.
46. **The camera.** *Take Photo…* opens the camera (it asks once for permission). The picture appears as in item 45, named `photo`. **Not tried in the Simulator.**
47. **A file.** *Choose File…* picks one or more picture files from Files (also from iCloud Drive or a server). A PNG, a JPEG, a GIF and a WebP must come through unchanged; a file that is not a picture must say so and change nothing.
48. **Paste.** Copy a picture (long-press one in Photos or Safari and choose Copy, or copy a screenshot), put the caret in a note and paste (⌘V or the edit menu): it comes in as in item 45, named `image`. Copy some cells from a spreadsheet and paste: that must still paste text.
49. **Drop.** With Photos or Files beside this app (Split View or Slide Over), drag a picture onto the text: it goes in where you let go. **Not tried in the Simulator, which cannot drag between apps.**
50. **Turn images into tags.** Put the caret on a `![…](app_data/…)` line (or select a few), then Image, *Turn Images into Image Tags* (⌘⇧X on a hardware keyboard): the line becomes `<Image src="…" alt="…" />` with the caret just before ` />`. Type ` width="50%"` and the *Preview* shows it at half the width. Undo takes it back in one step.
51. **The same picture twice.** Add the same photo to the same note twice: the note then points at one file, not two. Add it to a different note: a second file, named for that note.
52. **Back and forth with the desktop.** Make a backup (⋯, *Export a backup…*) and restore it in the desktop app: the pictures show in the notes there. Add a picture in the desktop app, make a backup there, restore it here: it shows here.

## Typing aids (build plan Step 9)

A hardware keyboard (the Smart Keyboard Folio or a Magic Keyboard) is needed for the keys, not for the lists: on the on-screen keyboard you tap a line. Do these on the *Markdown* or *Split* tab, in a note you do not mind changing.

53. **The list after `<`.** On a new line type `<`: the ten components appear under the caret, each with a line on what it is (above the caret when the on-screen keyboard leaves no room). Type `I`: only Info and Image are left. Tap one, or press ↓ then Return (or Tab): the tag goes in with the caret inside it, ready to type (inside `<Info>…</Info>`, inside the quotes of `<Image src="">`). **Esc** closes the list and writes nothing (the UI tests cannot press it, so try it).
54. **Props and values.** Type `<Chart ` (with the space): the props of a chart are listed (`type`, `x`, `y`, `title`, `height`). Choose `type`: it is written as `type=""` with the caret in the quotes, and the values (bar, line, area, pie) are listed; choose one: the closing quote is passed. Try `<Mark `, `<Image ` and `<YouTube ` too; compare with the desktop if you can.
55. **Frontmatter.** At the top of a note, put the caret on an empty line inside the `---` lines: the properties the note does not have yet are listed (title, description, tags …). Choose one. (On an empty line Return takes the first one, as on the desktop; Esc leaves it.)
56. **Snippets.** On a new line type `/`: table, codeblock, tasks and divider are listed; `/ta` narrows it. Choose `table`: a table goes in with the caret in its first cell.
57. **Linking to a note.** Type `[[` and a few letters of another note's title: the notes that contain them are listed (the ones that start with them first, eight at most, never this note). Choose one: `[Title](note:12)` replaces what you typed. Then select a few words, tap the **Link** button (a chain, beside Find) or press ⌘⇧K: the notes named like those words are listed, and the link keeps your words as its text. With only a caret, the button types the `[[` for you.
58. **Opening a link.** On the *Preview* tab, tap the link from item 57: that note opens, and the list beside it shows where it is. Put a note in the Trash Can and tap a link to it: a message says it is not there.
59. **Indenting.** With a hardware keyboard, type a few lines of a list, select all of them and press Tab: every line moves in by a tab; Shift+Tab takes one step off. ⌃] and ⌃[ do the same wherever the caret is. With only a caret, Tab types a tab.
60. **Bold and italic.** Select a word and press ⌘B: `**word**`; again: back to `word`. ⌘I does `*word*`; on a bold word it makes `***word***`, and again takes the italic off.
61. **Highlighting.** Select words on one line (long-press, or double-tap one) and look in the edit menu: *Highlight* opens yellow, green, blue, pink and orange; choose one: `<Mark color="…">words</Mark>`, the words still selected. Put the caret inside the highlight: the menu now has *Remove Highlight* too. With a hardware keyboard ⌘⇧H opens the same colours as a list (1 to 5, or ↓ and Return; 0 takes it off). Try it on a line with `*` in it, on code, inside a tag and over two lines: each refuses with a message that says why.
62. **The ⌘-hold list.** Hold ⌘ with the editor active: the list shows Indent, Outdent, Bold, Italic, Link to a Note and Highlight (and Find, and the Image menu's *Turn Images into Image Tags*). **Not tried in the Simulator, which cannot hold ⌘.**
63. **Both ways round.** Do items 53 to 57 in portrait and in landscape, and with the keyboard hidden and shown: the list must stay fully on screen and readable. Make the text larger (Settings, Display, Text Size): the lines grow with it.
64. **Typing speed.** In a note of a few thousand lines, type quickly after a `<` and in the middle of the note: the list must keep up and the letters must not lag.

**Not built, so do not expect it:** highlighting in the *Preview* tab (do it in the editor; the preview follows), and buttons for Tab and Shift+Tab on the on-screen keyboard.

## Colour schemes and fonts (build plan Step 10)

65. **The schemes.** Tap **Appearance** at the foot of the first column (the one headed Notebooks; open it with the button at the top left if it is hidden; it is in the More menu too, and it names the scheme in force): **System, Dark, Light, Forest, Wine and Cream**, each with a swatch. Choose each in turn: the whole app (the sidebar, the list, the note, the sheet itself, the status bar and the keyboard) changes at once, and the choice is ticked.
66. **System.** Choose System, then switch the iPad between Light and Dark (Control Centre): the app follows. System is the choice on a fresh install.
67. **Your own notes in each scheme.** Open a long note with a few components (an Info, a chart, a `<Mark>` of each colour) on the Preview and Split tabs in every scheme: everything reads easily, the five highlight colours too. Put the desktop beside it in the same scheme: the desktop's is the reference; say what looks different.
68. **The editor.** On the Markdown tab, headings, bold, italics, code, links, `<Info>` tags, list markers and the frontmatter are each coloured, and legible, in every scheme; they are the desktop's editor colours.
69. **The selected row.** The selected note in the list has light text on the scheme's accent colour in all five (Cream's is terracotta, Forest's green).
70. **Fonts.** In *Appearance…* set the Editor to Serif, Sans serif and Monospaced, and the Preview likewise: the text changes at once. Code in the editor stays monospaced; typing and the caret are not disturbed.
71. **Kept.** Close the app (swipe it away) and open it again: the same scheme and fonts. Make a backup and restore it in the desktop app: it wears the same scheme (not for System, which the desktop does not have: it keeps its own).
72. **From the desktop.** Choose a scheme on the desktop, make a backup, restore it on the iPad: the iPad wears that scheme. If the desktop's was "Follow the sun", so is the iPad's, with the same pair of colours and city (items 172 to 177).
73. **Your eyes.** In daylight and at night, at your usual brightness: say which schemes are too faint or too bright on this screen, and where.

**Not built, so do not expect it:** the desktop's own font families (Geist, Lora …): the iPad has the system's three. ("Follow the sun" is built: see items 172 to 177.) The footer under the list, and the system's own pickers, are not in the scheme.

## Follow the sun, the ruler and reflow (M3†)

Built 2026-11-09 and tried only in the Simulator (the pixels of the page at the ends and the middle of the fade; the sheet; reflow by typing into a note; the ruler). What follows is
what only your iPad and a real sunset can answer. These continue from 171; others have been added in the same stretch, so expect to renumber on merge.
How it works is in [architecture/appearance.md](../architecture/appearance.md).

172. **Choosing it.** Appearance ▸ **Follow the sun**: the row has a swatch (the pair's day, dusk and night), the page changes, and below the schemes two sections appear: *Light and dark colours* (five strips, each running from full day to full night with a tick on the one chosen) and *Your city*. Choose each pair in turn: the page and the sheet take its colours at once. Choose another scheme, then Follow the sun again: the pair you chose is still chosen.
173. **The city.** Type `Austin, TX` and Save city (the iPad needs a network): it says *Using Austin, Texas, United States: sunrise …, sunset …* and the times are today's there. Try `Paris`, a name that matches nothing (it says *Couldn't find a city matching …*), and then Save city with the network off (it says it couldn't reach the lookup, and keeps the city you had). Empty the field and save: it says the city is forgotten and that 6:30 AM and 6:30 PM are used.
174. **The fade, at dusk.** With Follow the sun chosen and a city saved, watch the page for the hour around the real sunset: it starts to darken 45 minutes before, is half way at the sunset, and has finished 45 minutes after. The text should change between its dark and light colour once, about half way (the pair's own point). **Tell me whether the stretch where the text is hard to read (about 14 minutes around the middle, 3 to 4.5:1) bothers you at your usual brightness;** it is the desktop's own design, carried over.
175. **Opening it in the dark.** At night, swipe the app away and open it with the network off (Airplane Mode): it opens already dark (the last launch's times are kept), with no flash of light. Then open it where nothing was ever saved (a fresh install, with a backup restored): it opens in the 6:30 and 6:30 stand-ins and fetches the real times a moment after a city is saved.
176. **Both ways with the desktop.** On the desktop choose Follow the sun, a pair other than the first, and a city; make a backup; restore it on the iPad: the iPad follows the sun with that pair and city (Appearance shows them). Then change the pair on the iPad, make a backup, restore it on the desktop: the desktop shows the new pair.
177. **Away.** Fly or travel, or just change the city to one on the other side of the world and save: the page jumps to what that city's sun is doing now and fades as it does. The iPad's own time zone is not used for the sun, only for the stand-ins.

178. **The ruler.** Appearance ▸ Writing ▸ **Ruler**: a faint line appears at column 80 in the Markdown tab and the Live tab, and the stepper moves it (20 to 200). It scrolls with the text, is behind the words, and is firmer with Increase Contrast. With the editor font set to Sans serif or Serif the column is that many "0"s wide, as on the desktop. Say if it is where you expect in portrait and in landscape (the text keeps to about 85 characters across a wide landscape iPad, so a ruler at 100 may sit past the text).
179. **Reflow.** Switch on **Break lines as you type** and set the column to 40. Type a long sentence with the keyboard (software and hardware): the line breaks at the last space before the column, the caret stays after what you typed, and the next word starts the new line. In a list item the next line lines up under the text, after a `>` quote it keeps the `>`, and in a task it lines up under the words, not the box. Typing into a heading, a code block, the frontmatter, an HTML tag or a table row never breaks it (a table row does break with *Keep tables whole* off).
180. **Undo.** After a break, undo once (⌘Z or shake): **tell me whether the character and the break go back together or in two steps.** (On the desktop's Live tab they go together; its plain editor takes two.)
181. **What reflow leaves alone.** With reflow on at 40, none of these break a line: pasting a long paragraph, undoing, deleting words so a line is long again, Return, dictating a long phrase, a drop of text. Typing one more character on that same long line afterwards does break it. With a Japanese or Chinese keyboard, the text is left alone while a word is still being composed and the line breaks when you finish it and type on.
182. **Scribble and autocorrect.** Write a long line with Scribble: it is broken once each word is turned into text. Accept an autocorrection or a predictive word on the keyboard: the line breaks after it, not in the middle of it.
183. **In the Live tab.** Do items 179 and 181 on the Live tab, with marks hiding and showing as the caret moves (a bold or a link in the line): the break and the caret are right, nothing garbled, and VoiceOver reads the line as before. Keys that Gate L tested (arrows, Backspace, Tab, ⌘B) behave as before with reflow on.

## Accessibility and window sizes (build plan Step 11)

74. **VoiceOver.** Turn VoiceOver on (Settings, Accessibility) and go through: the sidebar, a note's row, the three tabs, the toolbar buttons (each is named), a note's text in the editor ("Note text") and in the preview, a chart, a link. Say where it reads something wrong, in the wrong order, or not at all; and how the list after `<` and the note picker are announced.
75. **Larger text.** In Settings, Display & Brightness, Text Size (and Accessibility ▸ Display & Text Size ▸ Larger Text), go to the largest size: the notes list shows whole titles, the sidebar shows whole words with the count under each name, the note's date is not broken, nothing sits on top of anything. Do it in landscape and portrait, in the Markdown and Preview tabs.
76. **Reduce Motion.** With it on, tapping a heading in a note's contents scrolls without animating, and opening a notebook does not slide.
77. **Increase Contrast.** With it on, the grey text (dates, tags, counts) is darker and the faint lines are firmer, in every scheme.
78. **A narrow window.** Put the app in Slide Over, or a third of the screen in Split View, or a small Stage Manager window. The toolbar has a View menu (Markdown, Preview, Split) and an Edit menu (Find, Link to Note, Image) beside Trash; the notebooks and the list are behind a back button. Type in a note and use the list after `<`: it stays inside the window. Turn the iPad while it is narrow.
79. **Split View and Stage Manager.** Resize the window slowly from full screen to the smallest: the layout changes at a width and never overlaps or loses a control.
80. **Licences.** *More*, *About this build*, *Open-source licences*: GRDB.swift, swift-markdown and swift-cmark, each opening its licence text.

What to tell me for each: what you did, what you expected, what happened.

## Pictures already stored (Stored Image…)

The **Image** menu has *Stored Image…* (⌘⇧M with a hardware keyboard, on the *Markdown* or *Split* tab). It lists every picture in the app's `app_data/`, newest first, so one can be put in a note again, also after the text that pointed at it is gone. **Use a copy of your notes: this edits them.**

81. **The list.** Image, *Stored Image…* (or ⌘⇧M with a hardware keyboard: the same list opens, and no "m" is typed in the note): each picture has a small preview, its file name (it starts with the title of the note it was first put into), "Used in N notes" (or "Not used in any note") and its size. After a backup restored from the desktop, the desktop's pictures are all there, with the same counts as the desktop's Images list if you open it there.
82. **Filter and choose.** Type words of a name (`trip map` finds `trip-plan-route-map-…`): only the pictures with every word remain; nothing matching says so. Tap one: the list closes and `![…](app_data/…)` is in the note as a paragraph of its own, after the frontmatter even if the caret was in it, and the *Preview* shows it. Cancel changes nothing.
83. **Selected words.** Select a few words of a note, then Image, *Stored Image…* (the title of the list says which words), and choose: the words are replaced by the picture, and are its description (`![the words](app_data/…)`).
84. **Many pictures.** With a few hundred pictures (your own notes) the list opens without a long wait, shows at most 50 at once, and scrolling stays smooth while the previews load.

## Room for writing (the Split divider, hiding the lists)

85. **Drag the divider.** In *Split*, take hold of the strip between the editor and the preview (it has a short grip) and drag it: the editor and the preview grow and shrink as the finger moves, and neither goes very small. A double tap puts it back in the middle. Quit and reopen the app: it is where you left it (one place for side by side, one for stacked).
86. **Hide both lists.** In a note, tap the button at the left of the toolbar (arrows pointing outwards): the notebooks and the notes list both go, and the note has the whole screen; in *Split* the halves are now side by side. Tap it again (arrows pointing inwards): both come back. The system's button beside it still shows or hides the notebooks alone.
87. **VoiceOver on the divider.** With VoiceOver on, find "Divider between the editor and the preview" and swipe up or down: it moves a tenth at a time, and says how many percent the editor has.

## The Live look spike (Live view plan, step L1)

In the Editor lab (More, Editor lab): the Hide syntax menu (the eye with a line through it) has **Live look (spike L1)**. It is not the Live tab, only what the Live view will draw without changing the text. Choose it on the *Sample* note.

88. **Headings and marks.** The `# Editor lab` heading is large and bold (the `#` hidden) and `## Code` is a size smaller; bold, italic, strikethrough and code show without their marks. Type `*test*` on a line of its own and move off it: `test` is **slanted** (not just coloured), and `***both***` is bold and slanted.
89. **A rule and a picture.** The `---` near the end is a line across the page; the line `![A picture…](lab-picture.png)` under the heading is a coloured picture, not its text. Tap the picture: its Markdown shows and the picture sits just after it. Tap the rule: its three dashes show. Tap away: both are drawn again.
90. **The caret through them.** With a hardware keyboard, move the caret down through the picture's line and past the rule with the arrow keys: it should take one press for each line, never stick, and the text must not jump. Try dragging the selection handles across the picture and the rule, and writing a word with the Pencil beside them. Tell me anything odd.

## The Live view's three open risks (Live view plan, spikes L5, L6 and L7)

These check in your hands what the Simulator could not, or could only partly. **Steps L5 to L7 have since been built in the real Live tab, where the same cases run as UI tests in the Simulator; items 125 to 136 below ask for them in a note, and the lab items here stay for the comparisons (*never* reveal, the other reveal rules) and for the VoiceOver switch, which the Live tab now reads too.** In the Editor lab (More, Editor lab): the *Text* menu has **Editing spike (L5)**, eight short lines to move through (`Plain line before.`, `# Heading one`, `A **bold** word and *italic* too.`, `**Bold start** and more text`, `text ending in **bold**`, `## Second heading`, a line with code and strikethrough, `Last line.`). In the *Hide syntax* menu, choose **Live look**, and then, in the same menu, how far the marks show: **Reveal: construct the caret touches** (the rule the Live view will have), *Reveal: caret's line* (what the lab always did) or *Reveal: never* (every mark hidden even at the caret: the worst case, kept to compare). The last group of that menu, *VoiceOver*, is for items 100 to 103. Items 91 to 99 need the iPad's keyboard (or the Magic Keyboard).

91. **Arrow keys across a bold word.** *Reveal: construct.* Put the caret at the start of `A **bold** word and *italic* too.` (⌘← on that line). Press → thirteen times, then ← thirteen times. Each press should move the caret over one character you can see, never stand still; the `**` should show, dimmed, as soon as the caret touches the word (just before the first `**`) and go when it is one character past the closing `**`. Then say whether this bothers you: at that last press the text slides left under the caret (the Simulator drew the caret 26 points *left* of where it was after a press of →, and the reverse for ←).
92. **The same, with the marks never revealed.** *Reveal: never.* The same thirteen presses across `**bold**`: expect **four presses where the caret does not seem to move** (two for each `**`), and the same across `*italic*`. This is why the marks must show when the caret touches them; tell me if the iPad does not do this, because the plan rests on it.
93. **Up and Down.** *Reveal: construct.* From `Plain line before.` press ↓ seven times and ↑ seven times. Each press should move one line. When a line with bold in it is entered its marks appear and the line grows to the right: is the caret where you expected among the *visible* letters? (In the Simulator it was after the same number of visible letters as on the line you left.)
94. **Shift+arrow across the marks.** From just before `**bold**`: ⇧→ ten times, ⇧← ten times, ⇧↓ twice, then ⇧⌘→. The selection should grow and shrink one character at a time and the marks should show while it touches the word. Tell me anything that jumps.
95. **Backspace and forward delete next to marks.** *Reveal: construct.* (a) Put the caret just after `# ` in `# Heading one` (before the H) and press Backspace three times: it should remove the space, then the `#` (the line stops being a heading), then the line break. (b) Put the caret right after the closing `**` of `**bold**` and press Backspace: one `*` should go, visibly. (c) Put it just before the opening `**` and press forward delete (fn+Delete, or ⌦) three times: `*`, `*`, `b`. (d) At the start of `## Second heading` press forward delete four times. **Every press should remove one character you can see.** If one seems to do nothing, or the bold word changes with no character leaving, tell me which and where the caret was.
96. **Typing at the edges of a bold word.** *Reveal: construct.* Type `X` just before the closing `**`, `Y` just after it, `Z` just before the opening `**` and `W` just after it. X and W end up inside the bold, Y and Z outside; each should appear where the caret was drawn.
97. **A finger on the line.** *Reveal: construct.* Tap along `A **bold** word and *italic* too.`, including on the space before `bold` and just after the word. Where did the caret go, and what changed on screen? (In the Simulator every tap landed on a word edge, never between the two `*`, and the line then grew to the right by the width of the marks.) Then drag a selection handle through the word and tell me whether the marks flicker.
98. **The Pencil and dictation beside a mark.** Write a word with the Pencil, and dictate a word, right after the closing `**` of `**bold**`. While the system is still composing (the grey underline) the marks are meant to stay as they were; afterwards the marks should be right. Tell me what you see; this cannot be tried in the Simulator.
99. **Undo and redo.** *Reveal: construct.* After `**bold**` type `Y`, then `Z`, then press Backspace twice, then ⌘Z twice and ⇧⌘Z once (or the shake and the three-finger swipe). The text and the caret should come back step by step, with the marks showing and hiding correctly. (⌘Z sent through the Simulator undid nothing, in the lab and in the Markdown tab alike, so this has not been seen to work with hidden marks.)
100. **VoiceOver, as it is.** Turn VoiceOver on (Settings, Accessibility). *VoiceOver: as it is.* Swipe to the text and let VoiceOver read `A **bold** word and *italic* too.` and `# Heading one`. Does it say "star star", "asterisk" or "number sign"? Try both punctuation levels (Settings, Accessibility, VoiceOver, Verbosity, Punctuation: Some and All). The text view hands VoiceOver the whole text with its marks.
101. **VoiceOver, marks silent, headings marked.** Choose *VoiceOver: marks silent, headings marked* (the string is unchanged; the hidden marks are marked "speak no punctuation"). Read the same two lines at both punctuation levels: the marks should not be spoken. Set the rotor to Headings and swipe up and down: it should stop at `Heading one` and `Second heading`.
102. **VoiceOver, value without the marks.** Choose *VoiceOver: value without the marks* and read the same lines (no marks spoken is expected). Then set the rotor to Characters and move through `A bold word` by swiping up and down: does the character spoken match where the caret is drawn? Select a word with VoiceOver and compare what it announces with what is highlighted. This is the one that can disagree, because the text it describes is 25 characters shorter than the text view's.
103. **Typing with VoiceOver on.** With each of the three VoiceOver choices, type `X` after `**bold**` and press Backspace twice. VoiceOver announces what you type and delete: tell me anything it says that you cannot see on screen (a `*` is on screen while you are there, since the marks show where the caret is).
104. **Speed on the iPad.** Use a Release build. *Text ▸ 5,000 lines*, *Hide syntax ▸ Live look*, *Reveal: construct the caret touches*, then the speedometer button (Typing speed test) and wait for the line under the editor. Write it down (“ours” is the colouring, “whole” is everything UIKit does with the character too). Do the same with *Hide syntax ▸ Show marks* for comparison, and tell me whether typing in the middle of the note feels different. The Simulator on a Mac gave ours 0.4 ms median and 0.5 ms at the 95th, against a budget of 16 ms for the whole keystroke.
105. **A very long note.** In the Markdown tab (not the lab), make a note of about 400,000 characters: select all in the 5,000-line lab note, copy it, and paste it four times into one note. Type a few words in the middle, then stop. Does the iPad get warm or the editor stutter after you stop? In the lab the colouring once did not settle on a note that long and kept the Simulator busy (fixed: the passes now run one at a time, and the real editor settled in the Simulator); this checks it on the iPad itself. Delete the note afterwards.

## The Live tab (Live view plan, step L3)

The fourth tab of a note: *Markdown, Live, Preview, Split*. It is the Markdown tab's own text view drawn as the note will read, with the syntax hidden away from the caret. Rules and pictures are not drawn yet, `<Mark>` is not tinted and the frontmatter is not set apart (step L4); they look as in the Markdown tab. To try it, open a note, choose **Live**, and type some Markdown in it (a heading, a **bold** word, an *italic* one, ~~strikethrough~~, `code`, a fenced block).

106. **The tab.** *Live* is the second word of the picker, between Markdown and Preview; in a narrow window (Slide Over, a third of the screen) the View menu has it too.
107. **What is drawn.** With the caret on a plain line: a `# heading` is large and bold without its `#` (H2 a size smaller, H3 smaller still); a bold word is bold, an italic one italic, `~~struck~~` struck through and `code` smaller on a faint fill, none of them with their marks; the colours of code, links, tags and the `-`, `1.` and `>` marks are as in the Markdown tab, while headings, bold and italic are not coloured.
108. **The caret reveals one construct.** Tap inside a bold word: its two `**` appear, dimmed and regular, and the italic and struck words on the same line stay drawn. Tap in the italic word: the `**` go and its `*` show. Tap on a plain word: all hidden again. Tap inside a heading: its `# ` shows.
109. **The edge counts.** With the caret right after `**bold**` the marks still show; type a space, and they hide. Move back across the space with ←: they show again when the caret touches the word.
110. **Code blocks.** With the caret outside a fenced block, its two fences (the ``` lines) are hidden and what is inside is drawn as code, with `**not bold**` left alone; tap in the block: both fences show; tap out: both hide.
111. **Typing.** Type `**word**` and go on typing: the marks stay while you are at the closing `**` and hide when you have gone on. Then undo (⌘Z, or shake): the text comes back as you typed it, and nothing is left hidden that you can no longer reach.
112. **The tabs share one text view.** Put the caret inside a word, choose Markdown and then Live: the caret is where you left it, the keyboard stays up, and typing a letter goes there. Try the same through Split and Preview.
113. **The three fonts.** In Appearance, choose each editor font (sans, serif, mono) in turn: headings, bold and code keep the family, and italic is slanted in each (in the monospaced face it is the same letters slanted).
114. **Every scheme, and large text.** In each of the five colour schemes the dimmed marks, the code colours and the heading text read clearly; at the largest accessibility text size the headings are still larger than the text and nothing is cut off.
115. **Your hands.** The typing aids work as in the Markdown tab (the list after `<`, `[[` for a note link, Tab, bold and italic from the keyboard), and so do Find, the Link button and the Image menu. Write a word with the Pencil in a paragraph that has hidden marks (Scribble must be on). Tell me anything that behaves differently from the Markdown tab.

## The rest of the Live tab (Live view plan, step L4)

Rules, pictures, highlights and the frontmatter in the Live tab (the second word of the picker). To try them, open a note in Live and put in a `---` on a line of its own, a picture (the Image menu, or paste one), a `<Mark color="green">highlighted</Mark>` and look at the top of the note.

116. **The frontmatter.** The block at the top of the note (the lines between the two `---`) is smaller than the text and grey; it is never hidden, and nothing in it is drawn as bold or italic.
117. **A highlight.** `<Mark color="green">words</Mark>` is tinted green behind the words, with the two tags gone; try yellow, blue, pink and orange, and a colour that is not one of them (yellow). Tap in the highlighted words: the tags show, dimmed. Type a word in the middle of a highlight: it is tinted as you type, not a moment later.
118. **A rule.** `---` on a line of its own is a thin line across the page, with the dashes gone. Tap on the line: the dashes show and the line goes; tap away and it is back. Arrow up and down across it with a hardware keyboard: one press for each line.
119. **A picture.** A picture on a line of its own (`![alt](app_data/…)`, or `<Image src="app_data/…" />`) is the picture itself, at about the size the Preview draws it, and never wider than the text. Tap it: its Markdown shows and the picture is drawn below it; tap away and it is drawn in place again. `<Image … width="50%" />` is half the width of the text.
120. **Turning the iPad.** With a picture on screen, turn the iPad to portrait and back: the picture fits the new width a moment after, and the note below it does not jump or leave a gap.
121. **A picture whose file is gone.** Change the file name in a picture's Markdown to one that is not stored: the line says `Image not found: …`, muted and in italics, where the picture was; put the name back and the picture returns.
122. **What stays text.** A picture in the middle of a sentence, one with a web address (`https://…`), and a `<Drawio>` tag stay as their text. Tell me if one of them should be drawn.
123. **Every scheme.** In each of the five colour schemes the tint behind highlighted words and the rule can be seen, and the text on a tint can be read (dark text on the light schemes' strong tints, light text on the dark ones').
124. **A note with several pictures.** Scroll through a note with five or more pictures, quickly: the text is never held up, a picture that has not come in yet is a faint box of its size that fills in, and nothing flickers when the keyboard comes up or goes.

## The Live tab's editing, VoiceOver and speed (Live view plan, steps L5 to L7)

The same keys, VoiceOver choices and speed checks as items 91 to 105, in the Live tab of a real note. The tab reveals the marks **by construct** (the rule the plan took); there is no switch for it. In the Simulator, UI tests send the keys of items 125 to 129 and check at every press that the selection moved, that the caret was drawn somewhere else, and that no character beside the selection was hidden; what they cannot say is how it feels in your hands, and what VoiceOver says. The Live tab reads the lab's *Hide syntax ▸ VoiceOver* choice too: the default is *marks silent, headings marked* (candidate B), and *value without the marks* (candidate A) is the fallback, which you can switch on there and try in a note's Live tab.

125. **Arrow keys in a note.** In the Live tab with a hardware keyboard, in a note that has `# Heading one` and `A **bold** word and *italic* too.` on lines of their own, do items 91, 93 and 94 again: → thirteen times and ← thirteen times across the bold word, ↓ and ↑ through the lines, ⇧→ and ⇧← across the marks. Each press should move the caret over one character you can see; the marks show, dimmed, as the caret touches the word and go when it is a character past. Tell me where a press seemed to do nothing, and whether the line sliding under the caret at the word's edge (item 91) bothers you.
126. **Delete.** Item 95 in the note: Backspace after `# ` (three times), Backspace right after a closing `**`, forward delete (fn+Delete, or ⌦: the UI tests can only send ⌃D) before an opening `**` and at the start of a heading. **Every press should remove one character you can see.** The Simulator's tests did this with ⌃D and with Backspace; ⌦ is yours.
127. **Typing at the edges, and a finger.** Items 96 and 97 in the note: X, Y, Z and W at the four edges of a bold word; taps along the line (including on the space before `bold` and just after the word); a selection handle dragged through the word.
128. **⌘B, ⌘I, Tab, paste and the list after `<`, beside marks.** In a note with a bold word: select the word after it and press ⌘B (it becomes bold; again, it is not), select the bold word between its marks and press ⌘I (`***word***`; again, `**word**`); put the caret right after a closing `**` and press Tab (a tab is typed and the marks hide), then select two list lines that have bold in them and press Tab and Shift+Tab; copy a word and paste it right after a closing `**` and over a whole `**word**`; type `<Ma` right after `**bold** ` (the list opens under the caret, Return writes the tag). Tell me anything that behaves differently from the Markdown tab.
129. **Undo and redo.** Item 99 in the Live tab (and its menu: shake, or the three-finger swipe): after `**bold**` type `Y`, then `Z`, press Backspace, then undo until the text is as it was and redo until it is back. The text and the caret come back step by step, the marks showing and hiding as they should. (The Simulator's ⌘Z undid the typing, joined into fewer steps than there were edits.)
130. **Scribble and dictation beside a mark.** Item 98 in the Live tab: write a word with the Pencil, and dictate a word, right after a closing `**`. While the system is still composing (the grey underline) the marks stay as they were; when it ends they are right. (The Simulator's test used marked text, which is what a composition is; the Pencil and the microphone are yours.)
131. **VoiceOver reads a bold word and a heading.** With VoiceOver on, open a note in the Live tab and read `A **bold** word and *italic* too.` and `# Heading one`: **no "star", "asterisk" or "number sign" is said for a mark that is hidden** (try Punctuation: Some and All, as in item 100). Set the rotor to Headings: it stops at each heading. Move the caret with the Characters rotor through `bold word` and tell me if what is spoken matches what is drawn, and select a word and compare what VoiceOver says with what is highlighted. If a mark is spoken, say which one, then do the same after choosing *Hide syntax ▸ VoiceOver: value without the marks* in the Editor lab (it applies to the Live tab too, and is kept until you change it) and tell me which of the two is better. **Not decided**: this is the one item the Simulator cannot answer.
132. **Larger text.** Settings, Display & Brightness, Text Size, or Accessibility ▸ Larger Text, to the largest size: in the Live tab a heading is still twice the size of the text (H2 one and a half times), the lines wrap inside the page and nothing is cut off; a rule and a picture keep their places.
133. **Increase Contrast.** Settings, Accessibility, Display & Text Size, Increase Contrast, on: in the Live tab the marks that show are darker than with it off, and a rule is a firmer line, in every scheme. Say where the marks over a coloured highlight (`<Mark>**word**</Mark>`) are hard to read.
134. **Reduce Motion.** With it on, use the Live tab for a while: switching tabs, a picture arriving, tapping into a word. Nothing in the Live tab animates, so there is nothing to turn off; tell me if you see something move.
135. **Typing in a long note.** In a Release build, paste the lab's 5,000-line note (item 104) into a note, choose Live, and type in the middle of it, then the same in Markdown: it should feel the same, and the letters must not lag. The Simulator's numbers are in the plan's L7 result.
136. **A very long note.** Item 105 in the Live tab: about 400,000 characters, type a few words in the middle and stop. The iPad should not get warm or stutter afterwards. The Live tab has **no length limit** (the plan's decision V5): headings, bold, tints and pictures are drawn in a note of any length, so a highlight past the first 100,000 characters is tinted, which the desktop's Live tab does not do. Tell me if typing is slower than in the Markdown tab on the same note, and where in the note you typed. Delete the note afterwards.

**Gate L passed (you, 2026-11-09):** you tried the Live tab on the iPad and it works well. Items 91 to 105 (the lab's cases and VoiceOver choices), 116 to 124 (the rest of L4: pictures, tints, the rule, the frontmatter) and 125 to 136 above were not recorded one by one, so none of them is ticked here.

## PDFs: import and the reader (M2, first step)

The reader beside the note a PDF belongs to. **Tried in the Simulator only; this is its first time on the iPad.** You need a small PDF (a few pages, with a table of contents if you can), a book of a few hundred pages, and ideally a password-protected one. Marks, the Notes tab, quoting, search, export and the Pencil lab came after this and are in the next section (items 180 on; Gate P2). (These items are numbered from 140 to leave room for the Live view's.)

140. **Import from Files.** In a group, tap *Import PDF* (the page with a plus, next to *New Note* at the top of the notes list) and choose a PDF: a note named after the file appears in that group, with a small PDF icon in the list, and opens with the PDF at its first page.
141. **Several at once.** Choose three PDFs in the picker: three notes, and the last one opens.
142. **Drag from Files.** Put the Files app beside this one (Split View or Slide Over) and drag a PDF onto the notes list, then onto a group, and onto a notebook in the first column: each makes a note, in the group or notebook it was dropped on.
143. **The same PDF twice.** Import a PDF you have already imported: the app asks. *Open It* shows the first note; *Import Another Copy* makes a second note; *Cancel* makes nothing. Tell me if the words are not clear.
144. **Not a PDF.** Rename a text file to end in `.pdf` and import it: a message says it doesn't look like a PDF, and no note is left behind.
145. **Reading.** A finger scrolls the pages; pinching zooms; a long press selects words, and Copy works. At first the pages fit the width. Turn the iPad: they still fit, until you have zoomed yourself, and then your zoom stays.
146. **It comes back.** Read to a page, zoom in, open another note, and come back: the same page and zoom. End the app (swipe it away) and open it again: the same.
147. **Contents.** The list button at the left of the strip opens *Contents*: the PDF's own table of contents, with sub-headings indented and page numbers at the right. Choosing a line goes there and closes the list. A PDF with no table of contents says so.
148. **Bookmarks.** The bookmark button marks the page you are on (it is filled while you are on a bookmarked page; pressing it then takes the bookmark off). *Bookmarks* in the list shows them by page; swipe right (or press and hold) to rename one, swipe left to delete it; choosing one goes to its page.
149. **Go to a page.** Tap *Page 12 of 340* at the right of the strip, type a number, and it goes there.
150. **Find.** The magnifier opens the system's find bar over the PDF (⌘F with a keyboard does too): type a word, and the matches are marked, with next and previous.
151. **Beside the note.** In landscape with the lists showing, the pane has a *PDF / Note* switch; choose *Note* and the note is there, and back on *PDF* the PDF is where you left it. Tap the arrows button at the top left to hide the lists: the PDF is on the left and the note on the right with a divider you can drag (double tap puts it in the middle). In portrait: the switch again.
152. **A big book.** Import the book of a few hundred pages: it opens within a second or two, scrolling keeps up with a finger, and jumping through the contents is quick. Tell me the size and the pages, and anything slow.
153. **A protected PDF.** It asks for a password instead of showing a blank page. A wrong one says so; the right one opens it, and its contents and page count then show.
154. **The Trash Can.** Move a PDF's note to the Trash Can: the question says its PDF stays with it; the Trash Can lists it with *PDF* and its size. Restore it: it opens as before. Move it back and delete it for good: it is gone (the iPad's *Storage* in Settings would show the space come back).
155. **Round trip with the desktop.** Restore a desktop backup that has PDFs: they open here, at the page the desktop was on. Make a backup here and restore it on the desktop: the PDFs and the bookmarks are there. (Highlights made on the desktop come back and are drawn here too: items 188 and 213.)
156. **Colour schemes and large text.** In each scheme the strip and the lists read clearly (the pages themselves are always white: dark pages are not built); at the largest text size nothing in the strip is cut off.
157. **VoiceOver.** The strip's buttons are named (*Contents, bookmarks, highlights and notes*, *Find in the PDF*, *Bookmark this page*, *Add a typed note*, *Undo*, *Redo*, *Cite this page*, *Export annotated PDF*), the page button says *Page 12 of 340* and offers to go to a page, and the lists read their lines. Tell me what the PDF itself reads as.

## PDF markup, notes, search, export and ink (M2, Gate P2)

**Gate P2 is yours.** Everything here was built and checked **in the iPad Simulator and with `swift test` on a Mac only, never on an iPad, and nothing in this section is ticked.** The Simulator has no Pencil and no real touch pressure; what it could not say is marked **iPad only**. You need: a PDF of a few pages for the first items, a real textbook (a few hundred pages, with a table of contents and, if you can find one, printed page labels such as a Roman-numeral preface), a two-column paper, a PDF that is rotated or cropped on some pages, and a password-protected one. Use a **Release** build (install step 6) for anything about speed or memory. Ink on the page is built (the group *Pencil ink on a PDF*; the Pencil is yours to try). The Pencil's highlighter snapping to text lines and handwritten notes beside a PDF are **not built**.

**Typed markup** (the Pencil is not needed: a finger or the Pencil used as a pointer both work)

220. **Highlight.** In a PDF, press and hold a word, drag a handle to take a few lines, and a bar of five colours and three tools (highlight, underline, strikethrough) appears over the pages. Choose a colour and *Highlight*: the words are tinted on the page, in that colour, where they were. Zoom in and out, turn the iPad, scroll away and back: the mark stays on the words. *Tell me if the tint is in the wrong place, off by half a line, or covers the text.*
221. **Underline and strikethrough.** The same with the other two tools: a line under the words, a line through them, in the colour chosen.
222. **The five colours.** Make one of each. Compare them with the desktop's (open the same PDF there from a backup; items 188 and 213): yellow, green, blue, pink and orange should look alike on both. The colour you chose last is the one used next time.
223. **A selection that runs over lines and pages.** Select from the end of a page into the top of the next one and mark it. It is one highlight: one *Undo* takes all of it back, and *Delete* in its card removes both parts. Try it on a two-column paper too: *tell me if the selection or the quote runs across the columns in the wrong order* (risk X4).
224. **A mark's card.** Tap a marked word: a card opens over the pages (at the bottom of the pane, or at the top when the mark is low on the page) with the five colours, a comment line, *Quote in the note*, a bin and a close button. Choose another colour (the mark changes), type a comment and tap away (the comment is kept), delete the mark. A tap on unmarked text does nothing; a tap on a link in the PDF (a contents page) still follows the link.
225. **A typed note.** The speech-bubble button, then a tap on the page, then type, then *Save*: a yellow box with your words is on the page at the tap. Tap it for its card, *Edit the note* to retype it. A note with no words is not kept. Write one in Cyrillic, Greek, Japanese and with an emoji: PDFKit draws them with the system's fonts. **Not built:** moving or resizing a note by dragging, and a note's font size (it is 12 points).
226. **Undo and redo.** The two arrow buttons in the strip (⌘Z and ⇧⌘Z with a hardware keyboard) take back and put back marks, recolouring, comments, typed notes and deletes, one at a time. They last until the PDF is closed; the history is not saved.
227. **Odd pages.** On a PDF with rotated pages, one with a crop box and a landscape page, mark words on each: the mark is on the words every time (the Mac checked this on nine such pages; the iPad's own PDFKit is what you are testing). Also on a page of a **scanned** book if you have one: there is no text to select, so there is nothing to mark (OCR is later).
228. **They stay.** End the app and open it again: the marks are there. Restore a **desktop** backup that has highlights, underlines and notes on a PDF: they are drawn in the same places here. Make a backup here, restore it on the desktop: the marks are drawn there in the same places.
229. **Schemes and large text.** In each of the five colour schemes and at the largest text size, the bar, the card and the lists read clearly and nothing is cut off. (The pages are always white; marks are always the same colours.)
230. **VoiceOver.** The bar's buttons are named (*Yellow*, *Highlight*…), the card reads, the *Highlights* list reads each mark's page, words and comment. The marks on the page itself are not read: tell me if you would want that.
231. **The Pencil as a pointer.** With the Pencil, tap a mark (its card opens), long-press a word (it selects). **iPad only.** *Not built, and not here:* the Pencil's highlighter snapping to text lines (it waits on spike B).

**The sidebar, quoting, citing and links**

232. **Highlights tab.** The list button at the left of the strip, then *Highlights*: every mark by page with its words and comment, a filter box that narrows them, a swipe to delete. Tapping one goes to its page and a frame flashes round the mark for a moment. A quote icon on a row means a note already quotes it.
233. **Quote.** With a note open beside the PDF (side by side with the lists hidden, or the *Note* switch), put the caret in a paragraph in the *Markdown* tab, then *Quote in the note* on a mark (its card, or the quote button on a row of the list). A block quote with its citation appears at the caret: `> words`, an empty `>` line, and `> — [*Title*, p. 42](pdf:…#p=44&a=…)`. With the note in the *Preview* tab, it is added at the end instead. With a PDF that has page labels, the words say the printed page (page *xii* of the preface) and the link the physical one. Characters like `*`, `_` and `<` in the PDF's words are made literal: the preview shows them, and starts no bold or tag.
234. **Cite this page.** The link button in the strip puts `[*Title*, p. 42](pdf:…#p=44)` at the caret of the note.
235. **Follow a link.** In the note's *Preview* tab (or the right half of *Split*) tap the citation: the PDF goes to that page and the mark flashes. From a *different* note that cites the PDF (a chapter note), the PDF opens beside that note and the note stays where it is.
236. **A PDF that is gone.** Put the PDF's note in the Trash Can: the citations in your other notes (in their *Preview* tab) are struck through, say *(PDF not on this device)* after them, and are not tappable; the quote above them stays. After you restore the note they work again. The same for a note restored from a desktop backup that does not have the PDF.
237. **Notes tab.** *Notes* in the list: the PDF's own note first, then every note whose text links to it, with how many pages each cites. Choosing one shows that note beside the PDF (the note list selection follows). *New note for this PDF* makes "Notes on <title>" in the same group with a link to the PDF as its first line, beside the PDF.
238. **The Live tab.** A `pdf:` link in the *Live* tab is drawn like any other link and is **not** followed when tapped, as on the desktop (only the preview follows links). *Tell me if it looks different from a `note:` link there.*

**Search**

239. **Search finds the PDF by its marks.** Highlight a phrase, comment on another mark, type a note, and bookmark a page with a name; then search for a word from each (type in the search box above the notes list): the PDF's note is in the results each time, and not for a word you never marked. Delete the mark (or *Undo* it): the note stops being found by it; undo the delete, and it is found again. The marks' words are never shown in the note.

**Export annotated PDF**

240. **Export.** The share button in the strip (or *More*, *Export annotated PDF…* when the strip is narrow): a sheet with *Flatten markup* (off) and the number of marks, then *Export…*, then *Save or share…*. Save it to Files, AirDrop it to a Mac and open it in Preview, and open it in another PDF app: the highlights, underlines, strikethroughs and notes are there as annotations you can select and edit, with your comments as their notes, in the same places as in the reader.
241. **Flatten.** The same with *Flatten markup* on: the marks look the same everywhere and cannot be edited or removed, the text underneath can still be selected, and the PDF's own links (a contents page, a cross-reference) no longer work, because PDFKit burns every annotation in (the desktop's flatten keeps them; a native copy does too).
242. **Text in the notes.** A typed note in Cyrillic, Greek, Japanese and an emoji exports and reads right (unlike the desktop's export, which stops at Japanese).
243. **A protected PDF.** Export it (the sheet says so): the copy asks for the **same password** in another app. *Not carried:* the original's limits on printing and copying.
244. **A big book.** Export a 300 to 600 page book with marks on many pages. Tell me the size, the page count, how long it took and whether the app stayed usable and was not ended by the system (PDFKit holds a copy of the book in memory while it writes it; the desktop's measured 2 to 4.5 times the file, this is not measured). Check the file in Preview.
245. **The original is untouched.** Mark more, export again: the second copy has the new marks, the first copy does not, and the PDF in the library is byte for byte what you imported (open it on the desktop from a backup: no marks inside it).

**The PDF ink lab (spike B)** is *More, PDF ink lab (spike B)*, built by another session (PR #290) and tried in the Simulator; its own items are 200 to 215 under *Spike B* below. This branch had made a second lab and it was dropped in favour of that one. The ink in the reader (the group after this one) is built on what that lab found.

**Pencil ink on a PDF** *(built 2026-11-10; the pages' canvases are PDFKit's overlays and the strokes are kept as one D9 record per page; tried in the Simulator with a finger only; the lab above is where the same question was asked first)*

246. **Can the Pencil draw at all?** Open a PDF, tap the pencil button in the strip (*Draw on the pages*). A bar says *Drawing with the Pencil* and *No ink yet*, and the system's tool picker shows (pens, eraser, lasso, ruler, colours; it may dock at the bottom or float). Draw a word with the Pencil. **iPad only, and the first thing to try:** this works only if PDFKit's page view lets the Pencil through to the canvas, which the app asks of it ([the plan](../pdf-markup-plan.md#ink-on-the-pages-2026-11-10); in the Simulator a finger reaches the canvas this way, which is all the Simulator can say). If nothing is drawn, tell me, and whether the picker moved; the fallback is a canvas layer of the app's own.
247. **A finger and the Pencil.** While drawing, a finger still scrolls the book and pinches, and a long press still selects words (the selection bar does not show while drawing). Rest your palm on the glass while you write: no marks, no scroll. Draw with the Pencil while the other hand scrolls. *Tell me what happens at each.*
248. **The tools.** The pen, marker, pencil, crayon, the pixel eraser, the stroke eraser, the lasso (move and resize), the ruler, other colours. The picker's undo and redo take strokes back; the strip's own *Undo* takes marks back (it does not touch ink). Do the Pencil's double tap and squeeze do what your Settings say?
249. **Keeping it.** Draw on pages 1, 4 and 9; *Done*. The bar is gone and the ink stays and shows. Open the list button, *Highlights*: an *Ink* section lists pages 1, 4 and 9; a tap goes to the page. End the app, open it again: the ink is on the pages. Scroll to page 60 and back: the ink is there, at once.
250. **Zoom, turn, Split View.** Pinch in to about 300% and write: the strokes are sharp (not blurred) and under the tip. Turn the iPad and use Split View: the ink stays on the words it was written beside.
251. **Odd pages.** On a PDF with turned and cropped pages (item 227), write a line on each: the ink is where you wrote it, in the cropped page too. Then export (item 240) and open the copy in Preview: the ink is in the same places.
252. **Clearing a page.** In *Highlights*, swipe a page of ink left, *Clear ink*: it goes from the list and the page. Draw it again, then erase every stroke on a page with the eraser: the page leaves the list by itself.
253. **Export.** Export with *Flatten markup* off and on. The sheet says how many pages of ink. In Preview the ink is lines on the pages (a flattened copy cannot be edited); a pencil's grain and a crayon's texture are not in the copy and a pen's width is even along a stroke (C21). *Tell me if that is too ugly.* Open an unflattened copy in another app that reads annotations (Acrobat, if you have it): the ink is editable.
254. **Finger draws.** With *Finger draws* on in the bar a finger draws, and two fingers scroll and pinch. Off by default; it is remembered. (The Simulator uses it, as it has no Pencil.)
255. **A dense page.** Fill a page with handwriting as in a lecture. Scroll away from it: does the app stall as the page is kept? Come back: is the ink all there? *Done* on 20 such pages. Tell me the time it took and whether the iPad warmed up. (Release build.)
256. **A big book with ink.** In a 300 to 600 page book draw on about 50 pages, scrolling through; then end the app, open the book again and scroll the whole book. *Tell me if the app is ended by the system, how long the book takes to appear, and whether scrolling keeps up.* The lab's items 209 to 213 have the numbers to compare.
257. **A backup.** Export a backup, restore it: the ink is on the pages. Restore a backup with ink on the **desktop**: the PDF opens and its delete dialog counts the pages of ink (the desktop does not draw the ink yet).
258. **Schemes, large text, VoiceOver.** The page stays white and the ink dark in each scheme. The banner and the pencil button are named. VoiceOver on a page with ink: the app labels the canvas *Handwriting on page N, M strokes*, but **PDFKit did not show that canvas to the Simulator's accessibility tree**, so *tell me what VoiceOver actually says there* (I could not check).
259. **Mixing it with marks.** Highlight words, draw over them, tap a highlight: its card opens when not drawing; while drawing, a tap on a mark opens nothing.

**All together**

260. **A real textbook, start to finish.** Import a textbook, read a chapter, mark ten things in the five colours, comment on three, type two notes, quote four marks into a chapter note and cite two pages, follow a citation, search for a word you marked, export it annotated, and open the export in Preview. *Tell me everything that felt wrong, slow or missing.*
261. **The desktop, both ways.** Marks, notes, bookmarks and `pdf:` citations made on the desktop work here (a citation in a restored note opens the PDF at the page and flashes the mark; the mark is where the desktop put it), and the other way round. Search finds the same PDF by the same words on both.
262. **What you cannot do yet, so I know you looked.** The Pencil's highlighter snapping to lines, handwritten notes beside a PDF, dark pages, moving a typed note, ink drawn by the desktop's reader. These are not built. *Tell me which of them you missed most.*

What to tell me for each: what you did, what you expected, what happened, and Debug or Release.

## What it leaves out

The Pencil's highlighter snapping to text lines, handwritten notes beside a PDF, dark pages, moving or resizing a typed note, printed page labels in the page button and the contents, and the PDF's title from its own metadata. Highlighting in the preview, buttons for Tab and Shift+Tab on the on-screen keyboard, Follow the sun and the desktop's font families, and everything else the real editor will have; attached files (they come in with a backup and go out again, but are not shown; stored *images* are drawn in
the preview); the notes' sort order and which dates show under a note (the desktop has both); notebook colours; settings other than the colour scheme and fonts; the Pencil; sync. Selecting text
across blocks of the preview, and the video player of `<YouTube>`, are not there either.

## Drawings (M2, S5: the stroke format and the canvas)

Built 2026-11-09 and tried only in the Simulator, with a finger standing in for the Pencil (four UI tests: a drawing is stored, written into the note and shown, a blank page is a cancel, a tap on the
drawing edits it). Everything about the **Pencil itself** is yours to try, and these are what Gate C needs ([architecture/ink.md](../architecture/ink.md#what-gate-c-still-needs)).
These start at 160 because the Live items end at 136 and the PDF reader's start at 140 and run to 157.

160. **A new drawing.** In Markdown or Split, the Image menu's *Drawing…* opens a full-screen page with PencilKit's tool picker. Draw with the Pencil: the line follows the tip with the latency you know from Notes (say if it does not), the palm resting on the glass leaves no marks, and a finger scrolls the page when *Only draw with Apple Pencil* is on in Settings.
161. **Done.** *Done* puts `<Ink src="app_data/…" alt="Drawing" width="80%" />` in the note as a paragraph of its own (after the frontmatter, never inside it), and the preview shows the drawing. *Cancel*, and *Done* on a blank page, change nothing.
162. **Edit it.** In the preview, tap the drawing: the page opens again on the same strokes (all the strokes, with their tools and colours). Add some, *Done*: the note names a new file in place of the old, and the preview shows the new drawing. Undo in the note brings the old name back.
163. **Every ink.** Draw one stroke with each of the pen, monoline, fountain pen, pencil, marker, crayon and watercolour, in one colour, then *Done*. The preview is a simplified picture (no grain or bleed on pencil, crayon and watercolour; the marker is a flat translucent band). **Tell me which ones look wrong or too different from the canvas.**
164. **Dark schemes (R12).** Draw black ink on a light scheme, then pick a dark one: the preview shows the ink white, and so does the page when you tap to edit. In a dark scheme, draw a red, a blue and a yellow stroke as well, *Done*, and look at the preview in that scheme and then in a light one. **Tell me whether the colours in the preview are the ones on the canvas, and whether the canvas shows them as you chose them.**
165. **The eraser.** Erase the middle of a long stroke with the pixel eraser and the end of another with the stroke eraser, *Done*: the preview shows the stroke cut where you erased, and the page reopened shows the same gap.
166. **Moving things.** Select some strokes with the lasso, move and resize them, *Done*: they are where you put them in the preview.
167. **A dense page.** Fill a page with handwriting, as you would in a lecture, and *Done*. Say how long *Done* takes, whether the preview comes in at once, how long the page takes to open again, and the size of the PNG (the Files app, or a backup's `app_data`). The measurements in the format page say a dense page is about 4 MB.
168. **The page's size.** A new page is as big as the screen it opened on. Draw in portrait, then open the same drawing in landscape: the page keeps its size and scrolls; pinch zooms it.
169. **A backup.** Export a backup and restore it (or restore the same one): the drawing is there, shows, and can be edited. Take the PNG out of the backup and open it in any image viewer: it shows the drawing in the colours of the scheme it was saved in.
170. **VoiceOver.** On the drawing in the preview, VoiceOver says *Drawing, image, button* and a double tap opens the page.
171. **Elsewhere.** A note with an `<Ink>` shows an *Unknown component* notice on the desktop and in the CLI until their side is built: this is expected, so just confirm nothing else in the note changes.

## Spike B: the PDF ink lab (M2, PencilKit over PDFKit)

Built 2026-11-09 and tried only in the Simulator, where a finger stands in for the Pencil. It answers the three questions the PDF plan leaves open before the iPad draws on PDFs ([the plan's Spike B section](../pdf-markup-plan.md#spike-b-status-2026-11-09), risk X3): does a finger still scroll and select text while the Pencil draws on a canvas over the page, is the ink as quick as in Notes, and does a 500-page book fit in memory when every page near the screen has a canvas. **Use a Release build** for the numbers (see *Install it on your iPad*); a Debug build is several times slower and its memory is not the app's.

Open it from the ellipsis menu at the top of the notebooks column: *PDF ink lab (spike B)*. The first time, it writes a 500-page test book on the iPad (a few seconds). The strip under the title shows the page, the zoom, the canvases on screen, the memory the app uses and the room it has left. The five buttons at the top right are *Book*, *Pen*, *Canvases*, *Runs* and *By hand*, then *Cases to try* and *Report*. Everything you measure goes into the report: tap *Report*, then the copy button, and paste it into a note or send it to me. **These items are numbered from 200 so as to stay clear of the items other sessions are adding: renumber them when the page is merged.**

200. **Open it.** Say how long the book took to appear, and the *room left* in the strip when it has (the Simulator does not report it; the iPad does).
201. **The Pencil draws, a finger scrolls.** With the defaults (*Pen* menu: *A finger draws* is off), draw with the Pencil on the page: black strokes under the tip. Drag with a finger across the text, across a stroke and across the margin: the pages scroll and nothing is drawn. **Tell me if a finger ever draws, or the Pencil ever scrolls.** (The PDF's own scroll view accepts the Pencil as well as fingers: *By hand* ▸ *Where does a touch go?* lists the touch types it takes, and the canvas should win against it.)
202. **Selecting text.** Press and hold a word with a finger: it is selected with handles and the copy menu. Drag a handle over several lines and onto the next page. Then press and hold on a stroke you drew. **Tell me what works and what does not, and whether it is any worse than with *Canvases on the pages* turned off.**
203. **Page view touches.** In the *Canvases* menu, turn off *Let touches through PDFKit's page view*, and try to draw: **the Pencil should draw nothing**, because PDFKit's own page view takes no touches (the Simulator showed exactly that, and a canvas inside it was never reached). Turn it on again. After either, *By hand* ▸ *Where does a touch go?* writes where a touch lands into the report. This tells us whether the iPad is built the same inside as the Simulator.
204. **Palm and edge.** Rest the side of your hand on the glass while you write: no marks, no scrolling or zooming from it. Draw a long line down across the gap between two pages: say what happens to the part past the page's edge.
205. **Zoom.** Pinch to about 300% and write: the strokes stay sharp (not blurred) and under the tip, and the pen is as thick on the page as at 100%. Pan with a finger and write again; scroll away and come back: the strokes are on the same words.
206. **Away and back.** Draw on page 3, scroll to page 60 and back; use *Book* ▸ *Go to page…* to jump to page 400 and write at once; turn the iPad to the other orientation and back. The ink is always back where it was, nothing pops in late, and the first stroke after a jump is not lost.
207. **The tools.** The pixel eraser, the stroke eraser, the lasso, the marker (*Pen* menu); then *Canvases* ▸ *System tool picker*: it appears and its tool applies to the page in view, also after you scroll to another page.
208. **Latency.** *By hand* ▸ *Start recording*, write a few lines with the Pencil, *Stop recording*, and read the report's block called *By hand*: the Pencil samples, the time from the hardware to the app, and from the hardware to the soonest frame that could show it. **Then write the same words in Notes and say whether this is better, the same or worse, and by how much you can tell.** The numbers are what the app can see; Notes is the real comparison (the stroke itself is drawn by PencilKit, which predicts ahead of the tip and which the app cannot time).
209. **The scroll run.** *Runs* ▸ *Scroll through every page* with the 500-page book and 12 pages a second (then 30): the report has the memory at the start, at the peak and at the end, the room left at its lowest, the late and dropped frames and the worst frame, and how many canvases were made and the most on screen at once. Then turn *Canvases on the pages* off and run it again, for the cost of the canvases alone.
210. **Ink on 5, 50 and 200 pages.** *Runs* ▸ *Draw on 5 pages*, then *50*, then *200* (the ink is a dense page of handwriting's worth of points; *Light* is the other choice). Each puts ink on the pages from the first on, in turn, and reports the memory before and after, the cost of leaving a page (building the stroke format and its JSON, which the app will do off the main thread; this is the time the work itself takes), the size of a page's record (JSON, zipped, and PencilKit's own copy) and then a second stretch that comes back to the same pages. **Tell me the memory growth and whether the app was ever ended by the system.**
211. **By hand on 5 pages.** *By hand* ▸ *Start recording*; write a page of handwriting as in a lecture on each of five pages, using *Add a memory line to the report* after each; *Stop recording*. This is the real figure for five pages, beside the made-up ink of item 210.
212. **Keep, hold and empty.** The *Canvases* menu has the variants the build may have to choose between: *Keep every canvas that was made*, *Ink of pages off the screen* as PencilKit's data, *Empty a canvas when its page leaves*, and *Build the stroke format when a page leaves*. Run the scroll run and *Draw on 200 pages* with each changed on its own (and put the menu back to its defaults afterwards): the memory against the first run says what each costs or saves. **In the Simulator, emptying each canvas as its page left halved the memory 200 dense pages cost; tell me whether the iPad agrees.**
213. **Your own book.** *Book* ▸ *Open a PDF from Files…*, with your biggest book (several hundred pages, ideally a scan): the scroll run and a few pages by hand. **Tell me the size and the pages, and the memory the report gives.**
214. **Turned and cropped pages.** *Book* ▸ *Make a 30-page book with turned and cropped pages*: the first nine pages are turned by quarter turns and cropped in different ways. Draw on each: the stroke appears under the tip, and stays on the same words after you scroll away and back. The report lists how each canvas sits on its page.
215. **The cases.** Open *Cases to try*, mark each Fine or Problem as you go (they are in the report), and add anything else you saw in the notes box.

## What is not yet verified

- **The PDF ink lab on a real iPad** (items 200 to 215): the Pencil, the latency, the memory and whether the finger and the Pencil can share the page. Only the Simulator, with a finger, has been used.
- **The preview on a real iPad,** and with Dynamic Type or VoiceOver. (Importing a backup through the system picker was not
  tried in the Simulator; you used a backup of your real notes on the iPad, which I take to mean that route worked there.)
- **Drawing on a real iPad with the Pencil** (items 160 to 171): latency, palm rejection, the textured inks and how the dark schemes treat colours; only the Simulator, with a finger, has been used.
- Search speed on the iPad's own CPU and SQLite.
- Large backups on a device (the core streams, and was measured up to 1 GB on a Mac, but the app has not handled one).

## What to tell me

Per item above: what you did, what you expected, what happened. For search in particular, a query, what the desktop
returned and what this returned. The speed line, and whether it was a Debug or a Release build.
