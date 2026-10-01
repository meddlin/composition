# Feature matrix

Which features each of the three products has **today**. For which database each one
uses, see [product-builds.md](product-builds.md); for how the desktop app is built, see
[desktop-app-plan.md](desktop-app-plan.md).

| | CLI | Web | Desktop |
|---|---|---|---|
| **Path** | `apps/cli` | `apps/web` | `apps/desktop` |
| **Runs as** | Terminal app (Textual) | Next.js server, in a browser | macOS app (Electron) |

Legend: ✅ supported · ❌ not supported · 🚫 left out on purpose (the note says why)

## Notes and organization

| Feature | CLI | Web | Desktop | Notes |
|---|:-:|:-:|:-:|---|
| Create and delete notes | ✅ | ✅ | ✅ | |
| Confirm before deleting | ✅ | ✅ | ✅ | |
| Trash Can: restore deleted notes and groups for 60 days | ❌ | ✅ | ✅ | The CLI deletes for good. [web-trash-can.md](ui/web-trash-can.md) |
| Edit Markdown, with autosave | ✅ | ✅ | ✅ | [note-lifecycle.md](architecture/note-lifecycle.md) |
| YAML frontmatter (title, description, tags, dates) | ✅ | ✅ | ✅ | [data-model.md](architecture/data-model.md) |
| Nested groups: create, rename, delete when empty | ✅ | ✅ | ✅ | [groups.md](architecture/groups.md) |
| Move a note to another group | ✅ | ✅ | ✅ | CLI: the `m` key. Web and desktop: drag the note onto a group |
| Drag and drop notes and groups | ❌ | ✅ | ✅ | [web-groups.md](ui/web-groups.md) |
| Move an existing group under another | ❌ | ✅ | ✅ | The CLI can only nest a group when it is created |
| Several notes open side by side | ❌ | ✅ | ✅ | Draggable panes |
| Favorites: pin groups and notes above the tree | ❌ | ✅ | ✅ | [groups.md](architecture/groups.md#favorites-web-and-desktop) |

## Search

| Feature | CLI | Web | Desktop | Notes |
|---|:-:|:-:|:-:|---|
| Fuzzy full-text search | ✅ | ✅ | ✅ | Meilisearch; [search.md](architecture/search.md) |
| Field filters, like `tag: software` | ✅ | ✅ | ✅ | CLI: `tag`, `title`, `createdOn`. Web and desktop: those plus `description` and `updated` |
| Search engine comes with the app | ❌ | ❌ | ✅ | CLI starts a `meilisearch` you installed. Web needs `pnpm meili` run by hand. Desktop bundles it |

## Viewing a note

| Feature | CLI | Web | Desktop | Notes |
|---|:-:|:-:|:-:|---|
| Markdown preview | ✅ | ✅ | ✅ | |
| Images in notes: paste, and shown in the preview | ❌ | ✅ | ✅ | The CLI shows the Markdown text. [images.md](architecture/images.md) |
| Image size limit | n/a | 10 MB | None | See [Image size limit](#image-size-limit) |
| `<Info>`, `<Warning>`, `<Image>`, `<Toc>` components | ❌ | ✅ | ✅ | [mdx-components.md](ui/mdx-components.md) |
| **Attach any file to a note, listed in a table on the note** | ❌ | 🚫 | ✅ | Desktop only, by design. [attachments.md](architecture/attachments.md) |

## Appearance and settings

| Feature | CLI | Web | Desktop | Notes |
|---|:-:|:-:|:-:|---|
| Color schemes | 3 | 5 | 5 | CLI: dark, light, forest. Web and desktop add cream and "follow the sun" |
| "Follow the sun" scheme | ❌ | ✅ | ✅ | [web-follow-the-sun.md](ui/web-follow-the-sun.md) |
| Resizable columns, remembered | ❌ | ✅ | ✅ | |
| Application data location setting | ✅ | ✅ | ✅ | |
| Developer docs viewer (`/docs`) | ❌ | ✅ | 🚫 | It reads this repo's docs from disk, which an installed app doesn't have |

## Distribution

| | CLI | Web | Desktop |
|---|---|---|---|
| Shipped as | Undecided | Undecided | Manual download from GitHub Releases |
| Platforms | Wherever Python and Textual run | Any browser | macOS only for now |
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

- **Images:** the note's Markdown holds the path. The CLI shows it as text.
- **Attachments:** they live in their own table, never in the note's text, so the CLI and
  web app never rewrite them. The web app shows nothing for them. Moving a note to the Trash
  Can keeps its attachments, so a restored note gets them back; they are deleted when the
  note is permanently deleted (by hand or after 60 days), or at once when the CLI deletes it.
