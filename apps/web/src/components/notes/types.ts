export type Note = {
  id: string;
  content: string;
  updatedAt: number;
};

export function noteTitle(note: Note): string {
  const firstLine = note.content.split("\n").find((line) => line.trim() !== "");
  const title = firstLine?.replace(/^#+\s*/, "").trim();
  return title || "Untitled";
}
