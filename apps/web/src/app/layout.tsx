import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { ShortcutsHelper } from "@/components/shortcuts/ShortcutsHelper";
import { SunThemeSync } from "@/components/SunThemeSync";
import { loadSunSchedule } from "@/lib/composition/service";
import { editorFontStack } from "@/lib/composition/editorFonts";
import { previewFontStack } from "@/lib/composition/previewFonts";
import { sunThemeAttributes } from "@/lib/composition/sunSchedule";
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
  const { theme, previewFont, editorFont } = loadWebSettings();

  // "Follow the sun" renders at the right point on the ramp up front, so there's
  // no flash of the wrong scheme; SunThemeSync then keeps it moving client-side.
  const sun = await loadSunSchedule();
  const attributes = sun ? sunThemeAttributes(sun.level) : undefined;

  return (
    <html
      lang="en"
      data-theme={theme}
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
