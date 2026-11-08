import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSaveFileApi, offeredFileName, type SaveFileFs, type SaveFileUi } from "./saveFile";

const BYTES = new Uint8Array([0x50, 0x4b, 3, 4]);

function setup(chosen: { canceled: boolean; filePath?: string } = { canceled: false, filePath: "/Users/me/Desktop/Q3 budget.xlsx" }, overrides: Partial<SaveFileFs> = {}) {
  const ui = {
    showSaveDialog: vi.fn(async (_options: Parameters<SaveFileUi["showSaveDialog"]>[0]) => chosen),
    defaultFolder: vi.fn(() => "/Users/me/Documents"),
  };
  const files = {
    writeFile: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    rm: vi.fn(async () => {}),
    ...overrides,
  } as unknown as { [K in keyof SaveFileFs]: ReturnType<typeof vi.fn> };
  return { api: createSaveFileApi(ui, files as unknown as SaveFileFs), ui, files };
}

describe("saveFile", () => {
  it("asks in the save dialog, offering the name in the documents folder and only the kind's extension", async () => {
    const { api, ui } = setup();

    await api.saveFile({ name: "Q3 budget.xlsx", bytes: BYTES, kind: "xlsx" });

    expect(ui.showSaveDialog).toHaveBeenCalledWith({
      defaultPath: path.join("/Users/me/Documents", "Q3 budget.xlsx"),
      filters: [{ name: "Excel workbook", extensions: ["xlsx"] }],
    });
  });

  it("filters on csv for a csv", async () => {
    const { api, ui } = setup({ canceled: false, filePath: "/out/a.csv" });

    await api.saveFile({ name: "a.csv", bytes: BYTES, kind: "csv" });

    expect(ui.showSaveDialog.mock.calls[0][0].filters).toEqual([{ name: "CSV", extensions: ["csv"] }]);
  });

  it("writes the bytes beside the chosen file, then renames over it", async () => {
    const { api, files } = setup();

    expect(await api.saveFile({ name: "Q3 budget.xlsx", bytes: BYTES, kind: "xlsx" })).toEqual({ saved: true });

    expect(files.writeFile).toHaveBeenCalledTimes(1);
    const [temporary, written] = files.writeFile.mock.calls[0] as unknown as [string, Uint8Array];
    expect(path.dirname(temporary)).toBe("/Users/me/Desktop");
    expect(temporary).not.toBe("/Users/me/Desktop/Q3 budget.xlsx");
    expect(temporary).toMatch(/\.tmp$/);
    expect(written).toBe(BYTES);
    expect(files.rename).toHaveBeenCalledWith(temporary, "/Users/me/Desktop/Q3 budget.xlsx");
    expect(files.writeFile.mock.invocationCallOrder[0]).toBeLessThan(files.rename.mock.invocationCallOrder[0]);
    expect(files.rm).not.toHaveBeenCalled();
  });

  it("is not an error when the dialog is dismissed, and writes nothing", async () => {
    const { api, files } = setup({ canceled: true });

    expect(await api.saveFile({ name: "a.xlsx", bytes: BYTES, kind: "xlsx" })).toEqual({ saved: false });
    expect(files.writeFile).not.toHaveBeenCalled();
    expect(files.rename).not.toHaveBeenCalled();
  });

  it("treats a dialog that returns no path as dismissed", async () => {
    const { api, files } = setup({ canceled: false });

    expect(await api.saveFile({ name: "a.xlsx", bytes: BYTES, kind: "xlsx" })).toEqual({ saved: false });
    expect(files.writeFile).not.toHaveBeenCalled();
  });

  it("adds the extension to a name the dialog left without one, but keeps one that is already there in any case", async () => {
    const bare = setup({ canceled: false, filePath: "/out/report" });
    await bare.api.saveFile({ name: "a.xlsx", bytes: BYTES, kind: "xlsx" });
    expect(bare.files.rename.mock.calls[0][1]).toBe("/out/report.xlsx");

    const upper = setup({ canceled: false, filePath: "/out/REPORT.CSV" });
    await upper.api.saveFile({ name: "a.csv", bytes: BYTES, kind: "csv" });
    expect(upper.files.rename.mock.calls[0][1]).toBe("/out/REPORT.CSV");

    const other = setup({ canceled: false, filePath: "/out/notes.txt" });
    await other.api.saveFile({ name: "a.csv", bytes: BYTES, kind: "csv" });
    expect(other.files.rename.mock.calls[0][1]).toBe("/out/notes.txt.csv");
  });

  it("writes only where the dialog said, whatever path the page put in the name", async () => {
    const { api, files, ui } = setup({ canceled: false, filePath: "/Users/me/Desktop/x.xlsx" });

    await api.saveFile({ name: "../../../etc/cron.d/evil.xlsx", bytes: BYTES, kind: "xlsx" });

    expect(ui.showSaveDialog.mock.calls[0][0].defaultPath).toBe(path.join("/Users/me/Documents", "evil.xlsx"));
    for (const [target] of [...files.writeFile.mock.calls, ...files.rename.mock.calls.map((call) => [call[1]])]) {
      expect(path.dirname(target as string)).toBe("/Users/me/Desktop");
    }
  });

  it("says why when the file could not be written, and removes the partial file", async () => {
    const { api, files } = setup(undefined, {
      writeFile: vi.fn(async () => {
        throw new Error("ENOSPC: no space left on device");
      }),
    });

    const result = await api.saveFile({ name: "a.xlsx", bytes: BYTES, kind: "xlsx" });

    expect(result).toEqual({ saved: false, error: "Could not save the file: ENOSPC: no space left on device" });
    expect(files.rename).not.toHaveBeenCalled();
    expect(files.rm).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), { force: true });
  });

  it("says why when the file could not be moved into place, and removes the temporary file", async () => {
    const { api, files } = setup(undefined, {
      rename: vi.fn(async () => {
        throw new Error("EACCES: permission denied");
      }),
    });

    const result = await api.saveFile({ name: "a.xlsx", bytes: BYTES, kind: "xlsx" });

    expect(result).toEqual({ saved: false, error: "Could not save the file: EACCES: permission denied" });
    expect(files.rm).toHaveBeenCalledTimes(1);
  });

  it("still answers when removing the partial file fails too", async () => {
    const { api } = setup(undefined, {
      writeFile: vi.fn(async () => {
        throw new Error("EIO");
      }),
      rm: vi.fn(async () => {
        throw new Error("EPERM");
      }),
    });

    expect(await api.saveFile({ name: "a.xlsx", bytes: BYTES, kind: "xlsx" })).toEqual({ saved: false, error: "Could not save the file: EIO" });
  });

  it("answers with an error, not a throw, when the dialog itself fails", async () => {
    const { api, ui, files } = setup();
    ui.showSaveDialog.mockRejectedValueOnce(new Error("no window"));

    expect(await api.saveFile({ name: "a.xlsx", bytes: BYTES, kind: "xlsx" })).toEqual({ saved: false, error: "Could not save the file: no window" });
    expect(files.writeFile).not.toHaveBeenCalled();
    // The failure doesn't leave it refusing every later save.
    expect(await api.saveFile({ name: "a.xlsx", bytes: BYTES, kind: "xlsx" })).toEqual({ saved: true });
  });

  it("opens one dialog at a time", async () => {
    const { api, ui } = setup();
    let answer: (value: { canceled: boolean }) => void = () => {};
    ui.showSaveDialog.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));

    const first = api.saveFile({ name: "a.xlsx", bytes: BYTES, kind: "xlsx" });
    const second = await api.saveFile({ name: "b.xlsx", bytes: BYTES, kind: "xlsx" });

    expect(second).toEqual({ saved: false, error: "A save dialog is already open." });
    expect(ui.showSaveDialog).toHaveBeenCalledTimes(1);
    answer({ canceled: true });
    expect(await first).toEqual({ saved: false });
    // Once it is answered, the next one opens.
    expect(await api.saveFile({ name: "c.xlsx", bytes: BYTES, kind: "xlsx" })).toEqual({ saved: true });
    expect(ui.showSaveDialog).toHaveBeenCalledTimes(2);
  });
});

