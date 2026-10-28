// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBackForward } from "./useBackForward";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness(props: { onBack: () => void; onForward: () => void }) {
  useBackForward(props.onBack, props.onForward);
  return null;
}

function setup() {
  const onBack = vi.fn();
  const onForward = vi.fn();
  render(<Harness onBack={onBack} onForward={onForward} />);
  return { onBack, onForward };
}

/** fireEvent returns false when something called preventDefault. */
const claimed = (result: boolean) => !result;

describe("useBackForward: mouse", () => {
  it("goes back on releasing the Back button and forward on the Forward button", () => {
    const { onBack, onForward } = setup();

    fireEvent.mouseUp(document.body, { button: 3 });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onForward).not.toHaveBeenCalled();

    fireEvent.mouseUp(document.body, { button: 4 });
    expect(onForward).toHaveBeenCalledTimes(1);
  });

  it("claims every part of the press so the browser does not navigate, but acts once", () => {
    const { onBack } = setup();

    expect(claimed(fireEvent.mouseDown(document.body, { button: 3 }))).toBe(true);
    expect(claimed(fireEvent.mouseUp(document.body, { button: 3 }))).toBe(true);
    expect(claimed(fireEvent(document.body, new MouseEvent("auxclick", { button: 3, bubbles: true, cancelable: true })))).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("leaves the other buttons alone", () => {
    const { onBack, onForward } = setup();

    for (const button of [0, 1, 2]) {
      expect(claimed(fireEvent.mouseUp(document.body, { button }))).toBe(false);
    }
    expect(onBack).not.toHaveBeenCalled();
    expect(onForward).not.toHaveBeenCalled();
  });

  it("does nothing while a dialog is open", () => {
    const { onBack } = setup();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "alertdialog");
    document.body.append(dialog);

    fireEvent.mouseUp(document.body, { button: 3 });
    expect(onBack).not.toHaveBeenCalled();
    dialog.remove();
  });

  it("calls the newest callback", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness onBack={first} onForward={vi.fn()} />);
    rerender(<Harness onBack={second} onForward={vi.fn()} />);

    fireEvent.mouseUp(document.body, { button: 3 });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops listening when unmounted", () => {
    const onBack = vi.fn();
    const { unmount } = render(<Harness onBack={onBack} onForward={vi.fn()} />);
    unmount();

    fireEvent.mouseUp(document.body, { button: 3 });
    expect(onBack).not.toHaveBeenCalled();
  });
});

describe("useBackForward: keys", () => {
  function asPlatform(platform: string) {
    vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  }

  it("uses Cmd+[ and Cmd+] on a Mac", () => {
    asPlatform("MacIntel");
    const { onBack, onForward } = setup();

    expect(claimed(fireEvent.keyDown(document.body, { key: "[", metaKey: true }))).toBe(true);
    fireEvent.keyDown(document.body, { key: "]", metaKey: true });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onForward).toHaveBeenCalledTimes(1);
  });

  it("leaves Alt+Arrow to the text field on a Mac", () => {
    asPlatform("MacIntel");
    const { onBack } = setup();

    expect(claimed(fireEvent.keyDown(document.body, { key: "ArrowLeft", altKey: true }))).toBe(false);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("uses Alt+Left and Alt+Right elsewhere", () => {
    asPlatform("Win32");
    const { onBack, onForward } = setup();

    fireEvent.keyDown(document.body, { key: "ArrowLeft", altKey: true });
    fireEvent.keyDown(document.body, { key: "ArrowRight", altKey: true });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onForward).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document.body, { key: "[", metaKey: true });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("ignores other modifiers and held-down repeats", () => {
    asPlatform("MacIntel");
    const { onBack } = setup();

    fireEvent.keyDown(document.body, { key: "[" });
    fireEvent.keyDown(document.body, { key: "[", metaKey: true, shiftKey: true });
    fireEvent.keyDown(document.body, { key: "[", metaKey: true, repeat: true });
    expect(onBack).not.toHaveBeenCalled();
  });
});
