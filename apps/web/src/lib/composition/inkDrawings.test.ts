import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conformancePath } from "./__fixtures__/conformance";
import { forgetInkDrawings, loadInkDrawing } from "./inkDrawings";

const sample = fs.readFileSync(conformancePath("ink/sample.png"));
const respond = (body: Uint8Array | string, status = 200) => new Response(body as BodyInit, { status });

const fetchMock = vi.fn<(url: string) => Promise<Response>>();

beforeEach(() => {
  forgetInkDrawings();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("loadInkDrawing", () => {
  it("fetches the stored image from where this build serves them and reads its strokes", async () => {
    fetchMock.mockResolvedValue(respond(sample));
    const drawing = await loadInkDrawing("sketch-0123456789ab.png");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/app_data/sketch-0123456789ab.png");
    expect(drawing?.strokes).toHaveLength(4);
  });

  it("asks once for a drawing it is asked for again", async () => {
    fetchMock.mockImplementation(async () => respond(sample));
    const first = await loadInkDrawing("a.png");
    expect(await loadInkDrawing("a.png")).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forgets the oldest drawings, so a long session does not keep every one", async () => {
    fetchMock.mockImplementation(async () => respond(sample));
    for (let index = 0; index < 30; index++) await loadInkDrawing(`d${index}.png`);
    expect(fetchMock).toHaveBeenCalledTimes(30);
    await loadInkDrawing("d29.png");
    expect(fetchMock).toHaveBeenCalledTimes(30);
    await loadInkDrawing("d0.png");
    expect(fetchMock).toHaveBeenCalledTimes(31);
  });

  it("is null for a PNG that is only a picture, and for one that is not a PNG at all", async () => {
    fetchMock.mockResolvedValueOnce(respond(new Uint8Array(sample.subarray(0, 40)))).mockResolvedValueOnce(respond("<html>not an image</html>"));
    expect(await loadInkDrawing("cut.png")).toBeNull();
    expect(await loadInkDrawing("html.png")).toBeNull();
  });

  it("fails when the file can't be fetched, and tries again the next time", async () => {
    fetchMock.mockResolvedValueOnce(respond("Not found", 404));
    await expect(loadInkDrawing("gone.png")).rejects.toThrow("404");
    fetchMock.mockResolvedValueOnce(respond(sample));
    expect((await loadInkDrawing("gone.png"))?.strokes).toHaveLength(4);
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(loadInkDrawing("offline.png")).rejects.toThrow("Failed to fetch");
  });
});
