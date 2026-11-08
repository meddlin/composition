import fs from "node:fs";

/**
 * The conformance corpus (`fixtures/conformance/`): files the TypeScript and Swift cores both read, so that a change to
 * one implementation fails until the fixtures and the other implementation are updated together. Test code only.
 * See fixtures/conformance/README.md.
 */

const ROOT = new URL("../../../../../../fixtures/conformance/", import.meta.url);

/**
 * JSON has no way to write a long string, so `{"$repeat": ["a", 501]}` stands for 501 letters a. Swift expands it the same
 * way, and the 500- and 200-character limits are tested at their edge.
 */
export function expand(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expand);
  if (value !== null && typeof value === "object") {
    const repeat = (value as { $repeat?: unknown }).$repeat;
    if (Array.isArray(repeat)) return String(repeat[0]).repeat(Number(repeat[1]));
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, expand(v)]));
  }
  return value;
}

export function conformancePath(file: string): URL {
  return new URL(file, ROOT);
}

/** A fixture file, parsed and with `$repeat` expanded. */
export function loadConformance<T>(file: string): T {
  return expand(JSON.parse(fs.readFileSync(conformancePath(file), "utf8"))) as T;
}

/** Whether the fixtures should be rewritten from the TypeScript behaviour: `UPDATE_FIXTURES=1 pnpm test`. */
export const UPDATING_FIXTURES = process.env.UPDATE_FIXTURES === "1";
