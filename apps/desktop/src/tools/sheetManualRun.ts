import { check, setup } from "./sheetManualFixture";

/**
 * The commands of the sheet manual test, run against the scratch home that `scripts/sheet-manual.mjs` points HOME and the settings
 * file at before starting this. See docs/manual-tests/sheet.md.
 */

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "setup") {
    const home = option("home");
    if (!home) throw new Error("setup needs --home.");
    console.log((await setup(home)).join("\n"));
  } else if (command === "check") {
    const files = rest.filter((arg, i) => !arg.startsWith("--") && rest[i - 1] !== "--home");
    if (files.length === 0) throw new Error("check needs the workbooks to check: pnpm manual:sheet check book.xlsx [more.xlsx] [--names]");
    console.log((await check(files, rest.includes("--names"))).join("\n"));
  } else {
    throw new Error(`Unknown command "${command ?? ""}".`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
