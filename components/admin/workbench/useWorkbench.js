// The workbench's state, fed from the ONE agent socket the panel already holds.
//
// AgentPanel owns the connection (approvals, runs and sign-ins ride it too);
// this hook owns what the new views need from it — chats and their events,
// conversation history, the review timeline, listening ports, and terminal
// output — and hands every message it recognises a home. `handle(msg)` returns
// true for a message it consumed, so the panel's own switch stays as it was.
//
// Two rules carried over from the rest of the panel:
//   - a server that does not know a workbench message yet answers
//     `Unknown message "chat.list"`. That is not an error to put in a red
//     banner; it is an older agentd, and the view says to update it.
//   - terminal output is NEVER put in React state. It goes straight to the
//     xterm that asked for it, buffered for the moment between the shell
//     opening and the view subscribing, so the first prompt is not lost.
import { useCallback, useRef, useState } from "react";
import { historyToEvents } from "./chatFold";

const AREA = (request = "") =>
  /^chat\./.test(request) ? "chat" : /^ops\./.test(request) ? "ops" : /^preview\./.test(request) ? "preview" : /^desktop\./.test(request) ? "desktop" : /^term\./.test(request) ? "term" : "";

const AREA_WORD = { chat: "chat", ops: "the review timeline", preview: "previews", desktop: "the desktop", term: "the terminal" };

// Requests whose refusal is delivered to an awaiting caller, which says it in
// its own place. Their errors are not repeated as a banner.
const AWAITED = new Set(["chat.start", "chat.resume", "term.open", "preview.open", "desktop.ticket", "desktop.status", "desktop.screenshot", "desktop.action"]);

// The Desktop view says these in its own place, including "this agentd is too
// old for the stream" — an older agentd still has the desktop over VNC, so a
// banner saying it offers no desktop at all would be wrong.
const SELF_REPORTED = new Set(["desktop.status", "desktop.screenshot", "desktop.action"]);

const chatIdOf = (c = {}) => c.chatId || c.id || "";
const normChat = (c = {}) => ({ ...c, chatId: chatIdOf(c) });
const sessionKey = (s = {}) => `${s.profile || ""}:${s.tool || "claude"}:${s.sessionId || ""}`;
const MAX_EVENTS = 2000;

