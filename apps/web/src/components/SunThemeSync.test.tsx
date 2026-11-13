// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SUN_HOURS, type SunHours } from "@/lib/composition/sunHours";
import { MS_PER_MINUTE, sunLevel } from "@/lib/composition/sunSchedule";
import { SUN_SETTINGS_CHANGED, SunThemeSync } from "./SunThemeSync";

const loadSunHours = vi.fn<() => Promise<SunHours | null>>();
vi.mock("@/lib/composition/client", () => ({ loadSunHours: () => loadSunHours() }));

const MINUTE = MS_PER_MINUTE;
const HOUR = 60 * MINUTE;
const MIDNIGHT = new Date(2026, 5, 10).getTime();
const hours: SunHours = { lightenFrom: "06:00", lightFrom: "07:00", darkenFrom: "18:30", darkFrom: "20:00" };
const root = document.documentElement;

beforeEach(() => {
  vi.useFakeTimers();
  loadSunHours.mockReset();
  loadSunHours.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  root.removeAttribute("data-tone");
  root.removeAttribute("data-sun-pair");
  root.style.removeProperty("--auto-light");
});

describe("SunThemeSync and the pair of colors", () => {
  // At 06:29:18, where the 06:00 to 07:00 fade has the surfaces about 48% of the way to light: past the classic pair's
  // ink flip (0.45) but not the cream and dark amber pair's (0.5).
  const now = new Date(2026, 5, 10, 6, 29, 18).getTime();

  it("flips the ink where the classic pair does when no pair is named", () => {
    vi.setSystemTime(now);

    render(<SunThemeSync initial={hours} />);

    expect(sunLevel(hours, now)).toBeGreaterThan(0.45);
    expect(sunLevel(hours, now)).toBeLessThan(0.5);
    expect(root.dataset.tone).toBe("light");
  });

  it("flips the ink where the window's pair does", () => {
    root.dataset.sunPair = "cream-amber";
    vi.setSystemTime(now);

    render(<SunThemeSync initial={hours} />);

    expect(root.dataset.tone).toBe("dark");
  });
});

describe("SunThemeSync", () => {
  it("sets the scheme for the current time right away", () => {
    vi.setSystemTime(MIDNIGHT + 12 * HOUR);

    render(<SunThemeSync initial={hours} />);

    expect(root.dataset.tone).toBe("light");
    expect(root.style.getPropertyValue("--auto-light")).toBe("100.0%");
    expect(loadSunHours).not.toHaveBeenCalled();
  });

  it("moves along the fade as time passes", () => {
    vi.setSystemTime(MIDNIGHT + 18 * HOUR + 30 * MINUTE); // the evening fade starts
    render(<SunThemeSync initial={hours} />);
    expect(root.style.getPropertyValue("--auto-light")).toBe("100.0%");

    act(() => vi.advanceTimersByTime(45 * MINUTE)); // half way through its 90 minutes
    expect(root.style.getPropertyValue("--auto-light")).toBe("50.0%");
    expect(root.dataset.tone).toBe("light");

    act(() => vi.advanceTimersByTime(30 * MINUTE));
    expect(root.dataset.tone).toBe("dark");
  });

  it("does nothing when another scheme is selected", () => {
    render(<SunThemeSync initial={null} />);

    expect(root.dataset.tone).toBeUndefined();
  });

  it("loads the hours itself on mount when none are given", async () => {
    vi.setSystemTime(MIDNIGHT + 12 * HOUR);
    loadSunHours.mockResolvedValue(hours);

    await act(async () => {
      render(<SunThemeSync />);
    });

    expect(root.dataset.tone).toBe("light");
  });

  it("re-reads the hours when settings change", async () => {
    vi.setSystemTime(MIDNIGHT + 12 * HOUR);
    render(<SunThemeSync initial={null} />);
    loadSunHours.mockResolvedValue(hours);

    await act(async () => {
      window.dispatchEvent(new Event(SUN_SETTINGS_CHANGED));
    });

    expect(root.dataset.tone).toBe("light");
  });

  it("follows new hours at once: the same moment is dark, then light", async () => {
    vi.setSystemTime(MIDNIGHT + 22 * HOUR);
    render(<SunThemeSync initial={DEFAULT_SUN_HOURS} />);
    expect(root.dataset.tone).toBe("dark");
    loadSunHours.mockResolvedValue({ lightenFrom: "20:00", lightFrom: "21:00", darkenFrom: "05:00", darkFrom: "06:00" });

    await act(async () => {
      window.dispatchEvent(new Event(SUN_SETTINGS_CHANGED));
    });

    expect(root.dataset.tone).toBe("light");
  });

  it("never asks the network for anything while it runs", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.setSystemTime(MIDNIGHT + 12 * HOUR);
    render(<SunThemeSync initial={hours} />);

    await act(async () => {
      vi.advanceTimersByTime(3 * HOUR);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(loadSunHours).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
