import { useKeyboard } from "@opentui/react";
import type { SelectOption } from "@opentui/core";
import { useRef, useState } from "react";
import { BINDINGS, type Scope } from "../keymap";
import type { Palette } from "../theme";

/** A centered box over the whole screen. Everything inside it owns the keyboard while it is open. */
function Overlay({ palette, title, width = 60, children }: {
  palette: Palette;
  title: string;
  width?: number;
  children: React.ReactNode;
}) {
  return (
    <box position="absolute" top={0} left={0} width="100%" height="100%" alignItems="center" justifyContent="center">
      <box
        width={width}
        border
        borderStyle="rounded"
        borderColor={palette.borderFocused}
        backgroundColor={palette.surface}
        title={title}
        padding={1}
        flexDirection="column"
      >
        {children}
      </box>
    </box>
  );
}

export function PromptDialog({ palette, title, label, initial = "", onSubmit, onCancel }: {
  palette: Palette;
  title: string;
  label: string;
  initial?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  // The input's own submit argument is typed loosely; what was typed is tracked here instead.
  const typed = useRef(initial);
  useKeyboard((key) => {
    if (key.name === "escape") onCancel();
  });
  return (
    <Overlay palette={palette} title={title}>
      <text fg={palette.muted}>{label}</text>
      <input
        focused
        value={value}
        onInput={(next) => {
          typed.current = next;
          setValue(next);
        }}
        onSubmit={() => {
          const trimmed = typed.current.trim();
          if (trimmed) onSubmit(trimmed);
        }}
        backgroundColor={palette.background}
        textColor={palette.foreground}
        focusedBackgroundColor={palette.background}
        focusedTextColor={palette.foreground}
      />
      <text fg={palette.muted}>Enter to confirm, Esc to cancel</text>
    </Overlay>
  );
}

export function ConfirmDialog({ palette, title, message, onConfirm, onCancel }: {
  palette: Palette;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useKeyboard((key) => {
    if (key.name === "y") onConfirm();
    else if (key.name === "n" || key.name === "escape") onCancel();
  });
  return (
    <Overlay palette={palette} title={title}>
      <text fg={palette.foreground}>{message}</text>
      <text fg={palette.muted}>y to confirm, n or Esc to cancel</text>
    </Overlay>
  );
}

export type PickerOption = { label: string; value: number | null };

export function PickerDialog({ palette, title, options, onPick, onCancel }: {
  palette: Palette;
  title: string;
  options: PickerOption[];
  onPick: (value: number | null) => void;
  onCancel: () => void;
}) {
  useKeyboard((key) => {
    if (key.name === "escape") onCancel();
  });
  const items: SelectOption[] = options.map((option) => ({ name: option.label, description: "" }));
  return (
    <Overlay palette={palette} title={title}>
      <box height={Math.min(options.length, 12)}>
        <select
          focused
          options={items}
          showDescription={false}
          height="100%"
          backgroundColor={palette.surface}
          textColor={palette.foreground}
          focusedBackgroundColor={palette.surface}
          focusedTextColor={palette.foreground}
          selectedBackgroundColor={palette.selection}
          selectedTextColor={palette.selectionText}
          onSelect={(index) => onPick(options[index]?.value ?? null)}
        />
      </box>
      <text fg={palette.muted}>Enter to choose, Esc to cancel</text>
    </Overlay>
  );
}

const SCOPE_TITLES: Record<Scope, string> = {
  tree: "In the tree",
  pane: "In a pane",
  trash: "In the Trash",
  settings: "In Settings",
};

export function HelpDialog({ palette, onClose }: { palette: Palette; onClose: () => void }) {
  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q" || key.name === "?") onClose();
  });
  const scopes: Scope[] = ["tree", "pane", "trash"];
  return (
    <Overlay palette={palette} title="Keys" width={72}>
      {scopes.map((scope) => (
        <box key={scope} flexDirection="column" marginBottom={1}>
          <text fg={palette.accent}>{SCOPE_TITLES[scope]}</text>
          {BINDINGS.filter((binding) => binding.scope === scope).map((binding) => (
            <text key={`${scope}:${binding.action}`} fg={palette.foreground}>
              {`${binding.keys.join(" or ").padEnd(18)} ${binding.description}`}
            </text>
          ))}
        </box>
      ))}
      <text fg={palette.muted}>Typing in an editor always wins. Esc closes this.</text>
    </Overlay>
  );
}
