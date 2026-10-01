import type { ReactNode } from "react";
import { Panel } from "./Panel";

// A triangle with an exclamation mark.
const ICON =
  "M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z";

/**
 * A warning panel, like Confluence's: a gold callout with a triangle icon, for
 * something a reader should be careful about.
 *
 * Written in a note as `<Warning>…</Warning>`, the same way as `<Info>`.
 */
export function Warning({ children }: { children?: ReactNode }) {
  return (
    <Panel tone="warning" label="Warning" icon={ICON}>
      {children}
    </Panel>
  );
}
