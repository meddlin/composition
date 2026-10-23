import { createContext } from "react";

export type DrawioEditing = {
  /** Opens the draw.io editor on the stored diagram `name` (a file in `app_data/`); saving points the note's `<Drawio>` tags at the new file. */
  edit: (name: string) => void;
};

/**
 * What a `<Drawio>` in the preview needs from the editor around it to be edited. Null where nothing can
 * change the note (a preview shown on its own), where the diagram is just a picture.
 */
export const DrawioEditContext = createContext<DrawioEditing | null>(null);
