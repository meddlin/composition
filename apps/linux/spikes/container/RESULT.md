# S6: versions, what a package carries, and memory

Run 2026-11-07. Scripts: `footprint.sh`, `webkit-footprint.sh`, `peak-rss.py`. The image is `Dockerfile` (Ubuntu 24.04, arm64).

## What each distribution ships

Asked of the package managers in containers (`apt-cache policy`, `dnf repoquery`), not from memory:

| | Ubuntu **24.04**.5 LTS | Ubuntu **26.04**.1 LTS | Fedora **45** |
|---|---|---|---|
| GTK 4 | 4.14.5 | 4.22.4 | 4.24.1 |
| libadwaita | **1.5.0** | 1.9.1 | 1.10.0 |
| WebKitGTK 6.0 | **2.52.6** (security-updated) | 2.52.6 | 2.54.2 |
| GtkSourceView 5 | 5.12.0 | 5.18.0 | 5.22.0 |
| GLib | 2.80.0 | 2.88.0 | 2.90.1 |
| SQLite (system) | 3.45.1 | 3.46.1 | 3.53.4 |
| GNOME Shell / mutter | 46.0 / 46.2 | 50.1 / 50.1 | 51.1 / 51.1 |
| bubblewrap | 0.9.0 | 0.11.1 | 0.13.1 |
| Flatpak | 1.14.6 (**in the archive; not installed by default, unverified**) | 1.16.6 | 1.18.4 |
| libspelling / gspell | 0.2.0 / 1.12.2 | 0.4.9 / 1.14.2 | 0.4.10 / 1.14.5 |
| Ubuntu's own `rustc` | 1.75 (too old for gtk-rs: the app is built with rustup) | 1.93 | n/a |

**The floor is libadwaita 1.5 and GTK 4.14 (Ubuntu 24.04).** Building with the `v1_5` feature of the `libadwaita` crate makes the compiler
refuse anything newer. Ubuntu 26.04 and Fedora 45 are the ceiling to test on: the same binary must not misbehave there.
WebKitGTK is **not** the constraint: 24.04 carries 2.52.6, the same as 26.04.

## What an AppImage or a `.deb` has to carry

Of the spike binary (`footprint.sh`): **146 shared libraries, 232 MB** uncompressed, of which WebKitGTK and JavaScriptCore are **122 MB**
and GTK 4, libadwaita and GtkSourceView 15 MB. The binary is 3.2 MB. WebKitGTK's three helper programs (web, network, GPU process) add no
libraries the binary does not already link. Data a bundle would also carry: Adwaita icons 14 MB, GtkSourceView definitions 2.8 MB, GLib
schemas 0.4 MB, locale 1.6 MB. Meilisearch (decided) adds **121 MB** (linux-aarch64) or **126 MB** (linux-amd64), community build.

- **An AppImage** would carry all of that, about 250 MB before compression and 370 MB with Meilisearch, **and** would have to make WebKitGTK find
  its helper programs (`WEBKIT_EXEC_PATH`) and its sandbox's `bwrap` outside the system paths. That second part is likely to meet
  Ubuntu 24.04's user-namespace restriction (unverified). It is not built. **Decided: no AppImage.**
- **A `.deb`** depends on the system libraries instead: `libgtk-4-1 (>= 4.14)`, `libadwaita-1-0 (>= 1.5)`, `libwebkitgtk-6.0-4`,
  `libgtksourceview-5-0`, which pull the other 140 or so libraries through `apt` (the resolved list is in `footprint.sh`'s output).
  The package itself is then the binary, the preview bundle (616 KB gzipped), the data and Meilisearch.
- **A Flatpak** takes GTK, libadwaita, WebKitGTK and GtkSourceView from the GNOME runtime. Not built; its sandbox and home-folder
  permission are discussed in the design.

## Memory

| What | Resident (RSS) | Proportional (PSS) |
|---|---:|---:|
| The shell, preview **off** (101 notes, a search index, GtkSourceView, libadwaita), GL renderer on llvmpipe | 307 MB | 280 MB |
| the same with `GSK_RENDERER=cairo` | 163 MB | 134 MB |
| **Whole app, preview on** (GL): shell + WebKitWebProcess + WebKitNetworkProcess | 627 MB (double-counts shared pages) | **452 MB** |
| **Whole app, preview on** (Cairo) | 495 MB | **329 MB** |

Container, arm64, software rendering, sandbox off, no Meilisearch. The measured Electron idle on the Mac was 395 MB (different OS and
method, from an earlier session). **No saving is shown.** The honest reading: WebKitGTK's web process costs about what Chromium's renderer
does, and the shell's share depends on the renderer; a real GPU may change the shell's share a great deal. Measure on the VM and the
physical machine before the memory is mentioned to anyone.
