# Linking to other notes

Source: [`noteRefs.ts`](../../apps/web/src/lib/composition/noteRefs.ts),
[`noteLinks.ts`](../../apps/web/src/components/notes/noteLinks.ts),
[`useNoteLinkPicker.ts`](../../apps/web/src/components/notes/useNoteLinkPicker.ts),
[`NoteLinkMenu.tsx`](../../apps/web/src/components/notes/NoteLinkMenu.tsx),
[`NoteLink.tsx`](../../apps/web/src/components/notes/NoteLink.tsx) (web and desktop; the CLI can't do this yet)

A note can link to another note. The link is ordinary Markdown whose target is `note:<id>`:

```md
See the [release checklist](note:42).
```

The id, not the title, is what the link follows. Titles aren't unique and can be renamed; an id
never repeats and never changes, and a note restored from the Trash Can keeps its id. So renaming
a note never breaks a link to it. The words in the brackets are just text and don't follow a
rename.

## Writing a link

Two ways, both ending in the same picker: a list of notes, filtered by title, at the caret.

- **Type `[[`.** The notes whose title contains what follows appear; keep typing to narrow them.
  Nothing is offered inside a fenced code block, or once the `[[` has been closed or broken by a
  `]` or a line break.
- **Press `Cmd+Shift+K` (macOS) or `Ctrl+Shift+K`** in the editor. With words selected, they become
  the link's text (`read the checklist` → `read the [checklist](note:42)`); without, the note's
  title is used. What you type to filter is shown in the menu, not put in the note.

In the picker, `↑` `↓` move, `Enter` or `Tab` insert the link, `Esc` closes it (the shortcut again
does too), and clicking a note works as well. The note being edited isn't listed. Starting from the
shortcut and `Esc` leave the text exactly as it was; after `[[` they leave the `[[` you typed.

### Why this shortcut

`Cmd/Ctrl+K` is search, and `Cmd/Ctrl+L` is the browser's address bar. `Cmd/Ctrl+Shift+K` sits
next to search, and the desktop app has no browser to compete with. The one clash known in the web
app is Firefox on Windows and Linux, which opens its web console with `Ctrl+Shift+K`. The editor
cancels the keystroke, as the search shortcut already does for Firefox's `Ctrl+K`, but this hasn't
been tried in Firefox; if it ever refuses to hand the key over, `[[` does the same thing. The editor
announces the shortcut with `aria-keyshortcuts`.

## Following a link

In the preview a note link is a link. Clicking it opens the note **in the pane the link is in**
(or focuses the pane if that note is already open). `Cmd/Ctrl`-click opens it **beside** that pane
instead. A link to a note that has been deleted for good is shown struck through and does nothing;
one to a note in the Trash Can counts as deleted until it's restored.

## Linking to a PDF

A note can cite a PDF, a page of it, or a mark you made on it, with a link whose target is `pdf:<id>`, in the desktop app:

```md
[*Designing Data*, p. 42](pdf:3f9c2a71b0de4c1e8a2d5b6f7e8d9c0a#p=44&a=7b1d…)
```

You do not type these: the PDF reader's **Quote** and **Cite this page** write them into the note beside it ([pdf.md](pdf.md#notes-and-citations)).
`p` is the physical page and `a` the mark; both are optional. Clicking one in the preview shows that page in the PDF's panel and flashes the mark
(**Cmd/Ctrl**-click makes no difference to it); the editor and the Live tab draw it like any other link. A link whose PDF is not on this device, or is in
the Trash Can, is shown struck through ("PDF not on this device") and does nothing, as a link to a deleted note does; the web app, which has no PDFs,
shows every one that way. The PDF is named by an id that never changes, so renaming it breaks nothing. Source:
[`pdfRefs.ts`](../../apps/web/src/lib/composition/pdfRefs.ts), [`NoteLink.tsx`](../../apps/web/src/components/notes/NoteLink.tsx).

## Good to know

- react-markdown removes the target of any link with a scheme it doesn't know, so the preview lets
  `note:<id>` through (`noteUrlTransform`) and keeps dropping unsafe ones such as `javascript:`.
- The link is plain text in the note, so it's found by searching for `](note:42)`. Nothing in the
  database records links yet, so there is no "linked from" list.
- `pdf:` links are let through the same way (`noteUrlTransform`); unsafe schemes are still dropped.
- The CLI doesn't know about note links yet: the Markdown stays in the note, but it can't insert or
  follow one.
