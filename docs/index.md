# Docs

Landing place for documentation.

See [architecture.md](architecture.md) for how the app is put together and how data
flows through it.

See [ui/web-groups.md](ui/web-groups.md) for how groups are managed in the web app.

See [ui/web-trash-can.md](ui/web-trash-can.md) for the delete confirmation and the Trash Can on the Settings page.

See [ui/web-components.md](ui/web-components.md) for the shadcn/ui component setup and how its tokens map onto the color schemes.

See [desktop-app-plan.md](desktop-app-plan.md) for the proposed Electron desktop app, and
[desktop-app-research.md](desktop-app-research.md) for the research behind it.

See [desktop-build-and-release.md](desktop-build-and-release.md) for the step-by-step from
`git pull` to a local desktop build and a GitHub Release.

See [deployment/manual-build-release.md](deployment/manual-build-release.md) for getting an Apple
certificate and notarization key, and producing a signed, notarized desktop build by hand.

See [product-builds.md](product-builds.md) for which database each product (CLI, web,
desktop) uses today and is meant to use later.

See [feature-matrix.md](feature-matrix.md) for where the CLI, web and desktop apps differ.

See [ui/web-follow-the-sun.md](ui/web-follow-the-sun.md) for the sunrise/sunset color scheme.

See [feature-matrix.md](feature-matrix.md) for which features the CLI, web and desktop apps each have.

See [architecture/attachments.md](architecture/attachments.md) for files attached to a note.

See [architecture/sync-server.md](architecture/sync-server.md) for the self-hosted sync server (`apps/sync-server`): what it is, how to run it, and where its guides are.

See [ui/cli-keybindings.md](ui/cli-keybindings.md) for every CLI key, which keys belong to the editor, and which keys can't be used and why.

See [shared-core-plan.md](shared-core-plan.md) for the plan to move the code the three apps share into one package.

See [ui/mdx-components.md](ui/mdx-components.md) for the components (like `<Info>` and `<Warning>`) a note can use, and
[architecture/diagrams.md](architecture/diagrams.md) for draw.io diagrams in a note (`<Drawio>`).

See [architecture/ink.md](architecture/ink.md) for handwritten drawings from the iPad in a note (`<Ink>`): the stroke format, and how the web, desktop and CLI show them.

See [ui/ai-helper.md](ui/ai-helper.md) for the AI helper, the chat panel beside a note that talks to your own Ollama server or, if you sign in, your ChatGPT plan, and
[manual-tests/ai-helper.md](manual-tests/ai-helper.md) for checking it by hand. Its research and build plan are
[ai-helper-research.md](ai-helper-research.md) and [ai-helper-plan.md](ai-helper-plan.md).


