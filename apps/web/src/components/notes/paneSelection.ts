/**
 * The text selected in a note pane: in its editor, or else in its preview. The editor's selection is read
 * from the textarea, which keeps it while another element has focus; the preview's is the page's selection,
 * which a click elsewhere clears, so the AI helper reads it the moment focus moves into its dock.
 */
export function readPaneSelection(section: HTMLElement): string {
  const editor = section.querySelector("textarea");
  if (editor && editor.selectionStart !== editor.selectionEnd) {
    return editor.value.slice(editor.selectionStart, editor.selectionEnd);
  }
  const preview = section.querySelector("[data-note-preview]");
  const selection = window.getSelection();
  if (preview && selection && !selection.isCollapsed && selection.anchorNode && preview.contains(selection.anchorNode)) {
    return selection.toString();
  }
  return "";
}
