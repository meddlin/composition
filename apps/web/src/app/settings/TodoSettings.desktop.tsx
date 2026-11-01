"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_TODO_SETTINGS,
  isRetention,
  RETENTION_ERROR,
  type TodoSettings as Settings,
} from "@/lib/composition/todoSettings";
import { loadTodoSettings, previewTodoPurge, saveTodoSettings } from "@/lib/composition/todosClient";
import { useSettingsPluginEnabled } from "./PluginsProvider";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The windows offered by name; anything else is entered as a number of months. */
const WINDOWS = [
  { months: 12, label: "1 year" },
  { months: 24, label: "2 years" },
  { months: 36, label: "3 years" },
  { months: 60, label: "5 years" },
  { months: 120, label: "10 years" },
];

const SELECT_CLASS = "w-fit max-w-full rounded-md border bg-background px-2 py-1.5";

const windowLabel = (months: number) => WINDOWS.find((w) => w.months === months)?.label ?? `${months} ${months === 1 ? "month" : "months"}`;

const messageOf = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback);

/**
 * Settings > To-dos: when the week starts, how long archived items are kept, and when the fiscal year starts. It
 * belongs to the To-do plugin, so it is not shown while the plugin is off. (The web app has no to-do panels; see
 * `TodoSettings.tsx`.)
 */
export function TodoSettings() {
  return useSettingsPluginEnabled("todo") ? <TodoSettingsCard /> : null;
}

function TodoSettingsCard() {
  const [saved, setSaved] = useState<Settings>(DEFAULT_TODO_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  /** A shorter window that would delete archived items, waiting to be confirmed. */
  const [pending, setPending] = useState<{ next: Settings; months: number; count: number }>();
  /** "Other" was picked for the window, so the months box shows even for a window that has a name. */
  const [custom, setCustom] = useState(false);
  /** What is typed in the months box; absent while it just shows the saved window. */
  const [monthsText, setMonthsText] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    loadTodoSettings()
      .then((settings) => {
        if (cancelled) return;
        setSaved(settings);
        setLoaded(true);
      })
      .catch((reason) => {
        if (!cancelled) setError(messageOf(reason, "The to-do settings could not be read."));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A change shows at once and is saved in the background, as the other settings are; it is put back if the save fails.
  async function save(next: Settings) {
    const previous = saved;
    setSaved(next);
    setPending(undefined);
    setMonthsText(undefined);
    try {
      await saveTodoSettings(next);
    } catch (reason) {
      setSaved(previous);
      setError(messageOf(reason, "The to-do settings could not be saved."));
    }
  }

  // A shorter window can delete archived items, so it says how many first, and waits for a yes.
  async function change(next: Settings) {
    setError(undefined);
    setPending(undefined);
    const months = next.retentionMonths;
    if (months !== null && (saved.retentionMonths === null || months < saved.retentionMonths)) {
      try {
        const count = await previewTodoPurge(months);
        if (count > 0) {
          setPending({ next, months, count });
          return;
        }
      } catch (reason) {
        setError(messageOf(reason, "The archive could not be checked."));
        return;
      }
    }
    await save(next);
  }

  function pickWindow(value: string) {
    setError(undefined);
    setPending(undefined);
    setMonthsText(undefined);
    if (value === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    void change({ ...saved, retentionMonths: value === "forever" ? null : Number(value) });
  }

  const shownMonths = monthsText ?? String(saved.retentionMonths ?? DEFAULT_TODO_SETTINGS.retentionMonths);

  function commitMonths() {
    const months = Number(shownMonths.trim());
    if (!isRetention(months) || shownMonths.trim() === "") {
      setError(RETENTION_ERROR);
      return;
    }
    setError(undefined);
    if (months !== saved.retentionMonths) void change({ ...saved, retentionMonths: months });
  }

  function cancelPending() {
    setPending(undefined);
    setCustom(false);
    setMonthsText(undefined);
  }

  const isNamed = saved.retentionMonths === null || WINDOWS.some((w) => w.months === saved.retentionMonths);
  const windowChoice = custom || !isNamed ? "custom" : saved.retentionMonths === null ? "forever" : String(saved.retentionMonths);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          To-dos
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <Field className="gap-1">
          <FieldLabel htmlFor="todo-week-starts-on">Week starts on</FieldLabel>
          <FieldDescription className="text-xs">
            A week is seven days from this day. At its end the finished items are archived and the open ones roll over.
            Changing it mid-week gives one short week.
          </FieldDescription>
          <div>
            <select
              id="todo-week-starts-on"
              value={saved.weekStartsOn}
              disabled={!loaded}
              onChange={(event) => void change({ ...saved, weekStartsOn: Number(event.target.value) as Settings["weekStartsOn"] })}
              className={SELECT_CLASS}
            >
              {DAYS.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </div>
        </Field>

        <Field className="gap-1">
          <FieldLabel htmlFor="todo-keep-for">Keep archived items for</FieldLabel>
          <FieldDescription className="text-xs">
            Items that are done, removed or dropped stay in the archive this long after their last activity, then are
            deleted for good. Reports are notes and are never deleted by this.
          </FieldDescription>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="todo-keep-for"
              value={windowChoice}
              disabled={!loaded}
              onChange={(event) => pickWindow(event.target.value)}
              className={SELECT_CLASS}
            >
              {WINDOWS.map(({ months, label }) => (
                <option key={months} value={months}>
                  {label}
                </option>
              ))}
              <option value="forever">Keep forever</option>
              <option value="custom">Other (months)</option>
            </select>
            {windowChoice === "custom" && (
              <Input
                type="number"
                inputMode="numeric"
                aria-label="Months to keep archived items"
                value={shownMonths}
                min={1}
                max={600}
                onChange={(event) => setMonthsText(event.target.value)}
                onBlur={commitMonths}
                onKeyDown={(event) => event.key === "Enter" && commitMonths()}
                className="w-24"
              />
            )}
          </div>
          {pending && (
            <div role="alert" className="mt-1 flex flex-col gap-2 rounded-md border border-warning/50 bg-warning/10 p-3">
              <p>
                {pending.count === 1 ? "1 archived item is" : `${pending.count} archived items are`} older than{" "}
                {windowLabel(pending.months)} and will be deleted for good the next time the to-do clean-up runs.
              </p>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="destructive" onClick={() => void save(pending.next)}>
                  Keep for {windowLabel(pending.months)}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={cancelPending}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Field>

        <Field className="gap-1">
          <FieldLabel htmlFor="todo-fiscal-start">Fiscal year starts in</FieldLabel>
          <FieldDescription className="text-xs">
            The quarterly reports follow it. A fiscal year is named by the year it ends in, so one that starts in October 2026
            is 2027.
          </FieldDescription>
          <div>
            <select
              id="todo-fiscal-start"
              value={saved.fiscalYearStartMonth}
              disabled={!loaded}
              onChange={(event) => void change({ ...saved, fiscalYearStartMonth: Number(event.target.value) })}
              className={SELECT_CLASS}
            >
              {MONTHS.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>
          </div>
        </Field>

        {error && <FieldError>{error}</FieldError>}
      </CardContent>
    </Card>
  );
}
