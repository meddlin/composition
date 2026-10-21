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
| Several notes open side by side | ✅ | ✅ | ✅ | CLI: the `o` key opens a note in a new pane, `ctrl+o` moves between panes. Web and desktop: draggable panes, or **Open to the side** in a note's `⋯` menu; a note opened beside another starts on its editor. [web-side-by-side.md](ui/web-side-by-side.md), [screen-navigation.md](architecture/screen-navigation.md) |
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
| `<Image width>`: draw a pasted image smaller, in pixels or % of the note | ❌ | ✅ | ✅ | `Cmd/Ctrl+Shift+M` turns a Markdown image into the tag, and the editor suggests `width` and its values. The file itself is not shrunk, and the CLI ignores the width. [mdx-components.md](ui/mdx-components.md#resizing-width) |
| Image size limit | None | 10 MB | None | See [Image size limit](#image-size-limit) |
| `<Info>`, `<Warning>`, `<Image>`, `<Toc>` components | ✅ | ✅ | ✅ | The CLI draws them as boxes, a contents list and a picture. [mdx-components.md](ui/mdx-components.md) |
| Footnotes: `[^1]` citations and a `<Footnotes>` list | ✅ | ✅ | ✅ | Numbered by where they are cited, so adding one renumbers the rest. The CLI shows a citation as a superscript number and the list in a box. [mdx-components.md](ui/mdx-components.md#footnotes) |
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
| Backup and restore everything from Settings | ✅ | ✅ | ✅ | Notes, groups, Trash Can, images, attachments, and the color scheme, city, column sizes and favorites, in one `.tar.gz`. The web and CLI type a path; the desktop uses file dialogs. [backup-restore.md](architecture/backup-restore.md) |
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
