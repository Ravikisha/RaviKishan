// BROWSER. Talking to agentd.
//
// A WebSocket rather than fetch, because approvals are a server→client PUSH:
// the server asks a question and blocks on the answer, which polling cannot
// express without either latency or a second channel for the replies.
//
// Reconnects by job id rather than assuming the socket survived. Cloudflare
// idles out a quiet tunnel, phones suspend sockets when the screen locks, and a
// panel that only works while the connection happens to hold is a panel that
// works at a desk and fails on a train.
import { auth } from "./firebase";

export const AGENT_URL =
  process.env.NEXT_PUBLIC_AGENT_URL || "wss://agent.ravikishan.me";

export class AgentClient {
  constructor({ url = AGENT_URL, onEvent = () => {}, onState = () => {} } = {}) {
    this.url = url;
    this.onEvent = onEvent;
    this.onState = onState;
    this.ws = null;
    this.ready = false;
    this.closedByUs = false;
    this.backoff = 1000;
  }

  async connect() {
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in.");
    const token = await user.getIdToken();

    this.closedByUs = false;
    this.onState({ status: "connecting" });

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));

    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch (_) {
        return;
      }
      if (msg.type === "ready") {
        this.ready = true;
        this.backoff = 1000;
        this.onState({ status: "connected", ...msg });
        return;
      }
      this.onEvent(msg);
    };

    ws.onclose = () => {
      this.ready = false;
      this.onState({ status: this.closedByUs ? "closed" : "reconnecting" });
      if (this.closedByUs) return;
      // Backoff, capped. A phone coming out of a tunnel should not hammer the
      // server, and a server that is down should not be hammered either.
      setTimeout(() => this.connect().catch(() => {}), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    };

    ws.onerror = () => {
      // onclose always follows; reconnection is handled there so it is not
      // attempted twice.
    };
  }

  close() {
    this.closedByUs = true;
    this.ws?.close();
  }

  send(msg) {
    if (!this.ws || this.ws.readyState !== 1) throw new Error("Not connected to the agent server.");
    this.ws.send(JSON.stringify(msg));
  }

  start(job) {
    this.send({ type: "start", ...job });
  }
  stop(jobId) {
    this.send({ type: "stop", jobId });
  }
  answer(id, allow, { scope = "once", reason = "" } = {}) {
    this.send({ type: "answer", id, allow, scope, reason });
  }
  transcript(jobId) {
    this.send({ type: "transcript", jobId });
  }
  halt(reason) {
    this.send({ type: "halt", reason });
  }
  resume() {
    this.send({ type: "resume" });
  }
  addProfile(name) {
    this.send({ type: "profile.add", name });
  }
}

/* ---------------- voice ---------------- */

// The "say something and it happens" half. Browser-native Web Speech API —
// no key, no service, no cost, and nothing leaves the device except the text
// you would have typed anyway.
//
// Support is uneven: Chrome and Edge have it, Firefox does not, and iOS Safari
// requires a user gesture per utterance. So this is an ENHANCEMENT — the panel
// is fully usable by typing, and the microphone button simply does not appear
// where the API is missing. It is never the only way to do something.
export const speechSupported = () =>
  typeof window !== "undefined" &&
  !!(window.SpeechRecognition || window.webkitSpeechRecognition);

export function listen({ onText, onEnd = () => {}, onError = () => {} } = {}) {
  const Impl = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Impl) throw new Error("This browser has no speech recognition.");

  const rec = new Impl();
  rec.lang = navigator.language || "en-US";
  rec.continuous = false;
  // Interim results make it feel responsive; only the final one is submitted.
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onresult = (e) => {
    const last = e.results[e.results.length - 1];
    onText(last[0].transcript, last.isFinal);
  };
  rec.onerror = (e) => onError(e.error || "speech failed");
  rec.onend = onEnd;
  rec.start();
  return () => rec.stop();
}

// Spoken status, for when the phone is in a pocket. Short on purpose: reading a
// transcript aloud is noise, "two approvals waiting" is information.
export function say(text, { enabled = true } = {}) {
  if (!enabled || typeof window === "undefined" || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 240));
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  } catch (_) {
    // A browser that refuses to speak is not a failure worth surfacing.
  }
}

/* ---------------- turning a sentence into a job ---------------- */

// One implementation, in a pure module, so it can be tested without a browser.
// The same reason noteShape.js and repoAudit.js are pure — and the GitHub audit
// already showed what a second copy does within an hour.
export { parseCommand, CommandError } from "./server/agentCommand";
