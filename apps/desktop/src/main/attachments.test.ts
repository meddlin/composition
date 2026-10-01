import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAttachmentsApi, type AttachmentUi } from "./attachments";

let dir: string;
let stored: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "composition-attach-ipc-"));
  stored = path.join(dir, "stored-report.pdf");
  fs.writeFileSync(stored, "pdf bytes");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function setup(ui: Partial<AttachmentUi> = {}, found: { path: string; fileName: string } | null = null) {
  const service = {
    listAttachments: vi.fn(async () => []),
    addAttachmentFiles: vi.fn(async () => ({ attachments: [] })),
    findAttachmentFile: vi.fn(async () => found ?? { path: stored, fileName: "report.pdf" }),
    removeAttachment: vi.fn(async () => ({})),
  };
  const nativeUi: AttachmentUi = {
    pickFiles: vi.fn(async () => []),
    pickSavePath: vi.fn(async () => null),
    reveal: vi.fn(),
    ...ui,
  };
  return { api: createAttachmentsApi(service, nativeUi), service, ui: nativeUi };
}

describe("addAttachments", () => {
  it("attaches exactly the files the user picked in the dialog", async () => {
    const { api, service } = setup({ pickFiles: vi.fn(async () => ["/a/one.pdf", "/b/two.zip"]) });

    await api.addAttachments(7);

    expect(service.addAttachmentFiles).toHaveBeenCalledWith(7, ["/a/one.pdf", "/b/two.zip"]);
  });

  it("does nothing when the dialog is cancelled", async () => {
    const { api, service } = setup();

    expect(await api.addAttachments(7)).toEqual({ attachments: [] });
    expect(service.addAttachmentFiles).not.toHaveBeenCalled();
  });
});

describe("revealAttachment", () => {
  it("shows the stored file in Finder", async () => {
    const { api, ui } = setup();

    expect(await api.revealAttachment(3)).toEqual({});
    expect(ui.reveal).toHaveBeenCalledWith(stored);
  });

  it("says so when the file has gone missing", async () => {
    const { api, ui, service } = setup();
    service.findAttachmentFile.mockResolvedValue(null as never);

    expect((await api.revealAttachment(3)).error).toMatch(/missing/);
    expect(ui.reveal).not.toHaveBeenCalled();
  });
});

describe("saveAttachmentCopy", () => {
  it("offers the original file name and writes a copy where the user chose", async () => {
    const target = path.join(dir, "saved.pdf");
    const { api, ui } = setup({ pickSavePath: vi.fn(async () => target) });

    expect(await api.saveAttachmentCopy(3)).toEqual({});

    expect(ui.pickSavePath).toHaveBeenCalledWith("report.pdf");
    expect(fs.readFileSync(target, "utf8")).toBe("pdf bytes");
    expect(fs.existsSync(stored)).toBe(true);
  });

  it("is a cancellation, not an error, when the user dismisses the dialog", async () => {
    const { api } = setup();

    expect(await api.saveAttachmentCopy(3)).toEqual({ canceled: true });
  });

  it("reports a destination that can't be written", async () => {
    const { api } = setup({ pickSavePath: vi.fn(async () => path.join(dir, "no", "such", "dir", "x.pdf")) });

    expect((await api.saveAttachmentCopy(3)).error).toMatch(/^Could not save a copy:/);
  });
});

describe("removeAttachment", () => {
  it("is handed straight to the service", async () => {
    const { api, service } = setup();

    await api.removeAttachment(3);

    expect(service.removeAttachment).toHaveBeenCalledWith(3);
  });
});
