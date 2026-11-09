# Build-and-run environment for the Linux spikes: Ubuntu 24.04, the same release the Electron .deb was smoke-tested on.
# Native arm64 on an Apple-silicon Mac (fast); pass --platform linux/amd64 to run the same file under emulation for x86-64.
# Not a product image. See apps/linux/spikes/README.md.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    RUSTUP_HOME=/opt/rustup \
    CARGO_HOME=/opt/cargo \
    PATH=/opt/cargo/bin:$PATH

# GTK4, libadwaita, WebKitGTK 6.0 and GtkSourceView 5 as Ubuntu 24.04 ships them (the floor the design targets).
# The rest is a virtual desktop to run them in: Xvfb for X11, weston and mutter for headless Wayland, an AT-SPI bus
# and python bindings to read the accessibility tree, IBus to drive an input method, fonts, and bubblewrap
# (WebKitGTK's sandbox).
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config curl ca-certificates git file less procps psmisc sqlite3 \
      libgtk-4-dev libadwaita-1-dev libwebkitgtk-6.0-dev libgtksourceview-5-dev libsqlite3-dev libglib2.0-dev \
      gir1.2-gtk-4.0 gir1.2-adw-1 gir1.2-webkit-6.0 gir1.2-gtksource-5 gobject-introspection python3 python3-gi \
      xvfb xauth xdotool x11-utils x11-xserver-utils imagemagick \
      dbus dbus-x11 at-spi2-core gir1.2-atspi-2.0 python3-pyatspi \
      weston mutter \
      ibus ibus-gtk4 ibus-hangul im-config \
      bubblewrap flatpak \
      libgl1-mesa-dri mesa-vulkan-drivers libegl1 libgles2 \
      fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji fonts-cantarell adwaita-icon-theme gnome-themes-extra \
      shared-mime-info libglib2.0-bin \
    && rm -rf /var/lib/apt/lists/*

# Ubuntu's own rustc is 1.75, too old for current gtk-rs. The host's toolchain version, from rustup.
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --default-toolchain 1.97.1 --profile minimal \
    && chmod -R a+rwX /opt/rustup /opt/cargo

WORKDIR /work
