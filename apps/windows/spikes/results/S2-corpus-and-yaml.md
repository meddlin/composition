# S2: the shared conformance corpus, and how far stock YAML is from js-yaml

## What exists (checked 2026-11-07)

| Where | What |
|---|---|
| `fixtures/conformance/` (what the iPad design proposed) | **Did not exist** when checked on 2026-11-07, on this branch's base (`main` at da75aa3) or any branch. **Update 2026-11-08:** the PDF-markup branch (PR #267, unmerged) now has it: a README and `pdf/` fixtures with **committed expected answers** (`UPDATE_FIXTURES=1` regenerates), for the PDF tables only. Not read by this spike |
| `main` | No conformance files at all. `apps/web/src/lib/composition/assistant/__fixtures__/` is unrelated (AI chat recordings) |
| The iPad branch `claude/ipad-app-design-build-683ed8` (PR #247, **unmerged**) | A real corpus at **`apps/ios/conformance/`**: 15 inputs, about 1 MB (`store-script.json`, `trash-script.json`, `frontmatter-cases.json`, `settings-cases.json`, `search-queries.json`, `mdx-notes.json`, `organization-cases.json`, `images-cases.json`, `editing-cases.json`, `component-cases.json`, `logic-subset.json`, `search-expected.json` and a preview showcase). It is named for the iPad |
| Where its expected answers come from | Not committed (except `search-expected.json`): `apps/web/scripts/ios-conformance-fixtures.test.ts` on that branch runs the inputs through the desktop's real TypeScript at test time and writes the answers; `apps/ios/scripts/conformance.sh` drives it |

**Gaps to report, not filled here:** (1) the corpus is not shared and not on `main`; (2) it lives under `apps/ios/`; (3) its oracle is a
test file in `apps/web` on an unmerged branch, so a Windows harness cannot regenerate answers from `main`; (4) no cross-platform manifest says
which cases a port must pass. This branch did **not** create a private corpus. `oracle/frontmatter.oracle.ts` reads a directory named by
`COMPOSITION_CORPUS_DIR` and runs the real `frontmatter.ts` over its `frontmatter-cases.json`; for the recorded run the iPad branch's
`apps/ios/conformance` was extracted with `git archive` to a scratch folder.

## The measurement

`frontmatter-cases.json` has 111 `parse` inputs and 123 `generate` inputs. The desktop's `frontmatter.ts` (js-yaml) answers each; .NET answers with
YamlDotNet 16.2.1:

| | Agrees with js-yaml |
|---|---|
| `parse`, YamlDotNet's scalars as written | **93 of 111** |
| `parse`, plus a js-yaml-style resolver for plain scalars (null, bool, int, float, timestamp) | **103 of 111** |
| `generate`, YamlDotNet's default emitter, byte for byte | **61 of 123** |

Remaining parse disagreements (probe, not a complete resolver): `0b101`, `.inf`, `1_000` (js-yaml keeps it a string), a `null` list item, `tags: 5`
(not a list or a string, so no tags), a nested `[a, b]` item, `2026-02-30` (JavaScript's `Date` rolls it to March 2), and a mapping whose key is empty
(`: bad`, which js-yaml refuses and YamlDotNet accepts). Generation differs in quoting: js-yaml quotes `-item`, `~`, `true`, `null`, `True`; YamlDotNet does not,
and it double-quotes a string that contains a single quote where js-yaml doubles the quote.

**Reading:** a stock library is not enough. Notes must stay byte-identical whichever app last saved them (`frontmatter.ts`), so the Windows core needs the
same answer the iPad reached (its G6): port js-yaml's loader and dumper rules by hand, checked by this corpus. That is a recommendation from one probe, not a finished port.
