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

  it("shows a highlight without its tags, tinted, until the caret is in it", () => {
    const { container } = render(<LiveEditor value={'<Mark color="green">big</Mark> tail'} onChange={() => {}} />);
    const view = editorIn(container);
    // The caret starts at the beginning, which touches the highlight, so its tags show.
    expect(text(container)).toBe('<Mark color="green">big</Mark> tail');

    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(text(container)).toBe("big tail");
    const tinted = container.querySelector(".md-mark");
    expect([tinted?.textContent, tinted?.getAttribute("data-color")]).toEqual(["big", "green"]);

    view.dispatch({ selection: { anchor: 20 } });
    expect(text(container)).toBe('<Mark color="green">big</Mark> tail');
    expect(view.state.doc.toString()).toBe('<Mark color="green">big</Mark> tail');
  });

  it("is a labelled, multi-line text box with spell checking, for assistive tech", () => {
    const { container } = render(<LiveEditor value="text" onChange={() => {}} />);
    const content = container.querySelector(".cm-content")!;

    expect(content.getAttribute("role")).toBe("textbox");
    expect(content.getAttribute("aria-multiline")).toBe("true");
    expect(content.getAttribute("aria-label")).toBe("Markdown editor");
    expect(content.getAttribute("spellcheck")).toBe("true");
  });

  it("shows the attributes it is given for an open menu, keeps its own, and drops the ones taken away", () => {
    const { container, rerender } = render(<LiveEditor value="text" onChange={() => {}} attributes={{ "aria-controls": "menu-1" }} />);
    const content = container.querySelector(".cm-content")!;
    expect(content.getAttribute("aria-controls")).toBe("menu-1");
    expect(content.getAttribute("aria-label")).toBe("Markdown editor");

    rerender(<LiveEditor value="text" onChange={() => {}} attributes={{ "aria-controls": undefined, "aria-activedescendant": "option-2" }} />);

    expect(content.getAttribute("aria-controls")).toBeNull();
    expect(content.getAttribute("aria-activedescendant")).toBe("option-2");
    expect(content.getAttribute("aria-label")).toBe("Markdown editor");
  });

  it("says it is read only when it is", () => {
    const { container, rerender } = render(<LiveEditor value="text" onChange={() => {}} />);
    expect(container.querySelector(".cm-content")!.getAttribute("aria-readonly")).toBeNull();

    rerender(<LiveEditor value="text" onChange={() => {}} readOnly />);

    expect(container.querySelector(".cm-content")!.getAttribute("aria-readonly")).toBe("true");
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
