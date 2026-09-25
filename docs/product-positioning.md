# Product Positioning

An explanation of why I'm building this product, and what problems it is solving.

---

## Goal

Composition's goal is an effortless, local-first writing experience that combines Markdown, rich
components, easy attachments, and strong search. Obsidian provides much of the foundation, but I
wanted to improve the component editing, layout, and search experience. Doing all of this via
Obsidian would mean relying on a mixed network of Obsidian plugins.

### Inspiration

OneNote: effortless capture; you can start writing immediately, paste screenshots, attach files,
and organize later.

Confluence/Jira: Structured components and richer layouts, implemented in Composition through MDX,
ideally with visual controls that don't require manually writing JSX.

Obsidian: natural Markdown writing, linked notes and attachments, local ownership, and use without a
mandatory subscription. This is my core study case.

### Comparison

| Area              | Your goal for Composition                                             | What Obsidian provides                                                                   |
| ----------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Writing           | Natural Markdown input with effortless editing                        | Markdown editing with Live Preview                                                       |
| Capture           | Minimal ceremony; immediate local saving                              | Local note creation and attachment insertion; workflow may need customization            |
| Components        | Visually editable callouts, columns, images, and other MDX components | Native Markdown features; richer layouts often need CSS or plugins                       |
| MDX               | Component-based documents with a usable editing experience            | No native full MDX support; community plugins offer editing or preview                   |
| Attachments       | Easy paste/drop, local storage, previews, and linking                 | Local attachments and embeds for supported media; no local storage-plan quota            |
| Search            | Meilisearch-powered typo tolerance and relevance ranking              | Precise text queries, regex, and filters; core results sort by filename or dates         |
| Attachment search | Potential PDF text extraction and OCR feeding Meilisearch             | Requires additional plugins for vault-wide attachment-content search                     |
| Sync              | Optional, ideally self-hosted without a subscription                  | Paid official Sync or alternatives such as community LiveSync                            |
| Maintenance       | You control and maintain the entire application                       | Obsidian maintains the core; you maintain your selected plugins and self-hosted services |


## Release Strategy

Use GitHub releases to host binaries

### MacOS Releases

Need Apple Developer platform for the modern certification and signing.