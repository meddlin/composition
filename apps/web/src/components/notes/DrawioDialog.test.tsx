// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveImage } from "@/lib/composition/client";
import { dataUriFromPngBytes, loadMessage } from "@/lib/composition/drawio";
import { DrawioDialog, type DrawioSource } from "./DrawioDialog";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A PNG whose chunks are as given, with a zero CRC. */
function png(...chunks: [string, string | number[]][]): Uint8Array {
  const out: number[] = [...SIGNATURE];
  for (const [type, data] of chunks) {
    const bytes = typeof data === "string" ? [...data].map((c) => c.charCodeAt(0)) : data;
    out.push(0, 0, (bytes.length >>> 8) & 255, bytes.length & 255, ...[...type].map((c) => c.charCodeAt(0)), ...bytes, 0, 0, 0, 0);
  }
  return Uint8Array.from(out);
}
const DIAGRAM_PNG = png(["IHDR", new Array(13).fill(0)], ["tEXt", "mxfile\u0000x"], ["IEND", []]);
const PLAIN_PNG = png(["IHDR", new Array(13).fill(0)], ["IEND", []]);

const ORIGIN = window.location.origin;
const frame = () => screen.getByTitle("draw.io editor") as HTMLIFrameElement;

/** What the editor says, as if it came from the iframe. */
function editorSays(message: object, from: { source?: unknown; origin?: string } = {}) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify(message),
        origin: from.origin ?? ORIGIN,
        source: (from.source ?? frame().contentWindow) as MessageEventSource,
      }),
    );
  });
}

function open(source: DrawioSource = { kind: "new" }) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<DrawioDialog open noteId={7} source={source} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
}

/** Spies on what is posted to the editor. */
function posts() {
  const spy = vi.spyOn(frame().contentWindow!, "postMessage").mockImplementation(() => {});
  return () => spy.mock.calls.map(([message, origin]) => ({ message: JSON.parse(message as string), origin }));
}

