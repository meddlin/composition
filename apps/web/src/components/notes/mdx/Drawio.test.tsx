// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DrawioEditContext } from "../DrawioEdit";
import { Drawio } from "./Drawio";

afterEach(cleanup);

function renderDiagram(props: Parameters<typeof Drawio>[0], edit?: (name: string) => void) {
  return render(
    <DrawioEditContext.Provider value={edit ? { edit } : null}>
      <Drawio {...props} />
    </DrawioEditContext.Provider>,
  );
}

describe("Drawio", () => {
  it("shows the stored picture, with its alt text", () => {
    renderDiagram({ src: "app_data/flow-0123456789ab.png", alt: "Request flow" });

    const image = screen.getByRole("img", { name: "Request flow" });
    expect(image.getAttribute("src")).toBe("/app_data/flow-0123456789ab.png");
  });

  it("draws the picture at half its pixels, since a diagram is stored at twice the size it is drawn", () => {
    renderDiagram({ src: "app_data/flow-0123456789ab.png", alt: "Flow" });
    const image = screen.getByRole("img", { name: "Flow" }) as HTMLImageElement;
    Object.defineProperty(image, "naturalWidth", { value: 800 });

    fireEvent.load(image);

    expect(image.style.width).toBe("400px");
  });

  it("takes a width as <Image> does, which wins over the picture's own size", () => {
    const { container } = renderDiagram({ src: "app_data/flow-0123456789ab.png", alt: "Flow", width: "50%" });
    const image = screen.getByRole("img", { name: "Flow" }) as HTMLImageElement;
    Object.defineProperty(image, "naturalWidth", { value: 800 });

    fireEvent.load(image);

    // The box has the width; the picture fills it.
    expect((container.firstElementChild as HTMLElement).style.width).toBe("50%");
    expect(image.style.width).toBe("100%");
  });

  it("opens the editor on the stored file from its Edit button", () => {
    const edit = vi.fn();
    renderDiagram({ src: "app_data/flow-0123456789ab.png", alt: "Flow" }, edit);

    fireEvent.click(screen.getByRole("button", { name: "Edit diagram" }));

    expect(edit).toHaveBeenCalledExactlyOnceWith("flow-0123456789ab.png");
  });

  it("has no Edit button where nothing can change the note", () => {
    renderDiagram({ src: "app_data/flow-0123456789ab.png", alt: "Flow" });

    expect(screen.queryByRole("button", { name: "Edit diagram" })).toBeNull();
  });

  it("has no Edit button for a picture that is not stored with the notes, which is only shown", () => {
    renderDiagram({ src: "https://example.com/flow.png", alt: "Remote" }, vi.fn());

    expect(screen.getByRole("img", { name: "Remote" }).getAttribute("src")).toBe("https://example.com/flow.png");
    expect(screen.queryByRole("button", { name: "Edit diagram" })).toBeNull();
  });

  it("says what is missing, rather than showing nothing, without a src", () => {
    renderDiagram({ alt: "Flow" }, vi.fn());

    expect(screen.getByText("Diagram: add a src")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
