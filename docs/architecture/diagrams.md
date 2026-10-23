# Diagrams

Source: [`drawio.ts`](../../apps/web/src/lib/composition/drawio.ts),
[`DrawioDialog.tsx`](../../apps/web/src/components/notes/DrawioDialog.tsx),
[`mdx/Drawio.tsx`](../../apps/web/src/components/notes/mdx/Drawio.tsx),
[`mdx/drawioSrc.ts`](../../apps/web/src/components/notes/mdx/drawioSrc.ts),
[`drawio.lock.json`](../../apps/web/drawio.lock.json),
[`fetch-drawio.mjs`](../../apps/web/scripts/fetch-drawio.mjs); on the desktop,
[`drawioHost.ts`](../../apps/desktop/src/main/drawioHost.ts),
[`protocol.ts`](../../apps/desktop/src/main/protocol.ts)

A note can hold a diagram drawn in [draw.io](https://www.drawio.com/), in the web and desktop apps.
The terminal app shows the picture. How a note writes one is in
[mdx-components.md](../ui/mdx-components.md#drawio); this is how it works.

## What is stored

A diagram is **a PNG with the drawing inside it**: draw.io's "PNG with embedded diagram" (`xmlpng`),
which writes the diagram's XML into a `tEXt` chunk named `mxfile`. It is stored exactly like a pasted
image ([images.md](images.md)): a file in `app_data/`, named `<note title>-diagram-<hash>.png`, by the
same `saveImage` call, with the same byte check and size limit. A note refers to it by path:

```
<Drawio src="app_data/trip-plan-diagram-3f9c2a71b0de.png" alt="Diagram" />
```

So nothing in the data model is new. A diagram is backed up, restored, listed on the Images page, and
moved with **Application data location** like any image, and the terminal app draws it with its
image decoder. The picture is also what can be opened again: the editor reads the drawing back out of the
PNG, so there is no second copy of it to keep in step.

- **Twice the size.** It is exported at 2x so text stays sharp, on an opaque white background (a
  transparent diagram would disappear on a dark color scheme). `<Drawio>` draws it at half its pixels
  (`density`, in [`NoteImage`](../../apps/web/src/components/notes/NoteImage.tsx)) unless the tag
  gives a `width`.
- **Not SVG.** SVG is refused on purpose ([images.md](images.md#file-names)): it can carry script.
  PNG needs no new rule. Editable SVG would be crisper and could follow the color scheme, but needs a
  sanitizer on save and `<img>`-only serving first.
- **Saving makes a new file.** A name embeds a hash of the bytes, so an edited diagram is a new file,
  and saving points every `<Drawio>` of that file in *this* note at it (a tag in a code block, an example,
  is left alone). Another note that showed the same file keeps showing the old one. The old file stays in
  `app_data/`, now used by nothing, and is listed under **Not used** on the Images page.

## The editor

The editor is the real draw.io, in an `<iframe>` in a dialog (`DrawioDialog`), driven over
`postMessage` in draw.io's [embed JSON protocol](https://www.drawio.com/doc/faq/embed-mode):

```mermaid
sequenceDiagram
    participant D as DrawioDialog
    participant E as draw.io (iframe)
    participant S as service.saveImage
    D->>E: iframe src = /drawio/index.html?embed=1&proto=json&offline=1…
    E-->>D: init
    D->>E: load (the stored PNG as a data: address, or an empty diagram)
    E-->>D: load
    Note over D: Save diagram is enabled
    D->>E: export (xmlpng, 2x, white)
    E-->>D: export { data: data:image/png;base64,… }
    D->>S: saveImage({ noteId, fileName: "diagram.png", data })
    S-->>D: { name }
    D->>D: onSaved(name): the note is edited
```

- **Messages are trusted only from the editor we opened**: `event.source` must be the iframe's window
  and `event.origin` its origin, or the message is ignored. Messages to it name that origin too.
- **A stored diagram is read before the editor opens**, and checked for the `mxfile` chunk: a picture
  that has no drawing in it is refused with a message, rather than being opened as a picture to draw on.
- **Cancel asks first** when anything was drawn (the editor reports each change as `autosave`), and so
  does Escape. Clicking outside the dialog does nothing. Ctrl/Cmd+S inside the editor saves.
- **It follows the color scheme.** The editor is opened with `dark=1` when the page background is dark.
- The editor's own Save and Exit buttons are hidden, and it is started with `ui=min`.

The options in the editor's address keep it self-contained: `offline=1` and `stealth=1` (nothing is
fetched from draw.io's servers or Google) and `pwa=0` (`offline` also switches on its installable-app
service worker, which cannot register on the desktop app's custom scheme and has no use here). Nothing
is sent to draw.io. Only English is vendored.

## Where the editor comes from

draw.io is vendored, not installed from npm (the `drawio-offline` package on npm is years behind) and
not loaded from `embed.diagrams.net` (notes are local, and the desktop app's CSP allows no network
for scripts). [`drawio.lock.json`](../../apps/web/drawio.lock.json) pins a release by tag **and commit**,
the folders and files of draw.io's `src/main/webapp` to keep (`include`, about 38 MiB of the
110 MiB; the other languages, templates and the Google and OneDrive integrations are left out), and one
digest over those files. `pnpm fetch:drawio` in `apps/web`:

1. returns at once if `public/drawio/` already matches the digest;
2. otherwise downloads GitHub's archive of the commit and unpacks it in a temporary folder;
3. keeps the listed files and draw.io's `LICENSE` (Apache-2.0 asks that it travels), and checks their digest;
4. only then replaces `public/drawio/`. A mismatch writes nothing and fails the run.

The digest is of the files, not of the archive, because GitHub regenerates archives and does not promise
their bytes stay the same. `pnpm fetch:drawio --update v33.0.0` moves the pin to another release
(it resolves the tag to its commit) and rewrites the lock; `--out <dir>` fetches somewhere else.
`public/drawio/` is gitignored, and excluded from ESLint. If a draw.io feature turns out to need a file
that is not kept, it 404s: add its path to `include` and update.

The web app serves `public/drawio/` at `/drawio/`. Without it the dialog opens and stays on
"Loading the editor…". The desktop build fetches it itself (`build-renderer.mjs`), and Next's static
export carries it into `dist/renderer/drawio/`, along with its license, which
`collect-licenses.mjs` adds to the notices.

## On the desktop: its own origin

The editor opens whatever diagram it is given and runs a lot of script, so the desktop app serves it
from **`app://drawio/`**, a different origin from the app's `app://composition`
([`protocol.ts`](../../apps/desktop/src/main/protocol.ts)), and it has its own CSP
([`drawioHost.ts`](../../apps/desktop/src/main/drawioHost.ts)):

- Its scripts must be its own (`script-src 'self'`: no inline, no `eval`), it can fetch only its own
  files (`connect-src 'self'`) and load images only from itself or as data, so even a diagram that
  tried could send nothing out.
- Only the app's own pages may frame it (`frame-ancestors`), and the app's CSP adds `app://drawio`
  to `frame-src`, beside YouTube's player.
- A page on one origin cannot read or script the other. In the packaged app the editor frame has no
  `window.composition` (the bridge is not exposed to it, and the main process answers only to
  `app://composition`; [`origin.ts`](../../apps/desktop/src/main/origin.ts)), and touching its parent
  throws a `SecurityError`. This was checked by running the built app.
- Under `pnpm dev` the editor is read from `apps/web/public/drawio/`, and the dev server's origin may
  frame it too.

## Gaps

- **The web app serves the editor from its own origin**, `/drawio/`, so the iframe's `sandbox` can't
  separate them (a frame with both `allow-scripts` and `allow-same-origin` can escape it, and the
  browser says so in the console). The editor is pinned and checksummed code, but a hostile diagram
  that found a hole in it would run with the web app's privileges. The desktop app does not have this
  problem. Serving `/drawio/` from another host or port would fix it for the web app.
- **Old files are not deleted.** Every save leaves the previous picture in `app_data/` (see above), so a diagram
  edited many times leaves many. There is no delete yet; see [images.md](images.md#gaps).
- **A diagram's text is not searchable.** Its labels are inside the PNG, so the app's search does not find them.
- **One note's edit does not reach another** that shows the same file.
- English only, and only the editor's `ui=min` layout.
- The editor needs the folder fetched: a fresh clone must run `pnpm fetch:drawio` in `apps/web` for the web app
  (the desktop build does it itself).
- The terminal app only draws the picture. It cannot edit one, and a diagram's `width` is ignored.
