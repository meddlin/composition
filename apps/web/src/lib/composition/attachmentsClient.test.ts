// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "./attachmentNames";

vi.mock("./actions", () => ({ listAttachments: vi.fn(), removeAttachment: vi.fn() }));

import * as web from "./attachmentsClient";
import * as desktop from "./attachmentsClient.desktop";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const stored = (id: number, fileName: string) => ({ id, noteId: 1, fileName, size: 3, createdAt: "2026-03-04T12:00:00.000Z" });

/** Makes the next file picker the client opens "choose" these files. */
function choose(files: File[]) {
  const original = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string, options?: ElementCreationOptions) => {
    const element = original(tag, options);
    if (tag === "input") {
      element.click = () => {
        Object.defineProperty(element, "files", { value: files });
        element.dispatchEvent(new Event("change"));
      };
    }
    return element;
  });
}

describe("attachmentsClient (web build)", () => {
  it("exports the same names as the desktop build", () => {
    expect(Object.keys(web).sort()).toEqual(Object.keys(desktop).sort());
  });

  it("cannot reveal a file, and calls its copy a download", () => {
    expect(web.attachmentCapabilities.canReveal).toBe(false);
    expect(web.attachmentCapabilities.saveCopyLabel("a.pdf")).toBe("Download a.pdf");
    expect(desktop.attachmentCapabilities.canReveal).toBe(true);
  });

  describe("addAttachments", () => {
    afterEach(() => vi.restoreAllMocks());

    it("uploads each chosen file's bytes to the note, marked as ours", async () => {
      const file = new File(["abc"], "plan & notes.txt");
      choose([file]);
      fetchMock.mockResolvedValue(reply({ attachments: [stored(1, "plan & notes.txt")] }));

      const result = await web.addAttachments(7);

      expect(result).toEqual({ attachments: [stored(1, "plan & notes.txt")] });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/notes/7/attachments?name=plan%20%26%20notes.txt");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "x-composition-upload": "1" });
      expect(init.body).toBe(file);
    });

    it("attaches the other files when one is refused, and reports the refusal", async () => {
      choose([new File(["a"], "a.txt"), new File(["b"], "b.txt"), new File(["c"], "c.txt")]);
      fetchMock
        .mockResolvedValueOnce(reply({ attachments: [stored(1, "a.txt")] }))
        .mockResolvedValueOnce(reply({ attachments: [], error: "b.txt: could not be attached (disk full)." }, 422))
        .mockRejectedValueOnce(new Error("network"));

      const result = await web.addAttachments(7);

      expect(result.attachments).toEqual([stored(1, "a.txt")]);
      expect(result.error).toBe("b.txt: could not be attached (disk full). c.txt: could not be attached.");
    });

    it("doesn't upload a file over the limit", async () => {
      const big = new File(["x"], "huge.bin");
      Object.defineProperty(big, "size", { value: MAX_ATTACHMENT_BYTES + 1 });
      choose([big]);

      const result = await web.addAttachments(7);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.attachments).toEqual([]);
      expect(result.error).toMatch(/huge\.bin: files can be at most 1 GB/);
    });

    it("attaches nothing, and reports no error, when the picker is dismissed", async () => {
      const original = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((tag: string, options?: ElementCreationOptions) => {
        const element = original(tag, options);
        if (tag === "input") element.click = () => element.dispatchEvent(new Event("cancel"));
        return element;
      });

      expect(await web.addAttachments(7)).toEqual({ attachments: [] });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("saveAttachmentCopy", () => {
    afterEach(() => vi.restoreAllMocks());

    it("starts a download of the attachment's route", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.getAttribute("href")).toBe("/api/attachments/4");
        expect(this.hasAttribute("download")).toBe(true);
      });

      expect(await web.saveAttachmentCopy(4)).toEqual({});
      expect(fetchMock).toHaveBeenCalledWith("/api/attachments/4", { method: "HEAD" });
      expect(click).toHaveBeenCalledOnce();
    });

    it("says so, instead of saving an error page, when the file is gone", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

      const result = await web.saveAttachmentCopy(4);

      expect(result.error).toMatch(/missing/);
      expect(click).not.toHaveBeenCalled();
    });
  });

  it("can't reveal a file", async () => {
    expect((await web.revealAttachment(1)).error).toMatch(/file manager/);
  });
});
