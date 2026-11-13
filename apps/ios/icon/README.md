# Benchnote app icon (iPad)

`icon.svg` is the source: a note page with one line highlighted, standing on a workbench, in the Cream scheme's colours
(`apps/web/src/app/globals.css`). `build.sh` renders it to the three PNGs of the `AppIcon` set in
`../Composition/Assets.xcassets/AppIcon.appiconset/`:

| File | Appearance | Pixels | How it is made |
|---|---|---|---|
| `AppIcon.png` | Any (also the App Store icon) | 1024 x 1024, sRGB, **no alpha** | `icon.svg` as it is |
| `AppIcon-Dark.png` | Dark | 1024 x 1024, sRGB, **transparent background** | `dark.css` hides the tile and lifts the bench's colour |
| `AppIcon-Tinted.png` | Tinted | 1024 x 1024, Gray Gamma 2.2, no alpha | `tinted.css` swaps in grays chosen by brightness |

```bash
brew install librsvg   # once: rsvg-convert draws the SVG
apps/ios/icon/build.sh
```

`finish-icon.swift` writes the final PNGs and refuses a wrong size, or an Any or Tinted icon with even one translucent pixel.
After changing the art, check with `sips -g pixelWidth -g pixelHeight -g hasAlpha -g profile` on each PNG, and build the app.

## Why it is shaped this way (Apple's pages, read 2026-11-12)

- **One 1024 px square per appearance; the system scales it and rounds the corners.** So the art has square corners and nothing is pre-masked. [HIG, App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons) (Specifications, Icon shape); [Xcode, Configuring your app icon using an asset catalog](https://developer.apple.com/documentation/xcode/configuring-your-app-icon) (Single Size).
- **Colour space:** sRGB, or Gray Gamma 2.2 for grayscale (HIG, Specifications). Display P3 is allowed; not needed for flat brand colours.
- **Alpha:** the Dark icon takes a transparent background and the Tinted icon is grayscale (Xcode asset-catalog page). The Any icon is the App Store icon, and the upload refuses an alpha channel on it (ITMS-90717; not stated on Apple's three pages, seen in [Apple's forum](https://developer.apple.com/forums/thread/795411)).
- **Design:** simple, flat filled shapes, no words (HIG, Design), and no baked-in highlights, shadows, blurs or glows, because the system adds its own (HIG, Visual effects).
- **No Icon Composer `.icon` file, yet.** The HIG recommends one but still supports a bitmap. A `.icon` replaces the asset catalog (Xcode, [Creating your app icon using Icon Composer](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer)), the app's deployment target is iPadOS 17, and `.icon` icons had an alpha-channel upload rejection in Xcode 26 with no fix confirmed in the forum thread above. Nobody can test an upload before M3. The SVG keeps `#background` and `#foreground` as separate groups, and `Composition` is a file-system-synchronized folder, so a `.icon` can be added later without editing `project.pbxproj`.