beforeEach(() => {
  vi.mocked(saveImage).mockResolvedValue({ name: "note-diagram-0123456789ab.png" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("DrawioDialog", () => {
  it("renders nothing while closed", () => {
    render(<DrawioDialog open={false} noteId={7} source={{ kind: "new" }} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.queryByTitle("draw.io editor")).toBeNull();
  });

  it("opens the offline editor in an iframe, and says it is waiting for it", () => {
    open();

    expect(frame().getAttribute("src")).toMatch(/^\/drawio\/index\.html\?.*offline=1/);
    expect(screen.getByRole("status").textContent).toBe("Loading the editor…");
    expect((screen.getByRole("button", { name: "Save diagram" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("gives a new diagram an empty drawing when the editor is ready, to the editor's origin only", () => {
    open();
    const posted = posts();

    editorSays({ event: "init" });

    expect(posted()).toEqual([{ message: JSON.parse(loadMessage(null)), origin: ORIGIN }]);
  });

  it("can be saved once the drawing is loaded", () => {
    open();
    editorSays({ event: "init" });
    editorSays({ event: "load" });

    expect((screen.getByRole("button", { name: "Save diagram" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("asks for the PNG on Save, stores what comes back under the note, and reports its name", async () => {
    const { onSaved } = open();
    const posted = posts();
    editorSays({ event: "load" });

    fireEvent.click(screen.getByRole("button", { name: "Save diagram" }));
    expect(posted().map((p) => p.message.action)).toEqual(["export"]);
    editorSays({ event: "export", data: dataUriFromPngBytes(DIAGRAM_PNG) });

    await waitFor(() => expect(onSaved).toHaveBeenCalledExactlyOnceWith("note-diagram-0123456789ab.png"));
    expect(saveImage).toHaveBeenCalledExactlyOnceWith({ noteId: 7, fileName: "diagram.png", data: DIAGRAM_PNG });
  });

  it("saves on the editor's own save too (Ctrl/Cmd+S inside it)", () => {
    open();
    const posted = posts();
    editorSays({ event: "load" });

    editorSays({ event: "save" });

    expect(posted().map((p) => p.message.action)).toEqual(["export"]);
  });

  it("says why when the diagram cannot be stored, and stays open to try again", async () => {
    vi.mocked(saveImage).mockResolvedValue({ error: "Images can only be PNG, JPEG, GIF or WebP." });
    const { onSaved, onClose } = open();
    posts();
    editorSays({ event: "load" });
    fireEvent.click(screen.getByRole("button", { name: "Save diagram" }));

    editorSays({ event: "export", data: dataUriFromPngBytes(DIAGRAM_PNG) });

    expect((await screen.findByRole("alert")).textContent).toBe("Images can only be PNG, JPEG, GIF or WebP.");
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Save diagram" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says so when the editor returns something that is not a picture", async () => {
    open();
    posts();
    editorSays({ event: "load" });
    fireEvent.click(screen.getByRole("button", { name: "Save diagram" }));

    editorSays({ event: "export", data: "not a data address" });

    expect((await screen.findByRole("alert")).textContent).toBe("The editor did not return a picture.");
    expect(saveImage).not.toHaveBeenCalled();
  });

  it("ignores messages that are not from its own editor", () => {
    open();
    const posted = posts();

    editorSays({ event: "init" }, { origin: "https://evil.example" });
    editorSays({ event: "init" }, { source: window });
    editorSays({ event: "load" }, { origin: "https://evil.example" });
    editorSays({ event: "export", data: dataUriFromPngBytes(DIAGRAM_PNG) }, { origin: "https://evil.example" });

    expect(posted()).toEqual([]);
    expect((screen.getByRole("button", { name: "Save diagram" }) as HTMLButtonElement).disabled).toBe(true);
    expect(saveImage).not.toHaveBeenCalled();
  });

  it("does not store an export it did not ask for", () => {
    open();
    posts();
    editorSays({ event: "load" });

    editorSays({ event: "export", data: dataUriFromPngBytes(DIAGRAM_PNG) });

    expect(saveImage).not.toHaveBeenCalled();
  });

  describe("cancelling", () => {
    it("closes at once when nothing was drawn", () => {
      const { onClose } = open();
      editorSays({ event: "load" });

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onClose).toHaveBeenCalledOnce();
    });

    it("asks first when something was drawn, and Keep editing carries on", () => {
      const { onClose } = open();
      editorSays({ event: "load" });
      editorSays({ event: "autosave", xml: "<x/>" });

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText("Discard what you drew?")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Save diagram" })).toBeTruthy();
    });

    it("closes on Discard", () => {
      const { onClose } = open();
      editorSays({ event: "load" });
      editorSays({ event: "autosave", xml: "<x/>" });

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));

      expect(onClose).toHaveBeenCalledOnce();
    });

    it("treats Escape as Cancel, so a keystroke cannot throw work away", () => {
      const { onClose } = open();
      editorSays({ event: "load" });
      editorSays({ event: "autosave", xml: "<x/>" });

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText("Discard what you drew?")).toBeTruthy();
    });
  });

  describe("editing a stored diagram", () => {
    function stubFetch(response: { ok?: boolean; bytes?: Uint8Array }) {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: response.ok ?? true,
        arrayBuffer: async () => (response.bytes ?? DIAGRAM_PNG).slice().buffer,
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    it("reads the stored picture first, and opens the editor on it", async () => {
      const fetchMock = stubFetch({});
      open({ kind: "edit", name: "flow-0123456789ab.png" });

      await waitFor(() => expect(frame()).toBeTruthy());
      expect(fetchMock).toHaveBeenCalledWith("/app_data/flow-0123456789ab.png");
      const posted = posts();
      editorSays({ event: "init" });

      expect(posted()[0].message).toEqual({ action: "load", autosave: 1, xmlpng: dataUriFromPngBytes(DIAGRAM_PNG) });
      expect(screen.getByRole("heading", { name: "Edit diagram" })).toBeTruthy();
    });

    it("says so, and opens no editor, for a picture with no diagram inside", async () => {
      stubFetch({ bytes: PLAIN_PNG });
      open({ kind: "edit", name: "photo-0123456789ab.png" });

      expect((await screen.findByRole("alert")).textContent).toMatch(/no diagram inside/);
      expect(screen.queryByTitle("draw.io editor")).toBeNull();
    });

    it("says so when the picture cannot be read", async () => {
      stubFetch({ ok: false });
      open({ kind: "edit", name: "gone-0123456789ab.png" });

      expect((await screen.findByRole("alert")).textContent).toBe("The diagram's picture could not be read.");
      expect(screen.queryByTitle("draw.io editor")).toBeNull();
    });
  });
});
