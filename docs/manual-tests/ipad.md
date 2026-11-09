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
72. **From the desktop.** Choose a scheme on the desktop, make a backup, restore it on the iPad: the iPad wears that scheme. If the desktop's was "Follow the sun", the iPad shows System.
73. **Your eyes.** In daylight and at night, at your usual brightness: say which schemes are too faint or too bright on this screen, and where.

**Not built, so do not expect it:** "Follow the sun", and the desktop's own font families (Geist, Lora …): the iPad has the system's three. The footer under the list, and the system's own pickers, are not in the scheme.

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

These check in your hands what the Simulator could not, or could only partly. In the Editor lab (More, Editor lab): the *Text* menu has **Editing spike (L5)**, eight short lines to move through (`Plain line before.`, `# Heading one`, `A **bold** word and *italic* too.`, `**Bold start** and more text`, `text ending in **bold**`, `## Second heading`, a line with code and strikethrough, `Last line.`). In the *Hide syntax* menu, choose **Live look**, and then, in the same menu, how far the marks show: **Reveal: construct the caret touches** (the rule the Live view will have), *Reveal: caret's line* (what the lab always did) or *Reveal: never* (every mark hidden even at the caret: the worst case, kept to compare). The last group of that menu, *VoiceOver*, is for items 100 to 103. Items 91 to 99 need the iPad's keyboard (or the Magic Keyboard).

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
105. **A very long note.** In the Markdown tab (not the lab), make a note of about 400,000 characters: select all in the 5,000-line lab note, copy it, and paste it four times into one note. Type a few words in the middle, then stop. Does the iPad get warm or the editor stutter after you stop? In the lab the colouring did not settle on a note that long and kept the Simulator busy; this checks whether the real editor does too. Delete the note afterwards.

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

## What it leaves out

Highlighting in the preview, buttons for Tab and Shift+Tab on the on-screen keyboard, Follow the sun and the desktop's font families, and everything else the real editor will have; attached files (they come in with a backup and go out again, but are not shown; stored *images* are drawn in
the preview); the notes' sort order and which dates show under a note (the desktop has both); notebook colours; settings other than the colour scheme and fonts; the Pencil; sync. Selecting text
across blocks of the preview, and the video player of `<YouTube>`, are not there either.

## What is not yet verified

- **The preview on a real iPad,** and with Dynamic Type or VoiceOver. (Importing a backup through the system picker was not
  tried in the Simulator; you used a backup of your real notes on the iPad, which I take to mean that route worked there.)
- Search speed on the iPad's own CPU and SQLite.
- Large backups on a device (the core streams, and was measured up to 1 GB on a Mac, but the app has not handled one).

## What to tell me

Per item above: what you did, what you expected, what happened. For search in particular, a query, what the desktop
returned and what this returned. The speed line, and whether it was a Debug or a Release build.
