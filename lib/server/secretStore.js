// SERVER ONLY. Passwords and API keys, readable by an AI client.
//
// READ THIS BEFORE CHANGING ANYTHING HERE.
//
// THE TRADE-OFF, STATED PLAINLY
// End-to-end encryption and agent-readable are mutually exclusive. The
// document vault (`vault/`) chose end-to-end: identity documents are encrypted
// in the browser under a passphrase that never leaves the machine, which is
// exactly why it has NO write tool and no MCP read of its bytes. This store
// chose the other side — an agent has to be able to read a value — so the
// deployment must be able to decrypt it. There is no arrangement where a model
// reads a secret and the server cannot.
//
// So the blast radius is contained instead:
//
//   SEALED AT REST      AES-256-GCM under SECRETS_KEY, which lives only in the
//                       deployment environment. A Firestore leak yields
//                       ciphertext; the key and the ciphertext never sit in the
//                       same place. Rotating SECRETS_KEY destroys every value.
//
//   ITS OWN SCOPE       A token needs the `secrets` scope. Every token minted
//                       before this existed has read/write/vault and CANNOT
//                       touch this store. Agent access is a deliberate act.
//
//   PER-SECRET OPT-IN   `agentReadable` defaults to FALSE. Saving a password
//                       does not expose it to anything; you turn on the ones
//                       you want an agent to use. "When AI requires it I can
//                       give them" is the actual behaviour, not a policy.
//
//   NEVER IN BULK       Listing returns names and metadata, never values.
//                       A value is read one at a time, by name.
//
//   EVERY READ AUDITED  Each reveal appends to the admin-only, append-only
//                       audit log with which token read which secret. A leak
//                       you cannot see is a leak you cannot respond to.
//
// What is still true and cannot be engineered away: a token holding `secrets`
// is equivalent to the secrets it can read. Treat minting one as handing over
// those passwords, and revoke it the moment a client is retired.
import crypto from "crypto";

export const COLLECTION = "secrets";

export class SecretError extends Error {
  constructor(message, { status = 400, code } = {}) {
    super(message);
    this.name = "SecretError";
    this.status = status;
    this.code = code;
  }
}

/* ---------------- the key ---------------- */

export const isConfigured = () => !!process.env.SECRETS_KEY;

function key() {
  const raw = process.env.SECRETS_KEY;
  if (!raw) {
    throw new SecretError(
      "The secret store is not configured on this deployment (missing SECRETS_KEY).",
      { status: 503, code: "secrets/not-configured" }
    );
  }
  // Separate from INTEGRATION_SECRET and MCP_TOKEN_SECRET on purpose: rotating
  // one of those should not destroy the password store, and rotating this one
  // should not sign every account out.
  const buf = Buffer.from(raw, "base64url");
  return buf.length === 32 ? buf : crypto.createHash("sha256").update(raw).digest();
}

// `purpose` is bound as additional authenticated data, so a sealed secret can
// never be opened by code that seals something else.
const PURPOSE = "secret-value";

