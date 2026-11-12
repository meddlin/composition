import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { ShortcutsHelper } from "@/components/shortcuts/ShortcutsHelper";
import { SunThemeSync } from "@/components/SunThemeSync";
import { initialSunTheme, loadSunHours } from "@/lib/composition/service";
import { editorFontStack } from "@/lib/composition/editorFonts";
import { previewFontStack } from "@/lib/composition/previewFonts";
import { loadWebSettings } from "@/lib/composition/webSettings";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Composition",
  description: "Markdown note-taking",
};

// The color scheme comes from a settings file on local disk, so render per request.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { theme, previewFont, editorFont, noteBackground, sunPair } = loadWebSettings();

  // "Follow the sun" renders at the right point on the fade up front, so there's
  // no flash of the wrong scheme; SunThemeSync then keeps it moving client-side.
  const sun = await loadSunHours();
  const attributes = initialSunTheme();

  return (
    <html
      lang="en"
      data-theme={theme}
      data-note-background={noteBackground}
      data-sun-pair={sunPair}
      data-tone={attributes?.tone}
      style={
        {
          "--preview-font": previewFontStack(previewFont),
          "--editor-font": editorFontStack(editorFont),
          ...(attributes && { "--auto-light": attributes.autoLight }),
        } as CSSProperties
      }
      className={`${fontVariables} h-full antialiased`}
    >
      <body className="h-full">
        <SunThemeSync initial={sun} />
        <ShortcutsHelper>{children}</ShortcutsHelper>
      </body>
    </html>
  );
}
