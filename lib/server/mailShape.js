// Mail, as far as it can be reasoned about without a network.
//
// PURE. Addresses, MIME, the capability table, the refusals and the shaping
// live here so every one of them is tested without a socket and without a
// mailbox — the same split as repoAudit.js, postText.js and accountDirectory.js.
//
// WHY THIS FILE IS CAREFUL
// -----------------------
// Sending mail is the most dangerous thing in this deployment. It is
// irreversible, it is outward-facing, it reaches real people, and it arrives
// wearing the owner's name. Nothing else here has all four properties at once:
// an npm version is permanent but nobody is on the other end, a LinkedIn post
// is public but is addressed to no one in particular.
//
// So the refusals are the point, and they happen BEFORE a request is built:
//   - a malformed address is refused rather than bounced by the provider
//   - a reply that names no thread is refused rather than sent as a new mail
//     to someone expecting a reply
//   - a body that is empty is refused, because an accidental send of nothing
//     still cannot be unsent
//   - a recipient count over the cap is refused, because the difference
//     between a reply and a mailshot is a typo in a loop

/* ---------------- addresses ---------------- */

// Deliberately not RFC 5322. A full parser accepts things no human typed and
// would let a crafted string through; this accepts what a person writes and
// refuses the rest, which is the correct bias when the failure is "mail went
// to the wrong place".
const ADDR_RE = /^[^\s@<>",;]+@[^\s@<>",;.]+(?:\.[^\s@<>",;.]+)+$/;

export const isAddress = (v) => ADDR_RE.test(String(v || "").trim());

// "Ada Lovelace <ada@example.com>" -> { name, email }
export function parseAddress(raw) {
  const v = String(raw || "").trim();
  const m = /^(.*?)\s*<([^>]+)>$/.exec(v);
  const email = (m ? m[2] : v).trim();
  const name = m ? m[1].trim().replace(/^"|"$/g, "") : "";
  return { name, email };
}

export const formatAddress = ({ name, email }) =>
  name ? `${/[",<>:;@]/.test(name) ? JSON.stringify(name) : name} <${email}>` : email;

// One string, a list, or a comma-separated line — all three turn up, from a
// model, a form and a paste respectively.
export function toRecipients(input) {
  const raw = Array.isArray(input) ? input : String(input || "").split(",");
  return raw
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .map(parseAddress);
}

export const MAX_RECIPIENTS = 25;

export function assertRecipients(input, field = "to") {
  const list = toRecipients(input);
  if (!list.length) throw new Error(`A message needs at least one ${field} address.`);
  if (list.length > MAX_RECIPIENTS) {
    throw new Error(
      `${list.length} ${field} addresses; the cap here is ${MAX_RECIPIENTS}. That cap exists because the difference between a reply and a mailshot is one wrong variable, and a send cannot be taken back.`
    );
  }
  const bad = list.filter((a) => !isAddress(a.email));
  if (bad.length) {
    throw new Error(
      `Not a usable address: ${bad.map((b) => b.email || "(empty)").join(", ")}. Checked before sending, because a provider's bounce arrives minutes later and names nothing.`
    );
  }
  return list;
}

/* ---------------- what each service actually allows ---------------- */

// Declared as DATA so the panel, the MCP tools and the tests read one object —
// the same call as linkedinText.js CAPABILITIES and noteSources.js. A
// capability described one way in the UI and another in a tool is how a model
// confidently reports doing something the service refused.
export const CAPABILITIES = {
  gmail: {
    label: "Gmail",
    read: { available: true, how: "users.messages.list + get" },
    search: {
      available: true,
      how: "Gmail's own query syntax (from:, is:unread, has:attachment, newer_than:7d)",
    },
    send: { available: true, how: "users.messages.send" },
    reply: { available: true, how: "send with threadId + In-Reply-To" },
    markRead: { available: true, how: "users.messages.modify, removing UNREAD" },
    archive: { available: true, how: "modify, removing INBOX" },
    labels: { available: true, how: "users.labels.list" },
    trash: { available: true, how: "users.messages.trash — recoverable for 30 days" },
    permanentDelete: {
      available: false,
      why: "That needs the full https://mail.google.com/ scope, which is never requested.",
      instead: "Trash it. Gmail keeps a trashed message for 30 days and it can be restored.",
    },
    sendAs: {
      available: false,
      why: "Sending as another address needs the account's own verified alias and settings.sendAs scope.",
      instead: "Send from the connected account, or connect the other address as its own account.",
    },
  },
  outlook: {
    label: "Outlook",
    read: { available: true, how: "GET /me/messages" },
    search: { available: true, how: "$search (KQL), which is weaker than Gmail's and cannot be combined with $orderby" },
    send: { available: true, how: "POST /me/sendMail" },
    reply: { available: true, how: "POST /me/messages/{id}/reply" },
    markRead: { available: true, how: "PATCH isRead" },
    archive: { available: true, how: "move to the Archive folder" },
    labels: {
      available: false,
      why: "Outlook has FOLDERS, not labels: a message lives in exactly one, so there is nothing to add or remove.",
      instead: "Move it to a folder, or use categories, which are per-mailbox strings rather than shared labels.",
    },
    trash: { available: true, how: "move to Deleted Items" },
    permanentDelete: {
      available: false,
      why: "Not offered here. A hard delete over an API is the one mail action with no undo at all.",
      instead: "Move it to Deleted Items, which is reversible from any mail client.",
    },
    sendAs: {
      available: false,
      why: "Sending as another mailbox needs Mail.Send.Shared and a delegated mailbox.",
      instead: "Connect that mailbox as its own account.",
    },
  },
};

export const MAIL_PROVIDERS = Object.keys(CAPABILITIES);

export function capability(provider, name) {
  const c = CAPABILITIES[provider];
  if (!c) throw new Error(`Unknown mail provider "${provider}". One of: ${MAIL_PROVIDERS.join(", ")}.`);
  return c[name] || { available: false, why: `${c.label} has no "${name}".` };
}

// Refuse what the service cannot do, BEFORE any request, and say what works
// instead. A provider's own error for an unsupported operation names neither.
export function assertCan(provider, name) {
  const cap = capability(provider, name);
  if (!cap.available) {
    throw new Error(
      `${CAPABILITIES[provider].label} cannot do that: ${cap.why}${cap.instead ? ` ${cap.instead}` : ""}`
    );
  }
  return cap;
}

/* ---------------- composing ---------------- */

export const MAX_SUBJECT = 998; // RFC 5322 line limit, and nothing sane is near it.

export function assertDraft({ to, cc, bcc, subject, body } = {}) {
  const recipients = assertRecipients(to, "to");
  const copies = cc ? assertRecipients(cc, "cc") : [];
  const blind = bcc ? assertRecipients(bcc, "bcc") : [];

  const subj = String(subject || "").trim();
  if (subj.length > MAX_SUBJECT) {
    throw new Error(`That subject is ${subj.length} characters; the limit is ${MAX_SUBJECT}.`);
  }
  // An empty body is almost always a bug in the caller rather than an intent,
  // and an accidentally sent blank message cannot be unsent.
  if (!String(body || "").trim()) {
    throw new Error("A message needs a body. An empty send cannot be taken back.");
  }
  return { to: recipients, cc: copies, bcc: blind, subject: subj, body: String(body) };
}

// A header value may not carry a newline: that is header injection, and it is
// how one message becomes two with recipients nobody chose.
const headerSafe = (v) => String(v || "").replace(/[\r\n]+/g, " ").trim();

// RFC 5322 for Gmail, which takes a raw message rather than fields.
export function buildMime(draft, { from, inReplyTo, references } = {}) {
  const d = assertDraft(draft);
  const lines = [];
  if (from) lines.push(`From: ${headerSafe(from)}`);
  lines.push(`To: ${headerSafe(d.to.map(formatAddress).join(", "))}`);
  if (d.cc.length) lines.push(`Cc: ${headerSafe(d.cc.map(formatAddress).join(", "))}`);
  if (d.bcc.length) lines.push(`Bcc: ${headerSafe(d.bcc.map(formatAddress).join(", "))}`);
  lines.push(`Subject: ${headerSafe(d.subject)}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${headerSafe(inReplyTo)}`);
  // Threading needs BOTH: In-Reply-To alone makes some clients show the reply
  // as a new conversation.
  if (references || inReplyTo) lines.push(`References: ${headerSafe(references || inReplyTo)}`);
  lines.push("MIME-Version: 1.0");
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push("Content-Transfer-Encoding: 8bit");
  lines.push("");
  lines.push(d.body);
  return lines.join("\r\n");
}

// Gmail wants base64url with no padding.
export const toRawMessage = (mime) =>
  Buffer.from(mime, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/* ---------------- shaping what comes back ---------------- */

// One row shape from two very different payloads, so nothing downstream has to
// know which service a message came from.
export function shapeMessage(provider, raw, { account } = {}) {
  const m =
    provider === "gmail" ? shapeGmail(raw) : provider === "outlook" ? shapeOutlook(raw) : null;
  if (!m) throw new Error(`Unknown mail provider "${provider}".`);
  return { ...m, provider, account: account || "" };
}

const headerOf = (payload, name) =>
  (payload?.headers || []).find((h) => String(h.name).toLowerCase() === name.toLowerCase())?.value || "";

function shapeGmail(raw) {
  const h = raw.payload || {};
  const labels = raw.labelIds || [];
  return {
    id: raw.id,
    threadId: raw.threadId || raw.id,
    from: parseAddress(headerOf(h, "From")),
    to: toRecipients(headerOf(h, "To")),
    subject: headerOf(h, "Subject"),
    // Gmail's own one-line preview. Using it rather than decoding the body
    // keeps a listing to one cheap request per page.
    preview: raw.snippet || "",
    at: raw.internalDate ? new Date(Number(raw.internalDate)).toISOString() : "",
    unread: labels.includes("UNREAD"),
    starred: labels.includes("STARRED"),
    inInbox: labels.includes("INBOX"),
    hasAttachment: (h.parts || []).some((p) => p.filename),
    messageId: headerOf(h, "Message-ID"),
    labels,
  };
}

function shapeOutlook(raw) {
  return {
    id: raw.id,
    threadId: raw.conversationId || raw.id,
    from: {
      name: raw.from?.emailAddress?.name || "",
      email: raw.from?.emailAddress?.address || "",
    },
    to: (raw.toRecipients || []).map((r) => ({
      name: r.emailAddress?.name || "",
      email: r.emailAddress?.address || "",
    })),
    subject: raw.subject || "",
    preview: raw.bodyPreview || "",
    at: raw.receivedDateTime || "",
    unread: raw.isRead === false,
    starred: raw.flag?.flagStatus === "flagged",
    inInbox: true,
    hasAttachment: !!raw.hasAttachments,
    messageId: raw.internetMessageId || "",
    labels: raw.categories || [],
  };
}

/* ---------------- analytics ---------------- */

// What a mailbox can honestly say about itself WITHOUT a second API. Every
// figure here is derived from messages already fetched, so nothing claims a
// number it did not count.
export function summarise(messages = [], { days = 7 } = {}) {
  const now = Date.now();
  const since = now - days * 86400000;
  const recent = messages.filter((m) => m.at && Date.parse(m.at) >= since);

  const bySender = {};
  for (const m of recent) {
    const key = (m.from?.email || "unknown").toLowerCase();
    if (!bySender[key]) bySender[key] = { email: key, name: m.from?.name || "", count: 0, unread: 0 };
    bySender[key].count++;
    if (m.unread) bySender[key].unread++;
  }

  // One bucket per day, including days with nothing — a strip drawn only from
  // days that had mail is not a timeline and would read as evenly spaced.
  const perDay = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const onDay = recent.filter((m) => String(m.at).slice(0, 10) === key);
    perDay.push({
      day: key,
      received: onDay.length,
      // Carried beside the arrival count because "ten arrived" and "ten
      // arrived and none has been read" are different mornings. The panel
      // draws the unread share of each bar from this, so there is one
      // bucketing rule rather than one here and another in the browser.
      unread: onDay.filter((m) => m.unread).length,
    });
  }

  return {
    window: days,
    // `counted` is said out loud because these figures describe the messages
    // that were FETCHED, not the mailbox: a page of 50 cannot speak for 40,000.
    counted: messages.length,
    inWindow: recent.length,
    unread: messages.filter((m) => m.unread).length,
    withAttachment: messages.filter((m) => m.hasAttachment).length,
    perDay,
    busiestDay: perDay.reduce((a, b) => (b.received > a.received ? b : a), perDay[0] || null),
    topSenders: Object.values(bySender)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}

/* ---------------- replying ---------------- */

// A reply that names no thread is a NEW message to someone expecting an
// answer, which is worse than a failure — it looks like it worked.
export function assertReplyTarget({ messageId, threadId } = {}) {
  if (!messageId && !threadId) {
    throw new Error(
      "A reply needs the message it answers. Without one this would arrive as a brand-new mail to someone expecting a reply, which looks like it worked."
    );
  }
  return { messageId: messageId || "", threadId: threadId || "" };
}

export const replySubject = (subject) =>
  /^re:/i.test(String(subject || "").trim()) ? String(subject).trim() : `Re: ${String(subject || "").trim()}`;

// Quote the message being answered, the way every mail client does.
export function quote(original = {}, body = "") {
  const who = original.from?.name || original.from?.email || "they";
  const when = original.at ? new Date(original.at).toUTCString() : "earlier";
  const quoted = String(original.preview || "")
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return `${body}\n\nOn ${when}, ${who} wrote:\n${quoted}`;
}
