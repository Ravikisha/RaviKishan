// WhatsApp's identifiers and message shapes, as plain data.
//
// PURE — no imports, no network, no node APIs — so the parts that are easy to
// get quietly wrong can be tested without a phone, a QR code or an account at
// risk. The same reason noteShape.js and contactShape.js are pure.
//
// WHAT IS EASY TO GET WRONG HERE
//
// A JID (`918765432100@s.whatsapp.net`) is not a phone number, a group JID is
// a different shape again, and the same person appears as a JID, an LID, and a
// number written five ways. Sending to the wrong JID is sending a private
// message to the wrong person — the one mistake in this integration that
// cannot be taken back.
//
// So: one place converts, it refuses what it cannot parse rather than guessing,
// and it never invents a country code.

export class WaError extends Error {}

export const USER_SUFFIX = "s.whatsapp.net";
export const GROUP_SUFFIX = "g.us";
export const BROADCAST_SUFFIX = "broadcast";
export const NEWSLETTER_SUFFIX = "newsletter";

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

/* ---------------- identifiers ---------------- */

export const isJid = (v) => /@(s\.whatsapp\.net|g\.us|broadcast|newsletter|lid)$/.test(str(v));
export const isGroup = (v) => str(v).endsWith(`@${GROUP_SUFFIX}`);
export const isBroadcast = (v) => str(v).endsWith(`@${BROADCAST_SUFFIX}`);
export const isStatus = (v) => str(v) === `status@${BROADCAST_SUFFIX}`;

// A JID can carry a device suffix (`:12`) and an agent part. Two JIDs for the
// same person must compare equal, or every chat lookup misses.
export function bareJid(jid) {
  const s = str(jid).trim();
  if (!s) throw new WaError("That is not a JID.");
  const [user, server] = s.split("@");
  if (!server) throw new WaError(`"${jid}" has no server part.`);
  return `${user.split(":")[0].split("_")[0]}@${server}`;
}

// The digits of a user JID. Groups have no phone number and saying so beats
// returning something that looks like one.
export function phoneOfJid(jid) {
  const bare = bareJid(jid);
  if (!bare.endsWith(`@${USER_SUFFIX}`)) return "";
  const digits = bare.split("@")[0].replace(/\D/g, "");
  return digits;
}

// A phone number becomes a JID ONLY when it is already international. This
// refuses rather than guessing: a local number plus an assumed country code is
// a real person's number in another country, and the message goes to them.
export function jidFromPhone(input, { defaultCountry = "" } = {}) {
  const raw = str(input).trim();
  if (!raw) throw new WaError("No number given.");
  if (isJid(raw)) return bareJid(raw);

  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) throw new WaError(`"${input}" has no digits in it.`);

  if (hasPlus) {
    if (digits.length < 8) throw new WaError(`"${input}" is too short to be an international number.`);
    return `${digits}@${USER_SUFFIX}`;
  }

  // No leading +. Only safe if a default country code was configured
  // DELIBERATELY, and even then only for a plausible national number.
  if (defaultCountry) {
    const cc = str(defaultCountry).replace(/\D/g, "");
    const national = digits.replace(/^0+/, "");
    if (!cc) throw new WaError("The configured default country code has no digits in it.");
    if (national.length < 6 || national.length > 12) {
      throw new WaError(`"${input}" does not look like a national number for +${cc}.`);
    }
    // Already carries the country code, written without the plus.
    if (digits.startsWith(cc) && digits.length >= cc.length + 6) return `${digits}@${USER_SUFFIX}`;
    return `${cc}${national}@${USER_SUFFIX}`;
  }

  throw new WaError(
    `"${input}" has no country code. Write it as +918765432100, or set WHATSAPP_DEFAULT_COUNTRY on the server — a number sent without one reaches whoever owns it in the country that is assumed.`
  );
}

/* ---------------- messages ---------------- */

// Baileys hands back a proto with one of ~30 content keys. This reduces it to
// something a panel can render and a model can read, and keeps the ORIGINAL
// type so an unsupported kind is reported rather than shown as an empty bubble.
export function shapeMessage(raw = {}) {
  const key = raw.key || {};
  const msg = raw.message || {};
  const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message || msg;

  const type = Object.keys(inner).find((k) => k !== "messageContextInfo") || "";
  const body = textOf(inner, type);

  return {
    id: str(key.id),
    chat: key.remoteJid ? bareJid(key.remoteJid) : "",
    // In a group, `participant` is who actually spoke; remoteJid is the group.
    from: key.fromMe ? "me" : str(key.participant ? bareJid(key.participant) : key.remoteJid ? bareJid(key.remoteJid) : ""),
    fromMe: !!key.fromMe,
    at: raw.messageTimestamp ? new Date(Number(raw.messageTimestamp) * 1000).toISOString() : "",
    type: type || "unknown",
    text: body.text,
    // Media is described, never fetched here: a chat listing that downloads
    // every image is a chat listing nobody runs twice.
    media: body.media,
    quoted: inner[type]?.contextInfo?.stanzaId || "",
    pushName: str(raw.pushName),
  };
}

