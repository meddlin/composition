// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageInfo } from "@/lib/composition/api";
import { ImageLibrary } from "./ImageLibrary";
import { ImagesScreen } from "./ImagesScreen";

const images: ImageInfo[] = [
  {
    name: "trip-plan-route-map-111111111111.png",
    size: 2 * 1024 * 1024,
    modifiedAt: "2026-03-01T10:00:00.000Z",
    usedIn: [
      { id: 1, title: "Trip plan" },
      { id: 2, title: "  " },
    ],
  },
  { name: "groceries-image-222222222222.jpg", size: 2048, modifiedAt: "2026-02-01T10:00:00.000Z", usedIn: [] },
];

const cards = () => screen.getAllByRole("button").filter((b) => b.querySelector("img"));

describe("ImageLibrary", () => {
  afterEach(cleanup);

  it("shows every image with its name and whether a note uses it", () => {
    render(<ImageLibrary images={images} />);

    expect(cards().map((c) => c.textContent)).toEqual([
      "trip-plan-route-map-111111111111.pngUsed in 2 notes",
      "groceries-image-222222222222.jpgNot used",
    ]);
    expect(cards()[0].querySelector("img")?.getAttribute("src")).toBe("/app_data/trip-plan-route-map-111111111111.png");
  });

  it("tells a new user how images get here", () => {
    render(<ImageLibrary images={[]} />);

    expect(screen.getByText(/Paste an image into a note/)).toBeTruthy();
  });

  it("narrows by file name", () => {
    render(<ImageLibrary images={images} />);

    fireEvent.change(screen.getByLabelText("Filter images"), { target: { value: "grocer" } });
    expect(cards()).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Filter images"), { target: { value: "nothing" } });
    expect(screen.getByText("No images match.")).toBeTruthy();
  });

  it("can show only the images no note uses", () => {
    render(<ImageLibrary images={images} />);

    fireEvent.click(screen.getByRole("button", { name: "Not used (1)" }));

    expect(cards().map((c) => c.textContent)).toEqual(["groceries-image-222222222222.jpgNot used"]);
    expect(screen.getByRole("button", { name: "Not used (1)" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("says so when every image is used", () => {
    render(<ImageLibrary images={[images[0]]} />);

    fireEvent.click(screen.getByRole("button", { name: "Not used (0)" }));

    expect(screen.getByText("Every image is used in a note.")).toBeTruthy();
  });

  it("opens an image's details: size, date and the notes that use it", () => {
    render(<ImageLibrary images={images} />);

    fireEvent.click(cards()[0]);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("2.0 MB · added 2026-03-01")).toBeTruthy();
    expect(within(dialog).getByText("Used in 2 notes")).toBeTruthy();
    expect(within(dialog).getByText("Trip plan")).toBeTruthy();
    expect(within(dialog).getByText("Untitled")).toBeTruthy();
  });

  it("says nothing refers to an image that is not used, and closes on Escape", () => {
    render(<ImageLibrary images={images} />);

    fireEvent.click(cards()[1]);
    expect(within(screen.getByRole("dialog")).getByText(/Nothing refers to this file now/)).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("copies the Markdown, or the component, to paste into a note", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ImageLibrary images={images} />);
    fireEvent.click(cards()[0]);

    fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));
    await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
    expect(writeText).toHaveBeenLastCalledWith("![trip plan route map](app_data/trip-plan-route-map-111111111111.png)");

    fireEvent.click(screen.getByRole("button", { name: "Copy Component" }));
    expect(writeText).toHaveBeenLastCalledWith('<Image src="app_data/trip-plan-route-map-111111111111.png" alt="" />');
  });

  it("says when the clipboard refuses", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<ImageLibrary images={images} />);
    fireEvent.click(cards()[0]);

    fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));

    await waitFor(() => expect(screen.getByText("Couldn't copy")).toBeTruthy());
  });
});

describe("ImagesScreen", () => {
  afterEach(cleanup);

  it("has a heading and a way back to the notes", () => {
    render(<ImagesScreen images={images} />);

    expect(screen.getByRole("heading", { name: "Images" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to notes/ }).getAttribute("href")).toBe("/");
  });
});
