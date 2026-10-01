import type { ReactNode } from "react";
import { Panel } from "./Panel";

// A circled "i".
const ICON =
  "M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.5a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM9.25 9.5a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0v-4Z";

/**
 * An info panel, like Confluence's: a tinted callout with an icon, for
 * background a reader should notice but that isn't a warning.
 *
 * Written in a note as `<Info>…</Info>`; Markdown inside it renders normally
 * when the tags sit on their own lines with blank lines around the content.
 */
export function Info({ children }: { children?: ReactNode }) {
  return (
    <Panel tone="info" label="Info" icon={ICON}>
      {children}
    </Panel>
  );
}
