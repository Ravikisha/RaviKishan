// The contact model, checked without a network or a browser.
//
// Two things here are easy to get subtly wrong and expensive to discover
// later: what counts as the SAME person, and what a pasted blob of text
// actually contains. Both are pure, so both are pinned here.
//
//   node scripts/contactshape-check.mjs
const C = await import("../lib/server/contactShape.js");

let pass = 0;
const fails = [];
const check = (ok, name, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  OK  ${name}`);
  } else {
    fails.push(`${name}${detail ? ` - ${detail}` : ""}`);
    console.log(`  XX  ${name}${detail ? ` - ${detail}` : ""}`);
  }
};
const throws = (fn, name, re) => {
  try {
    fn();
    check(false, name, "it did not throw");
  } catch (e) {
    check(re.test(e.message), name, e.message.slice(0, 110));
  }
};

const kinds = (r) => r.channels.map((c) => `${c.kind}:${c.value}`);

console.log("\npasting anything: an e-mail signature");
{
  const r = C.parseContactText(
    [
      "Asha Menon",
      "Staff Engineer, Northwind",
      "asha.menon+work@northwind.co.in | +91 98765 43210",
      "github.com/ashamenon  @asha_m",
      "Met at the Rust meetup in Bangalore.",
    ].join("\n")
  );

  check(r.name === "Asha Menon", "the name is the first line that is a name", r.name);
  check(r.channels.some((c) => c.kind === "email" && c.value === "asha.menon+work@northwind.co.in"), "the e-mail is found, plus sign and all", JSON.stringify(kinds(r)));
  check(r.channels.some((c) => c.kind === "phone"), "the phone is found", JSON.stringify(kinds(r)));
  check(r.channels.some((c) => c.kind === "url" && /github\.com\/ashamenon/.test(c.value)), "the url is found");
  check(r.channels.some((c) => c.kind === "handle" && c.value === "asha_m"), "the handle is found, without its @", JSON.stringify(kinds(r)));
  // The line that is not a channel is the reason you saved them.
  check(/Rust meetup/.test(r.note), "and the prose survives as the note", r.note);
  check(/Staff Engineer/.test(r.note), "including the job title line");
}

console.log("\npasting anything: one scruffy line");
{
  const r = C.parseContactText("ravi — ravi@example.com, 9876543210");
  check(r.name === "ravi", "a name is pulled from a single line", r.name);
  check(C.primaryEmail(r) === "ravi@example.com", "with the e-mail", C.primaryEmail(r));
  check(C.primaryPhone(r) !== "", "and the phone", JSON.stringify(kinds(r)));
  throws(() => C.parseContactText("   "), "empty text is refused", /nothing to read/i);
}

console.log("\nthe parser does not invent channels");
{
  // Years, versions and house numbers are not phone numbers.
  const r = C.parseContactText("Met in 2024. Running v2.1.3 on 42 Oak Street.");
  check(!r.channels.some((c) => c.kind === "phone"), "a year, a version and a house number are not phones", JSON.stringify(kinds(r)));

  // A URL must not also register as a handle.
  const u = C.parseContactText("https://twitter.com/someone");
  check(u.channels.filter((c) => c.kind === "handle").length === 0, "a url does not also become a handle", JSON.stringify(kinds(u)));
  check(u.channels.some((c) => c.kind === "url"), "it stays a url");

  // An e-mail must not leave its domain behind as a url, nor its local part
  // as a handle.
  const e = C.parseContactText("write to me at bob@acme.io");
  check(e.channels.length === 1 && e.channels[0].kind === "email", "an e-mail yields exactly one channel", JSON.stringify(kinds(e)));
}

console.log("\nphones: stored as typed, matched on digits");
{
  // Normalising to E.164 would mean GUESSING a country code, and a guessed
  // country code is a wrong number that looks right.
  const c = C.normaliseChannel({ kind: "phone", value: "+91 98765 43210" });
  check(c.value === "+91 98765 43210", "the number is stored exactly as written", c.value);
  check(C.phoneKey("+91 98765 43210") === C.phoneKey("098765 43210"), "but +91 98765 43210 and 098765 43210 match");
  check(C.phoneKey("9876543210") === C.phoneKey("(987) 654-3210"), "and formatting is ignored");
  check(C.phoneKey("12345") === "12345", "a short number is not truncated into a false match");

  const ext = C.phoneDigits("020 7946 0958 x23");
  check(ext.ext === "23", "an extension is kept separate", JSON.stringify(ext));
  check(!ext.digits.endsWith("23"), "and does not pollute the matching digits", ext.digits);
}

console.log("\nchannels normalise and de-duplicate");
{
  const list = C.dedupeChannels([
    { kind: "email", value: "  Bob@Acme.IO " },
    { kind: "email", value: "bob@acme.io", label: "work" },
    { kind: "phone", value: "+91 98765 43210" },
    { kind: "phone", value: "098765-43210" },
    { kind: "handle", value: "@ravi" },
    { kind: "url", value: "ravikishan.me" },
    { kind: "nonsense", value: "x" },
  ]);

  check(list.filter((c) => c.kind === "email").length === 1, "one address written two ways is one channel");
  check(list.find((c) => c.kind === "email").value === "bob@acme.io", "lower-cased and trimmed");
  // A duplicate that carries a label is new information, not noise.
  check(list.find((c) => c.kind === "email").label === "work", "and a label on the duplicate is kept");
  check(list.filter((c) => c.kind === "phone").length === 1, "one number written two ways is one channel");
  check(list.find((c) => c.kind === "handle").value === "ravi", "a handle loses its @");
  check(list.find((c) => c.kind === "url").value === "https://ravikishan.me", "a bare domain gains a scheme");
  check(list.find((c) => c.value === "x").kind === "other", "an unknown kind becomes other");
  throws(() => C.normaliseChannel({ kind: "email", value: "  " }), "an empty value is refused", /needs a value/);
}

console.log("\nthe old LinkedIn shape still reads");
{
  // Nothing was migrated. A record imported a year ago must render exactly
  // like one typed today.
  const old = C.shapeContact({
    first: "Asha",
    last: "Menon",
    email: "asha@northwind.co.in",
    url: "https://www.linkedin.com/in/ashamenon",
    company: "Northwind",
    position: "Staff Engineer",
    connectedOn: "12 Mar 2024",
  });
  check(old.name === "Asha Menon", "first and last become a name", old.name);
  check(C.primaryEmail(old) === "asha@northwind.co.in", "the legacy email becomes a channel");
  check(old.channels.some((c) => c.kind === "url"), "so does the legacy url");
  check(old.source === "linkedin", "and it is marked as imported", old.source);
  check(C.shapeContact({ name: "Typed Person" }).source === "manual", "a typed one is not");

  // Re-importing must update in place, not duplicate.
  check(C.contactId(old) === "ashamenon", "a LinkedIn record keeps its vanity slug as the id", C.contactId(old));
  const manual = C.shapeContact({ name: "Ravi Kishan", channels: [{ kind: "email", value: "r@x.com" }] });
  check(C.contactId(manual) === "ravi-kishan", "a typed one is named after the person", C.contactId(manual));
  check(C.contactId(manual, { suffix: "2" }) === "ravi-kishan-2", "with a suffix when two people share a name");
  check(C.contactId(C.shapeContact({ channels: [{ kind: "email", value: "solo@x.com" }] })) === "solo", "and falls back to the address");
}

console.log("\nsame person, two records");
{
  const a = C.shapeContact({ name: "Asha Menon", channels: [{ kind: "email", value: "asha@northwind.co.in" }] });
  const b = C.shapeContact({ name: "A. Menon", channels: [{ kind: "email", value: "ASHA@northwind.co.in" }] });
  const c = C.shapeContact({ name: "Asha Menon", channels: [{ kind: "email", value: "different@x.com" }] });

  check(C.sameAs(a, b), "a shared e-mail means the same person, whatever the case");
  // Two people really are called the same thing. Matching on name would merge
  // strangers, which is unrecoverable.
  check(!C.sameAs(a, c), "the same NAME does not");
  check(
    C.sameAs(
      C.shapeContact({ channels: [{ kind: "phone", value: "+91 98765 43210" }] }),
      C.shapeContact({ channels: [{ kind: "phone", value: "09876543210" }] })
    ),
    "a shared phone does, across formats"
  );
  check(!C.sameAs(C.shapeContact({ name: "X" }), C.shapeContact({ name: "X" })), "and a record with no channels matches nobody");
}

console.log("\nmerging keeps everything");
{
  const keep = C.shapeContact({
    name: "Asha Menon",
    company: "Northwind",
    note: "Met at the Rust meetup.",
    channels: [{ kind: "email", value: "asha@northwind.co.in" }],
    createdAt: "2024-03-12T00:00:00.000Z",
  }, { id: "ashamenon" });
  const drop = C.shapeContact({
    name: "A. Menon",
    position: "Staff Engineer",
    note: "Owes me a book.",
    tags: ["rust"],
    channels: [{ kind: "phone", value: "+91 98765 43210" }],
    createdAt: "2025-01-01T00:00:00.000Z",
  });

  const m = C.mergeContacts(keep, drop);
  check(m.id === "ashamenon", "the kept record's id survives", m.id);
  check(m.channels.length === 2, "both channels survive", String(m.channels.length));
  check(m.company === "Northwind" && m.position === "Staff Engineer", "each fills the other's blanks");
  // Losing half the notes on a merge is losing the reason you saved them.
  check(/Rust meetup/.test(m.note) && /Owes me a book/.test(m.note), "both notes are kept", m.note);
  check(m.tags.includes("rust"), "and the tags");
  check(m.createdAt === "2024-03-12T00:00:00.000Z", "the earlier creation date wins", m.createdAt);
}

console.log("\nsearch");
{
  const people = [
    C.shapeContact({ name: "Asha Menon", company: "Northwind", channels: [{ kind: "email", value: "asha@northwind.co.in" }, { kind: "phone", value: "+91 98765 43210" }] }),
    C.shapeContact({ name: "Bob Stone", company: "Acme", note: "knows asha from college", channels: [{ kind: "email", value: "bob@acme.io" }] }),
    C.shapeContact({ name: "Carol Diaz", tags: ["rust"], channels: [{ kind: "email", value: "carol@x.com" }] }),
  ];

  const hits = C.searchContacts(people, "asha");
  check(hits.length === 2, "a name and a mention both match", String(hits.length));
  // The whole reason for scoring: the person CALLED Asha outranks the note
  // that mentions her.
  check(hits[0].name === "Asha Menon", "the person named for it ranks first", hits.map((h) => h.name).join(","));

  check(C.searchContacts(people, "northwind")[0].name === "Asha Menon", "a company matches");
  check(C.searchContacts(people, "rust")[0].name === "Carol Diaz", "a tag matches");
  check(C.searchContacts(people, "bob@acme.io")[0].name === "Bob Stone", "an address matches");

  // Finding someone by a number written differently from how you stored it is
  // the whole point of keying on digits.
  const byPhone = C.searchContacts(people, "098765 43210");
  check(byPhone.length >= 1 && byPhone[0].name === "Asha Menon", "a phone matches across formats", JSON.stringify(byPhone.map((h) => h.name)));

  check(C.searchContacts(people, "asha menon").length === 1, "two words narrow rather than widen");
  throws(() => C.searchContacts(people, "a"), "a one-character search is refused", /at least two characters/);
}

console.log("\nwrites are validated before anything is sent");
{
  throws(() => C.validateContact({}), "an empty patch is refused", /Nothing to change/);
  throws(() => C.validateContact({ name: "" }, { creating: true }), "a new contact with no name and no channel is refused", /needs a name or at least one way/);
  throws(() => C.validateContact({ name: "x".repeat(200) }), "an over-long name is refused", /capped at 120/);
  throws(() => C.validateContact({ channels: "nope" }), "channels must be a list", /must be a list/);
  check(C.validateContact({ name: "ok" }).join() === "name", "a valid patch reports what it will write");
  check(C.validateContact({ name: "", channels: [{ kind: "email", value: "a@b.c" }] }, { creating: true }).length === 2, "a channel alone is enough to create one");
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("FAILURES:");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
