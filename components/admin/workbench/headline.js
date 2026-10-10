// The one sentence at the top of the Agent tab, written from real state.
//
// The question the page is opened with — from a phone, mostly — is "does
// anything need me?". So the answer is a sentence, not a dashboard: the
// first line says what matters most right now, in words, and the second
// says what else is going on. Pure, so the order of precedence is testable
// without a socket: not connected > waiting on you > halted > gone quiet >
// all quiet.
//
// tone: "off" (not connected), "wait" (connecting / reconnecting), "fail"
// (gave up), "ask" (an approval is waiting), "halt", "stuck", "quiet".

const RUNNING = ["queued", "running"];

// "under a minute", "7 minutes", "1 hour 12 minutes". The sentence is read,
// not scanned, so it is said the way a person would say it.
export function inWords(ms = 0) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h} hour${h === 1 ? "" : "s"}${r ? ` ${r} minute${r === 1 ? "" : "s"}` : ""}`;
}

const WHO = { claude: "Claude", codex: "Codex" };

// What an approval is FOR, as an object of "approve …".
export function approvalWhat(card = {}) {
  const t = String(card.tool || "");
  if (/^bash$/i.test(t)) return "a command";
  if (/^(write|edit|multiedit|notebookedit)$/i.test(t)) return "a write";
  if (/^webfetch$/i.test(t)) return "a page fetch";
  if (/push/i.test(card.summary || "")) return "a push";
  return t ? `a ${t} call` : "an action";
}

export function approvalWho(card = {}, chats = []) {
  const chat = chats.find((c) => c.chatId === (card.chatId || card.jobId));
  if (chat) return WHO[chat.tool] || "A chat";
  return "A run";
}

/**
 * @param {object} s
 * @param {string} s.status       idle | connecting | connected | reconnecting | closed | failed
 * @param {string} [s.host]
 * @param {object} [s.conn]       { attempt, of, reason }
 * @param {Array}  [s.approvals]
 * @param {Array}  [s.chats]      workbench chats ({ chatId, state, tool })
 * @param {Array}  [s.jobs]       runs ({ id, state })
 * @param {Function} [s.idleOf]   job => ms since it last said anything
 * @param {boolean} [s.halted]
 */
export function headline({ status = "idle", host = "", conn = {}, approvals = [], chats = [], jobs = [], idleOf = () => 0, halted = false } = {}) {
  const where = host || "the agent server";
  if (status === "failed") {
    return {
      tone: "fail",
      line: `Couldn't reach ${where}.`,
      sub: `Three tries failed${conn.reason ? `: ${conn.reason}` : ""}. Nothing retries until you connect again.`,
    };
  }
  if (status === "connecting") return { tone: "wait", line: `Connecting to ${where}…`, sub: "" };
  if (status === "reconnecting") {
    return {
      tone: "wait",
      line: `Lost ${where}. Reconnecting${conn.attempt ? `, try ${conn.attempt} of ${conn.of || 3}` : ""}.`,
      sub: "What you see below is the last thing the server sent.",
    };
  }
  if (status !== "connected") {
    return {
      tone: "off",
      line: `Not connected to ${where}.`,
      sub: "Nothing opens until you connect, and leaving this tab closes it.",
    };
  }

  const stalled = jobs.filter((j) => j.state === "stalled");
  const running = jobs.filter((j) => RUNNING.includes(j.state)).length + chats.filter((c) => c.state === "thinking").length;
  const parts = [];
  if (running) parts.push(`${running} running`);
  if (stalled.length) {
    const longest = Math.max(...stalled.map((j) => idleOf(j) || 0));
    parts.push(`${stalled.length} quiet for ${inWords(longest)}`);
  }
  const waitingRuns = jobs.filter((j) => j.state === "waiting").length;
  if (!approvals.length && waitingRuns) parts.push(`${waitingRuns} waiting`);
  const sub = parts.length ? `${parts.join(", ")}.` : "Nothing is running.";

  if (approvals.length === 1) {
    const card = approvals[0];
    return { tone: "ask", line: `${approvalWho(card, chats)} is waiting on you to approve ${approvalWhat(card)}.`, sub };
  }
  if (approvals.length > 1) return { tone: "ask", line: `${approvals.length} approvals are waiting on you.`, sub };
  if (halted) return { tone: "halt", line: "Halted. Nothing new starts until you resume.", sub };
  if (stalled.length) {
    return { tone: "stuck", line: stalled.length === 1 ? "A run has gone quiet." : `${stalled.length} runs have gone quiet.`, sub };
  }
  return { tone: "quiet", line: "All quiet.", sub };
}
