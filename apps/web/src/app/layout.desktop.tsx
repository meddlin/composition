import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SunThemeSync } from "@/components/SunThemeSync";
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

// There's no server to read the settings file, so the color scheme comes from
// a snapshot Electron's preload script puts on `window.composition` before the
// page runs. Setting it here, synchronously in <head>, avoids a flash of the
// wrong theme; the stylesheet's default is dark, so a missing value is safe.
// "Follow the sun" also needs its starting tone and blend, which the snapshot
// carries as `sun` (SunThemeSync takes over once the page is running).
const APPLY_THEME = `try{var i=(window.composition||{}).initial||{},r=document.documentElement;r.dataset.theme=i.theme||"dark";if(i.sun){r.dataset.tone=i.sun.tone;r.style.setProperty("--auto-light",i.sun.autoLight)}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPLY_THEME }} />
      </head>
      <body className="h-full">
        <SunThemeSync />
        {children}
      </body>
    </html>
  );
}
