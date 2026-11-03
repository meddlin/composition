// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveEditor } from "./LiveEditor";

const text = (container: HTMLElement) => container.querySelector(".cm-content")!.textContent;
const editorIn = (container: HTMLElement) => EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;

describe("LiveEditor", () => {
  afterEach(cleanup);

  it("shows the note's Markdown, marks and all, until the caret is elsewhere", () => {
    const { container } = render(<LiveEditor value={"**bold** tail"} onChange={() => {}} />);
    // The caret starts at the beginning, which touches the bold, so its marks show.
    expect(text(container)).toBe("**bold** tail");

    const view = editorIn(container);
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(text(container)).toBe("bold tail");
    // Hidden is not deleted.
    expect(view.state.doc.toString()).toBe("**bold** tail");
  });

  it("takes on text changed from outside without reporting it as typing", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<LiveEditor value="one" onChange={onChange} />);

    rerender(<LiveEditor value="one two" onChange={onChange} />);

    expect(editorIn(container).state.doc.toString()).toBe("one two");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports typing", () => {
    const onChange = vi.fn();
    const { container } = render(<LiveEditor value="one" onChange={onChange} />);

    editorIn(container).dispatch({ changes: { from: 3, insert: " two" } });

    expect(onChange).toHaveBeenCalledWith("one two");
  });

  it("refuses typing when read only", () => {
    const onChange = vi.fn();
    const { container } = render(<LiveEditor value="one" onChange={onChange} readOnly />);
    const view = editorIn(container);

    expect(view.state.readOnly).toBe(true);
    // Key handling is what honours read-only; this is the state that tells it to.
    expect(view.contentDOM.getAttribute("aria-readonly")).toBe("true");
  });

  it("counts and highlights what the find bar looks for", () => {
    const onFindCount = vi.fn();
    const { container } = render(
      <LiveEditor value="Cat and cat" onChange={() => {}} findQuery="cat" findOptions={{ matchCase: false, wholeWord: false }} onFindCount={onFindCount} />,
    );

    expect(onFindCount).toHaveBeenLastCalledWith(2);
    expect(container.querySelectorAll(".find-match, .find-current")).toHaveLength(2);
    expect(container.querySelectorAll(".find-current")).toHaveLength(1);
  });
});
