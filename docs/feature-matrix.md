# Feature matrix

Which features each of the three products has **today**. For which database each one
uses, see [product-builds.md](product-builds.md); for how the desktop app is built, see
[desktop-app-plan.md](desktop-app-plan.md).

| | CLI | Web | Desktop |
|---|---|---|---|
| **Path** | `apps/cli` | `apps/web` | `apps/desktop` |
| **Runs as** | Terminal app (OpenTUI, Node 26.10+) | Next.js server, in a browser | macOS app (Electron) |

Legend: ✅ supported · ❌ not supported · 🚫 left out on purpose (the note says why)

## Notes and organization

| Feature | CLI | Web | Desktop | Notes |
|---|:-:|:-:|:-:|---|
| Create and delete notes | ✅ | ✅ | ✅ | |
| Confirm before deleting | ✅ | ✅ | ✅ | |
| Trash Can: restore deleted notes and groups for 60 days | ✅ | ✅ | ✅ | CLI: the `t` key. [web-trash-can.md](ui/web-trash-can.md) |
| Edit Markdown, with autosave | ✅ | ✅ | ✅ | [note-lifecycle.md](architecture/note-lifecycle.md) |
| YAML frontmatter (title, description, tags, dates) | ✅ | ✅ | ✅ | [data-model.md](architecture/data-model.md) |
| Nested groups: create, rename, delete when empty | ✅ | ✅ | ✅ | [groups.md](architecture/groups.md) |
| Move a note to another group | ✅ | ✅ | ✅ | CLI: the `m` key. Web and desktop: drag the note onto a group |
| Drag and drop notes and groups | 🚫 | ✅ | ✅ | A terminal has no dragging worth the name; the CLI moves with keys instead (`m`, and `shift+↑` `shift+↓` below). [web-groups.md](ui/web-groups.md) |
| Reorder notes and groups by hand | ✅ | ✅ | ✅ | Web and desktop: drag a row to the edge of a sibling. CLI: `shift+↑` `shift+↓` move the highlighted row one place. [groups.md](architecture/groups.md#ordering) |
| Move an existing group under another | ✅ | ✅ | ✅ | CLI: the `m` key, which offers every group except the group itself and what is beneath it |
| Several notes open side by side | ✅ | ✅ | ✅ | CLI: the `o` key opens a note in a new pane, `ctrl+o` moves between panes. Web (and desktop, before its panels): draggable panes, or **Open to the side** in a note's `⋯` menu; a note opened beside another starts on its editor. [web-side-by-side.md](ui/web-side-by-side.md), [screen-navigation.md](architecture/screen-navigation.md) |
| Panels: a resizable grid of notes and a notes browser, saved between launches | ❌ | ❌ | ✅ | Desktop only (a terminal and a browser tab have no use for it yet). Split, drag, resize and close panels; the same note can be open in several; any panel can be pulled into a window of its own. The AI helper is a panel kind here (pinned to a note, or following the one you are in). Panel commands (split, close, next and previous, move to a window) have keys and a command palette (Cmd/Ctrl+Shift+P). [panels.md](ui/panels.md), [panel-system-plan.md](panel-system-plan.md) |
| To-do list: a panel with sub-items, a board, and a background of your choice | ❌ | ❌ | ✅ | Desktop only, a built-in plugin you can switch off in Settings. Sub-items nest without limit; **List** and **Board** views (Backlog, To-do, In progress, Done); **Remove** with an Undo. [panels.md](ui/panels.md#the-to-do-panel) |
| To-do weekly cycle: finished items archived each week, unfinished ones rolled over, an archive, and weekly, monthly and quarterly reports | ❌ | ❌ | ✅ | Desktop only. A week is seven days from a start day you choose; at its end done items go to a searchable **Archive** (kept 5 years unless you change it, or **Keep forever**), open ones wait in **Rolled over** to add to the week, move to the backlog or drop, and each week, month and quarter that had something in it gets an **editable Markdown report** that is a note in a **To-do reports** notebook, with **Regenerate** and a picker for a period that has none. **Delete permanently** for a sensitive item lists the reports that mention it. The first run asks whether to archive what is already completed. [todo-weekly-cycle.md](architecture/todo-weekly-cycle.md), [manual test](manual-tests/todo-archival.md) |
| Opening a plugin's panel without an empty panel: palette commands (Open To-do, Open AI Helper…) and a rail of icons beside the notebooks | ❌ | ❌ | ✅ | Desktop only, like the panels. Opening goes to the panel of that kind if one is open, else fills an empty focused panel, else splits right. A plugin that is off is not offered. The rail (main window only) can be switched off in Settings > General > Panels or with Toggle Plugin Rail in the palette, and each icon can be hidden without turning its plugin off. [panels.md](ui/panels.md#opening-a-plugins-panel), [plugin-launcher-plan.md](plugin-launcher-plan.md), [manual-tests/plugin-launcher.md](manual-tests/plugin-launcher.md) |
| Reading List plugin: a list of article links with the page of the one you pick beside it | ❌ | ❌ | ✅ | Desktop only, and off until switched on in Settings > Plugins. The pages load in a sandboxed `<webview>` with a session of their own (no bridge, no permissions); a **Clear browsing data** button wipes it. A browser tab already is a browser, and a terminal cannot render a page. [panels.md](ui/panels.md#the-reading-list-panel), [reading-list-plan.md](reading-list-plan.md), [manual-tests/reading-list.md](manual-tests/reading-list.md) |
| RSS Reader plugin: subscribe to RSS and Atom feeds, read their entries, unsubscribe | ❌ | ❌ | ✅ | Desktop only, and off until switched on in Settings > Plugins. Feeds are fetched by the main process only (the page has no network access): web addresses only, no private addresses, size and time limits, `ETag` refresh, about every 30 minutes while the app is open; entries are shown as plain text. Unsubscribing asks first. [panels.md](ui/panels.md#the-rss-reader-panel), [rss-reader-plan.md](rss-reader-plan.md), [manual-tests/rss.md](manual-tests/rss.md) |
| Favorites: pin groups and notes above the tree | ✅ | ✅ | ✅ | CLI: the `f` key. [groups.md](architecture/groups.md#favorites) |

## Search

| Feature | CLI | Web | Desktop | Notes |
|---|:-:|:-:|:-:|---|
| Fuzzy full-text search | ✅ | ✅ | ✅ | Meilisearch; [search.md](architecture/search.md) |
| Field filters, like `tag: software` | ✅ | ✅ | ✅ | The same parser in all three: `tag`, `title`, `description`, `created`, `updated` |
| Search engine comes with the app | ❌ | ❌ | ✅ | CLI starts a `meilisearch` you installed, and keeps working without one (search says why it is off). Web needs `pnpm meili` run by hand. Desktop bundles it |

## Viewing a note

| Feature | CLI | Web | Desktop | Notes |
|---|:-:|:-:|:-:|---|
| Markdown preview | ✅ | ✅ | ✅ | |
| Syntax highlighting while writing Markdown | ✅ | ✅ | ✅ | The CLI colors the editor with the same palette ([highlight.ts](../apps/cli/src/highlight.ts)). [markdown-editor-highlighting.md](ui/markdown-editor-highlighting.md) |
| Tab types a tab in the editor, to indent nested lists | ✅ | ✅ | ✅ | |
| Images in notes: shown in the preview | ✅ | ✅ | ✅ | The CLI draws them with the terminal's graphics protocol, or in block characters. [images.md](architecture/images.md) |
| Images in notes: paste | ✅ | ✅ | ✅ | A terminal can't paste picture bytes. The CLI adds an image from a file: `ctrl+l` and a path, or dragging the file into the terminal. Copying a screenshot to the clipboard doesn't work in the CLI. [images.md](architecture/images.md#in-the-cli) |
| Browse every stored image, and insert one again: **Images** page, or `Cmd/Ctrl+Shift+M` in the editor | ❌ | ✅ | ✅ | Finds an image after the text that referred to it was deleted, and says which are used in no note. The CLI has no image browser yet. [images.md](architecture/images.md#browsing-and-reusing-images) |
| `<Image width>`: draw a pasted image smaller, in pixels or % of the note | ❌ | ✅ | ✅ | `Cmd/Ctrl+Shift+X` turns a Markdown image into the tag, and the editor suggests `width` and its values. The file itself is not shrunk, and the CLI ignores the width. [mdx-components.md](ui/mdx-components.md#resizing-width) |
| Header image: a picture above the note's title, full width or centered | ❌ | ✅ | ✅ | The **Header image** button in a note's header (pick a stored image or upload one), or `headerImage` / `headerImageLayout` in the frontmatter. The CLI keeps the keys but doesn't draw it. [images.md](architecture/images.md#header-image) |
| Image size limit | None | 10 MB | None | See [Image size limit](#image-size-limit) |
| `<Info>`, `<Warning>`, `<Image>`, `<Toc>` components | ✅ | ✅ | ✅ | The CLI draws them as boxes, a contents list and a picture. [mdx-components.md](ui/mdx-components.md) |
| Footnotes: `[^1]` citations and a `<Footnotes>` list | ✅ | ✅ | ✅ | Numbered by where they are cited, so adding one renumbers the rest. The CLI shows a citation as a superscript number and the list in a box. [mdx-components.md](ui/mdx-components.md#footnotes) |
| `<Drawio>` diagram shown in the preview | ✅ | ✅ | ✅ | A diagram is a stored PNG with the drawing inside, so the CLI draws it like any image. [diagrams.md](architecture/diagrams.md) |
| Draw a diagram with draw.io, put it in the note, and edit it again from the preview | ❌ | ✅ | ✅ | The **Diagram** button or `Cmd/Ctrl+Shift+D` draws one; **Edit diagram** on the preview changes it. Works offline: the editor is vendored. The CLI has no editor. [diagrams.md](architecture/diagrams.md) |
| `<YouTube>` embeds a video you can watch in the preview | ❌ | ✅ | ✅ | Web and desktop play it in the preview (youtube-nocookie.com, so it needs the network); the CLI shows a link to it. [mdx-components.md](ui/mdx-components.md#youtube) |
| `<Repo>` card linking to a git repository (GitHub, GitLab, …) | ✅ | ✅ | ✅ | Drawn from the address alone, nothing is fetched. The CLI shows a link to it. [mdx-components.md](ui/mdx-components.md#repo) |
| `<Mark>` highlighted text, in five colors | ❌ | ✅ | ✅ | Web and desktop: `Cmd/Ctrl+Shift+H` in the editor, or select text in the preview and right-click. The CLI shows the text without the tint. [text-highlighting.md](ui/text-highlighting.md) |
| Link to another note: `[[` or `Cmd/Ctrl+Shift+K` picker, click to open | ❌ | ✅ | ✅ | The CLI keeps the `[text](note:id)` Markdown but can't insert or follow one yet. [note-links.md](ui/note-links.md) |
| **Attach any file to a note, listed in a table on the note** | ✅ | ✅ | ✅ | The web app uploads through the browser's file picker and downloads instead of "save a copy"; it has no "show in Finder". The CLI types paths where the desktop opens a file picker, and has no "show in Finder" either. [attachments.md](architecture/attachments.md) |

## Appearance and settings

| Feature | CLI | Web | Desktop | Notes |
|---|:-:|:-:|:-:|---|
| Color schemes | 6 | 6 | 6 | Dark, light, forest, wine, cream and "follow the sun", in all three. The CLI's colors are the web's (a test fails if they drift) |
| "Follow the sun" scheme | ✅ | ✅ | ✅ | [web-follow-the-sun.md](ui/web-follow-the-sun.md). The CLI fades smoothly only in a truecolor terminal, and otherwise switches between dark and light |
| Resizable columns, remembered | ✅ | ✅ | ✅ | Web and desktop: drag the dividers. CLI: `<` `>` for the tree and `[` `]` for the editor/preview split. The CLI's tree width is stored in its own field (`cliSidebarColumns`, in columns), so a backup restored from another app never resizes it; the split is the shared `editorRatio`. [keybindings](ui/cli-keybindings.md) |
| Application data location setting | ✅ | ✅ | ✅ | Moving it in the CLI or the desktop app moves the other one too, through `~/.composition-location.json`. The web app keeps its own. The CLI moves the files; web and desktop only repoint. [product-builds.md](product-builds.md) |
| Backup and restore everything from Settings | ✅ | ✅ | ✅ | Notes, groups, Trash Can, images, attachments, to-dos (with their archive, history and report links), and the color scheme, city, column sizes, favorites and to-do settings, in one `.tar.gz`. The web and CLI type a path; the desktop uses file dialogs. [backup-restore.md](architecture/backup-restore.md) |
| AI helper: ask a model on your own Ollama server about the note you are in, in a panel beside it | ❌ | ✅ | ✅ | Cmd/Ctrl+Shift+L (a dock in the note on the web; a panel of its own on desktop). Only Ollama (local or self-hosted, with an optional second address that is used when the first does not answer, e.g. at home and over Tailscale): no ChatGPT or other hosted service, and Ollama's cloud models are refused. The note and any selection are sent to that server; answers can be copied or made into a *new* note, never inserted. Chats are kept in memory only for now, other local servers and the CLI come later. [ai-helper.md](ui/ai-helper.md) |
| Keyboard shortcuts helper | ❌ | ✅ | ✅ | A list of every shortcut, in a Settings section and in a floating window opened with Cmd/Ctrl+/ (or `?` outside a text field) from any screen. The list is `components/shortcuts/shortcuts.ts`; add to it when adding a shortcut. The CLI has its own [keybindings](ui/cli-keybindings.md) |
| To-do settings: week start, how long archived items are kept, fiscal year | ❌ | ❌ | ✅ | Settings > General > To-dos, hidden while the To-do plugin is off. Lowering the window says how many archived items it would delete and asks first. [panels.md](ui/panels.md#settings) |
| Automatic updates | 🚫 | 🚫 | ✅ | Checks GitHub Releases at launch and every 6 hours, asks before downloading and again before restarting. Settings has the on/off toggle. [desktop-updates-plan.md](desktop-updates-plan.md) |
| Developer docs viewer (`/docs`) | ❌ | ✅ | 🚫 | It reads this repo's docs from disk, which an installed app doesn't have |

## Distribution

| | CLI | Web | Desktop |
|---|---|---|---|
| Shipped as | Inside the macOS desktop app (Composition > Install Command Line Tool…); from source elsewhere (`pnpm dev`, or the `composition` bin) | Undecided | Download from GitHub Releases once; after that it updates itself |
| Platforms | macOS and Linux, on Node 26.10 or newer. Windows later | Any browser | macOS only for now |
| Notes database | `~/.composition/composition.db`, shared by all three | same | same |

## Image size limit

The web app refuses pasted images over 10 MB, because they travel to the server as request
bodies. The desktop app has no limit: the image is written to the user's own disk and never
leaves the machine. Details in [architecture/images.md](architecture/images.md).

## Keeping this page true

When a feature lands or changes in one product, update its row in the same pull request.
A row with ❌ in a column is a statement that the product doesn't do it **yet** unless it
carries 🚫, which marks a deliberate decision.

### Shared data, uneven features

All three products open the same `composition.db`, so a note can carry something a
product can't show. The rule so far is that the product that can't show it must not lose it:

- **Images:** the note's Markdown holds the path. The CLI draws the picture in its preview and adds one from a file, and its "move the data" setting carries the image folder along.
- **Attachments:** they live in their own table, never in the note's text, so no app rewrites them
  by saving a note. The CLI has its Attachments screen. Moving a note to the Trash
  Can keeps its attachments, so a restored note gets them back; they are deleted when the
  note is permanently deleted (by hand or after 60 days). The CLI's "move the data" setting
  carries the attachments folder along.
