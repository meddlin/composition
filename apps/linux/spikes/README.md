# Linux native app: spikes

Throwaway code that answers one question each, for [docs/linux-native-app-design.md](../../../docs/linux-native-app-design.md).
**Nothing here is the app.** It is not part of any workspace, is not built by CI, and `apps/linux/` has no production code until the user
passes Gate A. Dates are 2026-11-07. Rust 1.97.1.

| Spike | Question | Folder | Result |
|---|---|---|---|
| **S1** | Does a GTK-free Rust core share the desktop's schema, uuid pass and backup, and does its SQLite have FTS5? | [`s1-core/`](s1-core/) | [RESULT.md](s1-core/RESULT.md): yes, 12 of 12 tests on three platforms; capture triggers, Trash Can and store scripts not covered |
| **S2** | Can FTS5 plus a typo layer meet the iPad's bar against Meilisearch? | [`s1-core/src/search/`](s1-core/src/search/) | [RESULT-search.md](s1-core/RESULT-search.md): yes. **Not chosen**: the user chose to bundle Meilisearch |
| **S3** | Does a libadwaita app over the core build and run on Ubuntu 24.04? | [`s3-shell/`](s3-shell/) | [RESULT.md](s3-shell/RESULT.md): yes, in a container |
| **S4** | The editor widget: IME, accessibility | `s3-shell/` | same note: GtkSourceView; AT-SPI text interface present; IBus Hangul composes (X11) |
| **S4b** | Can the Live tab's hidden marks be done with `invisible` text tags? | [`s3-shell/src/bin/live_marks.rs`](s3-shell/src/bin/live_marks.rs) | same note: the mechanism works; caret, selection and copy over hidden text not tried |
| **S5** | Can the desktop's own preview run standalone in WebKitGTK? | [`s5-preview/`](s5-preview/) | [RESULT.md](s5-preview/RESULT.md): yes, with the WebKit sandbox disabled in a throwaway container; sandbox-on unverified |
| **S6** | What must a package carry, and what does it cost in memory? | [`container/`](container/) | [RESULT.md](container/RESULT.md): 232 MB of libraries; 329 to 452 MB PSS with the preview on (no saving shown) |

Not done, and needed before the gates: see [What was not verified](../../../docs/linux-native-app-design.md#what-was-not-verified).

## Running them

Everything needs Docker for the GTK parts and nothing else for the core.

```bash
# the image: Ubuntu 24.04, GTK4, libadwaita, WebKitGTK 6.0, GtkSourceView 5, Xvfb, Weston, AT-SPI, IBus, Rust 1.97.1
docker build --platform linux/arm64 -t composition-linux-spike:24.04 apps/linux/spikes/container
```

- **S1, S2** (needs a checkout of the iPad branch for the shared corpus; see `s1-core/run.sh`): `IPAD_TREE=<checkout> apps/linux/spikes/s1-core/run.sh`
- **S5**: `apps/linux/spikes/s5-preview/build.sh` (needs `pnpm --dir apps/web install` first), then `verify.sh <note.md>`
- **S3**: build in the container with `cargo build --release` in `s3-shell/`; run through `container/xvfb-run.sh` (see the commands in
  `s3-shell/RESULT.md`, and `container/*.sh` for the AT-SPI, IME and footprint runs)

## What a container can and cannot show

Worked out by running them, not assumed. The container is Ubuntu 24.04.5 on a Mac with Docker Desktop (arm64 natively; x86-64 only under
emulation, and only the core was run there).

| Can show | How |
|---|---|
| The code builds and runs against Ubuntu 24.04's GTK 4.14.5, libadwaita 1.5.0, WebKitGTK 2.52.6 and GtkSourceView 5.12.0 | `cargo build`, `probe` |
| A libadwaita window drawn by GTK: layout, headerbar, light and dark, GtkSourceView colours | Xvfb with Mesa llvmpipe (`GskGLRenderer`); screenshots drawn by GTK itself with `GtkSnapshot` |
| The Wayland path, a scale-2 output | A headless Weston (pixman), where GTK falls back to `GskCairoRenderer` |
| The accessibility tree the toolkit exports | `pyatspi` over the session's AT-SPI bus |
| An input method composing into the editor | IBus and `ibus-hangul` on X11, typed with `xdotool` |
| WebKitGTK rendering a page | Only with its sandbox disabled (below) |
| Library closure sizes, `Depends` | `ldd`, `dpkg -S` |

| **Cannot** show | Why |
|---|---|
| GNOME Shell, mutter, the dash, notifications, the real titlebar and window controls, the overview | None runs. A headless mutter was **not tried** |
| Whether it *feels* native: motion, input latency, touchpad gestures, fractional scaling on a real output | Software rendering, synthetic input, no real display |
| Orca, braille, speech | No screen reader ran. The tree is checked, not how it is spoken |
| Wayland text-input (IME on GNOME's default), Fcitx 5, Anthy, Pinyin | Only IBus-on-X11 with one engine |
| System fonts, emoji and the user's GNOME theme and accent colour | The container has Noto and Cantarell only; the colour scheme was forced with `AdwStyleManager` |
| **WebKitGTK's sandbox** | `bwrap` is denied user namespaces in an unprivileged container, so the web process cannot start with it on |
| Ubuntu 24.04's AppArmor restriction on user namespaces | Not a property of the container |
| Portals (file chooser, open URI), drag and drop between apps, the clipboard between apps | No portal service, one app |
| `.deb` installation, `apt` dependency resolution, a launcher entry, MIME handling | Not built |
| Real memory and speed (GPU, a real compositor) | llvmpipe inflates the shell by about 125 MB |
| x86-64 behaviour of the GTK parts | Emulated and only the core was run |

**What the user must provide before any UI gate** (decided 2026-11-07): an **Ubuntu 24.04 Desktop VM on this Mac** (arm64, UTM or
Parallels; GNOME on Wayland, real mutter, Orca, IBus, the AppArmor behaviour) for Gate B, and a **physical x86-64 Ubuntu machine** once
before release for the GPU, HiDPI, touchpad and the x86-64 `.deb`.

### The one safety setting that was changed

`WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1` was set for the WebKitGTK screenshots and the memory run, in a throwaway container started
with `--network none`, with the user's explicit approval in chat. The session's auto-mode classifier had refused the first attempt, and
no other route round it was tried. No real notes were used. The core runs and the non-WebKit shell runs did not need it.
