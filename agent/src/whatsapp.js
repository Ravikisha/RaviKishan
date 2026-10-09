// WhatsApp, from your own account.
//
// READ THIS BEFORE USING IT
//
// This connects as YOU, by scanning a QR code with your phone, using Baileys —
// a reimplementation of the WhatsApp multi-device protocol. That is not the
// official API and WhatsApp's terms do not permit it. Accounts do get banned
// for automated use, and the thing you lose is your real conversation history.
//
// The official alternative cannot do what this does: the Cloud API works on a
// separate business number, starts with no history, and cannot read your
// personal chats. So the choice is "this, with the risk" or "not at all" —
// stated plainly rather than buried, because it is your account.
//
// What this file does NOT do, deliberately:
//   - no broadcast, no bulk send (whatsappShape.assertSendable refuses it)
//   - no contact scraping for outreach
//   - no auto-reply: nothing sends a message that you did not ask for
// Those are the behaviours that get accounts banned AND that harm people who
// did not ask to hear from you. One send at a time, at human speed.
//
// WHY BAILEYS AND NOT whatsapp-web.js: the latter drives a real Chromium,
// which on a 4-core ARM box is a few hundred MB resident and falls over under
// memory pressure. Baileys is a WebSocket and some crypto — it runs anywhere
// agentd does.
//
// WHY THIS LIVES IN agentd AND NOT ON VERCEL: it needs a socket held open for
// days and session keys written to disk. A serverless function cannot do
// either. This is the architectural reason WhatsApp is on your own box.
import fs from "fs";
import path from "path";
import { profileDir, ensureProfile } from "./profiles.js";
import {
  shapeMessage,
  shapeChat,
  bareJid,
  jidFromPhone,
  assertRealChat,
  assertSendable,
  searchMessages,
  previewOf,
  isGroup,
  WaError,
} from "../../lib/server/whatsappShape.js";

export { WaError };

// Loaded on demand. A deployment that never uses WhatsApp should not pay for
// the dependency, and a missing one must not take the whole daemon down.
let baileys = null;
async function lib() {
  if (baileys) return baileys;
  try {
    baileys = await import("@whiskeysockets/baileys");
    return baileys;
  } catch (e) {
    throw new WaError(
      "WhatsApp support is not installed on this server. Run `npm install @whiskeysockets/baileys` in agent/ and restart agentd."
    );
  }
}

export const isInstalled = async () => {
  try {
    await lib();
    return true;
  } catch (_) {
    return false;
  }
};

const sessionDir = (profile) => path.join(profileDir(profile), "whatsapp");

/* ---------------- one connection per profile ---------------- */

const sessions = new Map();

class Session {
  constructor(profile, { onEvent = () => {} } = {}) {
    this.profile = profile;
    this.onEvent = onEvent;
    this.sock = null;
    this.state = "idle"; // idle | pairing | open | closed
    this.qr = "";
    this.me = null;
    this.lastError = "";
    // Chats and recent messages are held in memory. Baileys does not keep a
    // store any more, and writing a full message database is a different
    // project — this keeps what a panel and a model actually ask for.
    this.chats = new Map();
    this.messages = new Map(); // jid -> message[]
    this.names = new Map();
    this.sendLog = [];
    this.stopping = false;
  }

  emit(type, data = {}) {
    this.onEvent({ type: `whatsapp.${type}`, profile: this.profile, at: Date.now(), ...data });
  }

  remember(msg) {
    if (!msg.chat) return;
    const list = this.messages.get(msg.chat) || [];
    // Newest last, bounded. A chat that has run for years must not grow
    // without limit in a daemon that stays up for weeks.
    if (!list.some((m) => m.id === msg.id)) list.push(msg);
    if (list.length > 500) list.splice(0, list.length - 500);
    this.messages.set(msg.chat, list);

    const chat = this.chats.get(msg.chat) || shapeChat({ id: msg.chat }, { name: this.names.get(msg.chat) });
    chat.lastAt = msg.at || chat.lastAt;
    chat.preview = previewOf(msg);
    if (!msg.fromMe) chat.unread = (chat.unread || 0) + 1;
    this.chats.set(msg.chat, chat);
  }

  async connect() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = await lib();

    ensureProfile(this.profile);
    const dir = sessionDir(this.profile);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