export default function useWorkbench(clientRef) {
  const [chats, setChats] = useState([]);
  const [chatEvents, setChatEvents] = useState({});
  const [sessions, setSessions] = useState([]);
  const [history, setHistory] = useState({});
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [chatErr, setChatErr] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [ops, setOps] = useState([]);
  const [opsLoading, setOpsLoading] = useState(false);
  const [ports, setPorts] = useState([]);
  const [portsLoading, setPortsLoading] = useState(false);
  const [unsupported, setUnsupported] = useState({});
  const bus = useRef({ subs: new Map(), buf: new Map() });

  const c = () => clientRef.current;
  const trySend = (fn) => {
    try {
      fn();
      return true;
    } catch (_) {
      return false;
    }
  };

  const upsertChat = (row) =>
    setChats((cs) => {
      const r = normChat(row);
      if (!r.chatId) return cs;
      const i = cs.findIndex((x) => x.chatId === r.chatId);
      if (i < 0) return [r, ...cs];
      const next = cs.slice();
      next[i] = { ...cs[i], ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) };
      return next;
    });

  const pushEvents = (chatId, evs, { front = false } = {}) =>
    setChatEvents((all) => {
      const cur = all[chatId] || [];
      const next = front ? [...evs, ...cur] : [...cur, ...evs];
      return { ...all, [chatId]: next.slice(-MAX_EVENTS) };
    });

  /* ---------------- terminal bus ---------------- */
  const subscribe = useCallback((termId, fn) => {
    const b = bus.current;
    b.subs.set(termId, fn);
    for (const m of b.buf.get(termId) || []) fn(m);
    b.buf.delete(termId);
    return () => {
      if (b.subs.get(termId) === fn) b.subs.delete(termId);
    };
  }, []);

  const toTerm = (msg) => {
    const b = bus.current;
    const fn = b.subs.get(msg.termId);
    if (fn) return fn(msg);
    const q = b.buf.get(msg.termId) || [];
    q.push(msg);
    b.buf.set(msg.termId, q.slice(-500));
  };

  /* ---------------- inbound ---------------- */
  const handle = (msg) => {
    switch (msg.type) {
      case "chat.list":
      case "chats":
        setChatLoading(false);
        // agentd answers `chats` with {live, history}; `chats` is the older name.
        if (Array.isArray(msg.chats || msg.live)) setChats((msg.chats || msg.live).map(normChat));
        if (Array.isArray(msg.sessions || msg.history)) setSessions(msg.sessions || msg.history);
        return true;
      case "chat.sessions":
        setChatLoading(false);
        setSessions(msg.sessions || []);
        return true;
      case "chat.history":
        if (!msg.sessionId && Array.isArray(msg.sessions)) {
          setSessions(msg.sessions);
          return true;
        }
        setHistory((h) => ({ ...h, [sessionKey(msg)]: historyToEvents(msg) }));
        return true;
      case "chat.started":
        upsertChat({ chatId: msg.chatId, sessionId: msg.sessionId, state: msg.state || "thinking", ...(msg.chat || {}) });
        return true;
      case "chat.event": {
        const id = msg.chatId;
        if (!id || !msg.event) return true;
        pushEvents(id, [msg.event]);
        if (msg.event.type === "started" && msg.event.sessionId) upsertChat({ chatId: id, sessionId: msg.event.sessionId });
        return true;
      }
      case "chat.state":
        upsertChat({ ...msg, type: undefined, chatId: msg.chatId });
        return true;
      case "ops.list":
      case "ops":
        setOpsLoading(false);
        setOps(msg.rows || msg.entries || msg.ops || []);
        return true;
      case "ops.event": {
        const row = msg.op || msg.entry || msg.row;
        if (row) setOps((o) => [row, ...o].slice(0, 1000));
        return true;
      }
      case "preview.list":
      case "previews":
        setPortsLoading(false);
        setPorts(msg.ports || msg.rows || []);
        return true;
      case "term.output":
      case "term.exit":
      case "term.closed":
        toTerm(msg);
        return true;
      case "error": {
        const area = AREA(msg.request);
        if (!area) return false;
        if (SELF_REPORTED.has(msg.request)) return true;
        if (/unknown message/i.test(msg.error || "")) {
          setUnsupported((u) => ({
            ...u,
            [area]: `The agent server does not offer ${AREA_WORD[area]} yet. Update agentd on the box to use it.`,
          }));
        } else if (!AWAITED.has(msg.request) && area === "chat") setChatErr(msg.error || "Refused.");
        if (area === "chat") setChatLoading(false);
        if (area === "ops") setOpsLoading(false);
        if (area === "preview") setPortsLoading(false);
        return true;
      }
      default:
        return false;
    }
  };

  /* ---------------- outbound ---------------- */
  const refreshChats = () => {
    setChatLoading(true);
    if (!trySend(() => c().chatList())) setChatLoading(false);
  };
  const refreshOps = () => {
    setOpsLoading(true);
    if (!trySend(() => c().opsList({ limit: 300 }))) setOpsLoading(false);
  };
  const refreshPorts = () => {
    setPortsLoading(true);
    if (!trySend(() => c().previewList())) setPortsLoading(false);
  };

  // Asked once a socket exists, so no view opens on a blank list.
  const onConnected = () => {
    setUnsupported({});
    refreshChats();
    refreshOps();
    refreshPorts();
  };

  const start = async (opts) => {
    setBusy(true);
    setChatErr("");
    const local = { type: "user", text: opts.prompt, local: true, at: Date.now() };
    try {
      const res = await c().chatStart(opts);
      const id = chatIdOf(res);
      upsertChat({
        chatId: id,
        sessionId: res.sessionId,
        state: "thinking",
        profile: opts.profile,
        tool: opts.tool,
        model: opts.model,
        cwd: opts.cwd,
        repo: opts.repo,
        orgId: opts.orgId,
        policy: opts.policy,
        title: String(opts.prompt || "").slice(0, 80),
      });
      pushEvents(id, [local], { front: true });
      setSelected({ chatId: id });
    } catch (e) {
      setChatErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const send = (chat, text) => {
    if (!chat) return;
    setChatErr("");
    try {
      c().chatSend(chat.chatId, text);
      pushEvents(chat.chatId, [{ type: "user", text, local: true, at: Date.now() }]);
      upsertChat({ chatId: chat.chatId, state: "thinking" });
    } catch (e) {
      setChatErr(e.message);
    }
  };

  const interrupt = (chat) => chat && !trySend(() => c().chatInterrupt(chat.chatId)) && setChatErr("Not connected to the agent server.");
  const close = (chat) => chat && !trySend(() => c().chatClose(chat.chatId)) && setChatErr("Not connected to the agent server.");

  const select = (sel) => {
    setSelected(sel);
    setChatErr("");
    const s = sel?.session;
    if (s && !history[sessionKey(s)]) trySend(() => c().chatHistory(s.profile, s.tool || "claude", s.sessionId));
  };

  const resume = async (session) => {
    setBusy(true);
    setChatErr("");
    try {
      const res = await c().chatResume({ profile: session.profile, tool: session.tool || "claude", sessionId: session.sessionId });
      const id = chatIdOf(res);
      upsertChat({
        chatId: id,
        sessionId: res.sessionId || session.sessionId,
        state: res.state || "idle",
        profile: session.profile,
        tool: session.tool,
        cwd: session.cwd,
        title: session.title,
      });
      const past = history[sessionKey(session)];
      if (past?.length) pushEvents(id, [...past, { type: "system", text: "Resumed." }], { front: true });
      setSelected({ chatId: id });
    } catch (e) {
      setChatErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const selectedEvents = selected?.chatId ? chatEvents[selected.chatId] || [] : selected?.session ? history[sessionKey(selected.session)] || [] : [];

  return {
    chats,
    sessions,
    selected,
    selectedEvents,
    busy,
    chatErr,
    chatLoading,
    ops,
    opsLoading,
    ports,
    portsLoading,
    unsupported,
    handle,
    onConnected,
    subscribe,
    refreshChats,
    refreshOps,
    refreshPorts,
    start,
    send,
    interrupt,
    close,
    select,
    resume,
  };
}
