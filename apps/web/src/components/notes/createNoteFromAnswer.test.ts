import { describe, expect, it, vi } from "vitest";
import * as frontmatter from "@/lib/composition/frontmatter";
import type { Note } from "./types";
import { createNoteFromAnswer } from "./createNoteFromAnswer";

/** Stands in for the two calls that reach the data layer (Server Actions or IPC), which make notes the way the real ones do. */
function fakeApi() {
  const createNote = vi.fn(async (title: string, groupId?: number | null, notebookId?: number | null): Promise<Note> => {
    const now = "2026-10-22T00:00:00.000Z";
    return { id: 42, title, content: frontmatter.generate(title, { createdAt: now, updatedAt: now }), tags: "", description: "", createdAt: now, updatedAt: now, groupId: groupId ?? null, notebookId: notebookId ?? 1 };
  });
  const saveNoteContent = vi.fn(async (id: number, content: string): Promise<Note> => {
    const [fm] = frontmatter.parse(content);
    return { id, title: fm?.title ?? "", content, tags: "", description: "", createdAt: "x", updatedAt: "y", groupId: 3, notebookId: 5 };
  });
  return { createNote, saveNoteContent };
}

describe("createNoteFromAnswer", () => {
  it("makes a separate note in the given group and notebook, titled from the answer, whose text is the answer under its own title block", async () => {
    const api = fakeApi();

    const note = await createNoteFromAnswer("# Day two\n\nVisit **Sintra**.", 3, 5, api);

    expect(api.createNote).toHaveBeenCalledWith("Day two", 3, 5);
    const saved = api.saveNoteContent.mock.calls[0];
    expect(saved[0]).toBe(42);
    const [fm, body] = frontmatter.parse(saved[1]);
    expect(fm?.title).toBe("Day two");
    expect(body).toBe("# Day two\n\nVisit **Sintra**.\n");
    expect(note.id).toBe(42);
  });

  it("files the note ungrouped when the source note was", async () => {
    const api = fakeApi();
    await createNoteFromAnswer("Plain answer.", null, 1, api);
    expect(api.createNote).toHaveBeenCalledWith("Plain answer.", null, 1);
  });

  it("calls an answer with no usable first line Untitled", async () => {
    const api = fakeApi();
    await createNoteFromAnswer("```\n```", null, 1, api);
    expect(api.createNote).toHaveBeenCalledWith("Untitled", null, 1);
  });

  it("does not double the newline at the end of an answer that has one", async () => {
    const api = fakeApi();
    await createNoteFromAnswer("Answer.\n", null, 1, api);
    expect(frontmatter.parse(api.saveNoteContent.mock.calls[0][1])[1]).toBe("Answer.\n");
  });
});
