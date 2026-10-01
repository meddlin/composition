# MDX components in notes

Source: [`NoteMarkdown.tsx`](../../apps/web/src/components/notes/NoteMarkdown.tsx),
[`mdx/`](../../apps/web/src/components/notes/mdx/)

Notes stay `.md` files, but the preview also renders a small set of components (`<Info>`, `<Warning>`, `<Image>`) written as
JSX tags. They work the same in the web and desktop apps, since both run the same renderer.

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

## Adding a component

1. Write it in `components/notes/mdx/`. `Info` and `Warning` are thin wrappers over `Panel`, which holds the shared layout.
2. Add it to `mdxComponents` in [`components.ts`](../../apps/web/src/components/notes/mdx/components.ts).
   That is the allowlist; the tag name in a note is the key.
