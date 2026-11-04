// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { fromReactKey, placeMenu, useTextareaSurface, type EditorSurface } from "./editorSurface";
import { MENU_WIDTH_PX } from "./MdxCompletionMenu";

/** A surface that is only a place on screen: the line at `at`, in a box `width` by `height`. */
function surfaceAt(at: { left: number; top: number; height?: number }, box = { width: 400, height: 300 }): EditorSurface {
  return {
    text: () => "",
    selection: () => ({ start: 0, end: 0 }),
    replace: () => {},
    setSelection: () => {},
    coordsAt: () => ({ height: 24, ...at }),
    box: () => box,
    hasFocus: () => true,
  };
}

describe("placeMenu", () => {
  it("goes under the line, a little way below it", () => {
    expect(placeMenu(surfaceAt({ left: 10, top: 20 }), 0)).toEqual({ left: 10, top: 48 });
  });

  it("stays inside the box on the right and on the left", () => {
    expect(placeMenu(surfaceAt({ left: 390, top: 20 }), 0).left).toBe(400 - MENU_WIDTH_PX);
    expect(placeMenu(surfaceAt({ left: -30, top: 20 }), 0).left).toBe(0);
  });

  it("sits at the left edge when the box is narrower than the menu", () => {
    expect(placeMenu(surfaceAt({ left: 50, top: 20 }, { width: 100, height: 300 }), 0).left).toBe(0);
  });

  it("goes above the line when it would run off the bottom, measured from the bottom of the box", () => {
    expect(placeMenu(surfaceAt({ left: 10, top: 250 }), 0)).toEqual({ left: 10, bottom: 300 - 250 + 4 });
  });

  it("goes below anyway when there is no more room above than below", () => {
    // 100 down in a box 250 tall: 200 for the menu fits neither way, and above has less.
    expect(placeMenu(surfaceAt({ left: 10, top: 100 }, { width: 400, height: 250 }), 0)).toEqual({ left: 10, top: 128 });
  });

  it("uses the menu height and width it is given", () => {
    // 100 down with a 40-high menu fits below; with the default it would not fit in this box.
    expect(placeMenu(surfaceAt({ left: 380, top: 100 }, { width: 400, height: 200 }), 0, 40, 100)).toEqual({ left: 300, top: 128 });
  });
});

describe("fromReactKey", () => {
  const react = (init: Partial<KeyboardEvent> & { isComposing?: boolean }) => {
    const preventDefault = vi.fn(() => {
      event.defaultPrevented = true;
    });
    const event = {
      key: "a",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      repeat: false,
      defaultPrevented: false,
      preventDefault,
      nativeEvent: { isComposing: init.isComposing ?? false },
      ...init,
    } as unknown as KeyboardEvent & { defaultPrevented: boolean };
    return event;
  };

  it("reads what the writing features read, including composition from the native event", () => {
    const key = fromReactKey(react({ key: "k", ctrlKey: true, shiftKey: true, isComposing: true }));

    expect(key).toMatchObject({ key: "k", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, repeat: false, isComposing: true });
  });

  it("is the same event: preventing it prevents the original, and that shows", () => {
    const event = react({});
    const key = fromReactKey(event);
    expect(key.defaultPrevented).toBe(false);

    key.preventDefault();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(key.defaultPrevented).toBe(true);
  });
});

describe("useTextareaSurface", () => {
  function setup() {
    const el = document.createElement("textarea");
    el.value = "hello world";
    document.body.append(el);
    const replace = vi.fn();
    const ref = { current: el as HTMLTextAreaElement | null };
    const hook = renderHook(({ replace: fn }) => useTextareaSurface(ref, fn), { initialProps: { replace } });
    return { el, ref, replace, hook };
  }

  it("reads the textarea as it is when asked", () => {
    const { el, hook } = setup();
    el.setSelectionRange(2, 5);

    expect(hook.result.current.text()).toBe("hello world");
    expect(hook.result.current.selection()).toEqual({ start: 2, end: 5 });

    el.value = "changed";
    expect(hook.result.current.text()).toBe("changed");
  });

  it("has no text and no caret before the textarea is there", () => {
    const { ref, hook } = setup();
    ref.current = null;

    expect(hook.result.current.text()).toBe("");
    expect(hook.result.current.selection()).toEqual({ start: 0, end: 0 });
    expect(hook.result.current.hasFocus()).toBe(false);
    expect(() => hook.result.current.setSelection(0, 1)).not.toThrow();
  });

  it("moves the selection, and knows about focus", () => {
    const { el, hook } = setup();

    hook.result.current.setSelection(1, 3);
    expect(hook.result.current.selection()).toEqual({ start: 1, end: 3 });

    expect(hook.result.current.hasFocus()).toBe(false);
    el.focus();
    expect(hook.result.current.hasFocus()).toBe(true);
  });

  it("puts the caret after the new text unless told where", () => {
    const { replace, hook } = setup();

    hook.result.current.replace(0, 5, "howdy");
    hook.result.current.replace(0, 5, "<Info></Info>", 6);

    expect(replace).toHaveBeenNthCalledWith(1, 0, 5, "howdy", 5);
    expect(replace).toHaveBeenNthCalledWith(2, 0, 5, "<Info></Info>", 6);
  });

  it("stays the same surface across renders but always uses the latest way of replacing", () => {
    const { hook } = setup();
    const first = hook.result.current;
    const later = vi.fn();

    hook.rerender({ replace: later });
    expect(hook.result.current).toBe(first);
    first.replace(0, 1, "x");

    expect(later).toHaveBeenCalledWith(0, 1, "x", 1);
  });
});
