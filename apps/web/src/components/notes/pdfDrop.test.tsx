// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_FAVORITES } from "@/lib/composition/favorites";
import { GroupTree } from "./GroupTree";
import type { Group, Notebook } from "./types";
import { usePdfDrop } from "./usePdfDrop";

afterEach(cleanup);

const pdf = new File(["%PDF-1.7"], "Book.pdf", { type: "application/pdf" });
const text = new File(["hello"], "notes.txt", { type: "text/plain" });

/** What the browser gives a drag of files from the operating system: the types and kinds while it is over, the files at the drop. */
const filesDrag = (...files: File[]) => ({
  types: ["Files"],
  items: files.map((file) => ({ kind: "file", type: file.type })),
  files,
  getData: () => "",
  dropEffect: "none",
});

const groups: Group[] = [{ id: 3, name: "Chapters", parentId: null, notebookId: 1 } as Group];
const notebooks: Notebook[] = [{ id: 1, name: "Main" } as Notebook];

function tree(onDropPdf?: (files: File[], groupId: number | null) => void, onDropOutside: () => void = vi.fn()) {
  const noop = vi.fn();
  render(
    <div onDrop={onDropOutside}>
    <GroupTree
      groups={groups}
      notes={[]}
      notebooks={notebooks}
      currentNotebookId={1}
      activeId={null}
      viewedGroupId={null}
      favorites={NO_FAVORITES}
      onToggleFavorite={noop}
      onSelectNote={noop}
      onOpenNoteBeside={noop}
      onSelectGroup={noop}
      onDeleteNote={noop}
      onCreateNote={noop}
      onDropPdf={onDropPdf}
      onCreateGroup={noop}
      onRenameGroup={noop}
      onDeleteGroup={noop}
      onMoveGroup={noop}
      onMoveNoteToGroup={noop}
      onMoveGroupToNotebook={noop}
      onPlaceNote={noop}
      onPlaceGroup={noop}
    />
    </div>,
  );
  return { zone: screen.getByText("Chapters").closest("[data-pdf-drop-zone]") as HTMLElement, noop };
}

