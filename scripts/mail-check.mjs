// Mail, checked with no network, no mailbox and no credentials.
//
//   node scripts/mail-check.mjs
//
// Sending mail is the most dangerous thing this deployment does: it is
// irreversible, outward-facing, reaches a real person, and arrives wearing the
// owner's name. Nothing else here has all four at once. So this suite is
// almost entirely about the REFUSALS, and about them happening before a
// request is built rather than after a provider bounces it.
import {
  CAPABILITIES,
  MAIL_PROVIDERS,
  MAX_RECIPIENTS,
  assertCan,
  assertDraft,
  assertRecipients,
  assertReplyTarget,
  buildMime,
  capability,
  formatAddress,
  isAddress,
  parseAddress,
  quote,
  replySubject,
  shapeMessage,
  summarise,
  toRawMessage,
  toRecipients,
} from "../lib/server/mailShape.js";

let pass = 0;
const fails = [];
const check = (ok, name, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};
const throws = (fn, name, re) => {
  try {
    fn();
    check(false, name, "it did not throw");
  } catch (e) {
    check(!re || re.test(e.message), name, re ? e.message.slice(0, 120) : "");
  }
};

/* ------------------------------------------------------------------ */

console.log("\naddresses are checked before anything is sent");
{
  for (const good of ["a@b.com", "first.last@sub.example.co.uk", "x+tag@y.dev"])
    check(isAddress(good), `"${good}" is an address`);
  for (const bad of ["", "no-at-sign", "a@b", "a@@b.com", "a b@c.com", "a@b.com, c@d.com", "<a@b.com>"])
    check(!isAddress(bad), `"${bad}" is not`);

  const p = parseAddress("Ada Lovelace <ada@example.com>");
  check(p.name === "Ada Lovelace" && p.email === "ada@example.com", "a display name is split off", JSON.stringify(p));
  check(parseAddress("plain@example.com").email === "plain@example.com", "a bare address survives");
  check(
    formatAddress({ name: "Doe, John", email: "j@x.com" }).startsWith('"'),
    "a name with a comma is quoted, or it would read as two recipients"
  );
  check(toRecipients("a@b.com, c@d.com").length === 2, "a comma-separated line splits");
  check(toRecipients(["a@b.com", "c@d.com"]).length === 2, "and so does a list");
}

console.log("\nand a bad one is refused rather than bounced");
{
  throws(() => assertRecipients([]), "no recipient at all", /at least one/);
  throws(() => assertRecipients(["nope"]), "a malformed address names itself", /Not a usable address/);
  throws(
    () => assertRecipients(Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `a${i}@b.com`)),
    "too many recipients is refused with the cap",
    /cap here is 25/
  );
  throws(
    () => assertRecipients(Array.from({ length: 40 }, (_, i) => `a${i}@b.com`)),
    "and says why that cap exists",
    /cannot be taken back/
  );
  check(assertRecipients("a@b.com").length === 1, "one good address passes");
}

console.log("\na draft that cannot be unsent is refused while it still can be");
{
  throws(() => assertDraft({ to: "a@b.com", subject: "x", body: "" }), "an empty body", /needs a body/);
  throws(() => assertDraft({ to: "a@b.com", subject: "x", body: "   " }), "and whitespace is empty", /needs a body/);
  throws(
    () => assertDraft({ to: "a@b.com", subject: "s".repeat(1200), body: "hi" }),
    "an absurd subject names the limit",
    /998/
  );
  const d = assertDraft({ to: "a@b.com", cc: "c@d.com", subject: " Hi ", body: "Hello" });
  check(d.subject === "Hi", "the subject is trimmed");
  check(d.cc.length === 1, "cc is parsed too");
  // A subject may legitimately be empty; a body may not.
  check(assertDraft({ to: "a@b.com", subject: "", body: "x" }).subject === "", "an empty subject is allowed");
}

console.log("\nheader injection cannot get through");
{
  const mime = buildMime({
    to: "a@b.com",
    subject: "Hi\r\nBcc: sneak@evil.com",
    body: "hello",
  });
  const headerBlock = mime.split("\r\n\r\n")[0];
  // The text DOES survive — flattened into the Subject, which is correct. What
  // must not exist is a LINE that begins a header, so this checks line starts
  // rather than whether the string appears anywhere.
  check(
    !headerBlock.split("\r\n").some((l) => /^bcc:/i.test(l)),
    "a newline in the subject cannot add a header",
    headerBlock.split("\r\n").filter((l) => /sneak/.test(l)).join(" | ")
  );
  check(headerBlock.split("\r\n").filter((l) => /^Subject:/.test(l)).length === 1, "and there is still one Subject");
  check(/Hi Bcc: sneak@evil.com/.test(mime), "the text survives, flattened onto one line");
}