describe("offeredFileName", () => {
  it.each([
    ["Q3 budget.xlsx", "xlsx", "Q3 budget.xlsx"],
    ["Q3 budget", "xlsx", "Q3 budget.xlsx"],
    ["Q3 budget.XLSX", "xlsx", "Q3 budget.xlsx"],
    ["Q3 budget.csv", "xlsx", "Q3 budget.csv.xlsx"],
    ["Q3 budget.xlsx", "csv", "Q3 budget.xlsx.csv"],
    ["data.csv", "csv", "data.csv"],
  ] as const)("%s as %s is offered as %s", (suggested, kind, offered) => {
    expect(offeredFileName(suggested, kind)).toBe(offered);
  });

  it.each([
    ["../../etc/passwd", "passwd.xlsx"],
    ["/etc/cron.d/evil.xlsx", "evil.xlsx"],
    ["C:\\Windows\\System32\\evil.xlsx", "evil.xlsx"],
    ["a/b\\c/d.xlsx", "d.xlsx"],
    ["folder/", "File.xlsx"],
  ])("keeps no part of a path: %s is offered as %s", (suggested, offered) => {
    expect(offeredFileName(suggested, "xlsx")).toBe(offered);
  });

  it("replaces characters a file name can't hold on some system", () => {
    expect(offeredFileName('Q3: "budget" <draft>?|*.xlsx', "xlsx")).toBe("Q3_ _budget_ _draft_.xlsx");
    expect(offeredFileName("a\u0000b\nc.xlsx", "xlsx")).toBe("a_b_c.xlsx");
  });

  it("drops leading dots (a hidden file) and trailing dots and spaces", () => {
    expect(offeredFileName("..hidden.xlsx", "xlsx")).toBe("hidden.xlsx");
    expect(offeredFileName("  name . .xlsx", "xlsx")).toBe("name.xlsx");
    expect(offeredFileName("name...", "csv")).toBe("name.csv");
  });

  it("offers a plain name when nothing usable is left", () => {
    expect(offeredFileName("", "xlsx")).toBe("File.xlsx");
    expect(offeredFileName("...", "csv")).toBe("File.csv");
    expect(offeredFileName("   ", "csv")).toBe("File.csv");
    expect(offeredFileName(".xlsx", "xlsx")).toBe("File.xlsx");
    expect(offeredFileName("???", "csv")).toBe("_.csv");
  });

  it("shortens a long name to 100 characters before the extension, never splitting a character", () => {
    const long = offeredFileName(`${"a".repeat(500)}.xlsx`, "xlsx");
    expect(long).toBe(`${"a".repeat(100)}.xlsx`);

    const emoji = offeredFileName(`${"😀".repeat(500)}.csv`, "csv");
    expect(emoji).toBe(`${"😀".repeat(100)}.csv`);
  });
});
