// Compare the JavaScript export of every tests/cases/*.tex with the result
// saved by tests/test_export.py, so both twins must agree.
//     node tests/test_export.mjs
import { readFileSync, readdirSync } from "node:fs";
import { convert } from "../web/backend/export.js";

const cases = new URL("./cases/", import.meta.url);
const extensions = { markdown: ".md", html: ".html" };
let failures = 0;

for (const file of readdirSync(cases).filter(f => f.endsWith(".tex")).sort()) {
  const tex = readFileSync(new URL(file, cases), "utf-8");
  for (const [fmt, ext] of Object.entries(extensions)) {
    const expectedName = file.replace(/\.tex$/, ext);
    const expected = readFileSync(new URL(expectedName, cases), "utf-8");
    const [output] = convert(tex, fmt);
    if (output !== expected) {
      failures++;
      console.log(`FAIL ${expectedName}`);
    }
  }
}
console.log(`${failures} failure(s)`);
process.exit(failures ? 1 : 0);
