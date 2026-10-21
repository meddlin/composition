// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listImages, saveImage } from "@/lib/composition/client";
import { HeaderImageDialog } from "./HeaderImageDialog";

vi.mock("@/lib/composition/client", () => ({ listImages: vi.fn(), saveImage: vi.fn() }));

const stored = (name: string) => ({ name, size: 1024, modifiedAt: "2026-01-01T00:00:00.000Z", usedIn: [] });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function open(header: { image: string; layout: "full" | "centered" } | null = null) {
  const onChange = vi.fn();
  render(<HeaderImageDialog noteId={7} open onOpenChange={() => {}} header={header} onChange={onChange} />);
  return onChange;
}

describe("HeaderImageDialog", () => {
  it("lists the stored images, and picks one with the layout chosen", async () => {
    vi.mocked(listImages).mockResolvedValue([stored("a-0123456789ab.png"), stored("b-0123456789ab.png")]);
    const onChange = open();

    fireEvent.click(await screen.findByRole("radio", { name: /Centered/ }));
    fireEvent.click(screen.getByRole("button", { name: "b-0123456789ab.png" }));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({ image: "app_data/b-0123456789ab.png", layout: "centered" });
  });

  it("defaults to full width", async () => {
    vi.mocked(listImages).mockResolvedValue([stored("a-0123456789ab.png")]);
    const onChange = open();

    fireEvent.click(await screen.findByRole("button", { name: "a-0123456789ab.png" }));

    expect(onChange).toHaveBeenCalledWith({ image: "app_data/a-0123456789ab.png", layout: "full" });
  });

  it("marks the image the note has now, and changing the layout keeps it", async () => {
    vi.mocked(listImages).mockResolvedValue([stored("a-0123456789ab.png"), stored("b-0123456789ab.png")]);
    const onChange = open({ image: "app_data/b-0123456789ab.png", layout: "full" });

    const current = await screen.findByRole("button", { name: "b-0123456789ab.png" });
    expect(current.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "a-0123456789ab.png" }).getAttribute("aria-pressed")).toBe("false");
    expect((screen.getByRole("radio", { name: /Full width/ }) as HTMLButtonElement).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: /Centered/ }));

    expect(onChange).toHaveBeenCalledWith({ image: "app_data/b-0123456789ab.png", layout: "centered" });
  });

  it("removes the header image, offering that only when there is one", async () => {
    vi.mocked(listImages).mockResolvedValue([]);
    const first = open({ image: "https://example.com/a.jpg", layout: "full" });

    fireEvent.click(await screen.findByRole("button", { name: "Remove header image" }));
    expect(first).toHaveBeenCalledWith(null);
    expect(screen.getByText(/Currently https:\/\/example.com\/a.jpg/)).toBeTruthy();

    cleanup();
    open(null);
    await screen.findByText(/No images yet. Upload one above/);
    expect(screen.queryByRole("button", { name: "Remove header image" })).toBeNull();
  });

  it("says so when the images can't be listed", async () => {
    vi.mocked(listImages).mockRejectedValue(new Error("nope"));
    open();

    await waitFor(() => expect(screen.getByText("Could not load the images.")).toBeTruthy());
  });

  describe("upload", () => {
    const pick = (file: File) => fireEvent.change(screen.getByLabelText("Upload an image file"), { target: { files: [file] } });
    const png = (name = "hero.png", bytes = 4) => new File([new Uint8Array(bytes)], name, { type: "image/png" });

    it("stores the file for this note and makes it the header, with the layout chosen", async () => {
      vi.mocked(listImages).mockResolvedValue([stored("a-0123456789ab.png")]);
      vi.mocked(saveImage).mockResolvedValue({ name: "trip-hero-0123456789cd.png" });
      const onChange = open();

      fireEvent.click(await screen.findByRole("radio", { name: /Centered/ }));
      pick(png("hero.png"));

      await waitFor(() => expect(onChange).toHaveBeenCalledWith({ image: "app_data/trip-hero-0123456789cd.png", layout: "centered" }));
      const call = vi.mocked(saveImage).mock.calls[0][0];
      expect(call).toMatchObject({ noteId: 7, fileName: "hero.png" });
      expect([...call.data]).toEqual([0, 0, 0, 0]);
      // It joins the grid, ahead of the others.
      expect(screen.getAllByRole("button", { name: /0123456789(ab|cd)\.png/ }).map((b) => b.getAttribute("aria-label"))).toEqual([
        "trip-hero-0123456789cd.png",
        "a-0123456789ab.png",
      ]);
    });

    it("says why when the file can't be saved, and leaves the header alone", async () => {
      vi.mocked(listImages).mockResolvedValue([]);
      vi.mocked(saveImage).mockResolvedValue({ error: "That file is not a PNG, JPEG, GIF or WebP image." });
      const onChange = open();
      await screen.findByText(/No images yet/);

      pick(png("notes.txt"));

      expect((await screen.findByRole("alert")).textContent).toContain("not a PNG, JPEG, GIF or WebP");
      expect(onChange).not.toHaveBeenCalled();
    });

    it("says so when the upload itself fails", async () => {
      vi.mocked(listImages).mockResolvedValue([]);
      vi.mocked(saveImage).mockRejectedValue(new Error("offline"));
      open();
      await screen.findByText(/No images yet/);

      pick(png());

      expect((await screen.findByRole("alert")).textContent).toBe("Could not save the image.");
    });

    it("refuses a file over the size limit without sending it", async () => {
      vi.mocked(listImages).mockResolvedValue([]);
      const onChange = open();
      await screen.findByText(/No images yet/);

      pick(png("huge.png", 10 * 1024 * 1024 + 1));

      expect((await screen.findByRole("alert")).textContent).toBe("Images can be at most 10 MB.");
      expect(saveImage).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
