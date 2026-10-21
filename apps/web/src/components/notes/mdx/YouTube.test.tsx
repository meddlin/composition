// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { YouTube } from "./YouTube";

describe("YouTube", () => {
  afterEach(cleanup);

  it("plays the video in a player, built from the id", () => {
    render(<YouTube url="https://youtu.be/dQw4w9WgXcQ?t=90" />);

    const player = screen.getByTitle("YouTube video");
    expect(player.tagName).toBe("IFRAME");
    expect(player.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=90");
    expect(player.hasAttribute("allowfullscreen")).toBe(true);
  });

  it("names the player with title, and lets start override the link", () => {
    render(<YouTube url="dQw4w9WgXcQ" start="1:05" title="Demo of the feature" />);

    expect(screen.getByTitle("Demo of the feature").getAttribute("src")).toContain("start=65");
  });

  it("never lets the note choose the frame's address", () => {
    const { container } = render(<YouTube url={'https://youtu.be/dQw4w9WgXcQ"><script>x</script>'} />);

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it.each(["https://example.com/video", "javascript:alert(1)", "dQw4w9WgXc"])("shows a notice instead of a player for %j", (url) => {
    const { container } = render(<YouTube url={url} />);

    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("img", { name: "YouTube video not found" }).textContent).toBe(`Not a YouTube video: ${url}`);
  });

  it("asks for a url when there is none yet", () => {
    render(<YouTube />);

    expect(screen.getByRole("img", { name: "YouTube video not found" }).textContent).toBe("YouTube video: add a url");
  });
});
