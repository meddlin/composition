import type { CSSProperties } from "react";
import { needsLightText, type TodoBackgroundName, type TodoLook } from "@/lib/composition/todoLook";

/** The lines and dots of each pattern, drawn in `--todo-ink`, which follows the text color. */
const PATTERNS: Record<Exclude<TodoBackgroundName, "notes" | "plain">, Pick<CSSProperties, "backgroundImage" | "backgroundSize">> = {
  grid: {
    backgroundImage:
      "linear-gradient(to right, transparent calc(100% - 1px), var(--todo-ink) 0), linear-gradient(to bottom, transparent calc(100% - 1px), var(--todo-ink) 0)",
    backgroundSize: "1.5rem 1.5rem",
  },
  dots: {
    backgroundImage: "radial-gradient(circle, var(--todo-ink) 0 1px, transparent 1.5px)",
    backgroundSize: "1rem 1rem",
  },
  lines: {
    backgroundImage: "linear-gradient(to bottom, transparent calc(100% - 1px), var(--todo-ink) 0)",
    backgroundSize: "100% 1.75rem",
  },
};

/**
 * What to put on a to-do panel's body to give it its look. "Same as notes" adds nothing but the `note-surface` class, so the
 * notes' own pattern (if one is chosen in Settings) is drawn the same way; the other choices draw their own, whatever Settings says.
 * A chosen color also sets the text color (and the tokens the panel's controls draw their text and outlines with) so what is
 * written on it stays readable under any color scheme.
 */
export function todoLookStyle(look: TodoLook): { className: string; style: CSSProperties } {
  const style: Record<string, string | undefined> = {};
  const className = look.background === "notes" ? "note-surface" : "";

  if (look.color) {
    const text = needsLightText(look.color) ? "#f2f2f2" : "#1f2328";
    style.backgroundColor = look.color;
    style.color = text;
    style.colorScheme = needsLightText(look.color) ? "dark" : "light";
    style["--foreground"] = text;
    style["--muted-foreground"] = `color-mix(in srgb, ${text} 62%, ${look.color})`;
    // The checkbox of a done item is filled with the primary color: the text color on the chosen one keeps it clear.
    style["--primary"] = text;
    style["--primary-foreground"] = look.color;
    style["--muted"] = `color-mix(in srgb, ${text} 10%, transparent)`;
    style["--border"] = `color-mix(in srgb, ${text} 20%, transparent)`;
    style["--input"] = `color-mix(in srgb, ${text} 28%, transparent)`;
  }

  if (look.background !== "notes" && look.background !== "plain") {
    style["--todo-ink"] = "color-mix(in srgb, var(--foreground) 9%, transparent)";
    Object.assign(style, PATTERNS[look.background]);
  }
  return { className, style: style as CSSProperties };
}
