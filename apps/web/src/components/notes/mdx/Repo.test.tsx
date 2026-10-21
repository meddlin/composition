// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Repo } from "./Repo";

describe("Repo", () => {
  afterEach(cleanup);

  it("is a card that opens the repository in a new tab", () => {
    render(<Repo url="https://github.com/meddlin/composition/tree/main" />);

    const card = screen.getByRole("link");
    expect(card.getAttribute("href")).toBe("https://github.com/meddlin/composition");
    expect(card.getAttribute("target")).toBe("_blank");
    expect(card.getAttribute("rel")).toBe("noopener noreferrer");
    expect(card.textContent).toBe("meddlin/compositionGitHub · github.com");
  });

  it("shows the description, and the host of one it doesn't know by name", () => {
    render(<Repo url="git@git.example.com:team/tool.git" description="Builds the thing" />);

    expect(screen.getByRole("link").textContent).toBe("team/toolBuilds the thinggit.example.com");
  });

  it("never lets the note choose the link's address", () => {
    const { container } = render(<Repo url={'https://github.com/a/b"><script>x</script>'} />);

    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it.each(["https://example.com/", "javascript:alert(1)", "owner/repo"])("shows a notice instead of a card for %j", (url) => {
    const { container } = render(<Repo url={url} />);

    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByRole("img", { name: "Repository not found" }).textContent).toBe(`Not a repository address: ${url}`);
  });

  it("asks for a url when there is none yet", () => {
    render(<Repo />);

    expect(screen.getByRole("img", { name: "Repository not found" }).textContent).toBe("Repository: add a url");
  });
});
