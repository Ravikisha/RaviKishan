// What a contact IS here.
//
// PURE — no imports, no network, no node APIs — because five places need it
// (the MCP tools, the admin panel, the LinkedIn importer, the unified search
// and the tests). The same reason noteShape.js and repoAudit.js are pure, and
// the GitHub audit already showed what a second copy does within an hour.
//
// WHAT CHANGED, and why
//
// The original record was LinkedIn-shaped: one `email`, one `url`, a company
// and a position. That is fine for an imported connection and wrong for
// everything else — a person has two e-mail addresses, a mobile and a work
// number, a GitHub handle, and a postal address, and none of that fits in a
// field called `email`.
//
// So a contact now holds CHANNELS: an ordered list of ways to reach someone,
// each with a kind, a value and an optional label. The old scalars are still
// read (and folded into channels) so nothing imported is lost and nothing has
// to be migrated before it works.

export class ContactError extends Error {}

export const CHANNEL_KINDS = ["email", "phone", "url", "handle", "address", "other"];

export const MAX_NAME = 120;
export const MAX_NOTE = 20_000;
export const MAX_CHANNELS = 40;

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const clean = (v) => str(v).replace(/\s+/g, " ").trim();

/* ---------------- recognising a value ---------------- */

// Deliberately permissive. This is not validation for a signup form — it is
// "does this look like the thing", on text a human pasted. Refusing a real
// address because it has a plus sign or a long TLD is worse than storing one
// that turns out to be a typo.
export const EMAIL_RE = /[^\s<>()[\]{},;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/g;

// A phone number as people actually write them: +91 98765 43210, (020) 7946
// 0958, 555-0199 x23. Requires at least 7 digits so it does not swallow years,
// version numbers or house numbers.
export const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d(?:[\d\s.-]{5,}\d)(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?/gi;

export const URL_RE = /\bhttps?:\/\/[^\s<>()"']+|(?:\b(?:www\.|(?:github|linkedin|twitter|x|instagram|youtube|t)\.(?:com|me|co))\/[^\s<>()"']+)/gi;

// @handle, but not an e-mail's local part and not a decorator in code.
export const HANDLE_RE = /(?:^|\s)@([A-Za-z0-9_.-]{2,30})\b/g;

/* ---------------- normalising a value ---------------- */

// Phones are stored AS TYPED and matched on digits. Normalising to E.164 would
// mean guessing a country code, and a guessed country code is a wrong phone
// number that looks right — worse than no normalisation at all.
export function phoneDigits(value) {
  const s = str(value);
  const ext = /(?:x|ext\.?|extension)\s*(\d{1,6})\s*$/i.exec(s);
  const main = ext ? s.slice(0, ext.index) : s;
  const digits = main.replace(/\D/g, "");
  return { digits, ext: ext ? ext[1] : "" };
}

// Two numbers are "the same" when their last 10 digits match: +91 98765 43210,
// 098765 43210 and 9876543210 are one phone written three ways, and a contact
// book that treats them as three people is useless.
export const phoneKey = (value) => {
  const { digits } = phoneDigits(value);
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

export const emailKey = (value) => clean(value).toLowerCase();

export function normaliseChannel(raw) {
  const kind = CHANNEL_KINDS.includes(raw?.kind) ? raw.kind : "other";
  let value = clean(raw?.value);
  if (!value) throw new ContactError("A channel needs a value.");

  if (kind === "email") value = value.toLowerCase();
  if (kind === "url" && !/^https?:\/\//i.test(value)) value = `https://${value}`;
  if (kind === "handle") value = value.replace(/^@+/, "");

  return {
    kind,
    value,
    label: clean(raw?.label).slice(0, 40),
    // What two channels are compared on. Stored rather than recomputed so a
    // change to the matching rule cannot silently re-merge old records.
    key: kind === "email" ? emailKey(value) : kind === "phone" ? phoneKey(value) : value.toLowerCase(),
  };
}

export function dedupeChannels(channels) {
  const seen = new Map();
  for (const c of channels || []) {
    let n;
    try {
      n = normaliseChannel(c);
    } catch (_) {
      continue;
    }
    const id = `${n.kind}::${n.key}`;
    // First one wins, but a later duplicate carrying a label fills in a blank
    // one — "the same number, now with 'mobile' attached" is new information.
    if (!seen.has(id)) seen.set(id, n);
    else if (!seen.get(id).label && n.label) seen.get(id).label = n.label;
  }
  return [...seen.values()].slice(0, MAX_CHANNELS);
}

/* ---------------- pasting anything ---------------- */

// The point of "add contact information in any form": you paste an e-mail
// signature, a line from a message, a vCard fragment, and the channels are
// pulled out of it.
//
// Everything it cannot classify is KEPT as the note rather than dropped —
// losing the one line that said "met at the Rust meetup" would make the
// feature worse than typing the fields by hand.
export function parseContactText(text) {
  const src = str(text);
  if (!clean(src)) throw new ContactError("There is nothing to read.");

  const channels = [];
  let rest = src;

  const take = (re, kind, transform = (m) => m[0]) => {
    rest = rest.replace(re, (...args) => {
      const m = args.slice(0, -2);
      m.index = args[args.length - 2];
      try {
        channels.push(normaliseChannel({ kind, value: transform(m) }));
      } catch (_) {}
      return " ";
    });
  };

  // Order matters. E-mails first, or the phone pattern eats the digits in an
  // address like a1b2@example.com, and URLs before handles, or every
  // "twitter.com/x" contributes a bogus handle.
  take(new RegExp(EMAIL_RE.source, "g"), "email");
  take(new RegExp(URL_RE.source, "gi"), "url");
  take(new RegExp(PHONE_RE.source, "gi"), "phone");
  take(new RegExp(HANDLE_RE.source, "g"), "handle", (m) => m[1]);

  // Removing the channels leaves the punctuation that joined them behind:
  // "ravi - ravi@x.com, 98765" becomes "ravi - ,". A separator is noise when it
  // is not between two word characters — so "Met in Pune, India" keeps its
  // comma and an orphaned one goes.
  const tidy = (l) =>
    clean(
      str(l)
        .replace(/(^|\s)[|•·\-–—,;:/]+(?=\s|$)/g, " ")
        .replace(/^[|•·\-–—,;:/\s]+|[|•·\-–—,;:/\s]+$/g, "")
    );

  // The name: the first line that still has words in it after the channels
  // were removed. A signature's first line is almost always the person.
  const lines = rest
    .split(/[\n\r]+/)
    .map(tidy)
    .filter(Boolean);

  const nameLine = lines.find((l) => /[A-Za-z]{2,}/.test(l) && l.split(/\s+/).length <= 6) || "";
  const name = clean(nameLine).slice(0, MAX_NAME);
  const note = lines.filter((l) => l !== nameLine).join("\n").slice(0, MAX_NOTE);

  return { name, channels: dedupeChannels(channels), note };
}

/* ---------------- the record ---------------- */

// Reads BOTH shapes: the LinkedIn-imported scalars and the channel list. A
// record imported a year ago renders identically to one typed today, and
// nothing had to be migrated for that to be true.
export function shapeContact(raw = {}, { id } = {}) {
  const legacy = [];
  if (raw.email) legacy.push({ kind: "email", value: raw.email, label: "" });
  if (raw.phone) legacy.push({ kind: "phone", value: raw.phone, label: "" });
  if (raw.url) legacy.push({ kind: "url", value: raw.url, label: "linkedin" });

  const name =
    clean(raw.name) || clean(`${str(raw.first)} ${str(raw.last)}`) || "";

  return {
    id: str(id || raw.id),
    name: name.slice(0, MAX_NAME),
    first: clean(raw.first),
    last: clean(raw.last),
    company: clean(raw.company),
    position: clean(raw.position),
    channels: dedupeChannels([...(raw.channels || []), ...legacy]),
    tags: [...new Set((raw.tags || []).map((t) => clean(t)).filter(Boolean))].slice(0, 30),
    note: str(raw.note).slice(0, MAX_NOTE),
    // Where it came from, so an import can refresh its own records without
    // touching one you typed.
    source: raw.source || (raw.connectedOn || raw.url ? "linkedin" : "manual"),
    connectedOn: clean(raw.connectedOn),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

export const channelsOf = (contact, kind) =>
  (contact.channels || []).filter((c) => c.kind === kind).map((c) => c.value);

export const primaryEmail = (contact) => channelsOf(contact, "email")[0] || "";
export const primaryPhone = (contact) => channelsOf(contact, "phone")[0] || "";

/* ---------------- identity ---------------- */

const slugify = (s) =>
  clean(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

// A LinkedIn import keeps using the vanity slug, so re-importing updates a
// person in place. Anything else is named after the person, with a short
// suffix — two people really are called the same thing, and a collision that
// silently overwrites one of them is the worst outcome here.
export function contactId(contact, { suffix = "" } = {}) {
  const url = (contact.url || channelsOf(contact, "url").find((u) => /linkedin\.com/i.test(u)) || "").replace(/\/+$/, "");
  const slug = url.split("/").pop();
  if (slug && /^[\w.-]{2,}$/.test(slug) && /linkedin/i.test(url)) return slug.toLowerCase();

  const base =
    slugify(contact.name) ||
    slugify(primaryEmail(contact).split("@")[0]) ||
    slugify(primaryPhone(contact)) ||
    "contact";
  return suffix ? `${base}-${suffix}` : base;
}

/* ---------------- finding duplicates ---------------- */

// Same person, two records. Decided ONLY on a shared channel key: two people
// who share an e-mail address or a phone number are one person, and two people
// with the same name are routinely not.
export function sameAs(a, b) {
  const keys = new Set((a.channels || []).filter((c) => c.kind === "email" || c.kind === "phone").map((c) => `${c.kind}::${c.key}`));
  if (!keys.size) return false;
  return (b.channels || []).some((c) => (c.kind === "email" || c.kind === "phone") && keys.has(`${c.kind}::${c.key}`));
}

// Keeps everything from both. The older record wins on scalar fields — it is
// the one with history — except where it is empty, and the notes are joined
// rather than one replacing the other.
export function mergeContacts(keep, drop) {
  const notes = [keep.note, drop.note].map(clean).filter(Boolean);
  return shapeContact({
    ...drop,
    ...keep,
    name: keep.name || drop.name,
    company: keep.company || drop.company,
    position: keep.position || drop.position,
    channels: dedupeChannels([...(keep.channels || []), ...(drop.channels || [])]),
    tags: [...(keep.tags || []), ...(drop.tags || [])],
    note: [...new Set(notes)].join("\n\n"),
    createdAt: [keep.createdAt, drop.createdAt].filter(Boolean).sort()[0] || "",
    updatedAt: new Date().toISOString(),
  }, { id: keep.id });
}

/* ---------------- search ---------------- */

// Scored, like the notes search and for the same reason: a name match almost
// always means that person, and a substring filter sorts a passing mention in
// a note above the contact actually called that.
export function searchContacts(contacts, query, { limit = 50 } = {}) {
  const q = clean(query).toLowerCase();
  if (q.length < 2) throw new ContactError("Give at least two characters to search for.");
  const terms = q.split(/\s+/).filter(Boolean);

  // A search that looks like a phone number matches on digits, so you can find
  // someone by a number written differently from how you stored it.
  const asPhone = phoneKey(q);
  const phoneSearch = asPhone.length >= 7;

  const out = [];
  for (const c of contacts) {
    const name = str(c.name).toLowerCase();
    const company = str(c.company).toLowerCase();
    const position = str(c.position).toLowerCase();
    const note = str(c.note).toLowerCase();
    const tags = (c.tags || []).map((t) => String(t).toLowerCase());
    const values = (c.channels || []).map((ch) => String(ch.value).toLowerCase());
    const keys = (c.channels || []).map((ch) => String(ch.key));

    let score = 0;
    if (phoneSearch && keys.some((k) => k.endsWith(asPhone))) score += 20;

    let missed = false;
    for (const t of terms) {
      const inName = name.includes(t);
      const inChannel = values.some((v) => v.includes(t));
      const inTag = tags.some((x) => x.includes(t));
      const inWork = company.includes(t) || position.includes(t);
      const inNote = note.includes(t);
      if (!inName && !inChannel && !inTag && !inWork && !inNote) {
        missed = true;
        break;
      }
      if (inName) score += name === t ? 14 : 7;
      if (inChannel) score += 6;
      if (inTag) score += 4;
      if (inWork) score += 2;
      if (inNote) score += 1;
    }
    if (missed && !(phoneSearch && score)) continue;
    out.push({ ...c, score });
  }

  out.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
  return out.slice(0, limit);
}

/* ---------------- writing ---------------- */

export function validateContact(patch, { creating = false } = {}) {
  if (!patch || typeof patch !== "object") throw new ContactError("Nothing to write.");

  const fields = ["name", "first", "last", "company", "position", "note", "channels", "tags"];
  const given = fields.filter((f) => patch[f] !== undefined);
  if (!given.length) throw new ContactError(`Nothing to change — pass one of ${fields.join(", ")}.`);

  if (creating && !clean(patch.name) && !(patch.channels || []).length) {
    throw new ContactError("A contact needs a name or at least one way to reach them.");
  }
  if (patch.name !== undefined && str(patch.name).length > MAX_NAME) {
    throw new ContactError(`A name is capped at ${MAX_NAME} characters.`);
  }
  if (patch.note !== undefined && str(patch.note).length > MAX_NOTE) {
    throw new ContactError(`A note is capped at ${MAX_NOTE} characters.`);
  }
  if (patch.channels !== undefined && !Array.isArray(patch.channels)) {
    throw new ContactError("channels must be a list of { kind, value, label }.");
  }
  return given;
}
