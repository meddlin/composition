import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  const { theme } = loadWebSettings();
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full">{children}</body>
    </html>
  );
}
