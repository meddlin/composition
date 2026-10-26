"use client";

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { saveHomeSettings } from "@/lib/composition/client";
import { cn } from "@/lib/utils";
import {
  HEADER_TITLE_MAX,
  DEFAULT_HEADER_TITLE,
  HOME_COLORS,
  RECENT_COUNTS,
  type HomeColor,
  type HomeDensity,
  type HomeLayout,
  type HomeSectionId,
  type HomeSettings as Settings,
  type HomeStartup,
  type RecentSort,
} from "@/lib/composition/home";

type Choice<T extends string> = { name: T; label: string; description: string };

const STARTUPS: Choice<HomeStartup>[] = [
  { name: "note", label: "A note", description: "Open on the first note in your list, as before." },
  { name: "home", label: "The home page", description: "Open on the overview of your notebooks and pinned notes." },
];

const LAYOUTS: Choice<HomeLayout>[] = [
  {
    name: "rail",
    label: "Side rail",
    description:
      "Notes fill the wide column, with your notebooks in a slim column beside them. On a narrow window the notebooks move above the notes.",
  },
  {
    name: "strip",
    label: "Chip strip",
    description: "Your notebooks run across the top as a row of chips, with the notes below at full width.",
  },
];

const DENSITIES: Choice<HomeDensity>[] = [
  { name: "standard", label: "Standard", description: "Title, a preview of the text, and the notebook and time." },
  { name: "compact", label: "Compact", description: "Title, notebook and time, without the preview." },
  { name: "list", label: "List", description: "One line per note." },
];

const RECENT_SORTS: Choice<RecentSort>[] = [
  { name: "edited", label: "Last edited", description: "Notes you changed most recently come first." },
  {
    name: "opened",
    label: "Last opened",
    description:
      "Notes you looked at most recently come first. Which notes you opened is remembered on this computer only; notes you haven't opened here yet follow, by when they were edited.",
  },
];

// The class is written out in full so Tailwind finds it.
const COLORS: Record<HomeColor, { label: string; swatch: string }> = {
  brand: { label: "Brand", swatch: "bg-brand" },
  highlight: { label: "Highlight", swatch: "bg-highlight" },
  success: { label: "Success", swatch: "bg-success" },
  warning: { label: "Warning", swatch: "bg-warning" },
  error: { label: "Error", swatch: "bg-error" },
};

const SECTION_LABELS: Record<HomeSectionId, string> = {
  notebooks: "Notebooks",
  pinned: "Pinned",
  recent: "Recently updated",
};

