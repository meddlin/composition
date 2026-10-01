import { FolderIcon as Folder } from "lucide-react";

/** A group's icon, tinted with the scheme's highlight color. Decorative. */
export function FolderIcon() {
  return <Folder aria-hidden strokeWidth={1.5} className="size-3.5 shrink-0 fill-highlight/35 stroke-highlight" />;
}