console.log("\nthe MIME a reply needs to thread");
{
  const mime = buildMime(
    { to: "a@b.com", subject: "Re: thing", body: "yes" },
    { from: "me@x.com", inReplyTo: "<abc@mail>" }
  );
  check(/^From: me@x\.com/m.test(mime), "From is set when given");
  check(/^In-Reply-To: <abc@mail>/m.test(mime), "In-Reply-To carries the original id");
  // Without References some clients start a NEW conversation, which is the
  // kind of bug nobody notices until a thread splits in two.
  check(/^References: <abc@mail>/m.test(mime), "and References too, or clients split the thread");
  check(/charset="UTF-8"/.test(mime), "the body is declared UTF-8");
  const raw = toRawMessage(mime);
  check(!/[+/=]/.test(raw), "the raw message is base64url with no padding, which is what Gmail takes");
  check(Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") === mime, "and round-trips");
}

console.log("\nthe two services differ, and every difference is declared");
{
  check(MAIL_PROVIDERS.join() === "gmail,outlook", "both are catalogued", MAIL_PROVIDERS.join());
  for (const p of MAIL_PROVIDERS) {
    for (const v of ["read", "send", "reply", "markRead", "archive", "trash"])
      check(capability(p, v).available, `${p} can ${v}`);
  }
  // The differences that actually bite.
  check(capability("gmail", "labels").available, "Gmail has labels");
  check(!capability("outlook", "labels").available, "Outlook does not");
  check(
    /FOLDERS/.test(capability("outlook", "labels").why),
    "and says why: a message lives in exactly one folder",
    capability("outlook", "labels").why
  );
  check(!!capability("outlook", "labels").instead, "with a route that works");
  // The capability nobody should have.
  for (const p of MAIL_PROVIDERS) {
    check(!capability(p, "permanentDelete").available, `${p} offers no permanent delete`);
    check(!!capability(p, "permanentDelete").instead, `and ${p} says what to do instead`);
  }
  check(
    /mail\.google\.com/.test(capability("gmail", "permanentDelete").why),
    "Gmail's reason names the scope that is never requested"
  );
  throws(() => assertCan("outlook", "labels"), "asking Outlook for labels is refused before any call", /cannot do that/);
  throws(() => capability("imap", "read"), "an unknown provider is refused with the list", /One of: gmail, outlook/);
}

console.log("\na reply must know what it answers");
{
  throws(() => assertReplyTarget({}), "a reply with no target is refused", /needs the message it answers/);
  throws(() => assertReplyTarget({}), "and says what would otherwise happen", /looks like it worked/);
  check(assertReplyTarget({ messageId: "m1" }).messageId === "m1", "a message id is enough");
  check(assertReplyTarget({ threadId: "t1" }).threadId === "t1", "so is a thread id");
  check(replySubject("Hello") === "Re: Hello", "a subject gains Re:");
  check(replySubject("Re: Hello") === "Re: Hello", "and does not gain a second one");
  check(replySubject("RE: Hello") === "RE: Hello", "whatever its case");
  const q = quote({ from: { name: "Ada" }, at: "2026-10-09T10:00:00Z", preview: "two\nlines" }, "Thanks");
  check(q.startsWith("Thanks"), "the reply leads, the quote follows");
  check(/> two\n> lines/.test(q), "every quoted line is marked");
  check(/Ada wrote:/.test(q), "and it says who");
}

console.log("\ntwo payloads, one row shape");
{
  const g = shapeMessage("gmail", {
    id: "g1",
    threadId: "t1",
    snippet: "hello there",
    internalDate: "1760000000000",
    labelIds: ["INBOX", "UNREAD"],
    payload: {
      headers: [
        { name: "From", value: "Ada <ada@x.com>" },
        { name: "To", value: "me@y.com" },
        { name: "Subject", value: "Hi" },
        { name: "Message-ID", value: "<abc@mail>" },
      ],
      parts: [{ filename: "a.pdf" }],
    },
  });
  const o = shapeMessage("outlook", {
    id: "o1",
    conversationId: "c1",
    bodyPreview: "hello there",
    receivedDateTime: "2026-10-09T10:00:00Z",
    isRead: false,
    hasAttachments: true,
    from: { emailAddress: { name: "Ada", address: "ada@x.com" } },
    toRecipients: [{ emailAddress: { address: "me@y.com" } }],
    subject: "Hi",
    internetMessageId: "<abc@mail>",
  });
  for (const k of ["id", "threadId", "from", "to", "subject", "preview", "at", "unread", "hasAttachment"]) {
    check(k in g && k in o, `both carry ${k}`);
  }
  check(g.from.email === o.from.email, "the sender is read the same way from both", `${g.from.email} / ${o.from.email}`);
  check(g.unread === true && o.unread === true, "unread means the same thing in both");
  check(g.hasAttachment === true && o.hasAttachment === true, "so does an attachment");
  check(g.provider === "gmail" && o.provider === "outlook", "and each row says where it came from");
  // Gmail says UNREAD; Outlook says isRead:false. Reading one as the other is
  // how an inbox reports everything as read.
  check(shapeMessage("outlook", { id: "x", isRead: true }).unread === false, "an Outlook read message is not unread");
  check(shapeMessage("gmail", { id: "x", labelIds: ["INBOX"] }).unread === false, "nor a Gmail one without UNREAD");
}

console.log("\nthe figures describe what was counted, not the mailbox");
{
  const now = Date.now();
  const at = (d) => new Date(now - d * 86400000).toISOString();
  const msgs = [
    { at: at(0), unread: true, hasAttachment: false, from: { email: "a@x.com", name: "A" } },
    { at: at(0), unread: false, hasAttachment: true, from: { email: "a@x.com", name: "A" } },
    { at: at(2), unread: true, hasAttachment: false, from: { email: "b@x.com", name: "B" } },
    { at: at(40), unread: false, hasAttachment: false, from: { email: "c@x.com", name: "C" } },
  ];
  const s = summarise(msgs, { days: 7 });
  check(s.counted === 4, "it counts everything it was given", String(s.counted));
  check(s.inWindow === 3, "and says how many fall in the window", String(s.inWindow));
  check(s.unread === 2, "unread is counted across all of them");
  check(s.withAttachment === 1, "so are attachments");
  check(s.perDay.length === 7, "there is one bucket per day", String(s.perDay.length));
  // A strip drawn only from days that had mail is not a timeline.
  check(s.perDay.some((d) => d.received === 0), "including days with nothing, so the strip is a timeline");
  // "Ten arrived" and "ten arrived and none has been read" are different
  // mornings, so the bucket carries both rather than making a caller re-count.
  check(s.perDay[s.perDay.length - 1].unread === 1, "each day says how much of it is still unread",
    JSON.stringify(s.perDay[s.perDay.length - 1]));
  check(
    s.perDay.every((d) => d.unread <= d.received),
    "and a day can never report more unread than arrived"
  );
  check(s.topSenders[0].email === "a@x.com" && s.topSenders[0].count === 2, "the busiest sender leads");
  check(s.busiestDay.received === 2, "and the busiest day is named", JSON.stringify(s.busiestDay));
  const empty = summarise([], { days: 7 });
  check(empty.counted === 0 && empty.topSenders.length === 0, "an empty mailbox summarises to nothing, not NaN");
  check(empty.perDay.length === 7, "and still draws the window");
}

console.log("\nthe query a listing actually sends");
{
  const { queryUrl } = await import("../lib/server/mailBoard.js");
  const u = queryUrl("https://gmail.googleapis.com/gmail/v1/users/me/messages/1", {
    format: "metadata",
    metadataHeaders: ["From", "To", "Subject", "Message-ID"],
  });
  // THE bug this test exists for. String(array) gives one comma-joined value,
  // Gmail matches no header against it, and every message comes back with an
  // EMPTY headers array -- a 200, a correct snippet, a correct date, and a
  // whole inbox reading "Unknown sender" with nothing in any log to say why.
  check(
    u.searchParams.getAll("metadataHeaders").length === 4,
    "an array parameter is REPEATED, not comma-joined",
    u.searchParams.getAll("metadataHeaders").join(" | ")
  );
  check(u.searchParams.get("format") === "metadata", "and a scalar is still set once");
  check(
    !queryUrl("https://x.test/y", { q: "", max: undefined, labelIds: null }).search,
    "an empty, undefined or null value is left off entirely"
  );
  check(
    queryUrl("https://x.test/y", { q: "from:ada is:unread" }).searchParams.get("q") === "from:ada is:unread",
    "and a query with spaces survives encoding"
  );
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nfailures:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
