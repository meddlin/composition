"use client";

import { useEffect, useState } from "react";

export type Loaded<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error"; message: string };

/**
 * Runs `load` once on mount. The desktop build has no server to render data
 * into the page, so the first paint is always a loading state.
 */
export function useLoaded<T>(load: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    load().then(
      (value) => {
        if (!cancelled) setState({ status: "ready", value });
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // `load` is a module-level function; it never changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
