// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SUN_SETTINGS_CHANGED } from "@/components/SunThemeSync";
import { saveSunPair, saveTheme } from "@/lib/composition/client";
import { ColorSchemeProvider, useColorScheme } from "./ColorSchemeProvider";

vi.mock("@/lib/composition/client", () => ({
  saveSunPair: vi.fn(async () => ({})),
  saveTheme: vi.fn(async () => ({})),
}));

const root = document.documentElement;
const heard = vi.fn();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  root.removeAttribute("data-theme");
  root.removeAttribute("data-sun-pair");
  window.removeEventListener(SUN_SETTINGS_CHANGED, heard);
});

/** Shows what the provider holds, with a button for each way to change it. */
function Probe() {
  const scheme = useColorScheme();
  return (
    <>
      <p>
        {scheme.theme} / {scheme.sunPair} / {scheme.themeError ?? scheme.sunPairError ?? "ok"}
      </p>
      <button onClick={() => scheme.selectTheme("forest")}>forest</button>
      <button onClick={() => scheme.selectTheme("auto")}>auto</button>
      <button onClick={() => scheme.selectSunPair("cream-amber")}>cream-amber</button>
      <button onClick={() => scheme.selectSunPair("mint-forest")}>mint-forest</button>
    </>
  );
}
const view = () =>
  render(
    <ColorSchemeProvider initialTheme="dark" initialSunPair="classic">
      <Probe />
    </ColorSchemeProvider>,
  );
const press = (name: string) => act(async () => void fireEvent.click(screen.getByRole("button", { name })));

describe("the color scheme", () => {
  it("is put on the page when the screen opens, and when another is picked", async () => {
    view();
    expect(root.dataset.theme).toBe("dark");

    await press("forest");

    expect(root.dataset.theme).toBe("forest");
    expect(saveTheme).toHaveBeenCalledWith("forest");
    expect(screen.getByText("forest / classic / ok")).toBeTruthy();
  });

  it("tells the sun sync to read the schedule once it is saved", async () => {
    view();
    window.addEventListener(SUN_SETTINGS_CHANGED, heard);

    await press("auto");

    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("goes back to the one before, and says why, when the save is refused", async () => {
    vi.mocked(saveTheme).mockResolvedValueOnce({ error: "Unknown color scheme." });
    view();
    window.addEventListener(SUN_SETTINGS_CHANGED, heard);

    await press("forest");

    expect(root.dataset.theme).toBe("dark");
    expect(screen.getByText("dark / classic / Unknown color scheme.")).toBeTruthy();
    expect(heard).not.toHaveBeenCalled();
  });
});

describe("the pair of Follow the sun colors", () => {
  it("is put on the page at once, saved, and the sun sync told", async () => {
    view();
    window.addEventListener(SUN_SETTINGS_CHANGED, heard);

    await press("cream-amber");

    expect(root.dataset.sunPair).toBe("cream-amber");
    expect(saveSunPair).toHaveBeenCalledWith("cream-amber");
    expect(heard).toHaveBeenCalled();
    expect(screen.getByText("dark / cream-amber / ok")).toBeTruthy();
  });

  it("goes back to the one before, on the page too, and says why, when the save is refused", async () => {
    vi.mocked(saveSunPair).mockResolvedValueOnce({ error: "Unknown pair of colors." });
    view();
    root.dataset.sunPair = "classic";

    await press("mint-forest");

    expect(root.dataset.sunPair).toBe("classic");
    expect(screen.getByText("dark / classic / Unknown pair of colors.")).toBeTruthy();
  });

  it("is chosen apart from the color scheme", async () => {
    view();

    await press("cream-amber");

    expect(saveTheme).not.toHaveBeenCalled();
    expect(root.dataset.theme).toBe("dark");
  });
});

describe("useColorScheme", () => {
  it("needs the provider", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Probe />)).toThrow("ColorSchemeProvider");

    error.mockRestore();
  });
});
