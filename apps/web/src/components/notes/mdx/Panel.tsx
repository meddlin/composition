import type { ReactNode } from "react";

// Full class names, so Tailwind can see them at build time.
// `brand`, not `primary`: shadcn's `primary` is the inverted foreground, and the scheme's blue is `brand`.
const tones = {
  info: { box: "border-brand/30 bg-brand/10", icon: "text-brand" },
  warning: { box: "border-warning/40 bg-warning/10", icon: "text-warning" },
} as const;

type Props = {
  tone: keyof typeof tones;
  /** The accessible name of the panel, e.g. "Info". */
  label: string;
  /** The `d` of a 20x20 filled SVG path. */
  icon: string;
  children?: ReactNode;
};

/** The layout shared by the Confluence-style panels: a tinted box, an icon, then the content. */
export function Panel({ tone, label, icon, children }: Props) {
  return (
    <div role="note" aria-label={label} className={`my-4 flex gap-3 rounded-md border p-4 ${tones[tone].box}`}>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="currentColor"
        className={`mt-0.5 size-5 shrink-0 ${tones[tone].icon}`}
      >
        <path fillRule="evenodd" d={icon} clipRule="evenodd" />
      </svg>
      {/* Inherits the preview's `prose` styling, so Markdown inside looks like the rest of the note. */}
      <div className="min-w-0 flex-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div>
    </div>
  );
}