describe("dropping a PDF on a group in the sidebar", () => {
  it("imports it into that group", () => {
    const onDropPdf = vi.fn();
    const { zone } = tree(onDropPdf);

    fireEvent.dragOver(zone, { dataTransfer: filesDrag(pdf) });
    fireEvent.drop(zone, { dataTransfer: filesDrag(pdf) });

    expect(onDropPdf).toHaveBeenCalledWith([pdf], 3);
  });

  it("imports into the top level when it is dropped on Ungrouped", () => {
    const onDropPdf = vi.fn();
    tree(onDropPdf);

    fireEvent.drop(screen.getByText("Ungrouped"), { dataTransfer: filesDrag(pdf) });

    expect(onDropPdf).toHaveBeenCalledWith([pdf], null);
  });

  it("accepts the drag while it is over the group, so the browser allows the drop, and highlights the row", () => {
    const { zone } = tree(vi.fn());
    const drag = filesDrag(pdf);

    const notCancelled = fireEvent.dragOver(zone, { dataTransfer: drag });

    expect(notCancelled).toBe(false);
    expect(drag.dropEffect).toBe("copy");
    expect(zone.className).toContain("bg-accent");
    fireEvent.dragLeave(zone, { dataTransfer: drag });
    expect(zone.className).not.toContain("bg-accent");
  });

  it("takes only the PDFs among the files, and leaves a drop with none to whatever else listens", () => {
    const onDropPdf = vi.fn();
    const outer = vi.fn();
    const { zone } = tree(onDropPdf, outer);

    fireEvent.drop(zone, { dataTransfer: filesDrag(text, pdf) });
    expect(onDropPdf).toHaveBeenLastCalledWith([pdf], 3);
    expect(outer).not.toHaveBeenCalled();

    fireEvent.drop(zone, { dataTransfer: { ...filesDrag(text), items: [{ kind: "file", type: "" }] } });
    expect(onDropPdf).toHaveBeenCalledTimes(1);
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("does not take pictures, and is no drop zone for files at all where there are no PDFs", () => {
    const onDropPdf = vi.fn();
    const { zone } = tree(onDropPdf);
    const image = new File(["x"], "a.png", { type: "image/png" });

    expect(fireEvent.dragOver(zone, { dataTransfer: filesDrag(image) })).toBe(true);
    cleanup();

    const without = tree(undefined);
    expect(without.zone).toBeNull();
  });
});

function Window({ onDrop, enabled = true }: { onDrop: (data: DataTransfer) => void; enabled?: boolean }) {
  const { active, handlers } = usePdfDrop({ enabled, onDrop });
  return (
    <div data-testid="window" {...handlers}>
      <textarea aria-label="editor" onDrop={(event) => event.preventDefault()} />
      <div data-pdf-drop-zone="">
        <span>a group</span>
      </div>
      {active && <p>hint</p>}
    </div>
  );
}

describe("dropping a PDF on the window", () => {
  it("hands over the drop, ahead of the editor that would take a dropped file as text", () => {
    const onDrop = vi.fn();
    render(<Window onDrop={onDrop} />);
    const drag = filesDrag(pdf);

    expect(fireEvent.dragOver(screen.getByLabelText("editor"), { dataTransfer: drag })).toBe(false);
    expect(drag.dropEffect).toBe("copy");
    fireEvent.drop(screen.getByLabelText("editor"), { dataTransfer: drag });

    expect(onDrop).toHaveBeenCalledWith(drag);
  });

  it("shows a hint while a PDF is over it, and takes it away on leaving or dropping", () => {
    render(<Window onDrop={vi.fn()} />);
    const window = screen.getByTestId("window");

    fireEvent.dragEnter(window, { dataTransfer: filesDrag(pdf) });
    expect(screen.queryByText("hint")).not.toBeNull();
    fireEvent.dragLeave(window, { dataTransfer: filesDrag(pdf), relatedTarget: null });
    expect(screen.queryByText("hint")).toBeNull();

    fireEvent.dragEnter(window, { dataTransfer: filesDrag(pdf) });
    fireEvent.drop(window, { dataTransfer: filesDrag(pdf) });
    expect(screen.queryByText("hint")).toBeNull();
  });

  it("keeps the hint up while the pointer moves from one part of the window to another", () => {
    render(<Window onDrop={vi.fn()} />);
    const window = screen.getByTestId("window");

    fireEvent.dragEnter(window, { dataTransfer: filesDrag(pdf) });
    // jsdom has no DragEvent, so the event is made plain and given the element the pointer moved onto.
    const leave = createEvent.dragLeave(screen.getByLabelText("editor"), { dataTransfer: filesDrag(pdf) });
    Object.defineProperty(leave, "relatedTarget", { value: window });
    fireEvent(screen.getByLabelText("editor"), leave);

    expect(screen.queryByText("hint")).not.toBeNull();
  });

  it("leaves a drop on a group row to the row, and steps its hint aside there", () => {
    const onDrop = vi.fn();
    render(<Window onDrop={onDrop} />);
    const window = screen.getByTestId("window");
    const row = screen.getByText("a group");

    fireEvent.dragEnter(window, { dataTransfer: filesDrag(pdf) });
    expect(fireEvent.dragOver(row, { dataTransfer: filesDrag(pdf) })).toBe(true);
    expect(screen.queryByText("hint")).toBeNull();
    fireEvent.drop(row, { dataTransfer: filesDrag(pdf) });

    expect(onDrop).not.toHaveBeenCalled();
  });

  it("ignores everything else being dragged: text, a note, or pictures", () => {
    const onDrop = vi.fn();
    render(<Window onDrop={onDrop} />);
    const window = screen.getByTestId("window");
    const other = { types: ["application/x-composition-note-id"], items: [{ kind: "string", type: "text/plain" }], files: [], getData: () => "4", dropEffect: "none" };

    expect(fireEvent.dragOver(window, { dataTransfer: other })).toBe(true);
    fireEvent.drop(window, { dataTransfer: other });
    fireEvent.drop(window, { dataTransfer: filesDrag(new File(["x"], "a.png", { type: "image/png" })) });

    expect(onDrop).not.toHaveBeenCalled();
  });

  it("does nothing when it is turned off, as where there are no PDFs", () => {
    const onDrop = vi.fn();
    render(<Window onDrop={onDrop} enabled={false} />);

    expect(fireEvent.dragOver(screen.getByTestId("window"), { dataTransfer: filesDrag(pdf) })).toBe(true);
    fireEvent.drop(screen.getByTestId("window"), { dataTransfer: filesDrag(pdf) });

    expect(onDrop).not.toHaveBeenCalled();
  });
});
