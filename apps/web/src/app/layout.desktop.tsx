import type { Metadata } from "next";
import { AppearanceSync } from "@/components/desktop/AppearanceSync";
import { ShortcutsHelper } from "@/components/shortcuts/ShortcutsHelper";
import { SunThemeSync } from "@/components/SunThemeSync";
import { EDITOR_FONT_CHOICES } from "@/lib/composition/editorFonts";
import { PREVIEW_FONT_CHOICES } from "@/lib/composition/previewFonts";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Composition",
  description: "Markdown note-taking",
};

// There's no server to read the settings file, so the color scheme comes from
// a snapshot Electron's preload script puts on `window.composition` before the
// page runs. Setting it here, synchronously in <head>, avoids a flash of the
// wrong theme; the stylesheet's default is dark, so a missing value is safe.
// The window's see-through look is one more attribute (`data-translucent`, see globals.css).
// "Follow the sun" also needs its starting tone and blend, which the snapshot
// carries as `sun` (SunThemeSync takes over once the page is running). The preview and editor
// fonts, and the note background, are applied the same way; without them the preview inherits the interface font and the
// editor falls back to Geist Mono (see globals.css).
const PREVIEW_FONT_STACKS = JSON.stringify(
  Object.fromEntries(PREVIEW_FONT_CHOICES.map(({ name, stack }) => [name, stack])),
);
const EDITOR_FONT_STACKS = JSON.stringify(
  Object.fromEntries(EDITOR_FONT_CHOICES.map(({ name, stack }) => [name, stack])),
);
const APPLY_THEME = `try{var i=(window.composition||{}).initial||{},r=document.documentElement,f=${PREVIEW_FONT_STACKS}[i.previewFont],e=${EDITOR_FONT_STACKS}[i.editorFont];r.dataset.theme=i.theme||"dark";r.dataset.noteBackground=i.noteBackground||"plain";if(i.translucent)r.dataset.translucent="";if(typeof i.opacity==="number")r.style.setProperty("--glass-alpha",String(Math.round(i.opacity*100)));if(f)r.style.setProperty("--preview-font",f);if(e)r.style.setProperty("--editor-font",e);if(i.sun){r.dataset.tone=i.sun.tone;r.style.setProperty("--auto-light",i.sun.autoLight)}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontVariables} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPLY_THEME }} />
      </head>
      <body className="h-full">
        <AppearanceSync />
        <SunThemeSync />
        <ShortcutsHelper>{children}</ShortcutsHelper>
      </body>
    </html>
  );
}
