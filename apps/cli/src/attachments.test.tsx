import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { service } from "./backend";
import { createSandbox, frame, press, pressEscape, settle, type Rendered, type Sandbox } from "./testing";

let sandbox: Sandbox;
let files: string;
beforeEach(() => {
  sandbox = createSandbox();
  files = fs.mkdtempSync(path.join(os.tmpdir(), "composition-files-"));
});
afterEach(async () => {
  await sandbox.dispose();
  fs.rmSync(files, { recursive: true, force: true });
});

const makeFile = (name: string, content = "hello") => {
  const file = path.join(files, name);
  fs.writeFileSync(file, content);
  return file;
};

/** A note, mounted, with the tree's cursor on it, and the Attachments screen open. */
async function openScreen(): Promise<{ app: Rendered; noteId: number }> {
  const note = await service.createNote("Plan", null);
  const app = await sandbox.mount();
  await press(app, "a", {}, 300);
  expect(frame(app)).toContain("Attachments · Plan");
  return { app, noteId: note.id };
}

/** The Save a copy prompt starts with a suggested path; this empties it. */
async function clearPrompt(app: Rendered) {
  for (let i = 0; i < 200; i++) app.mockInput.pressBackspace();
  await settle(app, 50);
}

async function typeAndSubmit(app: Rendered, text: string) {
  await app.mockInput.typeText(text);
  await press(app, "RETURN", {}, 500);
}

describe("the Attachments screen", () => {
  it("says so when nothing is attached, and goes back with Escape", async () => {
    const { app } = await openScreen();
    expect(frame(app)).toContain("Nothing is attached to this note");

    await pressEscape(app);

    expect(frame(app)).not.toContain("Attachments · Plan");
    expect(frame(app)).toContain("q quit");
  });

  it("opens from a pane with ctrl+p too", async () => {
    await service.createNote("Plan", null);
    const app = await sandbox.mount();
    await press(app, "RETURN", {}, 400); // open the note in a pane

    await press(app, "p", { ctrl: true }, 300);

    expect(frame(app)).toContain("Attachments · Plan");
  });

  it("attaches a file by its path, copies it, and lists it with its size", async () => {
    const { app, noteId } = await openScreen();
    const report = makeFile("report.pdf", "twelve bytes");

    await press(app, "a");
    await typeAndSubmit(app, report);

    const attached = await service.listAttachments(noteId);
    expect(attached.map((a) => a.fileName)).toEqual(["report.pdf"]);
    const stored = await service.findAttachmentFile(attached[0].id);
    expect(fs.readFileSync(stored!.path, "utf8")).toBe("twelve bytes");
    expect(fs.existsSync(report)).toBe(true); // the original is left alone
    expect(frame(app)).toContain("Attached 1 file.");
    expect(frame(app)).toContain("report.pdf");
    expect(frame(app)).toContain("12 B");
  });

  it("attaches several files at once, and names the ones that can't be attached", async () => {
    const { app, noteId } = await openScreen();
    const one = makeFile("one.txt");
    const two = makeFile("two words.txt");

    await press(app, "a");
    await typeAndSubmit(app, `${one} '${two}' ${files}`); // the last is a folder

    expect((await service.listAttachments(noteId)).map((a) => a.fileName).sort()).toEqual(["one.txt", "two words.txt"]);
    expect(frame(app)).toContain("Attached 2 files.");
    expect(frame(app)).toContain("only files can be attached");
  });

  it("saves a copy to a new name, and never over an existing file", async () => {
    const { app } = await openScreen();
    await press(app, "a");
    await typeAndSubmit(app, makeFile("report.pdf", "the bytes"));
    const target = path.join(files, "copy.pdf");

    await press(app, "s");
    await clearPrompt(app);
    await typeAndSubmit(app, target);

    expect(fs.readFileSync(target, "utf8")).toBe("the bytes");
    expect(frame(app)).toContain("Saved a copy to");

    await press(app, "s");
    await clearPrompt(app);
    await typeAndSubmit(app, target);
    expect(frame(app)).toContain("already exists");
  });

  it("removes an attachment after a confirmation, and deletes the stored file", async () => {
    const { app, noteId } = await openScreen();
    await press(app, "a");
    await typeAndSubmit(app, makeFile("report.pdf"));
    const [attachment] = await service.listAttachments(noteId);
    const stored = (await service.findAttachmentFile(attachment.id))!.path;

    await press(app, "d", { ctrl: true });
    expect(frame(app)).toContain('Remove "report.pdf"?');
    await press(app, "n"); // cancels
    expect(await service.listAttachments(noteId)).toHaveLength(1);

    await press(app, "d", { ctrl: true });
    await press(app, "y", {}, 500);

    expect(await service.listAttachments(noteId)).toHaveLength(0);
    expect(fs.existsSync(stored)).toBe(false);
    expect(frame(app)).toContain('Removed "report.pdf".');
    expect(frame(app)).toContain("Nothing is attached");
  });

  it("shows what the desktop app attached to the same note", async () => {
    const note = await service.createNote("Plan", null);
    await service.addAttachmentFiles(note.id, [makeFile("from-desktop.zip")]); // what the desktop app's picker ends in
    const app = await sandbox.mount();

    await press(app, "a", {}, 300);

    expect(frame(app)).toContain("from-desktop.zip");
  });
});
