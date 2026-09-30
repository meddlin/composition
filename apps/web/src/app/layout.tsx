import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { SunThemeSync } from "@/components/SunThemeSync";
import { loadSunSchedule } from "@/lib/composition/service";
import { sunThemeAttributes } from "@/lib/composition/sunSchedule";
import { loadWebSettings } from "@/lib/composition/webSettings";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Composition",
  description: "Markdown note-taking",
};

// The color scheme comes from a settings file on local disk, so render per request.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { theme } = loadWebSettings();

  // "Follow the sun" renders at the right point on the ramp up front, so there's
  // no flash of the wrong scheme; SunThemeSync then keeps it moving client-side.
  const sun = await loadSunSchedule();
  const attributes = sun ? sunThemeAttributes(sun.level) : undefined;

  return (
    <html
      lang="en"
      data-theme={theme}
      data-tone={attributes?.tone}
      style={attributes && ({ "--auto-light": attributes.autoLight } as CSSProperties)}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full">
        <SunThemeSync initial={sun} />
        {children}
      </body>
    </html>
  );
}