    const { state, saveCreds } = await useMultiFileAuthState(dir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

    this.sock = makeWASocket({
      auth: state,
      version,
      // Printing a QR to a terminal nobody is watching is useless; it goes to
      // the panel instead.
      printQRInTerminal: false,
      // Marking everything read as a side effect of connecting would silently
      // clear your unread badges on your actual phone.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      browser: ["agentd", "Chrome", "1.0.0"],
    });

    this.sock.ev.on("creds.update", saveCreds);

    this.sock.ev.on("connection.update", (u) => {
      if (u.qr) {
        this.qr = u.qr;
        this.state = "pairing";
        this.emit("qr", { qr: u.qr });
      }
      if (u.connection === "open") {
        this.state = "open";
        this.qr = "";
        this.me = this.sock.user || null;
        this.emit("open", { me: this.me });
      }
      if (u.connection === "close") {
        const code = u.lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        this.state = "closed";
        this.lastError = loggedOut
          ? "Logged out on the phone. The session is gone — scan a new QR to reconnect."
          : String(u.lastDisconnect?.error?.message || `closed (${code})`);
        this.emit("close", { loggedOut, reason: this.lastError });

        // Reconnect unless the phone logged us out or we asked it to stop.
        // Retrying a logged-out session is how you spin forever against an
        // account that will never accept you again.
        if (!loggedOut && !this.stopping) {
          setTimeout(() => this.connect().catch(() => {}), 5000);
        } else if (loggedOut) {
          fs.rmSync(sessionDir(this.profile), { recursive: true, force: true });
        }
      }
    });

    this.sock.ev.on("messaging-history.set", ({ chats = [], contacts = [] }) => {
      for (const c of contacts) {
        if (c.id) this.names.set(bareJid(c.id), c.name || c.notify || c.verifiedName || "");
      }
      for (const c of chats) {
        const jid = c.id ? bareJid(c.id) : "";
        if (jid) this.chats.set(jid, shapeChat(c, { name: this.names.get(jid) }));
      }
      this.emit("chats", { count: this.chats.size });
    });

    this.sock.ev.on("contacts.upsert", (list) => {
      for (const c of list || []) {
        if (c.id) this.names.set(bareJid(c.id), c.name || c.notify || c.verifiedName || "");
      }
    });

    this.sock.ev.on("messages.upsert", ({ messages, type }) => {
      for (const raw of messages || []) {
        const msg = shapeMessage(raw);
        if (!msg.chat) continue;
        if (raw.pushName && msg.from !== "me") this.names.set(msg.from, raw.pushName);
        this.remember(msg);
        // Only genuinely new traffic is announced. A history sync would
        // otherwise fire a notification per old message.
        if (type === "notify") this.emit("message", { message: msg });
      }
    });

    return this;
  }

  async stop() {
    this.stopping = true;
    try {
      this.sock?.end();
    } catch (_) {}
    this.state = "closed";
  }

  // Logging out invalidates the session on the phone too, which is the honest
  // way to disconnect — leaving a linked device behind is a credential you
  // forgot about.
  async logout() {
    this.stopping = true;
    try {
      await this.sock?.logout();
    } catch (_) {}
    fs.rmSync(sessionDir(this.profile), { recursive: true, force: true });
    this.state = "closed";
    sessions.delete(this.profile);
  }

  assertOpen() {
    if (this.state !== "open") {
      throw new WaError(
        this.state === "pairing"
          ? "WhatsApp is waiting for the QR code to be scanned."
          : `WhatsApp is not connected (${this.state}${this.lastError ? `: ${this.lastError}` : ""}).`
      );
    }
  }

  /* ---------------- reading ---------------- */

