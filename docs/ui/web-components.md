# Web UI components (shadcn/ui)

The web UI is built from [shadcn/ui](https://ui.shadcn.com) components on Tailwind v4. The
desktop app is a static export of the same code, so it gets the same components with nothing
extra to do.

- **Base and preset:** Radix (`radix-ui`), `radix-nova`, Lucide icons. Recorded in
  `apps/web/components.json`.
- **Where:** `apps/web/src/components/ui/` holds the generated components. They are source you
  own and may edit, not a dependency. App code imports `cn` from `@/lib/utils`; the generated
  files import it from the `cn` package directly.
- **Class merging** is the `cn` package (by the shadcn author, a drop-in for clsx and
  tailwind-merge), which is what the CLI wires up.
- **Not bundled in the web app:** the `shadcn` CLI package. Its `tailwind.css` was inlined
  (`shadcn eject`), so a CLI upgrade can't change styles under you.

## Adding a component

```bash
cd apps/web
pnpm dlx shadcn@latest add <name>
```

Then check what it changed:

1. **`globals.css`.** `init` appends shadcn's default grey `:root` and `.dark` tokens, which would
   override the color schemes (the same specificity, later in the file). Delete them if they
   reappear. Only the neutral-to-palette mapping described below should define those tokens.
2. **The desktop license notices.** If the component brings a new runtime package, add it to the
   roots in `apps/desktop/scripts/collect-licenses.mjs`; the list is hard-coded, and a package
   missing from it is missing from the shipped `THIRD_PARTY_NOTICES.txt`.
3. **A missing custom variant or utility.** `globals.css` carries the nine `data-*` variants the
   current components use. shadcn's `tailwind.css` also has accordion keyframes and the
   `no-scrollbar`, `scroll-fade` and `shimmer` utilities, left out because nothing uses them;
   copy over what a new component needs.

## How the color schemes drive the components

`globals.css` keeps the five palettes (dark, light, forest, cream, and the sun blend) as the source
of truth. shadcn's semantic tokens (`--card`, `--primary`, `--muted`, `--border`, `--ring`, ...)
are derived from the palette on `:root`, so every scheme restyles every component and nothing
is duplicated per scheme.

- The look is shadcn's neutral one: the primary action is foreground on background, inverted.
  Hover fills and borders are translucent foreground, so they read on `--background`,
  `--surface` and `--panel` alike.
- **Renamed palette tokens.** Textual's `primary`, `secondary` and `accent` are `--brand`,
  `--brand-dim` and `--highlight`, because shadcn owns those three names. `--brand` tints focus
  rings and the resize handle; `--highlight` colors folder icons.
- `dark:` follows the selected scheme's tone, not the OS setting (the `@custom-variant dark` in
  `globals.css`), so `dark:` classes in generated components work for dark, forest and the
  night half of the sun blend.
- `themes.test.ts` parses `globals.css`, so the palette blocks must keep their shape and the
  `--background`, `--surface` and `--panel` names.

## Things that bit during the migration

- **UI written before the token rename still compiles, but changes color.** `bg-primary` and
  `text-primary` used to be the scheme's blue; they are now the inverted foreground. Merging code
  that predates this (the Info callout in `mdx/Panel.tsx` did) turns it grey with no error, so grep
  new UI for `primary`, `secondary` and `accent` and use `brand` or `highlight` where blue or the
  folder color was meant.
- **Ghost buttons stay filled while `aria-expanded`.** A Radix trigger sets it while open, so the
  group-tree chevron overrides it (`aria-expanded:bg-transparent`).
- **The group menu is non-modal on purpose** (`GroupMenu.tsx`). A modal Radix menu traps focus,
  which pulls the auto-focused rename and sub-group fields back into the closing menu; they blur
  and cancel themselves. Non-modal also matches the old menu: an outside click closes it and goes
  through. After choosing an item it also suppresses Radix's return of focus to the trigger.
  There is a regression test for this in `NotesApp.test.tsx`.
- **Testing Radix in jsdom.** A menu opens on `pointerdown` (button 0), not click; a disabled item
  is `aria-disabled`, not `disabled`; focus moves between items on a timer, so wait a tick. No
  polyfills were needed.
- **Don't use a relative `@import` in `globals.css`.** A cold Turbopack build resolves it against
  the project root in one pass and logs `Can't resolve './x.css'`. The CSS comes out right, but CI
  logs get a misleading error, which is why the variants are inlined rather than imported.
- **The search results list stays hand-written** (`SearchBar.tsx`): it is driven by server results,
  with its own debounce, stale-response guard and keyboard handling. Only its input and popup
  styling moved to shadcn's `Input` and tokens.
