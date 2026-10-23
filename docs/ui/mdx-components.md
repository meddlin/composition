# MDX components in notes

Source: [`NoteMarkdown.tsx`](../../apps/web/src/components/notes/NoteMarkdown.tsx),
[`mdx/`](../../apps/web/src/components/notes/mdx/) (web and desktop);
[`mdx.ts`](../../apps/cli/src/mdx.ts), [`Preview.tsx`](../../apps/cli/src/components/Preview.tsx) (CLI)

Notes stay `.md` files, but the preview also renders a small set of components (`<Info>`, `<Warning>`, `<Image>`, `<Drawio>`, `<Toc>`, `<Mark>`, `<Footnotes>`, `<YouTube>`, `<Repo>`) written as
JSX tags. They work the same in the web and desktop apps, since both run the same renderer, and the
CLI draws them in the terminal too (see [In the CLI](#in-the-cli)). Writing them is the same
everywhere.

## `<Info>`

An info panel, like Confluence's: a tinted callout with an icon. Put the tags on their own
lines, with blank lines around the content, and Markdown inside renders normally:

```mdx
<Info>

Staging resets **nightly**. See the [runbook](https://example.com).

- back up first
- then deploy

</Info>
```

It takes no props. Its colors come from the active theme's `--primary`.

## `<Warning>`

A warning panel, like Confluence's: the same layout as `<Info>`, but gold with a triangle
icon, for something a reader should be careful about. It is written the same way:

```mdx
<Warning>

This **deletes** every note in the group.

</Warning>
```

Its colors come from the active theme's `--warning`.

## `<Image>`

An image, as a tag instead of Markdown's `![alt](src)`. Both render the same way, and pasting an
image into the editor inserts the Markdown form:

```mdx
<Image src="app_data/trip-plan-route-map-3f9c2a71b0de.png" alt="Route map" />
```

`src` and `alt` are plain strings (an `{expression}` is rejected, like for any component).
See [images.md](../architecture/images.md) for where pasted images live and how `app_data/` paths resolve.

### Resizing: `width`

Markdown's `![alt](src)` has nowhere to say how big to draw an image; the tag does:

```mdx
<Image src="app_data/trip-plan-route-map-3f9c2a71b0de.png" alt="Route map" width="50%" />

<Image src="app_data/trip-plan-route-map-3f9c2a71b0de.png" alt="Route map" width="400" />
```

- `width="400"` (or `"400px"`) is pixels; `width="50%"` is a share of the note's width. The height
  follows, keeping the proportions.
- An image is never drawn wider than the note, so `width="4000"` and `width="100%"` look the same on a
  narrow pane. Over `100%` counts as `100%`.
- A width that can't be read (`width="wide"`, `0`, `-5`) is ignored and the image stays at full size,
  so a half-typed value doesn't make it vanish.
- This only changes how the picture is drawn. The file in `app_data/` is untouched and still
  downloads, backs up and loads at its full size. The terminal app ignores `width`.

Source: [`mdx/imageWidth.ts`](../../apps/web/src/components/notes/mdx/imageWidth.ts).

### Turning a pasted image into an `<Image>`

Pasting inserts Markdown, which is the right default: a note with no component in it is plain
Markdown, and a stray `<` or `{` in its prose is fine. A note that uses a component is parsed as MDX,
where those are errors. So the tag is opt-in, one image at a time:

Press **Cmd+Shift+X** (macOS) or **Ctrl+Shift+X** in the editor with the caret on a Markdown
image, or with a selection that touches one or more, and each becomes an `<Image />` tag with the
same `src`, `alt` and `title`. The caret lands at the end of the tag's last prop, so a space
opens the prop menu (below) and `width` is two keystrokes away. It goes in as typing does, so
undo takes it back in one step. If there is no image at the caret, the editor says so and changes nothing.

Code is left alone: an image inside a fenced block or a backtick span is text, not an image.
The shortcut only goes one way; to go back, retype the Markdown form. Source:
[`mdx/imageToMdx.ts`](../../apps/web/src/components/notes/mdx/imageToMdx.ts).

## `<Drawio>`

A diagram drawn in [draw.io](https://www.drawio.com/), shown in the note as a picture and opened again from it
to change. Web and desktop only; the terminal shows the picture.

```mdx
<Drawio src="app_data/trip-plan-diagram-3f9c2a71b0de.png" alt="Request flow" />

<Drawio src="app_data/trip-plan-diagram-3f9c2a71b0de.png" alt="Request flow" width="60%" />
```

- **Drawing one.** The **Diagram** button in a note's header, or **Cmd+Shift+D** (macOS) / **Ctrl+Shift+D**
  in the editor, opens the draw.io editor in a dialog. **Save diagram** stores it and puts the tag in the
  note at the caret, as a paragraph of its own (the end of the note if the caret was never placed, never in the
  frontmatter). With a selection, the diagram replaces it. Cancelling asks first if anything was drawn.
- **Changing one.** In the preview, hovering over the picture shows an **Edit diagram** button. It opens the
  editor on the stored drawing, and saving points every `<Drawio>` of that diagram in the note at the new file.
- `src`, `alt`, `title` and `width` are as for [`<Image>`](#image), and so is the editor's completion for them.
  `src` has to be a diagram stored with the notes (`app_data/…`) to be editable; one from a web address is
  just shown, with no Edit button.
- A diagram is drawn at half the pixels it is stored with (it is saved at 2x so text stays sharp), unless
  `width` says how wide.
- The file is an ordinary stored image, a PNG with the drawing inside it, so it is also on the Images page and in
  backups. How it works, and what it cannot do yet: [diagrams.md](../architecture/diagrams.md).
- The editor is vendored (`pnpm fetch:drawio` in `apps/web`; the desktop build does it) and works offline.

Source: [`mdx/Drawio.tsx`](../../apps/web/src/components/notes/mdx/Drawio.tsx),
[`DrawioDialog.tsx`](../../apps/web/src/components/notes/DrawioDialog.tsx) and
[`mdx/drawioSrc.ts`](../../apps/web/src/components/notes/mdx/drawioSrc.ts), which writes and rewrites the tag.

## `<Toc>`

A table of contents for the note it is in: its headings as a nested list. It lists whatever
headings the note has when it is drawn, so it follows edits with no upkeep.

```mdx
<Toc />

<Toc maxDepth="3" />
```

`maxDepth` (a string, 1 to 6) stops the list at that heading level; without it, all six are listed.
On the web and desktop each entry links to its heading.

## `<Mark>`

Highlighted text, like a highlighter pen. It is inline, so it sits inside a sentence, and Markdown
inside it renders normally:

```mdx
Staging resets <Mark color="green">every night</Mark>, so **back up <Mark color="yellow">first</Mark>**.
```

`color` is `yellow`, `green`, `blue`, `pink` or `orange`; a missing or unknown one is yellow. The
names are the same everywhere and each color scheme tints them to suit its own background, so a
note reads in all of them. See [text-highlighting.md](text-highlighting.md) for how highlights
are made and removed.

## Footnotes

For a well-researched note with many links and references: cite a footnote with `[^label]` where it
belongs, and write its text on a line of its own anywhere in the note with `[^label]: text`.

```mdx
Staging resets nightly[^runbook], and the cron job is documented elsewhere[^cron].

[^runbook]: [Staging runbook](https://example.com/runbook), section 3.
[^cron]: See the [scheduler docs](https://example.com/cron) and the _ops_ channel.

<Footnotes />
```

- **The number is where it is cited, not the label.** Citations are numbered 1, 2, 3… in the order they
  appear in the note, whatever they are called, so a footnote added between two existing ones takes its
  place and the later ones renumber on their own. Nothing in the note's text is rewritten. Use any label
  you like (`[^1]`, `[^runbook]`); it only has to match its definition.
- **Where the list goes.** A note with footnotes lists them at the end, with a ↩ link from each back to
  where it is cited. `<Footnotes />` puts the list where the tag is instead (the last line, usually), and
  says "No footnotes yet." when there are none. It takes no props, and a second tag is left empty.
  Footnotes work in a note that uses no other component, too: they are Markdown (GFM) first, and the
  tag is for placing the list.
- **Links.** On the web and desktop, clicking a citation scrolls to its footnote and ↩ scrolls back; neither
  changes the address, and two notes open side by side never scroll each other.
- A citation with no definition stays as typed (`[^x]`), and a definition nobody cites is not listed.

Source: [`mdx/Footnotes.tsx`](../../apps/web/src/components/notes/mdx/Footnotes.tsx) and
[`mdx/rehypeFootnotes.ts`](../../apps/web/src/components/notes/mdx/rehypeFootnotes.ts), which moves the list to the tag.

## `<YouTube>`

A YouTube video you can watch in the preview, without leaving the note:

```mdx
<YouTube url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />

<YouTube url="https://youtu.be/dQw4w9WgXcQ?t=90" title="Demo of the release" />

<YouTube url="dQw4w9WgXcQ" start="1:30" />
```

- `url` is whatever you'd copy from YouTube: a watch link, a `youtu.be` link, an embed, shorts or live
  link, or just the 11-character video id.
- `start` begins playback part-way in: seconds (`90`), `1:30`, `1:02:03` or `1m30s`. It wins over a
  start time in the link (`?t=90`), which is used otherwise. One that can't be read plays from the start.
- `title` names the player for screen readers; it defaults to "YouTube video".
- The player is YouTube's privacy-enhanced one (`youtube-nocookie.com`), which sets no cookies until
  you press play, and is drawn full width at 16:9. Only the video id is read from `url`; the frame's
  address is built from it, so a note can't point the player anywhere but a YouTube video.
- A `url` that isn't a YouTube video (or isn't there yet, while typing) shows a short notice in place of
  the player, so the rest of the note stays put. A playlist or channel link has no single video, so it is the same.
- It needs the network to play. In the desktop app, the CSP's `frame-src` allows exactly that one
  host, and [`embedReferer.ts`](../../apps/desktop/src/main/embedReferer.ts) gives the player a
  referrer, since YouTube refuses to play for a page that sends none (the app's own `app://` pages
  never do).
- The terminal can't play video, so it shows a link to the video, `▶ title`, in its place.

Source: [`mdx/YouTube.tsx`](../../apps/web/src/components/notes/mdx/YouTube.tsx) and
[`mdx/youtubeRef.ts`](../../apps/web/src/components/notes/mdx/youtubeRef.ts), which reads the link
(and is shared with the terminal app).

## `<Repo>`

A git repository as a small card that opens it, instead of a bare URL:

```mdx
<Repo url="https://github.com/meddlin/composition" />

<Repo url="https://gitlab.com/gitlab-org/gitlab" description="The DevSecOps platform" />

<Repo url="git@git.example.com:team/tool.git" />
```

- `url` is whatever you'd copy: the repository's page (a link into it, like `…/tree/main/docs`, is
  cut back to the repository), a clone address (`…/repo.git`, `git@host:owner/repo.git`,
  `ssh://…`), with or without `https://`.
- `description` says what the repository is for; it is shown under the name.
- The card shows `owner/name`, with the host under it (named, for GitHub, GitLab, Bitbucket,
  Codeberg and SourceHut), and opens the repository in the browser. GitLab's nested groups
  (`group/subgroup/repo`) are kept whole. Any other host works too, when its addresses look like
  `host/owner/repo`.
- Nothing is fetched. The card is drawn from the address alone, so it works offline, makes no
  request on its own and shows no stars or language; `description` is where to say what it is.
- The link is built from the host and path that were read (`https://host/owner/name`), never taken
  as written, so a login, a query string or a script address in `url` is dropped.
- A `url` that isn't a repository (or isn't there yet, while typing) shows a short notice in place of
  the card.
- The terminal shows a link to it, `⎇ owner/name`, with the description after it.

Source: [`mdx/Repo.tsx`](../../apps/web/src/components/notes/mdx/Repo.tsx) and
[`mdx/repoRef.ts`](../../apps/web/src/components/notes/mdx/repoRef.ts), which reads the address
(and is shared with the terminal app).

## How it renders

- **Only notes that use a component are parsed as MDX.** Every other note is plain
  Markdown, so a stray `<` or `{` in prose is still fine (MDX rejects both).
- **Indented code is still code.** MDX switches that Markdown syntax off, so the preview turns it
  back on after `remark-mdx` ([`remarkIndentedCode`](../../apps/web/src/components/notes/mdx/remarkIndentedCode.ts),
  also used by the terminal app). HTML and autolinks stay off.
- **Nothing is evaluated.** The preview parses with `remark-mdx` and renders through
  react-markdown, rather than compiling the note to JavaScript with `@mdx-js/mdx`. The
  desktop CSP has no `unsafe-eval`, and a note shouldn't be able to run code anyway.
  So `{expressions}`, `prop={value}`, `import`/`export`, fragments and any tag that isn't in
  the allowlist are rejected.
- **Invalid MDX never blanks the preview.** A note is invalid MDX while a tag is half-typed,
  so the preview shows what is wrong (with its position when MDX reports one) above a plain
  Markdown render of the note, and recovers as soon as the note is valid.

In `next dev`, React also logs that failure and Next shows its "Issue" badge. Production
builds don't.

## In the CLI

The preview in the terminal accepts exactly what the web preview accepts, with the same error
messages, because it parses with the same plugins (`remark-mdx`, then the web's
[`remarkRestrictMdx`](../../apps/web/src/components/notes/mdx/remarkRestrictMdx.ts) and
[`remarkHeadings`](../../apps/web/src/components/notes/mdx/remarkHeadings.ts), imported through
[`backend.ts`](../../apps/cli/src/backend.ts)). What differs is how a component is drawn:

| Component | In the terminal |
|---|---|
| `<Info>` | A rounded box in the color scheme's primary color, titled `Info`, with a tinted background, and the content rendered as Markdown inside. |
| `<Warning>` | The same, in the scheme's warning color, titled `Warning`. |
| `<Toc>` | A box titled `Contents` listing the headings, indented by nesting and cut off at `maxDepth`. It isn't clickable, and follows the note as it is edited. |
| `<Mark>` | Its text, without the tags. The terminal draws a stretch of Markdown as one piece, so it has no way to tint a few words of it yet. |
| `<Footnotes>`, and the list at the end of a note without it | A box titled `Footnotes`, one numbered line per footnote; a link keeps its address in brackets after its words. Citations in the text are superscript digits (`¹`), since `[1]` would be read as a link. The definitions are not left where they were written. |
| `<YouTube>` | A link to the video on youtube.com, `▶ title`, since a terminal can't play it. A `url` that isn't a YouTube video is said so in words. |
| `<Repo>` | A link to the repository, `⎇ owner/name`, with the description after it. A `url` that isn't a repository is said so in words. |
| `<Image>` | The picture, when `src` is an image stored with the notes (`app_data/…`): see [images.md](../architecture/images.md#in-the-cli). Any other `src` is the same as `![alt](src)`, which shows as its alt text. Nothing without a `src`. |
| `<Drawio>` | The same as `<Image>`: the diagram's picture, which is a PNG. The terminal has no editor, so it cannot change one. |

A few things follow from the terminal drawing Markdown in whole pieces:

- A component can be nested in another (an `<Info>` in an `<Info>`), and a one-line
  `<Info>text</Info>` is a box too.
- Inside a sentence, a list item or a quote, a component can't be a box. An `<Image>` still becomes its
  Markdown form, shown as its alt text, an `<Info>` or `<Warning>` keeps its content without the box, a `<Mark>` is always just its content, and a `<Toc>` is left out.
- The position in an MDX error counts from the first line below the frontmatter, as on the web.
- The editor's completion (below) is web and desktop only.

Every other Markdown stretch in a note is still drawn by OpenTUI's own `<markdown>`, from the note's
own text, so a note without components renders exactly as it did before this existed: it isn't even
parsed as MDX.

## Completion in the editor

**Components.** Typing `<` in the editor opens a menu at the caret listing the components, like an
IDE's completion. Keep typing to narrow it (`<wa` leaves `<Warning>`), then pick with
ArrowUp/ArrowDown and Enter or Tab, or with the mouse; Escape dismisses it until the next `<`. Picking
one inserts a ready-to-fill tag and puts the caret where you'd type next (between the blank lines of a
callout, inside `src=""` for an image).

**Props.** Inside a component's open tag, a space opens a menu of the props the tag doesn't have
yet, each with a one-line description. Typing narrows it (`<Image wi` leaves `width`). Picking
one writes `width=""` with the caret between the quotes, and that opens the next menu: the values
worth trying for that prop.

| Component | Prop | Values offered |
|---|---|---|
| `<Image>`, `<Drawio>` | `src`, `alt`, `title` | none (free text) |
| `<Image>`, `<Drawio>` | `width` | `25%` `50%` `75%` `100%` `200` `400` `600` `800` |
| `<Mark>` | `color` | the five highlight colors |
| `<Toc>` | `maxDepth` | `1` to `6` |
| `<YouTube>` | `url`, `title` | none (free text) |
| `<YouTube>` | `start` | `30` `1:00` `5:00` |
| `<Repo>` | `url`, `description` | none (free text) |

A value menu closes when nothing matches what's typed, since `width="320"` is as good as any
preset. Picking a value replaces what was typed, closing quote included, and puts the caret past
the quote. Components that take no props (`<Info>`, `<Warning>`, `<Footnotes>`) never open a prop menu.

It stays out of the way of ordinary text: no menu for `a<b` or `<<`, inside a fenced code block, hard
against a tag's name or a closing quote, after the tag has closed, or past a blank line (MDX can't
carry a tag across one, so the editor doesn't either). A value is read as ending on its own line.
Source: [`mdx/completions.ts`](../../apps/web/src/components/notes/mdx/completions.ts) (the component catalog and
`<` trigger), [`mdx/props.ts`](../../apps/web/src/components/notes/mdx/props.ts) (the prop catalog and where the
caret is in a tag) and [`useMdxCompletion.ts`](../../apps/web/src/components/notes/useMdxCompletion.ts).

## Adding a component

1. Write it in `components/notes/mdx/`. `Info` and `Warning` are thin wrappers over `Panel`, which holds the shared layout.
2. Add it to `mdxComponents` in [`components.ts`](../../apps/web/src/components/notes/mdx/components.ts).
   That is the allowlist; the tag name in a note is the key.
3. Add its entry to `catalog` in [`completions.ts`](../../apps/web/src/components/notes/mdx/completions.ts):
   a one-line description and the template to insert (`$0` is where the caret goes). The type
   makes this a compile error to forget.
   Then add the props it takes to `catalog` in [`props.ts`](../../apps/web/src/components/notes/mdx/props.ts) (an
   empty list if none), with `values` for any worth suggesting. Also a compile error to forget.
4. For the CLI, add the name to `MDX_COMPONENTS` in [`mdx.ts`](../../apps/cli/src/mdx.ts) and say how it
   is drawn: in `elementBlocks` (and `replacement`, for where it can't be a block), plus a
   `Block` kind and its drawing in [`Preview.tsx`](../../apps/cli/src/components/Preview.tsx) if it needs
   one. The CLI's tests fail until the two lists match.
