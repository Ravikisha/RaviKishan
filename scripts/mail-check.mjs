// Mail, checked with no network, no mailbox and no credentials.
//
//   node scripts/mail-check.mjs
//
// Sending mail is the most dangerous thing this deployment does: it is
// irreversible, outward-facing, reaches a real person, and arrives wearing the
// owner's name. Nothing else here has all four at once. So this suite is
// almost entirely about the REFUSALS, and about them happening before a
// request is built rather than after a provider bounces it.
import { htmlToText, looksLikeHtml, mailFrameDoc, sanitiseMailHtml } from "../lib/server/mailHtml.js";
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

console.log("\nmail HTML: what must never survive");
{
  const esc = (s) => s;
  // Each of these is a real, documented way markup reaches a parser. They are
  // asserted here as DEFENCE IN DEPTH: the frame has no allow-same-origin and
  // the CSP is default-src 'none', so none of them could reach this page even
  // if one got through. That is the point of testing them anyway -- a
  // sanitiser nobody checks is a sanitiser nobody can rely on.
  const attacks = [
    ["a bare script", '<p>hi</p><script>steal()</script>', /script/i],
    ["a script with attributes", '<script type="text/javascript" src="//x.test/a.js"></script>', /script/i],
    ["an unclosed script", '<script>steal()', /script/i],
    ["an inline handler", '<img src="data:image/gif;base64,R0lGOD" onerror="steal()">', /onerror/i],
    ["an onload on the body", '<body onload="steal()">x</body>', /onload/i],
    ["a javascript: link", '<a href="javascript:steal()">click</a>', /javascript:/i],
    ["an entity-encoded javascript: link", '<a href="java&#115;cript:steal()">click</a>', /javascript:/i],
    ["a tab-split javascript: link", '<a href="java\tscript:steal()">click</a>', /javascript:/i],
    ["a data: link", '<a href="data:text/html,<script>steal()</script>">click</a>', /data:text\/html/i],
    ["an iframe", '<iframe src="//evil.test"></iframe>', /iframe/i],
    ["an object", '<object data="//evil.test/x.swf"></object>', /<object/i],
    ["an embed", '<embed src="//evil.test/x">', /<embed/i],
    ["a form", '<form action="//evil.test"><input name="p"></form>', /<form|<input/i],
    ["svg with a handler", '<svg><g onload="steal()"></g></svg>', /svg|onload/i],
    ["a base tag retargeting every link", '<base href="//evil.test/">', /<base/i],
    ["a meta refresh", '<meta http-equiv="refresh" content="0;url=//evil.test">', /http-equiv/i],
    ["a stylesheet link", '<link rel="stylesheet" href="//evil.test/a.css">', /<link/i],
    ["CSS expression()", '<style>b{width:expression(steal())}</style>', /expression\(/i],
    ["a CSS @import", '<style>@import url("//evil.test/a.css");</style>', /@import/i],
    ["-moz-binding", '<style>b{-moz-binding:url("//evil.test/x.xml#y")}</style>', /-moz-binding/i],
    ["a style attribute with expression()", '<p style="width:expression(steal())">x</p>', /expression\(/i],
    // A conditional comment hides markup from one parser and shows it to
    // another, so the comment has to go whole rather than be unwrapped.
    ["markup hidden in a conditional comment", '<!--[if mso]><script>steal()</script><![endif]-->', /script/i],
  ];

  for (const [name, input, forbidden] of attacks) {
    const { doc } = mailFrameDoc(input, { nonce: "N0NCE" });
    const body = doc.slice(doc.indexOf("<body>"));
    check(!forbidden.test(body.replace(/<script nonce="N0NCE">[\s\S]*?<\/script>/, "")), `${name} does not survive`, esc(body.slice(0, 110)));
  }
}

console.log("\nand what must");
{
  const { doc } = mailFrameDoc(
    '<h2>Hello</h2><p><b>bold</b> and <i>italic</i></p><table><tr><td bgcolor="#eee">cell</td></tr></table>' +
      '<a href="https://example.com/x?a=1&amp;b=2">link</a><blockquote>quoted</blockquote>',
    { nonce: "N" }
  );
  const body = doc.slice(doc.indexOf("<body>"));
  for (const t of ["<h2>", "<b>", "<i>", "<table", "<td", "<blockquote>"]) {
    check(body.includes(t), `${t} is kept, because a mail without layout is unreadable`);
  }
  check(/href="https:\/\/example\.com/.test(body), "an ordinary link survives");
  check(/target="_blank"/.test(body), "and opens in a new tab");
  check(/rel="noopener noreferrer nofollow"/.test(body), "with noopener, since the frame cannot be trusted to the opener");
  check(/bgcolor="#eee"/.test(body), "presentational attributes mail actually uses are kept");

  const styled = mailFrameDoc('<style>.x{color:red}</style><p class="x">hi</p>', { nonce: "N" }).doc;
  check(/\.x\{color:red\}/.test(styled), "a <style> block is kept, hoisted and sanitised");
}

console.log("\na dropped element takes itself and nothing else");
{
  // THE bug this block exists for, measured on a real Google security alert:
  // <link> and <meta> are VOID, so matching them as paired with an
  // "or end of document" fallback ran from the first one to EOF and deleted
  // the entire message. The frame rendered blank, nothing errored, and the
  // mail read as empty rather than as broken.
  const real =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="//x/y.css"></head>' +
    '<body><table><tr><td><div><div><link href="//x/z.css"><meta name="q" content="1"></div></div>' +
    "<p>THE MESSAGE</p></td></tr></table></body></html>";
  const { html } = sanitiseMailHtml(real);
  check(/THE MESSAGE/.test(html), "a void element in the head does not swallow the body", html.slice(0, 90));
  check(/<table/.test(html) && /<td/.test(html), "and the layout around it is intact");
  check(!/<link|<meta/i.test(html), "while the void elements themselves are gone");

  // The mirror image: an element that is merely UNCLOSED must not eat the
  // rest either, unless it is one of the raw-text elements where a real
  // parser would do exactly that.
  const unclosed = '<div><form action="//evil.test"><p>STILL HERE</p>';
  check(/STILL HERE/.test(sanitiseMailHtml(unclosed).html), "an unclosed form does not swallow what follows");
  const openScript = "<p>BEFORE</p><script>steal()";
  const after = sanitiseMailHtml(openScript).html;
  check(/BEFORE/.test(after) && !/steal/.test(after), "but an unclosed script does, which is what a parser does too");
}

console.log("\nremote images are blocked until asked for");
{
  const mail = '<img src="https://track.example/pixel.gif?u=1"><img src="data:image/gif;base64,R0lGOD">';
  const off = mailFrameDoc(mail, { nonce: "N" });
  const on = mailFrameDoc(mail, { nonce: "N", allowRemoteImages: true });

  check(off.blockedImages === 1, "a remote image is blocked by default", String(off.blockedImages));
  check(!/track\.example/.test(off.doc), "and its URL is not in the document at all, so nothing can request it");
  check(/mbx-blocked-img/.test(off.doc), "it leaves a visible placeholder rather than a gap");
  check(/img-src data:;/.test(off.doc) || /img-src data:;/.test(off.csp + ";"), "the CSP alone would refuse it", off.csp);
  check(/data:image\/gif/.test(off.doc), "an image already inside the message still shows");

  check(on.blockedImages === 0, "asking for them lets them through");
  check(/track\.example/.test(on.doc), "and the URL is then present");
  check(/img-src data: https: http:/.test(on.csp), "with the CSP widened to match", on.csp);

  // background="" on a cell is a remote image wearing another attribute name,
  // and it is how a tracker survives a block that only looks at <img>.
  const bg = mailFrameDoc('<table><tr><td background="https://track.example/b.gif">x</td></tr></table>', { nonce: "N" });
  check(bg.blockedImages === 1, "a background attribute counts as a remote image too");
  check(!/track\.example/.test(bg.doc), "and is removed");
}

console.log("\nthe frame refuses by default, not by omission");
{
  const { csp, doc } = mailFrameDoc("<p>hi</p>", { nonce: "ABC" });
  check(/default-src 'none'/.test(csp), "nothing loads unless it is named", csp);
  check(/script-src 'nonce-ABC'/.test(csp), "scripts run only under this render's nonce");
  check(/form-action 'none'/.test(csp), "a form cannot post anywhere");
  check(/base-uri 'none'/.test(csp), "and nothing can retarget relative URLs");
  check(/frame-ancestors 'none'/.test(csp), "the document cannot be framed elsewhere");
  check(/<meta name="referrer" content="no-referrer">/.test(doc), "no referrer leaks to anything it does load");
  check(/Content-Security-Policy/.test(doc), "and the policy travels inside the document, not as a header we cannot set");

  const noNonce = mailFrameDoc("<p>hi</p>", {});
  check(/script-src 'none'/.test(noNonce.csp), "with no nonce, nothing executes at all", noNonce.csp);
  check(!/<script/.test(noNonce.doc), "and no script is written into the document");
}

console.log("\nthe plain-text view");
{
  const t = htmlToText('<p>One</p><p>Two<br>Three</p><script>steal()</script><style>b{}</style>&amp; four');
  check(!/steal|b\{\}/.test(t), "script and style contents are not text", t);
  check(/One\nTwo\nThree/.test(t), "block elements become line breaks", JSON.stringify(t));
  check(/& four/.test(t), "entities are decoded");
  check(htmlToText("") === "", "and nothing in gives nothing out");
  check(looksLikeHtml("<p>x</p>") && !looksLikeHtml("just words"), "html is told apart from text");
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nfailures:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
