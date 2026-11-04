// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { afterEach, expect, vi } from "vitest";
import { saveImage } from "@/lib/composition/client";
import { describeParity } from "./parityHarness";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const pngFile = (name = "image.png") => new File([PNG_BYTES], name, { type: "image/png" });

afterEach(() => vi.mocked(saveImage).mockReset());

// Pasting pictures, in the plain Markdown editor and the live one.
describeParity("MarkdownEditor pasted images", (scenario) => {
  scenario("saves a pasted image against the note and inserts Markdown for it at the caret", async ({ render }) => {
    vi.mocked(saveImage).mockResolvedValue({ name: "trip-image-0123456789ab.png" });
    const editor = render({ initial: "before after" });
    editor.select(7, 7);

    const notCancelled = editor.paste([pngFile()]);

    expect(notCancelled).toBe(false);
    await waitFor(() => expect(editor.text()).toBe("before ![image](app_data/trip-image-0123456789ab.png)after"));
    expect(saveImage).toHaveBeenCalledWith({ noteId: 7, fileName: "image.png", data: PNG_BYTES });
  });

  scenario("shows a placeholder while the upload is in flight", async ({ render }) => {
    let finish: (result: { name: string }) => void = () => {};
    vi.mocked(saveImage).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const editor = render({ initial: "" });

    editor.paste([pngFile()]);

    expect(editor.text()).toMatch(/^\[Uploading image \(\d+\)…\]$/);
    finish({ name: "a-image-0123456789ab.png" });
    await waitFor(() => expect(editor.text()).toBe("![image](app_data/a-image-0123456789ab.png)"));
  });

  scenario("replaces the selected text", async ({ render }) => {
    vi.mocked(saveImage).mockResolvedValue({ name: "n-image-0123456789ab.png" });
    const editor = render({ initial: "keep DROP keep" });
    editor.select(5, 9);

    editor.paste([pngFile()]);

    await waitFor(() => expect(editor.text()).toBe("keep ![image](app_data/n-image-0123456789ab.png) keep"));
  });

  scenario("inserts several pasted images one after another", async ({ render }) => {
    vi.mocked(saveImage).mockImplementation(async ({ fileName }) => ({ name: `n-${fileName}` }));
    const editor = render({ initial: "" });

    editor.paste([pngFile("a.png"), pngFile("b.png")]);

    await waitFor(() => expect(editor.text()).toBe("![a](app_data/n-a.png)![b](app_data/n-b.png)"));
  });

  scenario("removes the placeholder and says why when the image is refused", async ({ render }) => {
    vi.mocked(saveImage).mockResolvedValue({ error: "Only PNG, JPEG, GIF, and WebP images are supported." });
    const editor = render({ initial: "text" });
    editor.select(4, 4);

    editor.paste([pngFile()]);

    await waitFor(() => expect(editor.text()).toBe("text"));
    expect(screen.getByRole("alert").textContent).toBe("Only PNG, JPEG, GIF, and WebP images are supported.");
  });

  scenario("recovers when the upload itself fails", async ({ render }) => {
    vi.mocked(saveImage).mockRejectedValue(new Error("network"));
    const editor = render({ initial: "" });

    editor.paste([pngFile()]);

    await waitFor(() => expect(editor.text()).toBe(""));
    expect(screen.getByRole("alert").textContent).toBe("Could not save the image.");
  });

  scenario("does not upload an image over the size limit", ({ render }) => {
    const editor = render({ initial: "" });
    const huge = pngFile();
    Object.defineProperty(huge, "size", { value: 11 * 1024 * 1024 });

    editor.paste([huge]);

    expect(saveImage).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/at most 10 MB/);
    expect(editor.text()).toBe("");
  });

  scenario("leaves an ordinary text paste alone", ({ render, mode }) => {
    const editor = render({ initial: "" });

    const notCancelled = editor.paste([], "just text");

    expect(saveImage).not.toHaveBeenCalled();
    if (mode === "markdown") {
      // The browser pastes into a textarea, so all there is to check is that nothing cancelled the paste.
      expect(notCancelled).toBe(true);
    } else {
      // The live editor pastes the text itself.
      expect(editor.text()).toBe("just text");
    }
  });

  scenario("prefers the text when the clipboard holds both text and a picture of it", ({ render, mode }) => {
    const editor = render({ initial: "" });

    const notCancelled = editor.paste([pngFile()], "A1\tB1");

    expect(saveImage).not.toHaveBeenCalled();
    if (mode === "markdown") expect(notCancelled).toBe(true);
    else expect(editor.text()).toBe("A1\tB1");
  });

  scenario("ignores pasted files that aren't images", ({ render }) => {
    const editor = render({ initial: "" });

    editor.paste([new File(["x"], "notes.txt", { type: "text/plain" })]);

    expect(saveImage).not.toHaveBeenCalled();
    expect(editor.text()).toBe("");
  });
});
