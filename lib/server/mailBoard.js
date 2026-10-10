// Gmail and Outlook behind one vocabulary — the same shape as taskBoard.js.
//
// Two adapters, one set of verbs, and every difference between the services
// DECLARED in mailShape.js rather than discovered when a call fails. A panel
// that offers the same five controls everywhere teaches you to expect
// something that will be silently dropped.
import {
  CAPABILITIES,
  assertCan,
  assertDraft,
  assertReplyTarget,
  buildMime,
  formatAddress,
  quote,
  replySubject,
  shapeMessage,
  summarise,
  toRawMessage,
} from "./mailShape.js";
import { htmlToText } from "./mailHtml.js";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GRAPH = "https://graph.microsoft.com/v1.0/me";

export class MailError extends Error {
  constructor(message, { status, provider, code } = {}) {
    super(message);
    this.name = "MailError";
    this.status = status;
    this.provider = provider;
    this.code = code;
  }
}

// Query building, pulled out and exported because of a bug that cost an
// afternoon and left no trace in any error.
//
// Gmail's `metadataHeaders` is a REPEATED parameter -- metadataHeaders=From
// &metadataHeaders=To. Passing the array through String() produced one
// comma-joined value, which matches no header, so every message came back with
// an EMPTY headers array. The request succeeded, the snippet and the date were
// right, and only the sender and the subject were missing: a whole inbox of
// "Unknown sender" with a 200 behind it.
export function queryUrl(url, query = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      for (const one of v) if (one !== undefined && one !== null && one !== "") u.searchParams.append(k, String(one));
      continue;
    }
    u.searchParams.set(k, String(v));
  }
  return u;
}

async function call(provider, token, url, { method = "GET", body, query } = {}) {
  const u = queryUrl(url, query || {});
  const res = await fetch(u, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 204) return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || json?.error_description || `HTTP ${res.status}`;
    // The two failures worth translating, because the provider's own wording
    // sends you looking in the wrong place.
    if (res.status === 401) {
      throw new MailError(
        `${CAPABILITIES[provider].label} rejected the connection. Reconnect that account in the Mail tab.`,
        { status: 401, provider, code: "mail/unauthorised" }
      );
    }
    if (res.status === 403 && /insufficient|scope|permission/i.test(msg)) {
      throw new MailError(
        `${CAPABILITIES[provider].label} refused: the connection does not carry the permission this needs (${msg}). Reconnect the account to grant it.`,
        { status: 403, provider, code: "mail/scope" }
      );
    }
    throw new MailError(`${CAPABILITIES[provider].label}: ${msg}`, { status: res.status, provider });
  }
  return json;
}

/* ================= Gmail ================= */

const gmail = {
  id: "gmail",

  async list(token, { max = 25, query = "", labelIds } = {}) {
    const page = await call("gmail", token, `${GMAIL}/messages`, {
      query: {
        maxResults: Math.min(100, Math.max(1, max)),
        q: query || undefined,
        labelIds: labelIds || undefined,
      },
    });
    const ids = (page.messages || []).map((m) => m.id);
    if (!ids.length) return [];
    // `metadata` rather than `full`: a listing needs headers and the snippet,
    // and asking for full bodies turns one screen into megabytes.
    const rows = await Promise.all(
      ids.map((id) =>
        call("gmail", token, `${GMAIL}/messages/${encodeURIComponent(id)}`, {
          query: {
            format: "metadata",
            metadataHeaders: ["From", "To", "Subject", "Message-ID"],
          },
        }).catch(() => null)
      )
    );
    return rows.filter(Boolean).map((r) => shapeMessage("gmail", r));
  },

  async get(token, id) {
    const raw = await call("gmail", token, `${GMAIL}/messages/${encodeURIComponent(id)}`, {
      query: { format: "full" },
    });
    const { text, html } = gmailBodies(raw.payload);
    return {
      ...shapeMessage("gmail", raw),
      body: text || htmlToText(html),
      html,
      hasHtml: !!html,
    };
  },

  async send(token, draft, { inReplyTo, references, threadId } = {}) {
    const mime = buildMime(draft, { inReplyTo, references });
    const out = await call("gmail", token, `${GMAIL}/messages/send`, {
      method: "POST",
      body: { raw: toRawMessage(mime), ...(threadId ? { threadId } : {}) },
    });
    return { id: out.id, threadId: out.threadId };
  },

  async setRead(token, id, read) {
    await call("gmail", token, `${GMAIL}/messages/${encodeURIComponent(id)}/modify`, {
      method: "POST",
      body: read ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] },
    });
    return { id, unread: !read };
  },

  async archive(token, id) {
    await call("gmail", token, `${GMAIL}/messages/${encodeURIComponent(id)}/modify`, {
      method: "POST",
      body: { removeLabelIds: ["INBOX"] },
    });
    return { id, archived: true };
  },

  async trash(token, id) {
    await call("gmail", token, `${GMAIL}/messages/${encodeURIComponent(id)}/trash`, { method: "POST" });
    return { id, trashed: true, recoverable: "Gmail keeps a trashed message for 30 days." };
  },

  async folders(token) {
    const out = await call("gmail", token, `${GMAIL}/labels`);
    return (out.labels || []).map((l) => ({ id: l.id, name: l.name, kind: l.type }));
  },
};

