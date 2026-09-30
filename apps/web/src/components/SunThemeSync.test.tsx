// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SunEvent } from "@/lib/composition/sunSchedule";
import type { SunSchedule } from "@/lib/composition/sunTimes";
import { SUN_SETTINGS_CHANGED, SunThemeSync } from "./SunThemeSync";

const loadSunSchedule = vi.fn<() => Promise<SunSchedule | null>>();
vi.mock("@/lib/composition/client", () => ({ loadSunSchedule: () => loadSunSchedule() }));

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MIDNIGHT = new Date(2026, 5, 10).getTime();
const events: SunEvent[] = [
  { at: MIDNIGHT + 6 * HOUR, kind: "sunrise" },
  { at: MIDNIGHT + 19 * HOUR, kind: "sunset" },
  { at: MIDNIGHT + DAY + 6 * HOUR, kind: "sunrise" },
];
const schedule = (overrides: Partial<SunSchedule> = {}): SunSchedule => ({
  events,
  level: 1,
  estimated: false,
  retry: false,
  ...overrides,
});
const root = document.documentElement;

beforeEach(() => {
  vi.useFakeTimers();
  loadSunSchedule.mockReset();
  loadSunSchedule.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  root.removeAttribute("data-tone");
  root.style.removeProperty("--auto-light");
});

describe("SunThemeSync", () => {
  it("sets the scheme for the current time right away", () => {
    vi.setSystemTime(MIDNIGHT + 12 * HOUR);

    render(<SunThemeSync initial={schedule()} />);

    expect(root.dataset.tone).toBe("light");
    expect(root.style.getPropertyValue("--auto-light")).toBe("100.0%");
    expect(loadSunSchedule).not.toHaveBeenCalled();
  });

  it("moves along the ramp as time passes", () => {
    vi.setSystemTime(MIDNIGHT + 18 * HOUR + 15 * 60 * 1000); // 45 minutes before sunset: ramp starts
    render(<SunThemeSync initial={schedule()} />);
    expect(root.style.getPropertyValue("--auto-light")).toBe("100.0%");

    act(() => vi.advanceTimersByTime(45 * 60 * 1000)); // sunset: half way
    expect(root.style.getPropertyValue("--auto-light")).toBe("50.0%");
    expect(root.dataset.tone).toBe("light");

    act(() => vi.advanceTimersByTime(30 * 60 * 1000));
    expect(root.dataset.tone).toBe("dark");
  });

  it("does nothing when another scheme is selected", () => {
    render(<SunThemeSync initial={null} />);

    expect(root.dataset.tone).toBeUndefined();
  });

  it("loads the schedule itself on mount when none is given", async () => {
    vi.setSystemTime(MIDNIGHT + 12 * HOUR);
    loadSunSchedule.mockResolvedValue(schedule());

    await act(async () => {
      render(<SunThemeSync />);
    });

    expect(root.dataset.tone).toBe("light");
  });

  it("re-reads the schedule when settings change", async () => {
    vi.setSystemTime(MIDNIGHT + 12 * HOUR);
    render(<SunThemeSync initial={null} />);
    loadSunSchedule.mockResolvedValue(schedule());

    await act(async () => {
      window.dispatchEvent(new Event(SUN_SETTINGS_CHANGED));
    });

    expect(root.dataset.tone).toBe("light");
  });

  it("asks for fresh times when the schedule says to retry", async () => {
    vi.setSystemTime(MIDNIGHT + 12 * HOUR);
    render(<SunThemeSync initial={schedule({ retry: true, estimated: true })} />);
    expect(loadSunSchedule).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });

    expect(loadSunSchedule).toHaveBeenCalledTimes(1);
  });

  it("asks for fresh times once every known event has passed", async () => {
    vi.setSystemTime(MIDNIGHT + DAY + 5 * HOUR);
    render(<SunThemeSync initial={schedule()} />);

    await act(async () => {
      vi.advanceTimersByTime(2 * HOUR + 10 * 60 * 1000); // past the last sunrise's ramp
    });

    expect(loadSunSchedule).toHaveBeenCalled();
  });
});
