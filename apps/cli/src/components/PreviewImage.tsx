import type { BoxRenderable, NativeImage } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { Api } from "../api";
import { cellGeometry, cellsForImage, imageProtocol, loadStoredImage, pixelsForCells } from "../images";
import type { Block } from "../mdx";
import type { Palette } from "../theme";

/** An image is drawn at most this much of the screen's height, so one picture never fills the preview. */
const MAX_SCREEN_SHARE = 0.6;
const MIN_ROWS = 6;

type State = { image: NativeImage } | { failure: "loading" | "missing" | "unreadable" };

/**
 * `image` shrunk to `width` x `height` pixels, averaging rather than picking (see pixelsForCells),
 * or null until that is done, or when there is no image yet. The result is the caller's to use
 * for as long as the sizes don't change, and is disposed here.
 */
function useScaledImage(image: NativeImage | null, width: number, height: number): NativeImage | null {
  const [scaled, setScaled] = useState<NativeImage | null>(null);
  useEffect(() => {
    if (!image || width < 1 || height < 1) {
      setScaled(null);
      return;
    }
    let next: NativeImage;
    try {
      next = width >= image.width && height >= image.height ? image.retain() : image.resize({ width, height, kernel: "area" });
    } catch {
      setScaled(null);
      return;
    }
    setScaled(next);
    return () => next.dispose(); // the drawing keeps its own reference to the pixels
  }, [image, width, height]);
  return scaled;
}

type Props = {
  block: Extract<Block, { kind: "image" }>;
  api: Pick<Api, "readImage">;
  palette: Palette;
  marginTop: number;
};

/**
 * One image in the preview, left-aligned and as large as the pane allows: in block characters, or
 * with the terminal's graphics protocol where it has one (see images.ts). Until it has loaded,
 * and if it can't be, it is its alt text, as every image was before.
 */
export function PreviewImage({ block, api, palette, marginTop }: Props) {
  const renderer = useRenderer();
  const { height: screenRows } = useTerminalDimensions();
  const slot = useRef<BoxRenderable | null>(null);
  const [columns, setColumns] = useState(0);
  const [state, setState] = useState<State>({ failure: "loading" });

  useEffect(() => {
    let live = true;
    let owned: NativeImage | null = null;
    setState({ failure: "loading" });
    void loadStoredImage(api, block.name).then((result) => {
      if (!live) {
        if ("image" in result) result.image.dispose();
        return;
      }
      if ("image" in result) owned = result.image;
      setState(result);
    });
    return () => {
      live = false;
      owned?.dispose(); // the drawing holds its own reference to the pixels
    };
  }, [api, block.name]);

  const protocol = imageProtocol();
  const image = "image" in state ? state.image : null;
  const geometry = cellGeometry(renderer, protocol);
  const cells =
    image && columns > 0
      ? cellsForImage(image, { maxColumns: columns, maxRows: Math.max(MIN_ROWS, Math.floor(screenRows * MAX_SCREEN_SHARE)) }, geometry)
      : null;
  const pixels = image && cells ? pixelsForCells(cells, geometry, image) : { width: 0, height: 0 };
  const scaled = useScaledImage(image, pixels.width, pixels.height);

  const label = block.alt || block.name;
  let content;
  if (cells && scaled) {
    // `fill`: the box has the picture's proportions already, which the shrunk image no longer shows.
    content = <image source={scaled} width={cells.width} height={cells.height} fit="fill" protocol={protocol} />;
  } else {
    const text =
      "image" in state || state.failure === "loading"
        ? label
        : state.failure === "missing"
          ? `Image not found: ${label}`
          : `Can’t display this image: ${label}`;
    content = <text fg={palette.muted}>{text}</text>;
  }

  return (
    // The box is as wide as the room there is; its width, once laid out, is what the image is fitted to.
    <box ref={slot} flexDirection="column" marginTop={marginTop} onSizeChange={() => setColumns(slot.current?.width ?? 0)}>
      {content}
    </box>
  );
}