See [reading-list-plan.md](reading-list-plan.md) for the Reading List plugin (desktop only, off until switched on): a list of article links beside a webview that shows the one you pick; [ui/panels.md](ui/panels.md#the-reading-list-panel) describes it and [manual-tests/reading-list.md](manual-tests/reading-list.md) checks it by hand.

See [plugin-launcher-plan.md](plugin-launcher-plan.md) for opening a plugin's panel without making an empty panel first (desktop only): Open commands in the command palette and a rail of icons beside the notebooks, which can be switched off or trimmed in Settings; [ui/panels.md](ui/panels.md#opening-a-plugins-panel) describes it and [manual-tests/plugin-launcher.md](manual-tests/plugin-launcher.md) checks it by hand.

See [rss-reader-plan.md](rss-reader-plan.md) for the RSS Reader plugin (desktop only, off until switched on): subscribe to RSS and Atom feeds, read their entries and unsubscribe; [ui/panels.md](ui/panels.md#the-rss-reader-panel) describes it and [manual-tests/rss.md](manual-tests/rss.md) checks it by hand.

See [ui/panels.md](ui/panels.md#the-contacts-panel) for the Contacts plugin (desktop only, on by default): a rolodex of personal and work contacts in a panel that moves between windows like the others, and is part of backups; [manual-tests/contacts.md](manual-tests/contacts.md) checks it by hand.

See [architecture/todo-weekly-cycle.md](architecture/todo-weekly-cycle.md) for how the to-do list tidies itself each week (finished items archived, unfinished ones rolled over, a history kept for a window you set, and weekly, monthly and quarterly reports written as notes), [ui/panels.md](ui/panels.md#the-to-do-panel) for what the panel does, [manual-tests/todo-archival.md](manual-tests/todo-archival.md) for checking it by hand, and [todo-archival-plan.md](todo-archival-plan.md) for the design and its decisions.

See [ui/live-editor.md](ui/live-editor.md) for the Live tab, which draws a note's Markdown as it will read and shows the syntax only under the caret, [manual-tests/live-editor.md](manual-tests/live-editor.md) for checking it by hand, and [live-editor-parity-plan.md](live-editor-parity-plan.md) for how every writing feature of the Markdown editor (image paste, MDX completion, the note-link picker, the highlight menu, the ruler and reflow) was brought into it.

See [ui/pdf.md](ui/pdf.md) for reading a PDF with your notes beside it (desktop app): a PDF as a note that owns it, marks kept beside the file (highlights, underlines, strikethroughs and text notes; Apple Pencil ink comes with the iPad app), Quote and `pdf:` citations that lead back to the page, and **Export annotated PDF**; [architecture/pdf.md](architecture/pdf.md) for how it works inside, [manual-tests/pdf.md](manual-tests/pdf.md) to check it by hand, and [pdf-markup-plan.md](pdf-markup-plan.md) for the design, the spikes and what is still to build.

See [manual-tests/stress-databases.md](manual-tests/stress-databases.md) for the generated 1,000-, 10,000- and 50,000-note databases (and the harness that measures the web app on them), and [stress-test-findings.md](stress-test-findings.md) for what they showed: a note over 1,000,000 characters that cannot be saved, a sidebar that re-renders on every keystroke, and a first page and an autosave that carry every note's text.

## Features

- [x] Create note
- [x] Delete note
    - [x] Confirm before deleting (web and desktop)
    - [x] Trash Can in Settings: restore recently deleted notes and groups; permanently deleted after 60 days (web and desktop)
- [x] Search across notes
- [x] Metadata support via front-matter
    - [] Support tags on notes, allow searching for notes via tags
- [x] Support note groups
    - [] Support filtering the list of notes by groups (a dedicated `group:` search token)
- [x] Image display support in Markdown content (web and desktop; see [architecture/images.md](architecture/images.md))
    - [x] Allow users to "upload" images directly into a note (paste)
    - [x] Show the image in a rendered version of the note
    - [] CLI support
- [x] Attach any type of file to a note, listed in a table on the note (see [architecture/attachments.md](architecture/attachments.md))
    - [] Drag files in from Finder
    - [] Search attachment names
- [] Support cross-linking between files
    - I want to be able to link in one note file, to another one within the database

### Admin Features

- [x] Support data backup & restore (Settings → Backup and Restore, in all three apps; see [architecture/backup-restore.md](architecture/backup-restore.md))
    - [x] Full backup: notes, groups, Trash Can, images, attachments and settings in one `.tar.gz`
    - [] Full notes backup to JSON files
- [x] Settings page for application configurations:
    - [x] Application data location
    - [x] Color scheme
        - [x] Web: "Follow the sun" scheme that tracks a saved city's sunrise and sunset

### Editing

- [] Generate a table of contents, at the top of the file
- [] Stylized render for Markdown content
    - Headers are bolded. Italics work. Underline support.
- [] Syntax highlighting support
    - Provide different colors for headers, etc.
- [] Checklist support
    - Allow creating checklists with `[]`, `[x]` syntax support

### SDLC + Engineering Standards

- [] GitHub actions to run unit tests on each PR
- [x] Dependabot automation

### Deployment

The desktop app ships as a manual download (see [product-builds.md](product-builds.md)). The terminal app runs from
source today (`pnpm dev`, or the `composition` bin): should it be published to npm, or shipped as a
single-file executable? Both are open; neither is needed to use it.

How to automate builds and deployments?


### Extra Ideas

How should a potential web application be handled?


## Feature - Search across notes

Fuzzy text search and filter across all notes. 

- basic fuzzy text search
- filter queries
    Examples: `tag: software`, `createdOn: >2026-05-30`, `title: Next.js`

### Implementation

Put a search bar at the top of the UI on the main view

Allow fuzzy text search and filtering from this input

Filter the notes list on the left, live with the search/filter functionality

Debounce user input in search bar, by 350ms

### Testing

- Create a loading script that will load 100 dummy note files
- Test the search capability with this data set

See [architecture/backup-restore.md](architecture/backup-restore.md) for backing up and restoring everything from Settings, and
[manual-tests/backup-restore.md](manual-tests/backup-restore.md) for the guided manual test of it in each app.

See [ui/markdown-editor-highlighting.md](ui/markdown-editor-highlighting.md) for how the Markdown tab colours text as you write, and the rules that keep the colours aligned with the caret.

Stored images can be browsed and reused from the Images page or with `Cmd/Ctrl+Shift+M` in the editor; see [architecture/images.md](architecture/images.md#browsing-and-reusing-images).

See [ui/note-links.md](ui/note-links.md) for linking one note to another (`[[`, the shortcut, and following links).

See [ui/web-side-by-side.md](ui/web-side-by-side.md) for opening several notes side by side (the `⋯` menu's "Open to the side", dragging) and what each pane shows.

See [ui/panels.md](ui/panels.md) for how the desktop app's panels behave (a resizable grid of notes and notes browsers, saved between launches),
[panel-system-plan.md](panel-system-plan.md) for the design, the build order and what is still to come (dragging a panel out of the window, keyboard shortcuts and menu entries),
and [panel-system-research.md](panel-system-research.md) for the pop-out spike and the facts behind it.

See [windows-build-plan.md](windows-build-plan.md) for the design of the Windows 10/11 x64 build: an NSIS installer with the CLI, Meilisearch and in-app updates inside, what has to change, the decisions to make, and the order to build it in.

See [windows-native-app-design.md](windows-native-app-design.md) for the design of a native Windows app (C#/.NET, WinUI 3, the note preview in a WebView2): what carries over from the Electron Windows plan, a tracker of which features port, the compromises, the decisions made and open, the spikes (run on a Mac, and the one that needs Windows) and the gates. Design and spikes only; the Electron app stays the shipping Windows plan.

See [ipad-app-design.md](ipad-app-design.md) for the design of a native iPad app (Swift, with Apple Pencil handwriting): the architecture, a tracker of which features work or are expected to, the compromises made to get it running, the decisions still open, and the spikes to run first. Built so far: the data layer, backup, Trash Can and search as a Swift package (`apps/ios/CompositionCore`), checked against the desktop's own code (plus the Markdown and MDX layer and a highlighter for the editor), and a prototype app (`apps/ios/Composition`) that draws notes and their components, runs on an iPad, and has an editor lab; [ipad-build-plan.md](ipad-build-plan.md) is the order of work for the first milestone, [ipad-live-view-plan.md](ipad-live-view-plan.md) is the plan for the Live view that follows it, and [manual-tests/ipad.md](manual-tests/ipad.md) is how to install the prototype on an iPad and what to try.

See [linux-native-app-design.md](linux-native-app-design.md) for the design of a native Linux app (Rust, GTK 4 and libadwaita, GNOME first): the architecture, a tracker of which features port, the compromises, the decisions made and still open, what the spikes in `apps/linux/spikes/` showed, and what could not be verified without a real GNOME desktop. Design and spikes only; no production code.
