import type { ComponentType, ReactNode } from "react";
import type { Components } from "react-markdown";
import { Image } from "./Image";
import { Info } from "./Info";
import { renderKey } from "./remarkRestrictMdx";
import { Warning } from "./Warning";

/**
 * The components a note may use as MDX tags, by tag name. This is the whole
 * allowlist: any other tag is rejected (see remarkRestrictMdx), so adding a
 * component here is all it takes to make it available in a note.
 */
export const mdxComponents: Record<
  string,
  ComponentType<{ children?: ReactNode; src?: string; alt?: string; title?: string }>
> = { Info, Warning, Image };

const names = Object.keys(mdxComponents);

/** `mdxComponents` as react-markdown looks them up (see renderKey). */
export const mdxComponentsByKey: Components = Object.fromEntries(
  Object.entries(mdxComponents).map(([name, component]) => [renderKey(name), component]),
);

const USES_COMPONENT = new RegExp(`<(?:${names.join("|")})[\\s/>]`);

/**
 * Whether the text mentions one of the components above. Only such notes are
 * parsed as MDX; every other note stays plain Markdown, where stray `<` or `{`
 * in prose is fine (MDX would reject it).
 */
export function usesMdxComponent(markdown: string): boolean {
  return USES_COMPONENT.test(markdown);
}
