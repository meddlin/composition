import { createContext } from "react";

export type SheetEditing = {
  /** Opens the sheet editor on the `<Sheet>` whose tag starts `offset` characters into the note's body. */
  edit: (offset: number) => void;
  /** Opens **Re-import from Excel** on the imported `<Sheet>` whose tag starts `offset` characters into the note's body. */
  reimport: (offset: number) => void;
};

/**
 * What a `<Sheet>` in the preview needs from the editor around it to be edited. Null where nothing can change the
 * note (a preview shown on its own, a note that is read-only), where the sheet is just drawn.
 */
export const SheetEditContext = createContext<SheetEditing | null>(null);
