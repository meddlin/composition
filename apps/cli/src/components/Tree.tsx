import type { SelectOption } from "@opentui/core";
import type { Palette } from "../theme";
import type { TreeRow } from "../tree";

/** How a row looks in the list: indentation, a fold marker for groups, then the label. */
export function rowText(row: TreeRow): string {
  const indent = "  ".repeat(row.depth);
  switch (row.kind) {
    case "section":
      return `${indent}${row.expanded ? "▾" : "▸"} ${row.label}`;
    case "group":
      // A favorite group is a shortcut to the group, not the group itself, so it can't be folded.
      if (row.favorite) return `${indent}◆ ${row.label}`;
      return `${indent}${row.expanded ? "▾" : "▸"} ${row.label}${row.pinned ? " ★" : ""}`;
    case "note":
      return `${indent}  ${row.label}${row.pinned && !row.favorite ? " ★" : ""}`;
    default:
      return `${indent}${row.label}`;
  }
}

type TreeProps = {
  rows: TreeRow[];
  selectedIndex: number;
  focused: boolean;
  palette: Palette;
  onMove: (index: number) => void;
  onActivate: (index: number) => void;
};

/** The left-hand tree of groups and notes. Selection is owned by the app, so it survives reloads. */
export function Tree({ rows, selectedIndex, focused, palette, onMove, onActivate }: TreeProps) {
  const options: SelectOption[] = rows.map((row) => ({ name: rowText(row), description: "" }));
  return (
    <select
      options={options}
      selectedIndex={selectedIndex}
      focused={focused}
      showDescription={false}
      showScrollIndicator
      height="100%"
      backgroundColor={palette.background}
      textColor={palette.foreground}
      focusedBackgroundColor={palette.background}
      focusedTextColor={palette.foreground}
      selectedBackgroundColor={focused ? palette.selection : palette.surface}
      selectedTextColor={focused ? palette.selectionText : palette.foreground}
      onChange={(index) => onMove(index)}
      onSelect={(index) => onActivate(index)}
    />
  );
}
