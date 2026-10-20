import { Atkinson_Hyperlegible_Next, Geist, Geist_Mono, Inter, Literata, Lora, Source_Serif_4 } from "next/font/google";

/**
 * The fonts both root layouts (web and desktop) load. next/font downloads them while the app
 * is built and serves them from the app itself, so nothing is fetched at runtime.
 *
 * Geist is the interface font and the preview's default. The others are the preview fonts
 * offered in Settings (lib/composition/previewFonts.ts, which names these variables). They
 * aren't preloaded: the browser fetches a family only once something is shown in it.
 * All of them are open source (SIL Open Font License 1.1).
 */

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// next/font reads these options at build time, so they have to be literals: no shared object to spread.
const inter = Inter({
  variable: "--font-preview-inter",
  subsets: ["latin"],
  style: ["normal", "italic"],
  preload: false,
});
const atkinson = Atkinson_Hyperlegible_Next({
  variable: "--font-preview-atkinson",
  subsets: ["latin"],
  style: ["normal", "italic"],
  preload: false,
});
const sourceSerif = Source_Serif_4({
  variable: "--font-preview-source-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
  preload: false,
});
const lora = Lora({
  variable: "--font-preview-lora",
  subsets: ["latin"],
  style: ["normal", "italic"],
  preload: false,
});
const literata = Literata({
  variable: "--font-preview-literata",
  subsets: ["latin"],
  style: ["normal", "italic"],
  preload: false,
});

/** Class names that define every font's CSS variable; put them on <html>. */
export const fontVariables = [geistSans, geistMono, inter, atkinson, sourceSerif, lora, literata]
  .map((font) => font.variable)
  .join(" ");
