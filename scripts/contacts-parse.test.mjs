/* Unit tests for the LinkedIn Connections.csv parser.
 *
 *   node scripts/contacts-parse.test.mjs
 *
 * The parser runs against real exported data before it is allowed to write
 * ~1,100 documents, because the failure mode is silent: a mis-split row makes a
 * person's employer end up in their surname and nobody notices until a search
 * comes back wrong.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

// The panel is a React component, so the two pure functions are re-declared
// here by extracting them from the source — keeping one implementation.
const src = fs.readFileSync(
  path.resolve(here, "..", "components", "admin", "ContactsPanel.js"),
  "utf8"
);
const pick = (name) => {
  const start = src.indexOf(`export function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in ContactsPanel.js`);
  // walk braces to the end of the function
  let depth = 0;
  let i = src.indexOf("{", start);
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(start, i + 1).replace(/^export /, "");
};

const mod = await import(
  "data:text/javascript," +
    encodeURIComponent(
      `${pick("parseCsv")}\n${pick("parseConnections")}\n${pick("contactId")}\n` +
        `export { parseCsv, parseConnections, contactId };`
    )
);
const { parseCsv, parseConnections, contactId } = mod;

let pass = 0;
let fail = 0;
const check = (cond, name, detail) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

console.log("csv edge cases");
{
  const rows = parseCsv('a,b,c\n1,"two, with comma",3\n4,"say ""hi""",6\n');
  check(rows.length === 3, "row count", String(rows.length));
  check(rows[1][1] === "two, with comma", "quoted comma kept in one field", rows[1][1]);
  check(rows[2][1] === 'say "hi"', "escaped quotes unescaped", rows[2][1]);
}
{
  const rows = parseCsv('a,b\r\n"multi\nline",2\r\n');
  check(rows[1][0] === "multi\nline", "newline inside quotes stays in the field");
}
{
  const rows = parseCsv("﻿a,b\n1,2\n");
  check(rows[0][0] === "a", "BOM stripped", JSON.stringify(rows[0][0]));
}

console.log("\npreamble handling");
{
  const sample =
    'Notes:\n"Some long note, with a comma and ""quotes""."\n\n' +
    "First Name,Last Name,URL,Email Address,Company,Position,Connected On\n" +
    "Ada,Lovelace,https://www.linkedin.com/in/ada,ada@example.com,Analytical Engines,Engineer,01 Jan 2026\n";
  const { rows, error } = parseConnections(sample);
  check(!error, "header found past the preamble", error);
  check(rows.length === 1, "preamble rows not treated as people", String(rows?.length));
  check(rows[0].name === "Ada Lovelace", "name joined", rows[0].name);
  check(rows[0].company === "Analytical Engines", "company mapped by header name");
  check(contactId(rows[0]) === "ada", "doc id from the vanity slug", contactId(rows[0]));
}
{
  const { error } = parseConnections("something,else\n1,2\n");
  check(!!error, "a non-connections CSV is rejected");
}
{
  const id = contactId({ name: "No Url Person", company: "Acme", url: "" });
  check(id === "no-url-person-acme", "falls back to a name+company id", id);
}

console.log("\nreal export");
const real = path.resolve(here, "..", "..", "linkedin", "Connections.csv");
if (!fs.existsSync(real)) {
  console.log("  ! linkedin/Connections.csv not found — skipping");
} else {
  const { rows, error } = parseConnections(fs.readFileSync(real, "utf8"));
  check(!error, "real file parses", error);
  if (rows) {
    check(rows.length > 500, `parsed ${rows.length} connections`);
    const ids = new Set(rows.map(contactId));
    check(
      ids.size >= rows.length * 0.97,
      "doc ids are essentially unique",
      `${ids.size} ids for ${rows.length} rows`
    );
    check(
      rows.every((r) => r.name && r.name.trim().length > 0),
      "every row has a name"
    );
    const dated = rows.filter((r) => /\d{2} \w{3} \d{4}/.test(r.connectedOn));
    check(
      dated.length > rows.length * 0.9,
      "connected-on dates line up with the right column",
      `${dated.length}/${rows.length}`
    );
    const withCompany = rows.filter((r) => r.company).length;
    console.log(
      `     ${rows.length} connections · ${withCompany} with a company · ` +
        `${rows.filter((r) => r.email).length} with an e-mail`
    );
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