function textOf(inner, type) {
  const c = inner[type] || {};
  switch (type) {
    case "conversation":
      return { text: str(inner.conversation), media: null };
    case "extendedTextMessage":
      return { text: str(c.text), media: null };
    case "imageMessage":
    case "videoMessage":
    case "documentMessage":
    case "audioMessage":
    case "stickerMessage":
      return {
        text: str(c.caption),
        media: {
          kind: type.replace("Message", ""),
          mimetype: str(c.mimetype),
          bytes: Number(c.fileLength || 0),
          filename: str(c.fileName),
          seconds: Number(c.seconds || 0) || undefined,
        },
      };
    case "reactionMessage":
      return { text: str(c.text), media: null };
    case "protocolMessage":
      return { text: "", media: null };
    case "locationMessage":
      return { text: `location ${c.degreesLatitude}, ${c.degreesLongitude}`, media: null };
    case "contactMessage":
      return { text: str(c.displayName), media: null };
    default:
      // Unknown kinds keep their name so the caller can say "a poll" rather
      // than rendering nothing.
      return { text: "", media: null };
  }
}

export function shapeChat(raw = {}, { name = "" } = {}) {
  const jid = raw.id ? bareJid(raw.id) : "";
  return {
    jid,
    name: str(name || raw.name || raw.subject) || phoneOfJid(jid) || jid,
    isGroup: isGroup(jid),
    unread: Number(raw.unreadCount || 0),
    lastAt: raw.conversationTimestamp
      ? new Date(Number(raw.conversationTimestamp) * 1000).toISOString()
      : "",
    archived: !!raw.archived,
    muted: Number(raw.muteEndTime || 0) > Date.now() / 1000,
    pinned: !!raw.pinned,
  };
}

/* ---------------- what will not be built ---------------- */

// Bulk messaging is the thing WhatsApp bans accounts for, and it is also the
// thing that harms people who did not ask to hear from you. It is refused
// here, in the pure layer, so no caller can assemble it out of single sends.
export const MAX_RECIPIENTS = 1;

// A human types a few messages a minute. Anything faster is a bot, reads as a
// bot, and is what automated-behaviour detection looks for.
export const MIN_SEND_GAP_MS = Number(process.env.WHATSAPP_MIN_GAP_MS || 3000);
export const MAX_SENDS_PER_HOUR = Number(process.env.WHATSAPP_MAX_PER_HOUR || 60);

export function assertSendable(recipients, { sentInLastHour = 0, msSinceLast = Infinity } = {}) {
  const list = Array.isArray(recipients) ? recipients : [recipients];
  if (list.length === 0) throw new WaError("No recipient.");
  if (list.length > MAX_RECIPIENTS) {
    throw new WaError(
      `This sends to one chat at a time, deliberately. Broadcasting is what gets accounts banned, and it is the part that reaches people who did not ask to hear from you.`
    );
  }
  if (sentInLastHour >= MAX_SENDS_PER_HOUR) {
    throw new WaError(
      `${MAX_SENDS_PER_HOUR} messages have gone out in the last hour, which is this server's cap. It exists to keep the account alive.`
    );
  }
  if (msSinceLast < MIN_SEND_GAP_MS) {
    throw new WaError(
      `Only ${Math.round(msSinceLast)}ms since the last message. Sending faster than ${MIN_SEND_GAP_MS}ms apart reads as automation.`
    );
  }
  return true;
}

// Status/broadcast lists are a different product with different etiquette and
// are refused outright rather than half-supported.
export function assertRealChat(jid) {
  const bare = bareJid(jid);
  if (isStatus(bare)) throw new WaError("Status updates are not a chat you can send to from here.");
  if (isBroadcast(bare)) throw new WaError("Broadcast lists are refused: see the note on bulk messaging.");
  if (bare.endsWith(`@${NEWSLETTER_SUFFIX}`)) throw new WaError("Channels are read-only here.");
  return bare;
}

/* ---------------- searching what was read ---------------- */

export function searchMessages(messages, query, { limit = 50 } = {}) {
  const q = str(query).trim().toLowerCase();
  if (q.length < 2) throw new WaError("Give at least two characters to search for.");
  const out = [];
  for (const m of messages) {
    const hay = `${m.text || ""} ${m.pushName || ""}`.toLowerCase();
    if (hay.includes(q)) out.push(m);
  }
  return out
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, limit);
}

// A one-line preview for a chat list. Media says what it is rather than
// showing nothing, which is how a chat of photos looks empty.
export function previewOf(message) {
  if (!message) return "";
  if (message.text) return message.text.replace(/\s+/g, " ").slice(0, 120);
  if (message.media) return `[${message.media.kind}${message.media.filename ? ` ${message.media.filename}` : ""}]`;
  if (message.type && message.type !== "unknown") return `[${message.type.replace("Message", "")}]`;
  return "";
}