// Gmail nests the body; plain text is preferred because that is what a model
// and a plain-text reply both want.
// BOTH halves of a multipart/alternative, not whichever one is found first.
//
// It used to return text/plain if there was one and the raw text/html source
// otherwise -- and since the reader prints its body as pre-wrapped text, an
// HTML-only message (which is most of them) rendered as a screenful of markup.
// The caller now gets the text for quoting and searching AND the html for
// reading, and decides.
function gmailBodies(payload) {
  if (!payload) return { text: "", html: "" };
  const dec = (d) => Buffer.from(String(d || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

  const walk = (parts, want) => {
    for (const p of parts || []) {
      if (p.mimeType === want && p.body?.data) return dec(p.body.data);
      const deeper = walk(p.parts, want);
      if (deeper) return deeper;
    }
    return "";
  };

  // A single-part message carries its body on the payload itself, and its own
  // mimeType says which of the two it is.
  if (payload.body?.data && !payload.parts?.length) {
    const only = dec(payload.body.data);
    return payload.mimeType === "text/html" ? { text: "", html: only } : { text: only, html: "" };
  }
  return { text: walk(payload.parts, "text/plain"), html: walk(payload.parts, "text/html") };
}

/* ================= Outlook ================= */

const outlook = {
  id: "outlook",

  async list(token, { max = 25, query = "", folder = "inbox" } = {}) {
    const base = folder ? `${GRAPH}/mailFolders/${encodeURIComponent(folder)}/messages` : `${GRAPH}/messages`;
    // Graph REFUSES $search together with $orderby, with an error naming
    // neither — so a search is returned in relevance order and says so.
    const q = query
      ? { $search: `"${query.replace(/"/g, "")}"`, $top: Math.min(50, max) }
      : { $top: Math.min(50, max), $orderby: "receivedDateTime desc" };
    const out = await call("outlook", token, base, {
      query: {
        ...q,
        $select: "id,conversationId,from,toRecipients,subject,bodyPreview,receivedDateTime,isRead,hasAttachments,internetMessageId,categories,flag",
      },
    });
    return (out.value || []).map((r) => shapeMessage("outlook", r));
  },

  async get(token, id) {
    const raw = await call("outlook", token, `${GRAPH}/messages/${encodeURIComponent(id)}`);
    // Graph says which of the two it handed over, so there is nothing to
    // guess -- but it will also call a body "html" that is really a wrapped
    // plain-text one, which htmlToText handles either way.
    const content = raw.body?.content || "";
    const isHtml = String(raw.body?.contentType || "").toLowerCase() === "html";
    return {
      ...shapeMessage("outlook", raw),
      body: isHtml ? htmlToText(content) : content || raw.bodyPreview || "",
      html: isHtml ? content : "",
      hasHtml: isHtml && !!content,
    };
  },

  async send(token, draft) {
    const d = assertDraft(draft);
    await call("outlook", token, `${GRAPH}/sendMail`, {
      method: "POST",
      body: {
        message: {
          subject: d.subject,
          body: { contentType: "Text", content: d.body },
          toRecipients: d.to.map((a) => ({ emailAddress: { address: a.email, name: a.name || undefined } })),
          ccRecipients: d.cc.map((a) => ({ emailAddress: { address: a.email } })),
          bccRecipients: d.bcc.map((a) => ({ emailAddress: { address: a.email } })),
        },
        saveToSentItems: true,
      },
    });
    // Graph's sendMail returns 202 with no body, so there is no id to report —
    // saying so beats inventing one.
    return { id: null, note: "Outlook returns no id for a sent message; it is in Sent Items." };
  },

  async reply(token, id, body) {
    await call("outlook", token, `${GRAPH}/messages/${encodeURIComponent(id)}/reply`, {
      method: "POST",
      body: { comment: String(body || "") },
    });
    return { id, replied: true };
  },

  async setRead(token, id, read) {
    await call("outlook", token, `${GRAPH}/messages/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { isRead: !!read },
    });
    return { id, unread: !read };
  },

  async archive(token, id) {
    await call("outlook", token, `${GRAPH}/messages/${encodeURIComponent(id)}/move`, {
      method: "POST",
      body: { destinationId: "archive" },
    });
    return { id, archived: true };
  },

  async trash(token, id) {
    await call("outlook", token, `${GRAPH}/messages/${encodeURIComponent(id)}/move`, {
      method: "POST",
      body: { destinationId: "deleteditems" },
    });
    return { id, trashed: true, recoverable: "It is in Deleted Items and can be moved back." };
  },

  async folders(token) {
    const out = await call("outlook", token, `${GRAPH}/mailFolders`, { query: { $top: 50 } });
    return (out.value || []).map((f) => ({ id: f.id, name: f.displayName, kind: "folder" }));
  },
};

const ADAPTERS = { gmail, outlook };
export const adapterFor = (provider) => {
  const a = ADAPTERS[provider];
  if (!a) throw new MailError(`Unknown mail provider "${provider}". One of: ${Object.keys(ADAPTERS).join(", ")}.`);
  return a;
};
export const mailProviderIds = () => Object.keys(ADAPTERS);

/* ================= resolving an account ================= */

export async function mailboxFor(idToken, provider, accountId) {
  const api = adapterFor(provider);
  const { tokenFor } = await import("./accountDirectory.js");
  const { token, account } = await tokenFor(idToken, { provider, accountId, service: "mail" });
  return { api, token, account };
}

/* ================= across every account ================= */

// One failing mailbox must never hide the rest — the same rule as
// list_all_tasks and list_youtube_channels. An expired Outlook connection is
// a normal state and says nothing about the Gmail account beside it.
export async function everyMailbox(idToken, { provider } = {}) {
  const { allAccounts } = await import("./accountDirectory.js");
  // An unreadable directory is "no mailboxes"; an unknown ORG is not — it is
  // a mistake the caller must hear about, not an empty inbox.
  const pool = await allAccounts(idToken).catch((e) => {
    if (typeof e?.code === "string" && e.code.startsWith("org/")) throw e;
    return [];
  });
  return pool.filter(
    (a) => mailProviderIds().includes(a.provider) && (!provider || a.provider === provider)
  );
}

export async function readEverywhere(idToken, { max = 25, query = "", provider } = {}) {
  const boxes = await everyMailbox(idToken, { provider });
  if (!boxes.length) {
    return {
      accounts: 0,
      count: 0,
      messages: [],
      note: "No mailbox is connected. list_mail_accounts says what to connect.",
    };
  }
  const results = await Promise.all(
    boxes.map(async (a) => {
      const who = a.label || a.email || a.accountId;
      try {
        const { api, token } = await mailboxFor(idToken, a.provider, a.accountId);
        const rows = await api.list(token, { max, query });
        return {
          provider: a.provider,
          accountId: a.accountId,
          account: who,
          rows: rows.map((m) => ({ ...m, account: who, accountId: a.accountId })),
        };
      } catch (e) {
        return { provider: a.provider, accountId: a.accountId, account: who, error: e.message, rows: [] };
      }
    })
  );
  const messages = results
    .flatMap((r) => r.rows)
    .sort((x, y) => String(y.at).localeCompare(String(x.at)));
  const failed = results.filter((r) => r.error);
  return {
    accounts: results.length,
    count: messages.length,
    partial: failed.length > 0,
    unreadable: failed.map((r) => ({ account: r.account, provider: r.provider, error: r.error })),
    byAccount: results.map((r) => ({
      account: r.account,
      provider: r.provider,
      accountId: r.accountId,
      count: r.rows.length,
      error: r.error,
    })),
    messages,
  };
}

/* ================= the verbs ================= */

export async function sendMail(idToken, { provider, accountId, dryRun, ...draft }) {
  const d = assertDraft(draft);
  const { api, token, account } = await mailboxFor(idToken, provider, accountId);
  assertCan(api.id, "send");
  const as = account.email || account.label || "";
  if (dryRun) {
    return {
      dryRun: true,
      wouldSendAs: as,
      to: d.to.map(formatAddress),
      cc: d.cc.map(formatAddress),
      bcc: d.bcc.map(formatAddress),
      subject: d.subject,
      body: d.body,
      note: "Nothing was sent. Call again without dryRun to send it.",
    };
  }
  const out = await api.send(token, d, {});
  return { ...out, sentAs: as, provider: api.id, to: d.to.map((a) => a.email), subject: d.subject };
}

export async function replyToMail(idToken, { provider, accountId, messageId, threadId, body, dryRun }) {
  assertReplyTarget({ messageId, threadId });
  const { api, token, account } = await mailboxFor(idToken, provider, accountId);
  assertCan(api.id, "reply");
  const original = await api.get(token, messageId);
  const as = account.email || account.label || "";

  if (dryRun) {
    return {
      dryRun: true,
      wouldSendAs: as,
      to: original.from.email,
      subject: replySubject(original.subject),
      body: quote(original, body),
      note: "Nothing was sent. Call again without dryRun to send it.",
    };
  }

  if (api.id === "outlook") {
    // Graph has a reply endpoint that threads correctly on its own; building
    // the mail by hand would lose the conversation.
    await api.reply(token, messageId, body);
    return { replied: true, provider: api.id, to: original.from.email, sentAs: as };
  }
  const out = await api.send(
    token,
    {
      to: [formatAddress(original.from)],
      subject: replySubject(original.subject),
      body: quote(original, body),
    },
    { inReplyTo: original.messageId, references: original.messageId, threadId: original.threadId }
  );
  return { ...out, replied: true, provider: api.id, to: original.from.email, sentAs: as };
}

export async function mailAnalytics(idToken, { provider, accountId, days = 7, max = 100 } = {}) {
  const { api, token, account } = await mailboxFor(idToken, provider, accountId);
  const rows = await api.list(token, { max });
  return {
    provider: api.id,
    account: account.email || account.label || "",
    ...summarise(rows, { days }),
  };
}

export { CAPABILITIES, summarise };