  listChats({ limit = 50, groups = true, query = "" } = {}) {
    this.assertOpen();
    let list = [...this.chats.values()];
    if (!groups) list = list.filter((c) => !c.isGroup);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((c) => `${c.name} ${c.jid}`.toLowerCase().includes(q));
    }
    return list
      .sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))
      .slice(0, limit)
      .map((c) => ({ ...c, name: this.names.get(c.jid) || c.name }));
  }

  readChat(jid, { limit = 50 } = {}) {
    this.assertOpen();
    const bare = assertRealChat(jid);
    const list = this.messages.get(bare) || [];
    return {
      jid: bare,
      name: this.names.get(bare) || this.chats.get(bare)?.name || bare,
      isGroup: isGroup(bare),
      count: list.length,
      // Oldest first reads like a conversation; a model handed it backwards
      // summarises the wrong end.
      messages: list.slice(-limit).map((m) => ({ ...m, fromName: m.fromMe ? "me" : this.names.get(m.from) || m.from })),
      note:
        list.length === 0
          ? "No messages cached for this chat. agentd only holds what arrived while it was connected — it does not download your history."
          : undefined,
    };
  }

  search(query, { limit = 50 } = {}) {
    this.assertOpen();
    const all = [...this.messages.values()].flat();
    return searchMessages(all, query, { limit }).map((m) => ({
      ...m,
      chatName: this.names.get(m.chat) || this.chats.get(m.chat)?.name || m.chat,
    }));
  }

  /* ---------------- writing ---------------- */

  recentSends() {
    const hourAgo = Date.now() - 3600_000;
    this.sendLog = this.sendLog.filter((t) => t > hourAgo);
    return this.sendLog;
  }

  async send(to, text, { quoted } = {}) {
    this.assertOpen();
    const jid = assertRealChat(jidFromPhone(to, { defaultCountry: process.env.WHATSAPP_DEFAULT_COUNTRY || "" }));
    if (!String(text || "").trim()) throw new WaError("Refusing to send an empty message.");

    const sends = this.recentSends();
    assertSendable(jid, {
      sentInLastHour: sends.length,
      msSinceLast: sends.length ? Date.now() - sends[sends.length - 1] : Infinity,
    });

    const options = quoted && this.messages.get(jid)?.find((m) => m.id === quoted)
      ? { quoted: { key: { id: quoted, remoteJid: jid }, message: {} } }
      : {};

    const out = await this.sock.sendMessage(jid, { text: String(text) }, options);
    this.sendLog.push(Date.now());

    const msg = shapeMessage(out || {});
    this.remember({ ...msg, chat: jid, fromMe: true, from: "me", text: String(text), at: new Date().toISOString() });
    this.emit("sent", { to: jid, id: msg.id });
    return { id: msg.id, to: jid, text: String(text), at: new Date().toISOString() };
  }

  async markRead(jid) {
    this.assertOpen();
    const bare = assertRealChat(jid);
    const list = this.messages.get(bare) || [];
    const unread = list.filter((m) => !m.fromMe).slice(-20);
    if (unread.length) {
      await this.sock.readMessages(unread.map((m) => ({ id: m.id, remoteJid: bare, participant: m.from })));
    }
    const chat = this.chats.get(bare);
    if (chat) chat.unread = 0;
    return { jid: bare, marked: unread.length };
  }

  // Whether a number is even on WhatsApp. Worth checking before sending to one
  // typed from memory.
  async exists(number) {
    this.assertOpen();
    const jid = jidFromPhone(number, { defaultCountry: process.env.WHATSAPP_DEFAULT_COUNTRY || "" });
    const [res] = await this.sock.onWhatsApp(jid.split("@")[0]);
    return { number, jid, onWhatsApp: !!res?.exists, resolved: res?.jid || "" };
  }

  status() {
    return {
      profile: this.profile,
      state: this.state,
      connected: this.state === "open",
      me: this.me ? { id: this.me.id, name: this.me.name || "" } : null,
      qr: this.state === "pairing" ? this.qr : "",
      chats: this.chats.size,
      cachedMessages: [...this.messages.values()].reduce((n, l) => n + l.length, 0),
      sentThisHour: this.recentSends().length,
      lastError: this.lastError,
    };
  }
}

/* ---------------- the registry ---------------- */

export async function connect(profile, { onEvent } = {}) {
  let s = sessions.get(profile);
  if (s && (s.state === "open" || s.state === "pairing")) return s;
  s = new Session(profile, { onEvent });
  sessions.set(profile, s);
  await s.connect();
  return s;
}

export function get(profile) {
  const s = sessions.get(profile);
  if (!s) {
    throw new WaError(
      `WhatsApp is not connected for profile "${profile}". Connect it in the admin's Agent tab and scan the QR code.`
    );
  }
  return s;
}

export const statusAll = () => [...sessions.values()].map((s) => s.status());

export async function disconnect(profile, { logout = false } = {}) {
  const s = sessions.get(profile);
  if (!s) return { stopped: false };
  if (logout) await s.logout();
  else await s.stop();
  sessions.delete(profile);
  return { stopped: true, loggedOut: logout };
}

// Does a saved session exist on disk for this profile? Used to offer "resume"
// rather than "scan a QR" when the credentials are already there.
export const hasSession = (profile) => {
  try {
    return fs.existsSync(path.join(sessionDir(profile), "creds.json"));
  } catch (_) {
    return false;
  }
};
