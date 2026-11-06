# Manual test: the iPad app (prototype)

A read-only viewer on the Swift core, to try your own notes on the iPad before the real app exists. It can import a
desktop backup, list and search the notes (typos included), show a note's text, use the Trash Can, and export a backup
the desktop can restore. It cannot edit, render Markdown, show images or attachments, or draw ink: see
[What it leaves out](#what-it-leaves-out). Design and status: [ipad-app-design.md](../ipad-app-design.md).

**It has been run in the iPad Simulator only, never on an iPad.** Part of what you do here is the first real run.

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
7. **Open a note.** You see its Markdown source with the frontmatter, as stored.
8. **Trash Can:** swipe a note, or use the trash button on an open one. Open the Trash Can (top left): swipe a row right
   to restore, left to delete for good. A trashed note must stop appearing in search, and appear again once restored.
9. **Export a backup** (the ⋯ menu, then **Save or share…**) and restore it in the desktop app (Settings, Restore).
   Everything, including the Trash Can, should be there.
10. **Replace with a backup,** and choose a file that is not a backup (any other file). It must say so and change nothing.
11. **Quit and reopen.** The notes are still there, and *About this build* says the search index was **not** rebuilt at launch.
12. **Turn the iPad, then use Split View and Slide Over.** Does the list and note still make sense?

## What it leaves out

Editing and autosave; rendering Markdown (you see the source); images and attached files (they come in with a backup and
go out again, but are not shown); groups and notebooks (notes are one flat list); the colour schemes and settings; the
Pencil; sync. A note's `[[links]]` and MDX components are plain text.

## What is not yet verified

- **Everything on a real iPad.** The Simulator ran the whole flow except choosing a file in the system picker: its Files
  app would not show a file I put there, so that route (security-scoped access to a file you pick) is untested. If
  **Choose a backup…** fails, that is the first suspect.
- Search speed on the iPad's own CPU and SQLite.
- Large backups on a device (the core streams, and was measured up to 1 GB on a Mac, but the app has not handled one).

## What to tell me

Per item above: what you did, what you expected, what happened. For search in particular, a query, what the desktop
returned and what this returned. The speed line, and whether it was a Debug or a Release build.
