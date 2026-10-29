/** Puts the window's fill opacity on a document as the percentage the stylesheet reads (`--glass-alpha`, see globals.css). */
export function applyWindowOpacity(root: HTMLElement, opacity: number): void {
  root.style.setProperty("--glass-alpha", String(Math.round(opacity * 100)));
}
