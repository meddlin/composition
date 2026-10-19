import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/composition/searchIndex", () => ({
  indexNote: vi.fn(async () => {}),
  deleteNoteFromIndex: vi.fn(async () => {}),
  searchNoteIds: vi.fn(async () => []),
  unavailableMessage: () => "unavailable",
}));

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-attachment-routes-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("@/lib/composition/db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

const ours = { "x-composition-upload": "1", host: "localhost:3000", origin: "http://localhost:3000" };

async function setup() {
  const service = await import("@/lib/composition/service");
  const upload = await import("./notes/[noteId]/attachments/route");
  const download = await import("./attachments/[id]/route");
  const note = await service.createNote("Trip plan");
  const post = (noteId: number | string, name: string | null, body: string | null, headers: Record<string, string> = ours) =>
    upload.POST(
      new Request(`http://localhost:3000/api/notes/${noteId}/attachments${name === null ? "" : `?name=${encodeURIComponent(name)}`}`, {
        method: "POST",
        headers,
        body,
      }),
      { params: Promise.resolve({ noteId: String(noteId) }) },
    );
  const get = (id: number | string) =>
    download.GET(new Request(`http://localhost:3000/api/attachments/${id}`), { params: Promise.resolve({ id: String(id) }) });
  return { service, note, post, get };
}

describe("POST /api/notes/[noteId]/attachments", () => {
  it("attaches the body to the note", async () => {
    const { service, note, post } = await setup();

    const response = await post(note.id, "report.pdf", "%PDF-1.7");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.attachments).toEqual([expect.objectContaining({ noteId: note.id, fileName: "report.pdf", size: 8 })]);
    expect(await service.listAttachments(note.id)).toEqual(body.attachments);
  });

  it("refuses a request that isn't from the app, and stores nothing", async () => {
    const { service, note, post } = await setup();

    const crossSite = await post(note.id, "a.txt", "x", { ...ours, origin: "https://evil.example" });
    const noHeader = await post(note.id, "a.txt", "x", { host: "localhost:3000" });

    expect(crossSite.status).toBe(403);
    expect(noHeader.status).toBe(403);
    expect(await service.listAttachments(note.id)).toEqual([]);
  });

  it("asks for a file name and a body", async () => {
    const { note, post } = await setup();

    expect((await post(note.id, null, "x")).status).toBe(400);
    expect((await post("abc", "a.txt", "x")).status).toBe(400);
    expect((await post(note.id, "a.txt", null)).status).toBe(400);
  });

  it("answers 422 with the reason when the note is gone", async () => {
    const { post } = await setup();

    const response = await post(9999, "a.txt", "x");

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("That note no longer exists.");
  });

  it("refuses an upload that says it is over the limit before reading it", async () => {
    const { note, post } = await setup();

    const response = await post(note.id, "huge.bin", "x", { ...ours, "content-length": "1000000001" });

    expect(response.status).toBe(413);
  });
});

describe("GET /api/attachments/[id]", () => {
  it("sends the bytes as a download that can't be displayed", async () => {
    const { note, post, get } = await setup();
    const [{ id }] = (await (await post(note.id, "page.html", "<script>alert(1)</script>")).json()).attachments;

    const response = await get(id);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<script>alert(1)</script>");
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="page\.html"/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-length")).toBe("25");
  });

  it("is 404 for an unknown id, a non-numeric id, and a file deleted behind the app's back", async () => {
    const { note, post, get } = await setup();
    const [{ id }] = (await (await post(note.id, "a.txt", "x")).json()).attachments;
    const dir = path.join(home, ".composition", "attachments");
    for (const file of fs.readdirSync(dir)) fs.rmSync(path.join(dir, file));

    expect((await get(id)).status).toBe(404);
    expect((await get(12345)).status).toBe(404);
    expect((await get("../../etc/passwd")).status).toBe(404);
  });
});
