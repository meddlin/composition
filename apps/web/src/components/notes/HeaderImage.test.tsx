// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FrontmatterCard } from "./FrontmatterCard";
import { HeaderImage } from "./HeaderImage";
import { headerImageSrc } from "./headerImageSource";

vi.mock("@/lib/composition/imageUrl", () => ({ imageUrl: (name: string) => `/app_data/${name}` }));

afterEach(cleanup);

const fm = { title: "Trip", description: "", tags: [], createdAt: "", updatedAt: "" };
const image = () => document.querySelector("img");

describe("headerImageSrc", () => {
  it("serves a stored image from this build's own URL and an https address as written", () => {
    expect(headerImageSrc("app_data/trip-0123456789ab.png")).toBe("/app_data/trip-0123456789ab.png");
    expect(headerImageSrc("https://example.com/a.jpg")).toBe("https://example.com/a.jpg");
  });

  it.each([["javascript:alert(1)"], ["data:image/png;base64,AAAA"], ["app_data/../secret.png"], ["//evil.example/a.png"], ["a picture"], ["app_data/notes.txt"]])(
    "refuses %j",
    (ref) => {
      expect(headerImageSrc(ref)).toBeNull();
    },
  );
});

describe("HeaderImage", () => {
  it("crops a full-width image to a banner across the note", () => {
    render(<HeaderImage image="app_data/a.png" layout="full" />);

    expect(image()?.getAttribute("data-layout")).toBe("full");
    expect(image()?.className).toContain("w-full");
    expect(image()?.className).toContain("object-cover");
  });

  it("shows a centered image whole, in the middle", () => {
    render(<HeaderImage image="app_data/a.png" layout="centered" />);

    expect(image()?.getAttribute("data-layout")).toBe("centered");
    expect(image()?.className).toContain("mx-auto");
    expect(image()?.className).not.toContain("object-cover");
  });

  it("fades the lower edge out into the background in either layout", () => {
    const { rerender } = render(<HeaderImage image="app_data/a.png" layout="full" />);
    expect(image()?.style.maskImage).toContain("linear-gradient(");
    expect(image()?.style.maskImage).toContain("transparent");

    rerender(<HeaderImage image="app_data/a.png" layout="centered" />);
    expect(image()?.style.maskImage).toContain("transparent");
  });

  it("leaves nothing behind for a source it won't show, or a file that fails to load", () => {
    const { rerender } = render(<HeaderImage image="javascript:alert(1)" layout="full" />);
    expect(image()).toBeNull();

    rerender(<HeaderImage image="app_data/a.png" layout="full" />);
    fireEvent.error(image()!);
    expect(image()).toBeNull();
  });
});

describe("FrontmatterCard", () => {
  it("puts the header image above the title", () => {
    render(<FrontmatterCard fm={{ ...fm, headerImage: "app_data/a.png", headerImageLayout: "centered" }} />);

    const heading = screen.getByRole("heading", { name: "Trip" });
    expect(image()?.compareDocumentPosition(heading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(image()?.getAttribute("data-layout")).toBe("centered");
  });

  it("defaults to full width, and draws no image for a note without one", () => {
    const { rerender } = render(<FrontmatterCard fm={{ ...fm, headerImage: "app_data/a.png" }} />);
    expect(image()?.getAttribute("data-layout")).toBe("full");

    rerender(<FrontmatterCard fm={fm} />);
    expect(image()).toBeNull();
  });
});
