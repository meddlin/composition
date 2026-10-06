# MDX components in notes

Source: [`NoteMarkdown.tsx`](../../apps/web/src/components/notes/NoteMarkdown.tsx),
[`mdx/`](../../apps/web/src/components/notes/mdx/) (web and desktop);
[`mdx.ts`](../../apps/cli/src/mdx.ts), [`Preview.tsx`](../../apps/cli/src/components/Preview.tsx) (CLI)

Notes stay `.md` files, but the preview also renders a small set of components (`<Info>`, `<Warning>`, `<Image>`, `<Toc>`) written as
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

## `<Toc>`

A table of contents for the note it is in: its headings as a nested list. It lists whatever
headings the note has when it is drawn, so it follows edits with no upkeep.

```mdx
<Toc />

<Toc maxDepth="3" />
```

`maxDepth` (a string, 1 to 6) stops the list at that heading level; without it, all six are listed.
On the web and desktop each entry links to its heading.

## How it renders

- **Only notes that use a component are parsed as MDX.** Every other note is plain
  Markdown, so a stray `<` or `{` in prose is still fine (MDX rejects both).
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
| `<Image>` | The picture, when `src` is an image stored with the notes (`app_data/…`): see [images.md](../architecture/images.md#in-the-cli). Any other `src` is the same as `![alt](src)`, which shows as its alt text. Nothing without a `src`. |

A few things follow from the terminal drawing Markdown in whole pieces:

- A component can be nested in another (an `<Info>` in an `<Info>`), and a one-line
  `<Info>text</Info>` is a box too.
- Inside a sentence, a list item or a quote, a component can't be a box. An `<Image>` still becomes its
  Markdown form, shown as its alt text, an `<Info>` or `<Warning>` keeps its content without the box, and a `<Toc>` is left out.
- The position in an MDX error counts from the first line below the frontmatter, as on the web.
- The editor does not offer completion for `<` yet; that is web and desktop only.

Every other Markdown stretch in a note is still drawn by OpenTUI's own `<markdown>`, from the note's
own text, so a note without components renders exactly as it did before this existed: it isn't even
parsed as MDX.

## Completion in the editor

Typing `<` in the editor opens a menu at the caret listing the components, like an IDE's
completion. Keep typing to narrow it (`<wa` leaves `<Warning>`), then pick with ArrowUp/ArrowDown and
Enter or Tab, or with the mouse; Escape dismisses it until the next `<`. Picking one inserts
a ready-to-fill tag and puts the caret where you'd type next (between the blank lines of a
callout, inside `src=""` for an image).

It stays out of the way of ordinary text: no menu for `a<b` or `<<`, or inside a fenced code
block. Source: [`mdx/completions.ts`](../../apps/web/src/components/notes/mdx/completions.ts)
(the catalog and trigger rules) and
[`useMdxCompletion.ts`](../../apps/web/src/components/notes/useMdxCompletion.ts).

## Adding a component

1. Write it in `components/notes/mdx/`. `Info` and `Warning` are thin wrappers over `Panel`, which holds the shared layout.
2. Add it to `mdxComponents` in [`components.ts`](../../apps/web/src/components/notes/mdx/components.ts).
   That is the allowlist; the tag name in a note is the key.
3. Add its entry to `catalog` in [`completions.ts`](../../apps/web/src/components/notes/mdx/completions.ts):
   a one-line description and the template to insert (`$0` is where the caret goes). The type
   makes this a compile error to forget.
4. For the CLI, add the name to `MDX_COMPONENTS` in [`mdx.ts`](../../apps/cli/src/mdx.ts) and say how it
   is drawn: in `elementBlocks` (and `replacement`, for where it can't be a block), plus a
   `Block` kind and its drawing in [`Preview.tsx`](../../apps/cli/src/components/Preview.tsx) if it needs
   one. The CLI's tests fail until the two lists match.
