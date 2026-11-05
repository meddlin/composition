// Shared by the spike's checks: prints one line and appends it to $SPIKE_RESULTS (JSON lines),
// which render-summary.mjs turns into the job summary.
import fs from "node:fs";

const file = process.env.SPIKE_RESULTS;

/** ok is true (PASS), false (FAIL) or null (INFO: a measurement, not a verdict). */
export function record(check, ok, detail = "") {
  const text = String(detail).replace(/\s+/g, " ").trim().slice(0, 400);
  const label = ok === null ? "INFO" : ok ? "PASS" : "FAIL";
  console.log(`${label}  ${check}${text ? `  (${text})` : ""}`);
  if (file) fs.appendFileSync(file, `${JSON.stringify({ check, ok, detail: text })}\n`);
}
