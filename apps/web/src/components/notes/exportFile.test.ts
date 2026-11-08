// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { canSaveFile, saveFile, SaveFileError } from "./exportFile";

const BYTES = new Uint8Array([0x50, 0x4b, 3, 4]);

function bridge(saveFileResult: { saved: boolean; error?: string } | Error = { saved: true }) {
  const save = vi.fn<(input: { name: string; bytes: Uint8Array; kind: string }) => Promise<{ saved: boolean; error?: string }>>(async () => {
    if (saveFileResult instanceof Error) throw saveFileResult;
    return saveFileResult;
  });
  (window as unknown as { composition: unknown }).composition = { saveFile: save };
  return save;
}

afterEach(() => {
  delete (window as unknown as { composition?: unknown }).composition;
  vi.restoreAllMocks();
});

describe("canSaveFile", () => {
  it("is true in a browser, which downloads", () => {
    expect(canSaveFile()).toBe(true);
  });

  it("is true in the desktop app, whose bridge saves the file", () => {
    bridge();
    expect(canSaveFile()).toBe(true);
  });

  it("is false where a bridge exists without saveFile", () => {
    (window as unknown as { composition: unknown }).composition = {};
    expect(canSaveFile()).toBe(false);
  });
});

describe("saveFile in the desktop app", () => {
  it("hands the bridge the name, the bytes and the kind, and nothing that names a place", async () => {
    const save = bridge({ saved: true });

    expect(await saveFile("Q3 budget.xlsx", BYTES, "xlsx")).toBe("saved");

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ name: "Q3 budget.xlsx", bytes: BYTES, kind: "xlsx" });
  });

  it("sends text as UTF-8 bytes, keeping the byte order mark Excel needs", async () => {
    const save = bridge({ saved: true });

    await saveFile("a.csv", "﻿Item,Qty\nPens,12\n", "csv");

    const { bytes, kind } = save.mock.calls[0][0];
    expect(kind).toBe("csv");
    // Not `instanceof`: jsdom's Uint8Array is not the one TextEncoder makes.
    expect(Object.prototype.toString.call(bytes)).toBe("[object Uint8Array]");
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe("﻿Item,Qty\nPens,12\n");
  });

  it("answers canceled when the save dialog was dismissed", async () => {
    bridge({ saved: false });
    expect(await saveFile("a.xlsx", BYTES, "xlsx")).toBe("canceled");
  });

  it("throws the reason when the file could not be written", async () => {
    bridge({ saved: false, error: "Could not save the file: EACCES" });

    const failure = await saveFile("a.xlsx", BYTES, "xlsx").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SaveFileError);
    expect((failure as Error).message).toBe("Could not save the file: EACCES");
  });

  it("lets a call that failed outright (the bridge refusing the arguments) through as it is", async () => {
    bridge(new Error("saveFile: invalid bytes"));
    await expect(saveFile("a.xlsx", BYTES, "xlsx")).rejects.toThrow("saveFile: invalid bytes");
  });

  it("does not start a download", async () => {
    bridge();
    const create = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });

    await saveFile("a.xlsx", BYTES, "xlsx");

    expect(create).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("saveFile in a browser", () => {
  it("downloads the file under the name given, with the media type for its kind, and says it was offered", async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return "blob:x";
      }),
      revokeObjectURL: vi.fn(),
    });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });

    expect(await saveFile("Q3 budget.csv", "a,b\n", "csv")).toBe("offered");
    expect(await saveFile("Q3 budget.xlsx", BYTES, "xlsx")).toBe("offered");

    expect(downloads).toEqual(["Q3 budget.csv", "Q3 budget.xlsx"]);
    expect(blobs.map((blob) => blob.type)).toEqual(["text/csv;charset=utf-8", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
    vi.unstubAllGlobals();
  });
});
