import type { PanelId } from "./layoutTree";

/**
 * Puts the cursor in a panel: its editor or question box if it has one, else its first control. The store knows which
 * panel is focused, but the cursor is the page's own, and a command that changes the one must move the other, or typing
 * would go to the panel left behind.
 */
export function focusPanelElement(panelId: PanelId): void {
  const panel = document.querySelector<HTMLElement>(`[data-panel-id="${panelId}"]`);
  if (!panel) return;
  const target =
    panel.querySelector<HTMLElement>("textarea:not([disabled])") ??
    panel.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), button:not([disabled])");
  target?.focus();
}
