import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "./attachmentNames";

vi.mock("./searchIndex", () => ({
  indexNote: vi.fn(async () => {}),
  deleteNoteFromIndex: vi.fn(async () => {}),
  searchNoteIds: vi.fn(async () => []),
  unavailableMessage: () => "unavailable",
}));

let home: string;
let source: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-attachments-"));
  source = path.join(home, "inbox");
  fs.mkdirSync(source);
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

const write = (name: string, content: string | Buffer = "hello") => {
  const file = path.join(source, name);
  fs.writeFileSync(file, content);
  return file;
};

const storedFiles = () => {
  const dir = path.join(home, ".composition", "attachments");
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

async function setup() {
  const service = await import("./service");
  const note = await service.createNote("Trip plan");
  return { service, note };
}

describe("addAttachmentFiles", () => {
  it("copies the file into the application data directory and lists it against the note", async () => {
    const { service, note } = await setup();

    const result = await service.addAttachmentFiles(note.id, [write("itinerary.pdf", "%PDF-1.7 ...")]);

    expect(result.error).toBeUndefined();
    expect(result.attachments).toEqual([
      expect.objectContaining({ noteId: note.id, fileName: "itinerary.pdf", size: 12 }),
    ]);
    expect(await service.listAttachments(note.id)).toEqual(result.attachments);
    expect(storedFiles()).toHaveLength(1);
    expect(storedFiles()[0]).toMatch(/^[0-9a-f]{12}-itinerary\.pdf$/);
  });

  it("does not expose where the file is stored", async () => {
    const { service, note } = await setup();

    const [attachment] = (await service.addAttachmentFiles(note.id, [write("a.txt")])).attachments;

    expect(attachment).not.toHaveProperty("storedName");
  });

  it("accepts any type of file, with or without an extension", async () => {
    const { service, note } = await setup();
    const files = [
      write("photo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      write("archive.zip", Buffer.from([0x50, 0x4b, 3, 4])),
      write("Makefile", "all:"),
      write("run.sh", "#!/bin/sh"),
    ];

    const result = await service.addAttachmentFiles(note.id, files);

    expect(result.error).toBeUndefined();
    expect(result.attachments.map((a) => a.fileName)).toEqual(["photo.png", "archive.zip", "Makefile", "run.sh"]);
  });

  it("keeps two files with the same name apart", async () => {
    const { service, note } = await setup();
    const first = write("notes.txt", "one");
    const { attachments } = await service.addAttachmentFiles(note.id, [first]);
    fs.writeFileSync(first, "two!");
    await service.addAttachmentFiles(note.id, [first]);

    expect(storedFiles()).toHaveLength(2);
    expect((await service.listAttachments(note.id)).map((a) => a.size)).toEqual([attachments[0].size, 4]);
  });

  it("leaves the original where it was", async () => {
    const { service, note } = await setup();
    const file = write("keep.txt");

    await service.addAttachmentFiles(note.id, [file]);

    expect(fs.existsSync(file)).toBe(true);
  });

  it("refuses a folder, by name, and still attaches the other files", async () => {
    const { service, note } = await setup();
    const folder = path.join(source, "photos");
    fs.mkdirSync(folder);

    const result = await service.addAttachmentFiles(note.id, [folder, write("ok.txt")]);

    expect(result.attachments.map((a) => a.fileName)).toEqual(["ok.txt"]);
    expect(result.error).toMatch(/photos: only files can be attached/);
  });

  it("refuses a file over the size limit and leaves nothing behind", async () => {
    const { service, note } = await setup();
    const big = write("big.bin", "");
    fs.truncateSync(big, MAX_ATTACHMENT_BYTES + 1); // sparse, so no real disk is used

    const result = await service.addAttachmentFiles(note.id, [big]);

    expect(result.attachments).toEqual([]);
    expect(result.error).toMatch(/big\.bin: files can be at most 1 GB/);
    expect(storedFiles()).toEqual([]);
  });

  it("reports a missing file without throwing", async () => {
    const { service, note } = await setup();

    const result = await service.addAttachmentFiles(note.id, [path.join(source, "gone.txt")]);

    expect(result.attachments).toEqual([]);
    expect(result.error).toMatch(/gone\.txt: could not be attached/);
  });

  it("refuses a note that no longer exists", async () => {
    const { service } = await setup();

    const result = await service.addAttachmentFiles(9999, [write("a.txt")]);

    expect(result).toEqual({ attachments: [], error: "That note no longer exists." });
    expect(storedFiles()).toEqual([]);
  });
});

describe("addAttachmentStream", () => {
  const stream = (content: string | Buffer) => Readable.from([Buffer.from(content)]);

  it("stores the streamed bytes as an attachment of the note", async () => {
    const { service, note } = await setup();

    const result = await service.addAttachmentStream(note.id, "itinerary.pdf", stream("%PDF-1.7 ..."));

    expect(result.error).toBeUndefined();
    expect(result.attachments).toEqual([
      expect.objectContaining({ noteId: note.id, fileName: "itinerary.pdf", size: 12 }),
    ]);
    expect(await service.listAttachments(note.id)).toEqual(result.attachments);
    const found = await service.findAttachmentFile(result.attachments[0].id);
    expect(fs.readFileSync(found!.path, "utf8")).toBe("%PDF-1.7 ...");
    expect(storedFiles()).toEqual([expect.stringMatching(/^[0-9a-f]{12}-itinerary\.pdf$/)]);
  });

  it("keeps a path in the name out of the stored file's name", async () => {
    const { service, note } = await setup();

    const result = await service.addAttachmentStream(note.id, "../../etc/passwd", stream("x"));

    expect(result.attachments[0].fileName).toBe("passwd");
    expect(storedFiles()).toHaveLength(1);
    expect(fs.existsSync(path.join(home, "etc"))).toBe(false);
  });

  it("accepts an empty file", async () => {
    const { service, note } = await setup();

    const result = await service.addAttachmentStream(note.id, "empty.txt", stream(""));

    expect(result.attachments).toEqual([expect.objectContaining({ fileName: "empty.txt", size: 0 })]);
  });

  it("refuses a note that no longer exists", async () => {
    const { service } = await setup();

    const result = await service.addAttachmentStream(9999, "a.txt", stream("x"));

    expect(result).toEqual({ attachments: [], error: "That note no longer exists." });
    expect(storedFiles()).toEqual([]);
  });

  it("stops at the size limit and leaves nothing behind", async () => {
    const { service, note } = await setup();
    const chunk = Buffer.alloc(8 * 1024 * 1024);
    let sent = 0;
    const endless = new Readable({
      read() {
        sent += chunk.length;
        this.push(sent > MAX_ATTACHMENT_BYTES + chunk.length ? null : chunk);
      },
    });

    const result = await service.addAttachmentStream(note.id, "big.bin", endless);

    expect(result.attachments).toEqual([]);
    expect(result.error).toMatch(/big\.bin: files can be at most 1 GB/);
    expect(storedFiles()).toEqual([]);
    expect(await service.listAttachments(note.id)).toEqual([]);
  }, 60_000);

  it("leaves nothing behind when the upload is cut off", async () => {
    const { service, note } = await setup();
    const broken = new Readable({
      read() {
        this.push(Buffer.from("partial"));
        this.destroy(new Error("connection reset"));
      },
    });

    const result = await service.addAttachmentStream(note.id, "cut.txt", broken);

    expect(result.attachments).toEqual([]);
    expect(result.error).toMatch(/cut\.txt: could not be attached \(connection reset\)/);
    expect(storedFiles()).toEqual([]);
  });
});

describe("findAttachmentFile", () => {
  it("returns the stored file and the name to show", async () => {
    const { service, note } = await setup();
    const [{ id }] = (await service.addAttachmentFiles(note.id, [write("a.txt", "abc")])).attachments;

    const found = await service.findAttachmentFile(id);

    expect(found?.fileName).toBe("a.txt");
    expect(fs.readFileSync(found!.path, "utf8")).toBe("abc");
  });

  it("is null for an unknown id or a file deleted behind the app's back", async () => {
    const { service, note } = await setup();
    const [{ id }] = (await service.addAttachmentFiles(note.id, [write("a.txt")])).attachments;
    fs.rmSync(path.join(home, ".composition", "attachments", storedFiles()[0]));

    expect(await service.findAttachmentFile(id)).toBeNull();
    expect(await service.findAttachmentFile(12345)).toBeNull();
  });
});

describe("removeAttachment", () => {
  it("deletes the row and the stored file, and only that attachment", async () => {
    const { service, note } = await setup();
    const { attachments } = await service.addAttachmentFiles(note.id, [write("a.txt"), write("b.txt")]);

    expect(await service.removeAttachment(attachments[0].id)).toEqual({});

    expect((await service.listAttachments(note.id)).map((a) => a.fileName)).toEqual(["b.txt"]);
    expect(storedFiles()).toHaveLength(1);
    expect(storedFiles()[0]).toMatch(/b\.txt$/);
  });

  it("says so when there is nothing to remove", async () => {
    const { service } = await setup();

    expect(await service.removeAttachment(42)).toEqual({ error: "That attachment no longer exists." });
  });
});

describe("a note's attachments through the Trash Can", () => {
  async function noteWithFiles() {
    const { service, note } = await setup();
    const other = await service.createNote("Other");
    await service.addAttachmentFiles(note.id, [write("a.txt"), write("b.txt")]);
    await service.addAttachmentFiles(other.id, [write("c.txt")]);
    return { service, note, other };
  }

  it("keeps them when the note is moved to the Trash Can", async () => {
    const { service, note } = await noteWithFiles();

    await service.deleteNote(note.id);

    expect(storedFiles()).toHaveLength(3);
    expect(await service.listAttachments(note.id)).toHaveLength(2);
  });

  it("gives them back when the note is restored", async () => {
    const { service, note } = await noteWithFiles();
    await service.deleteNote(note.id);

    await service.restoreNote(note.id);

    expect((await service.listAttachments(note.id)).map((a) => a.fileName)).toEqual(["a.txt", "b.txt"]);
    expect(storedFiles()).toHaveLength(3);
  });

  it("deletes them, and only them, when the note is permanently deleted", async () => {
    const { service, note, other } = await noteWithFiles();
    await service.deleteNote(note.id);

    await service.permanentlyDeleteNote(note.id);

    expect(await service.listAttachments(note.id)).toEqual([]);
    expect(storedFiles()).toHaveLength(1);
    expect(storedFiles()[0]).toMatch(/c\.txt$/);
    expect(await service.listAttachments(other.id)).toHaveLength(1);
  });

  it("deletes them when the note outlives the Trash Can's retention window", async () => {
    const { service, note, other } = await noteWithFiles();
    await service.deleteNote(note.id);
    await service.deleteNote(other.id);
    const { getDb } = await import("./db");
    getDb()
      .prepare("UPDATE trashed_notes SET deleted_at = '2000-01-01T00:00:00.000Z' WHERE id = ?")
      .run(note.id);

    await service.loadTrash();

    expect(await service.listAttachments(note.id)).toEqual([]);
    expect(storedFiles()).toHaveLength(1);
    // The other note is still inside the window, so it can still be restored with its file.
    expect(await service.listAttachments(other.id)).toHaveLength(1);
  });

  it("leaves a live note's attachments alone when the trash is cleaned", async () => {
    const { service, note } = await noteWithFiles();

    await service.loadTrash();
    await service.loadWorkspace();

    expect(await service.listAttachments(note.id)).toHaveLength(2);
    expect(storedFiles()).toHaveLength(3);
  });
});
