# Manual test: the iPad app (prototype)

A viewer on the Swift core, to try your own notes on the iPad before the real app exists. It can import a
desktop backup, list and search the notes (typos included), draw a note's Markdown and the ten components (or show its source),
use the Trash Can, and export a backup the desktop can restore. Since build plan Step 4 it has a **plain-text editor** (the *Edit*
tab) that saves what you type, which is there to test saving, not to be the editor. It cannot show attachments, or draw ink: see
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
7. **Open a note.** It opens as a **Preview** (Markdown and components; **Source** is the switch beside it, with the frontmatter, as
   stored). Open one of your own notes that uses components (`<Info>`, `<Chart>`, footnotes) and compare it with the desktop: see 13.
8. **Trash Can:** swipe a note, or use the trash button on an open one. Open the Trash Can (top left): swipe a row right
   to restore, left to delete for good. A trashed note must stop appearing in search, and appear again once restored.
9. **Export a backup** (the ⋯ menu, then **Save or share…**) and restore it in the desktop app (Settings, Restore).
   Everything, including the Trash Can, should be there.
10. **Replace with a backup,** and choose a file that is not a backup (any other file). It must say so and change nothing.
11. **Quit and reopen.** The notes are still there, and *About this build* says the search index was **not** rebuilt at launch.
12. **Turn the iPad, then use Split View and Slide Over.** Does the list and note still make sense?
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

14. **Scribble.** With the Pencil, write a few words into the text on the *Sample* note, between lines and at the end. They should turn into text, and the colours
   should carry on (a stray half-word of colouring while you write is fine; text lost or doubled is not). Try it inside a bold word too.
15. **Typing in a long note.** Choose *5,000 lines*, tap into the middle, and type for a few seconds on the on-screen keyboard and on a hardware one. Does it keep up?
   Since build plan Step 5 only the paragraphs around what you type are coloured at once (the rest is checked a third of a second after you stop), so it should keep up easily: in the Simulator it
   cost 0.6 ms a keystroke where the whole-note way cost 91 ms. Read *colour per edit* (last and worst) in the line under the text. Then *5,000 lines with views*, and scroll all the way down and up.
   **Then tap *Typing speed test* (the speedometer button, in a Release build):** it types 400 characters into the middle of *5,000 lines with views* and shows a line with the median, 95th percentile and
   worst of our own work per keystroke. Please send me that line: it is the iPad's number for the 16 ms budget.
   Also try typing a line of three backticks (a code fence) in the middle of the note: the colours below it should change to code within about half a second, in a blink and not a freeze.
16. **Views in the text.** In *5,000 lines with views* (or with *Insert a view*), draw in the grey canvas with the **Pencil**. The text must not scroll under the stroke, and
   the stroke must be there after you scroll away and back.
17. **Hide syntax.** Choose *Hide: tiny and clear* on the *Sample* note. Tap into a paragraph (its marks should come back), then use the arrow keys to cross from one
   paragraph to the next, and drag the selection handles over a hidden mark. Note anything odd: the caret stuck for a press or two, a selection that includes marks you
   cannot see, a jump when a paragraph reflows. If you use VoiceOver, move over a bold word and note whether it says "asterisk".
18. **Find, and the `<` list.** *Find* should open the system find bar and mark every match. Type `<` at the start of a line: the list should sit by the caret, also with the
   keyboard up and the caret near the bottom of the screen.
19. **Rotate and Split View** with the lab open, with a canvas in the text. Does it lay out again without a jump or a blank?

What to tell me for each: what you did, what you expected, what happened, and Debug or Release.

## Saving what you type (build plan Step 4, spike S6)

The *Edit* tab beside *Preview* and *Source* is a plain text view on the note's text: no colours, no completion, nothing else (the real
editor is Step 6). What you type is written to a small file at once, and into the notes after a pause of about a second (at the latest five seconds
into non-stop typing), and every time the app is about to leave the front. In the Simulator, ending the app in the middle of typing lost nothing; these
check it on the iPad. **Use a copy of your notes: this does edit them.**

20. **Type, then leave.** In *Edit*, type a sentence and at once swipe up to the Home screen. Open the app again: the sentence is there, and so in *Preview*.
21. **Type, then end the app at once.** Type a sentence and immediately swipe the app away in the app switcher (or hold the side button and restart the iPad, if you dare). Open the app:
    an alert says the app was closed while you were typing, and the sentence is back. Tell me if any of it is missing, and how fast you were.
22. **Type without stopping** for half a minute. Watch the list on the left: the note should move to the top, and its date change, *while* you are still typing (within about five seconds).
23. **Edit, then look.** After a pause, *Preview* shows what you typed, and a search for a word you typed finds the note.
24. **The frontmatter at the top of the note.** Change the `title:` line: after a pause the list shows the new title. Make it wrong (`title: [oops`): the title in the list stays as it was, and the text stays exactly as you typed it.
25. **Back up right after typing.** Type a sentence, open the ⋯ menu at once and export a backup, and restore it in the desktop app: the sentence is in the note.
26. **Come back to where you were.** Open a note, choose *Edit*, put the caret mid-note, press Home, then swipe the app away. Open it again from the Home screen: it should be on the same note, in *Edit*, with the caret about where it was.

What to tell me for each: what you did, what you expected, what happened, and Debug or Release.

## What it leaves out

Colour and completion in the editor, and everything else the real editor will have; attached files (they come in with a backup and go out again, but are not shown; stored *images* are drawn in
the preview); groups and notebooks (notes are one flat list); the colour schemes and settings; the Pencil; sync. A note's `[[links]]`
are plain text, selecting text across blocks of the preview, and the video player of `<YouTube>`.

## What is not yet verified

- **The preview on a real iPad,** and with Dynamic Type or VoiceOver. (Importing a backup through the system picker was not
  tried in the Simulator; you used a backup of your real notes on the iPad, which I take to mean that route worked there.)
- Search speed on the iPad's own CPU and SQLite.
- Large backups on a device (the core streams, and was measured up to 1 GB on a Mac, but the app has not handled one).

## What to tell me

Per item above: what you did, what you expected, what happened. For search in particular, a query, what the desktop
returned and what this returned. The speed line, and whether it was a Debug or a Release build.
