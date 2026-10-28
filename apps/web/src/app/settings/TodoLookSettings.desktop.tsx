"use client";

import { useEffect, useState } from "react";
import { todoLookStyle } from "@/components/panels/todoLookStyle";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  DEFAULT_TODO_LOOK,
  isTodoBackgroundName,
  TODO_BACKGROUND_CHOICES,
  TODO_COLOR_PRESETS,
  type TodoLook,
} from "@/lib/composition/todoLook";
import { loadTodoLook, saveTodoLook } from "@/lib/composition/todosClient";
import { cn } from "@/lib/utils";
import { useSettingsPluginEnabled } from "./PluginsProvider";

/** The color the picker starts on when no color is chosen yet (a picker cannot show "none"). */
const PICKER_START = "#fbf3d9";

/**
 * Saves the look. When this window holds the workspace (it does once the notes have been opened), the change goes through
 * its to-do store, so every to-do panel, in the main window and in pop-outs, shows it at once; otherwise there are no
 * to-do panels to update and it is only saved, and the panels read it when they are made.
 */
async function saveLook(look: TodoLook): Promise<{ error?: string }> {
  const todos = window.__workspace?.store.todos;
  if (todos) return todos.setLook(look);
  try {
    await saveTodoLook(look);
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The to-do background could not be saved." };
  }
}

/**
 * Settings > Styling: the background of the to-do panels, one setting for all of them, apart from the note background.
 * It belongs to the To-do plugin, so it is not shown while the plugin is off. (The web app has no to-do panels; see
 * `TodoLookSettings.tsx`.)
 */
export function TodoLookSettings() {
  return useSettingsPluginEnabled("todo") ? <TodoLookForm /> : null;
}

function TodoLookForm() {
  const [look, setLook] = useState<TodoLook>(DEFAULT_TODO_LOOK);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    loadTodoLook()
      .then((saved) => {
        if (cancelled) return;
        setLook(saved);
        setLoaded(true);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "The to-do background could not be read.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Each change shows at once and is saved in the background, as the other styling choices are.
  async function choose(next: TodoLook) {
    const previous = look;
    setLook(next);
    setError(undefined);
    const result = await saveLook(next);
    if (result.error) {
      setLook(previous);
      setError(result.error);
    }
  }

  const preview = todoLookStyle(look);
  const isDefault = look.background === DEFAULT_TODO_LOOK.background && look.color === DEFAULT_TODO_LOOK.color;

  return (
    <FieldSet className="gap-3 text-sm" disabled={!loaded && !error}>
      <FieldLegend variant="label">To-do background</FieldLegend>
      <FieldDescription className="text-xs">
        The background of the to-do panels (desktop app), apart from the note background above. One setting for all of them.
        A color you choose also sets the text to light or dark, whichever reads better on it.
      </FieldDescription>

      <RadioGroup
        value={look.background}
        onValueChange={(next) => isTodoBackgroundName(next) && void choose({ ...look, background: next })}
        aria-label="To-do pattern"
        className="gap-2"
      >
        {TODO_BACKGROUND_CHOICES.map(({ name, label }) => (
          <Field key={name} orientation="horizontal" className="w-fit gap-3">
            <RadioGroupItem value={name} id={`todo-background-${name}`} />
            <FieldLabel htmlFor={`todo-background-${name}`} className="cursor-pointer gap-3 font-normal">
              {label}
            </FieldLabel>
          </Field>
        ))}
      </RadioGroup>

      <div role="group" aria-label="To-do color" className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Color scheme's own"
          aria-pressed={look.color === null}
          title="Color scheme's own"
          onClick={() => void choose({ ...look, color: null })}
          className={cn(
            "size-7 rounded-full border border-foreground/30 bg-background text-xs text-muted-foreground",
            look.color === null && "ring-2 ring-ring ring-offset-2 ring-offset-background",
          )}
        >
          ∅
        </button>
        {TODO_COLOR_PRESETS.map(({ color, label }) => (
          <button
            key={color}
            type="button"
            aria-label={label}
            aria-pressed={look.color === color}
            title={label}
            onClick={() => void choose({ ...look, color })}
            style={{ backgroundColor: color }}
            className={cn(
              "size-7 rounded-full border border-foreground/30",
              look.color === color && "ring-2 ring-ring ring-offset-2 ring-offset-background",
            )}
          />
        ))}
        <label className="flex items-center gap-2 pl-1 text-muted-foreground">
          Custom
          <input
            type="color"
            aria-label="Custom color"
            value={look.color ?? PICKER_START}
            onChange={(event) => void choose({ ...look, color: event.target.value.toLowerCase() })}
            className="h-7 w-9 cursor-pointer rounded border border-input bg-transparent p-0.5"
          />
        </label>
      </div>

      <div
        aria-label="To-do background preview"
        role="img"
        className={cn("rounded-md border px-4 py-3 text-sm leading-6", preview.className)}
        style={preview.style}
      >
        <div>☐ Send the quarterly summary</div>
        <div className="pl-5">☐ Check the figures</div>
        <div className="line-through opacity-60">☑ Book the flights</div>
      </div>

      <div>
        <Button type="button" variant="outline" size="sm" disabled={isDefault} onClick={() => void choose(DEFAULT_TODO_LOOK)}>
          Reset to default
        </Button>
      </div>
      {error && <FieldError>{error}</FieldError>}
    </FieldSet>
  );
}
