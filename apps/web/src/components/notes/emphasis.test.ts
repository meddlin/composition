import { describe, expect, it } from "vitest";
import { emphasisFor, toggleEmphasis, type Emphasis } from "./emphasis";

/** Applies the toggle the way an editor would, and returns the new text and selected text. */
function toggle(text: string, from: number, to: number, emphasis: Emphasis) {
  const edit = toggleEmphasis(text, from, to, emphasis);
  if (!edit) return null;
  const next = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return { text: next, selected: next.slice(edit.selection.start, edit.selection.end) };
}

describe("emphasisFor", () => {
  const key = (k: string, init = {}) => ({ key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...init });

  it("is bold for Cmd+B or Ctrl+B and italic for Cmd+I or Ctrl+I", () => {
    expect(emphasisFor(key("b", { metaKey: true }))).toBe("bold");
    expect(emphasisFor(key("B", { ctrlKey: true }))).toBe("bold");
    expect(emphasisFor(key("i", { metaKey: true }))).toBe("italic");
    expect(emphasisFor(key("I", { ctrlKey: true }))).toBe("italic");
  });

  it("is nothing without Cmd or Ctrl, or with Shift or Alt", () => {
    expect(emphasisFor(key("b"))).toBeNull();
    expect(emphasisFor(key("b", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(emphasisFor(key("i", { metaKey: true, altKey: true }))).toBeNull();
    expect(emphasisFor(key("x", { metaKey: true }))).toBeNull();
  });
});

describe("toggleEmphasis", () => {
  it("wraps the selection in ** for bold and * for italic, and keeps it selected", () => {
    expect(toggle("a word here", 2, 6, "bold")).toEqual({ text: "a **word** here", selected: "word" });
    expect(toggle("a word here", 2, 6, "italic")).toEqual({ text: "a *word* here", selected: "word" });
  });

  it("takes the markers off again when pressed twice", () => {
    expect(toggle("a **word** here", 4, 8, "bold")).toEqual({ text: "a word here", selected: "word" });
    expect(toggle("a *word* here", 3, 7, "italic")).toEqual({ text: "a word here", selected: "word" });
  });

  it("takes them off when the selection includes the markers", () => {
    expect(toggle("a **word** here", 2, 10, "bold")).toEqual({ text: "a word here", selected: "word" });
    expect(toggle("a *word* here", 2, 8, "italic")).toEqual({ text: "a word here", selected: "word" });
  });

  it("treats three stars as both: each adds to or takes from the other", () => {
    expect(toggle("**word**", 2, 6, "italic")).toEqual({ text: "***word***", selected: "word" });
    expect(toggle("*word*", 1, 5, "bold")).toEqual({ text: "***word***", selected: "word" });
    expect(toggle("***word***", 3, 7, "italic")).toEqual({ text: "**word**", selected: "word" });
    expect(toggle("***word***", 3, 7, "bold")).toEqual({ text: "*word*", selected: "word" });
  });

  it("leaves spaces at the ends of the selection outside the markers", () => {
    expect(toggle("a word here", 1, 7, "bold")).toEqual({ text: "a **word** here", selected: "word" });
  });

  it("wraps a selection that spans lines as one", () => {
    expect(toggle("one\ntwo", 0, 7, "bold")).toEqual({ text: "**one\ntwo**", selected: "one\ntwo" });
  });

  it("does nothing with nothing selected, or only spaces", () => {
    expect(toggleEmphasis("a word", 2, 2, "bold")).toBeNull();
    expect(toggleEmphasis("a  b", 1, 3, "bold")).toBeNull();
  });

  it("marks a selection of only stars rather than unwrapping it", () => {
    expect(toggle("**", 0, 2, "italic")?.text).toBe("****");
  });
});
