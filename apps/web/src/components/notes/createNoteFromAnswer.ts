import { titleFromAnswer } from "@/lib/composition/assistant/title";
import * as frontmatter from "@/lib/composition/frontmatter";
import type { Note } from "./types";

type Api = {
  createNote(title: string, groupId?: number | null, notebookId?: number | null): Promise<Note>;
  saveNoteContent(noteId: number, content: string): Promise<Note>;
};

/**
 * Makes a new note out of an assistant's answer: a separate note in `groupId` of `notebookId`, titled from the answer's first line,
 * holding the answer as its text. The note is created first (so it gets its title block) and the answer is then
 * written under that block; saving the bare answer would leave the note without one.
 */
export async function createNoteFromAnswer(text: string, groupId: number | null, notebookId: number | null, api: Api): Promise<Note> {
  const created = await api.createNote(titleFromAnswer(text), groupId, notebookId);
  const [fm] = frontmatter.parse(created.content);
  const body = text.endsWith("\n") ? text : `${text}\n`;
  return api.saveNoteContent(created.id, fm ? frontmatter.render(fm, body) : body);
}
