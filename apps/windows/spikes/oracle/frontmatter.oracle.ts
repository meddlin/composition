// Spike S2: what the desktop's real frontmatter.ts (js-yaml) makes of the SHARED corpus's frontmatter cases.
// The corpus is not here: COMPOSITION_CORPUS_DIR points at a directory holding frontmatter-cases.json (today that file
// exists only on the iPad branch, under apps/ios/conformance/; see results/S2-conformance-and-yaml.md). Nothing is copied
// into this repository.
import fs from "node:fs";
import path from "node:path";
import { COMPOSITION_LIB, oracleDir, writeJson } from "./support";

const corpus = process.env.COMPOSITION_CORPUS_DIR;

describe.runIf(process.env.COMPOSITION_ORACLE_PHASE === "frontmatter" && corpus)("the desktop's frontmatter.ts answers the shared cases", () => {
  it("writes frontmatter-expected.json", async () => {
    const cases = JSON.parse(fs.readFileSync(path.join(corpus!, "frontmatter-cases.json"), "utf8")) as {
      parse: string[];
      generate: { title: string; createdAt: string; updatedAt: string; tags: string[]; description: string }[];
    };
    const fm = await import(path.join(COMPOSITION_LIB, "frontmatter"));
    const parse = cases.parse.map((content) => fm.parse(content));
    const generate = cases.generate.map((c) => fm.generate(c.title, { createdAt: c.createdAt, updatedAt: c.updatedAt, description: c.description, tags: c.tags }));
    writeJson(path.join(oracleDir(), "frontmatter-expected.json"), { parse, generate });
    expect(parse.length).toBe(cases.parse.length);
  });
});
