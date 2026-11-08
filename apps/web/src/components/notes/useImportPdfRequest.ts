import { useEffect, useEffectEvent } from "react";

/**
 * Runs `onRequest` each time the user picks File > Import PDF… in the desktop app's menu. The menu is the app's, so the page
 * is only told; `onRequest` says where the PDF goes (the group and notebook the sidebar is on) and starts the same import as
 * the sidebar's own button, whose picker the main process opens. A no-op in the web app, which has no menu and no PDFs, and
 * wherever `onRequest` is undefined.
 */
export function useImportPdfRequest(onRequest: (() => void) | undefined): void {
  // Always the latest closure (the sidebar moves between groups and notebooks) without listening again each time.
  const request = useEffectEvent(() => onRequest?.());
  useEffect(() => window.composition?.onImportPdfRequest?.(() => request()), []);
}
