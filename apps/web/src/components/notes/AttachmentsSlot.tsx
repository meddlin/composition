/**
 * Where a note pane shows the note's attached files. Attachments are desktop
 * only, so in the web build this is nothing, and `AttachmentsPanel` is never
 * imported, which keeps it out of the web bundle. The desktop build resolves
 * `AttachmentsSlot.desktop.tsx` instead (next.config.ts).
 */
export function AttachmentsSlot(props: { noteId: number }): null {
  void props;
  return null;
}