/** Settings for the home page. Changes reach the home page when you go back to your notes. */
export function HomeSettings({ initial, notebooks }: { initial: Settings; notebooks: { id: number; name: string }[] }) {
  const [draft, setDraft] = useState<Settings>(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  // What was saved is no longer what is on screen once a choice changes.
  function edit(change: Partial<Settings>) {
    setDraft((current) => ({ ...current, ...change }));
    setSaved(false);
    setError(undefined);
  }

  function setVisible(id: HomeSectionId, visible: boolean) {
    edit({ sections: draft.sections.map((s) => (s.id === id ? { ...s, visible } : s)) });
  }

  function setColor(notebookId: number, color: HomeColor | undefined) {
    const notebookColors = { ...draft.notebookColors };
    if (color) notebookColors[String(notebookId)] = color;
    else delete notebookColors[String(notebookId)];
    edit({ notebookColors });
  }

  function move(index: number, by: -1 | 1) {
    const sections = [...draft.sections];
    [sections[index], sections[index + by]] = [sections[index + by], sections[index]];
    edit({ sections });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveHomeSettings(draft);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  function choices<T extends string>(label: string, id: string, value: T, options: Choice<T>[], onChange: (next: T) => void) {
    return (
      <RadioGroup value={value} onValueChange={(next) => onChange(next as T)} aria-label={label} className="gap-3">
        {options.map(({ name, label: optionLabel, description }) => (
          <Field key={name} orientation="horizontal" className="items-start gap-3">
            <RadioGroupItem value={name} id={`${id}-${name}`} className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={`${id}-${name}`} className="cursor-pointer font-normal">
                {optionLabel}
              </FieldLabel>
              <FieldDescription className="text-xs">{description}</FieldDescription>
            </div>
          </Field>
        ))}
      </RadioGroup>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6 text-sm">
      <FieldSet className="gap-2">
        <FieldLegend variant="label">Open on</FieldLegend>
        <FieldDescription className="text-xs">What you see when Composition starts.</FieldDescription>
        {choices("Open on", "home-startup", draft.startup, STARTUPS, (startup) => edit({ startup }))}
      </FieldSet>

      <FieldSet className="gap-2">
        <FieldLegend variant="label">Layout</FieldLegend>
        {choices("Home page layout", "home-layout", draft.layout, LAYOUTS, (layout) => edit({ layout }))}
      </FieldSet>

      <FieldSet className="gap-2">
        <FieldLegend variant="label">Sections</FieldLegend>
        <FieldDescription className="text-xs">
          Choose what the home page shows and the order it shows it in. Pinned appears once you have pinned a note,
          from its menu in the sidebar or the pin button on its card; a notebook or a group can be pinned too. Pinned
          notebooks come first. In the side rail layout the notebooks always sit
          in the rail, so the order only applies to the other sections.
        </FieldDescription>
        <ul className="flex flex-col gap-1">
          {draft.sections.map(({ id, visible }, index) => (
            <li key={id} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
              <Checkbox
                id={`home-section-${id}`}
                checked={visible}
                onCheckedChange={(checked) => setVisible(id, checked === true)}
              />
              <FieldLabel htmlFor={`home-section-${id}`} className="flex-1 cursor-pointer font-normal">
                {SECTION_LABELS[id]}
              </FieldLabel>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${SECTION_LABELS[id]} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${SECTION_LABELS[id]} down`}
                disabled={index === draft.sections.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDownIcon />
              </Button>
            </li>
          ))}
        </ul>
      </FieldSet>

      <FieldSet className="gap-2">
        <FieldLegend variant="label">Recently updated</FieldLegend>
        <FieldDescription className="text-xs">How many notes to list, and which.</FieldDescription>
        <RadioGroup
          value={String(draft.recentCount)}
          onValueChange={(next) => edit({ recentCount: Number(next) })}
          aria-label="Recent notes to show"
          className="flex w-fit gap-5"
        >
          {RECENT_COUNTS.map((count) => (
            <Field key={count} orientation="horizontal" className="w-fit gap-2">
              <RadioGroupItem value={String(count)} id={`home-recent-${count}`} />
              <FieldLabel htmlFor={`home-recent-${count}`} className="cursor-pointer font-normal">
                {count}
              </FieldLabel>
            </Field>
          ))}
        </RadioGroup>
      </FieldSet>

      <FieldSet className="gap-2">
        <FieldLegend variant="label">Order recent notes by</FieldLegend>
        {choices("Order recent notes by", "home-recent-sort", draft.recentSort, RECENT_SORTS, (recentSort) => edit({ recentSort }))}
        <Field className="gap-1">
          <FieldLabel htmlFor="home-recent-notebook">Recent notes from</FieldLabel>
          <select
            id="home-recent-notebook"
            value={draft.recentNotebook ?? ""}
            onChange={(event) => edit({ recentNotebook: event.target.value === "" ? null : Number(event.target.value) })}
            className="w-fit max-w-full rounded-md border bg-background px-2 py-1.5"
          >
            <option value="">All notebooks</option>
            {notebooks.map((notebook) => (
              <option key={notebook.id} value={notebook.id}>
                {notebook.name}
              </option>
            ))}
          </select>
        </Field>
      </FieldSet>

      <FieldSet className="gap-2">
        <FieldLegend variant="label">Note cards</FieldLegend>
        <FieldDescription className="text-xs">How much each pinned and recent note shows.</FieldDescription>
        {choices("Note card size", "home-density", draft.density, DENSITIES, (density) => edit({ density }))}
      </FieldSet>

      {notebooks.length > 0 && (
        <FieldSet className="gap-2">
          <FieldLegend variant="label">Notebook colors</FieldLegend>
          <FieldDescription className="text-xs">
            The dot beside each notebook, and beside its notes. Automatic picks a color by the notebook&apos;s place in
            the list.
          </FieldDescription>
          <ul className="flex flex-col gap-1">
            {notebooks.map((notebook) => {
              const chosen = draft.notebookColors[String(notebook.id)];
              return (
                <li key={notebook.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate">{notebook.name}</span>
                  <div role="group" aria-label={`Color of ${notebook.name}`} className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-pressed={chosen === undefined}
                      onClick={() => setColor(notebook.id, undefined)}
                      className={cn(
                        "rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted",
                        chosen === undefined && "bg-muted font-medium text-foreground",
                      )}
                    >
                      Automatic
                    </button>
                    {HOME_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`${notebook.name}: ${COLORS[color].label}`}
                        aria-pressed={chosen === color}
                        onClick={() => setColor(notebook.id, color)}
                        className={cn(
                          "size-5 rounded-full ring-offset-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          COLORS[color].swatch,
                          chosen === color && "ring-2 ring-foreground",
                        )}
                      />
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </FieldSet>
      )}

      <FieldSet className="gap-2">
        <FieldLegend variant="label">Heading</FieldLegend>
        <Field orientation="horizontal" className="w-fit gap-3">
          <Checkbox
            id="home-header-show"
            checked={draft.header.show}
            onCheckedChange={(checked) => edit({ header: { ...draft.header, show: checked === true } })}
          />
          <FieldLabel htmlFor="home-header-show" className="cursor-pointer font-normal">
            Show a heading at the top
          </FieldLabel>
        </Field>
        <Field className="gap-1">
          <FieldLabel htmlFor="home-header-title">Heading text</FieldLabel>
          <Input
            id="home-header-title"
            type="text"
            value={draft.header.title}
            placeholder={DEFAULT_HEADER_TITLE}
            maxLength={HEADER_TITLE_MAX}
            onChange={(event) => edit({ header: { ...draft.header, title: event.target.value } })}
            disabled={!draft.header.show}
            className="max-w-sm"
          />
          <FieldDescription className="text-xs">
            Leave it empty for &ldquo;{DEFAULT_HEADER_TITLE}&rdquo;. The count of notes and notebooks stays beneath it.
          </FieldDescription>
        </Field>
      </FieldSet>

      {error && <FieldError>{error}</FieldError>}
      {saved && (
        <p role="status" className="text-success">
          Saved. It applies when you go back to your notes.
        </p>
      )}

      <Button type="submit" size="lg" disabled={pending} className="w-fit px-4">
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