export function sealValue(value, purpose = PURPOSE) {
  if (typeof value !== "string" || !value) {
    throw new SecretError("A secret needs a value.");
  }
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  c.setAAD(Buffer.from(purpose, "utf8"));
  const body = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

// `purpose` defaults to the secret store's own; the env store binds each value
// to its key name, so a sealed value cannot be moved under another key.
export function openValue(blob, purpose = PURPOSE) {
  let buf;
  try {
    buf = Buffer.from(String(blob || ""), "base64url");
  } catch (_) {
    throw new SecretError("This secret is unreadable.", { code: "secrets/unreadable" });
  }
  if (buf.length < 29) throw new SecretError("This secret is unreadable.", { code: "secrets/unreadable" });
  const d = crypto.createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAAD(Buffer.from(purpose, "utf8"));
  d.setAuthTag(buf.subarray(12, 28));
  try {
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  } catch (_) {
    // Wrong key, tampering, or a flipped byte. The caller is told the same
    // thing in every case.
    throw new SecretError(
      "This secret could not be opened. If SECRETS_KEY was rotated, every stored value is now unreadable and must be re-entered.",
      { code: "secrets/unreadable" }
    );
  }
}

/* ---------------- shape ---------------- */

export const KINDS = ["password", "apiKey", "token", "sshKey", "note", "other"];

// A slug, so a secret is addressable by a name a human and a model can both
// type, and so the document id cannot collide or contain a slash.
export const slugify = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

export function assertName(name) {
  const id = slugify(name);
  if (!id) {
    throw new SecretError("A secret needs a name made of letters or digits.");
  }
  return id;
}

// What a listing may EVER contain. Values are not in it, and this is the only
// function that builds a listing row — so a value cannot leak into one by
// someone spreading the raw document.
export function publicShape(id, d) {
  return {
    id,
    name: d.name || id,
    provider: d.provider || "",
    accountId: d.accountId || "",
    kind: d.kind || "other",
    username: d.username || "",
    url: d.url || "",
    notes: d.notes || "",
    tags: Array.isArray(d.tags) ? d.tags : [],
    // The flag that decides whether an agent may read the value at all.
    agentReadable: d.agentReadable === true,
    hasValue: !!d.value,
    // Enough to spot the right entry without revealing it.
    hint: d.hint || "",
    updatedAt: d.updatedAt || "",
    createdAt: d.createdAt || "",
    lastReadAt: d.lastReadAt || "",
    lastReadBy: d.lastReadBy || "",
  };
}

// A few characters so a human can tell two keys apart in a list without
// revealing either. Deliberately the LAST four and never the first — the
// start of an API key is often a fixed, guessable prefix.
export function hintFor(value) {
  const v = String(value || "");
  if (v.length <= 4) return "••••";
  return `••••${v.slice(-4)}`;
}

// A sign-in saved against a connected account. The name is derived rather
// than typed so the Accounts panel can find it again without a second index,
// and so two logins for the same provider cannot collide.
export const loginSecretName = (provider, accountId) =>
  `login-${slugify(provider)}-${slugify(String(accountId))}`;

export function buildRecord({
  name,
  value,
  kind,
  username,
  url,
  notes,
  tags,
  agentReadable,
  provider,
  accountId,
}) {
  const id = assertName(name);
  if (kind && !KINDS.includes(kind)) {
    throw new SecretError(`Unknown kind "${kind}". Use one of ${KINDS.join(", ")}.`);
  }
  const rec = {
    name: String(name).trim(),
    kind: kind || "password",
    username: username || "",
    url: url || "",
    notes: notes || "",
    tags: Array.isArray(tags) ? tags.slice(0, 12).map((t) => String(t).trim()).filter(Boolean) : [],
    // Default FALSE. Saving a password must not expose it to anything; the
    // owner turns on the ones an agent may use.
    agentReadable: agentReadable === true,
    // Which connected account this sign-in belongs to, when it belongs to one.
    // Stored on the secret rather than on the account because the account
    // document is written by the browser at consent time and knows nothing
    // about a password typed weeks later.
    provider: provider ? String(provider) : "",
    accountId: accountId ? String(accountId) : "",
    updatedAt: new Date().toISOString(),
  };
  if (value !== undefined) {
    rec.value = sealValue(value);
    rec.hint = hintFor(value);
  }
  return { id, record: rec };
}

/* ---------------- reading a value ---------------- */

// The one place a value is decrypted for a caller. Both guards live here so
// neither can be forgotten by a new call site.
export function readValue(doc, { forAgent, name }) {
  if (!doc) {
    throw new SecretError(`No secret named "${name}".`, { status: 404 });
  }
  if (!doc.value) {
    throw new SecretError(`"${name}" has no value stored.`, { status: 404 });
  }
  if (forAgent && doc.agentReadable !== true) {
    throw new SecretError(
      `"${name}" is not marked readable by an agent. Turn on "Readable by agents" for it in the admin's Secrets tab if that is intended — it is off by default so saving a password never exposes it.`,
      { status: 403, code: "secrets/not-agent-readable" }
    );
  }
  return openValue(doc.value);
}

// Redaction for anything that gets logged or echoed. A secret that reaches a
// log is a secret that outlives its rotation.
export const redact = (s) => {
  const v = String(s || "");
  return v.length <= 4 ? "••••" : `••••${v.slice(-4)}`;
};

/* ---------------- search ---------------- */

// Matches METADATA only — never the value. Searching ciphertext would be
// useless, and searching plaintext would mean decrypting the whole store to
// answer a query.
export function matches(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return [row.name, row.username, row.url, row.notes, (row.tags || []).join(" "), row.kind]
    .join(" ")
    .toLowerCase()
    .includes(q);
}
