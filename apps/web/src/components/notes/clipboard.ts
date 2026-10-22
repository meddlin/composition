/**
 * Copies text to the clipboard. Returns whether it worked. Where there is no clipboard API (or no permission),
 * the browser's own copy command copies what is selected, which is the fallback.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return document.execCommand?.("copy") ?? false;
  }
}
