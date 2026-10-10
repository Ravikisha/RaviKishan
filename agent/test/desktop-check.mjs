// The workbench's desktop, terminal, previews and review timeline, checked
// without a display, a VNC server or a shell: every rule that decides who may
// see or drive this box is pure or driven through fakes, and the two pipes
// (websockify and the preview proxy) run against real loopback sockets.
//
//   node test/desktop-check.mjs
import os from "os";
import path from "path";
import fs from "fs";
import net from "net";
import http from "http";
import * as events from "events";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "agentd-desktop-"));
process.env.AGENT_HOME = HOME;
process.env.AGENT_ADMIN_EMAILS = "owner@example.com";
fs.mkdirSync(path.join(HOME, "work"), { recursive: true });
fs.mkdirSync(path.join(HOME, "logs"), { recursive: true });

// A fake VNC server, up before desktop.js reads its port.
const vncSeen = [];
const vnc = net.createServer((s) => {
  s.on("data", (d) => vncSeen.push(Buffer.from(d)));
  s.write(Buffer.from("RFB 003.008\n"));
});
await new Promise((r) => vnc.listen(0, "127.0.0.1", r));
process.env.AGENT_VNC_PORT = String(vnc.address().port);

const desktop = await import("../src/desktop.js");
const preview = await import("../src/preview.js");
const terminal = await import("../src/terminal.js");
const oplog = await import("../src/oplog.js");
const auth = await import("../src/auth.js");
const approvalsMod = await import("../src/approvals.js");
const policy = await import("../src/policy.js");
const profiles = await import("../src/profiles.js");
const api = await import("../src/api.js");
const mcpDesktop = await import("../src/mcp-desktop.js");
const runner = await import("../src/runner.js");
const { createWorkbench } = await import("../src/workbench.js");
const { WebSocket, WebSocketServer } = await import("ws");

let pass = 0;
const fails = [];
const check = (ok, name, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  OK  ${name}`);
  } else {
    fails.push(`${name}${detail ? ` - ${detail}` : ""}`);
    console.log(`  XX  ${name}${detail ? ` - ${detail}` : ""}`);
  }
};
const throws = async (fn, name, re) => {
  try {
    await fn();
    check(false, name, "it did not throw");
  } catch (e) {
    check(re.test(e.message), name, e.message.slice(0, 140));
  }
};
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);
const owner = (over = {}) => ({ email: "owner@example.com", sub: "u1", exp: nowSec() + 3600, auth_time: nowSec(), ...over });
const tmpLog = () => new oplog.OpLog({ file: path.join(fs.mkdtempSync(path.join(HOME, "ops-")), "ops.ndjson") });

/* ---------------------------------------------------------------- tickets */
console.log("\ndesktop tickets: one use, sixty seconds, bound to who minted them");
{
  let t = 1_000_000;
  const tk = new desktop.Tickets({ now: () => t });
  const m = tk.mint(owner());
  check(typeof m.ticket === "string" && m.ticket.length >= 32, "a ticket is a long random string");
  check(m.expiresAt === t + 60_000, "it lives sixty seconds");
  check(m.viewOnly === true, "and is view-only unless asked otherwise");
  check(tk.mint(owner(), { viewOnly: "false" }).viewOnly === true, "a truthy string does not make it interactive — only false does");
  check(tk.mint(owner(), { viewOnly: false }).viewOnly === false, "an explicit false does");
  const r = tk.redeem(m.ticket);
  check(r && r.email === "owner@example.com" && r.viewOnly === true, "redeeming returns who minted it and the mode");
  check(tk.redeem(m.ticket) === null, "a second redemption is refused (single use)");
  const late = tk.mint(owner());
  t += 60_001;
  check(tk.redeem(late.ticket) === null, "an expired ticket is refused");
  const other = tk.mint(owner(), { purpose: "something-else" });
  check(tk.redeem(other.ticket) === null, "a ticket minted for another purpose does not open the desktop");
  const failed = tk.mint(owner(), { purpose: "x" });
  tk.redeem(failed.ticket);
  check(tk.redeem(failed.ticket, { purpose: "x" }) === null, "a failed redemption still spends the ticket");
  const gone = tk.mint(owner());
  check(tk.redeem(gone.ticket, { allowed: () => ["someone@else.com"] }) === null, "an e-mail dropped from the allow-list cannot redeem");
  check(tk.redeem("nonsense") === null && tk.redeem(undefined) === null && tk.redeem({}) === null, "an unknown or non-string ticket is refused");
  await throws(async () => tk.mint(null), "a ticket cannot be minted without an authenticated user", /Authenticate first/);
  check(![...tk.map.keys()].some((k) => k === m.ticket), "tickets are stored by hash, not as themselves");
  const small = new desktop.Tickets({ max: 2 });
  small.mint(owner());
  small.mint(owner());
  await throws(async () => small.mint(owner()), "the number of open tickets is capped", /Too many/);
}

/* ---------------------------------------------------------------- RFB */
console.log("\nview-only is enforced on the box, not trusted to noVNC");
{
  const hs = Buffer.concat([Buffer.from("RFB 003.008\n"), Buffer.from([1]), Buffer.from([1])]);
  const fbur = Buffer.from([3, 1, 0, 0, 0, 0, 6, 64, 3, 132]);
  const key = Buffer.from([4, 1, 0, 0, 0, 0, 0, 0x61]);
  const ptr = Buffer.from([5, 1, 0, 10, 0, 20]);
  const cut = Buffer.concat([Buffer.from([6, 0, 0, 0, 0, 0, 0, 3]), Buffer.from("abc")]);
  const enc = Buffer.from([2, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1]);
  const f = new desktop.RfbClientFilter();
  const r = f.push(Buffer.concat([hs, enc, key, fbur, ptr, cut]));
  check(!r.error, "a normal session parses", r.error);
  check(r.out.equals(Buffer.concat([hs, enc, fbur])), "the handshake, SetEncodings and update requests pass; key, pointer and clipboard do not");
  check(f.dropped === 3, "three input messages were dropped", String(f.dropped));

  const g = new desktop.RfbClientFilter();
  const all = Buffer.concat([hs, fbur, key]);
  let out = Buffer.alloc(0);
  for (const b of all) out = Buffer.concat([out, g.push(Buffer.from([b])).out]);
  check(out.equals(Buffer.concat([hs, fbur])), "the same holds when every byte arrives on its own");

  const h = new desktop.RfbClientFilter();
  check(/Unknown RFB message/.test(h.push(Buffer.concat([hs, Buffer.from([99, 0, 0, 0])])).error || ""), "an unknown message type closes rather than guesses");
  check(/Not an RFB/.test(new desktop.RfbClientFilter().push(Buffer.from("GET / HTTP/1.1\r\n")).error || ""), "a non-RFB client is refused");
  const old = new desktop.RfbClientFilter();
  const r33 = old.push(Buffer.concat([Buffer.from("RFB 003.003\n"), Buffer.from([1]), fbur]));
  check(!r33.error && r33.out.length === 12 + 1 + 10, "RFB 3.3 has no client security byte and still parses");
  check(/Security type 7/.test(new desktop.RfbClientFilter().push(Buffer.concat([Buffer.from("RFB 003.008\n"), Buffer.from([7])])).error || ""), "an unexpected security type is refused");
  check(desktop.RfbClientFilter.messageLength(Buffer.from([248, 0])) === 12 && desktop.RfbClientFilter.messageLength(Buffer.from([248, 1])) === -1, "the QEMU extended key event is known; other QEMU messages are not");
}

/* ---------------------------------------------------------------- actions */
console.log("\ndesktop actions are shaped before xdotool sees them");
{
  const A = desktop.assertAction;
  check(JSON.stringify(A({ action: "click", x: 10, y: 20, junk: "x" })) === JSON.stringify({ action: "click", x: 10, y: 20, button: "left" }), "a click keeps only known fields and defaults to the left button");
  await throws(async () => A({ action: "click", x: -1, y: 2 }), "a negative coordinate is refused", /whole number/);
  await throws(async () => A({ action: "click", x: 1.5, y: 2 }), "a fractional coordinate is refused", /whole number/);
  await throws(async () => A({ action: "click", x: "1; rm", y: 2 }), "a coordinate carrying shell is refused", /whole number/);
  await throws(async () => A({ action: "click", x: 1, y: 2, button: "4" }), "an unknown button is refused", /button must be/);
  for (const bad of ["ctrl+l; rm -rf ~", "ctrl l", "'Return'", "a+b+c+d+e", "ctrl+$(id)", "", "Ret\nurn", "--help"]) {
    await throws(async () => A({ action: "key", combo: bad }), `key combo ${JSON.stringify(bad)} is refused`, /not a key combo/);
  }
  check(A({ action: "key", combo: " Return\n" }).combo === "Return", "surrounding whitespace is trimmed, never passed on");
  check(preview.reservedPorts().has(Number(process.env.AGENT_VNC_PORT)) && preview.reservedPorts().has(5901), "a VNC port moved by the environment is reserved, and so is the default");
  check(A({ action: "key", combo: "ctrl+shift+t" }).combo === "ctrl+shift+t", "a real combo passes");
  await throws(async () => A({ action: "type", text: "a\u001b[31m" }), "typed text cannot carry an escape sequence", /control characters/);
  await throws(async () => A({ action: "type", text: "x".repeat(2001) }), "typed text is capped at 2000", /at most 2000/);
  check(A({ action: "type", text: "line one\nline two" }).text.includes("\n"), "a newline may be typed");
  await throws(async () => A({ action: "open_url", url: "javascript:alert(1)" }), "a javascript: URL never opens", /Only http and https/);
  await throws(async () => A({ action: "open_url", url: "file:///etc/passwd" }), "nor a file: URL", /Only http and https/);
  check(A({ action: "open_url", url: "https://example.com/a b" }).url === "https://example.com/a%20b", "an http(s) URL is normalised");
  await throws(async () => A({ action: "scroll", amount: 21 }), "scroll is capped at 20 notches", /1 to 20/);
  await throws(async () => A({ action: "rm" }), "an unknown action is refused with the list", /Actions:/);
  await throws(async () => A({ action: "focus_window", window: "" }), "focus_window needs a title", /focus_window needs/);
  check(A({ action: "screenshot", x: 1 }).x === undefined, "a screenshot carries no arguments");
}

console.log("\nxdotool argv: arrays, never a shell");
{
  const X = (a) => desktop.xdotoolArgs(desktop.assertAction(a));
  check(JSON.stringify(X({ action: "click", x: 5, y: 6, button: "right" })) === JSON.stringify(["mousemove", "--sync", "5", "6", "click", "3"]), "a right click moves then clicks button 3");
  check(X({ action: "double_click", x: 1, y: 2 }).join(" ") === "mousemove --sync 1 2 click --repeat 2 --delay 120 1", "a double click repeats twice");
  const typed = X({ action: "type", text: "--version; rm -rf ~" });
  check(typed[typed.length - 2] === "--" && typed[typed.length - 1] === "--version; rm -rf ~", "typed text sits after -- as ONE argument, flags and semicolons inert");
  check(X({ action: "key", combo: "Return" }).join(" ") === "key --clearmodifiers -- Return", "a key press is key -- combo");
  check(X({ action: "scroll", direction: "up", amount: 2 }).join(" ") === "click --repeat 2 --delay 40 4", "scrolling up is wheel button 4");
  check(X({ action: "scroll", direction: "down", amount: 1, x: 3, y: 4 }).slice(0, 4).join(" ") === "mousemove --sync 3 4", "and moves first when given a point");
  const fw = X({ action: "focus_window", window: "Chromium (dev).*" });
  check(fw.includes("Chromium \\(dev\\)\\.\\*"), "a window title is matched literally (regex escaped)", fw.join(" "));
  check(X({ action: "click", x: 1, y: 1 }).every((a) => typeof a === "string"), "every argument is a string");
}

console.log("\nthe desktop runs xdotool, import and CDP — and only those");
{
  const calls = [];
  const png = Buffer.alloc(40);
  desktop.PNG_MAGIC.copy(png);
  png.writeUInt32BE(1600, 16);
  png.writeUInt32BE(900, 20);
  const fetches = [];
  process.env.AGENT_MCP_TOKEN = "rkmcp_should_not_leak_123456";
  const d = new desktop.Desktop({
    run: async (cmd, args, opts) => {
      calls.push({ cmd, args, env: opts.env });
      if (cmd === "import") return png;
      if (cmd === "xdotool" && args[0] === "search") return Buffer.from("101\n102\n");
      if (cmd === "xdotool" && args[0] === "getwindowname") return Buffer.from(args[1] === "101" ? "Terminal" : "Chromium");
      return Buffer.alloc(0);
    },
    fetchFn: async (url, opts) => {
      fetches.push({ url, opts });
      return { ok: true, json: async () => ({ id: "ABC-123" }) };
    },
  });
  await d.act(desktop.assertAction({ action: "click", x: 1, y: 2 }));
  check(calls[0].cmd === "xdotool" && calls[0].env.DISPLAY === ":1", "a click runs xdotool on DISPLAY=:1");
  check(!("AGENT_MCP_TOKEN" in calls[0].env), "without the daemon's site token in its environment");
  const shot = await d.screenshot();
  check(calls[1].cmd === "import" && calls[1].args.join(" ") === "-window root png:-", "a screenshot is import -window root png:-");
  check(shot.width === 1600 && shot.height === 900, "and its size is read from the PNG header");
  const w = await d.listWindows();
  check(w.windows.length === 2 && w.windows[1].title === "Chromium", "windows are listed with their titles");
  await d.openUrl("https://example.com/?q=a&b=c");
  check(fetches[0].opts.method === "PUT" && fetches[0].url === "http://127.0.0.1:9222/json/new?https%3A%2F%2Fexample.com%2F%3Fq%3Da%26b%3Dc", "open_url PUTs to CDP on loopback with the address encoded", fetches[0].url);
  check(fetches[1].url.endsWith("/json/activate/ABC-123"), "and brings the new tab to the front");
  const bad = new desktop.Desktop({ run: async () => Buffer.from("<html>") });
  await throws(() => bad.screenshot(), "a screenshot that is not a PNG is refused", /not a PNG/);
  check(desktop.pngSize(Buffer.from("nope")) === null, "pngSize refuses a non-PNG");
}

/* ---------------------------------------------------------------- gate */
console.log("\nthe desktop gate: deny by default, deny on timeout, one pass per yes");
{
  check(desktop.desktopDecision({ policy: "allowlist", action: "screenshot" }).allow === true, "allowlist lets a screenshot through");
  check(desktop.desktopDecision({ policy: "allowlist", action: "click" }).allow === false, "but asks for a click");
  check(desktop.desktopDecision({ policy: "manual", action: "screenshot" }).allow === false, "manual asks even for a look");
  check(desktop.desktopDecision({ policy: "yolo", action: "type" }).allow === true, "yolo asks nothing");
  check(desktop.desktopDecision({ policy: "nonsense", action: "list_windows" }).allow === false, "an unknown policy is treated as manual");

  const acted = [];
  const fakeDesktop = { act: async (a) => (acted.push(a), a.action === "screenshot" ? { png: Buffer.alloc(0), width: 1, height: 1 } : {}) };
  const logged = [];
  const asks = [];
  const yes = { ask: async (id, req, o) => (asks.push({ id, req, o }), { allow: true, reason: "ok" }) };
  const no = { ask: async () => ({ allow: false, reason: "Denied." }) };
  const gate = new desktop.DesktopGate({ desktop: fakeDesktop, approvals: yes, log: (e) => logged.push(e) });
  await gate.run({ callerId: "j_x_000000", actor: "job:j_x_000000", policy: "allowlist", action: { action: "screenshot" } });
  check(asks.length === 0 && logged.length === 0, "a screenshot under allowlist is neither asked about nor logged");
  const r = await gate.run({ callerId: "j_x_000000", actor: "job:j_x_000000", policy: "allowlist", action: { action: "click", x: 1, y: 2 }, waitMs: 5000 });
  check(asks.length === 1 && asks[0].req.tool === "Desktop" && asks[0].o.timeoutMs === 5000, "a click asks, as a Desktop card, with the caller's wait");
  check(r.ok && acted.at(-1).action === "click", "and runs once allowed");
  check(logged.at(-1).kind === "desktop" && logged.at(-1).decision === "allowed" && logged.at(-1).actor === "job:j_x_000000", "and is logged with who and the decision");
  const before = acted.length;
  const g2 = new desktop.DesktopGate({ desktop: fakeDesktop, approvals: no, log: (e) => logged.push(e) });
  const d2 = await g2.run({ callerId: "mcp", actor: "mcp", policy: "allowlist", action: { action: "open_url", url: "https://x.example" } });
  check(d2.ok === false && d2.denied && acted.length === before, "a refusal runs nothing");
  check(logged.at(-1).kind === "browser" && logged.at(-1).decision === "denied", "and is logged as a denied browser action");
  const g3 = new desktop.DesktopGate({ desktop: fakeDesktop, approvals: no, log: () => {} });
  check(g3.noteApproved("c_1", "mcp__desktop__click", { x: 4, y: 5 }) === true, "a yes at the permission prompt is noted");
  check((await g3.run({ callerId: "c_1", actor: "chat:c_1", policy: "allowlist", action: { action: "click", x: 4, y: 5 } })).ok === true, "and lets that exact click through without a second card");
  check((await g3.run({ callerId: "c_1", actor: "chat:c_1", policy: "allowlist", action: { action: "click", x: 4, y: 5 } })).ok === false, "once only");
  g3.noteApproved("c_1", "mcp__desktop__click", { x: 4, y: 5 });
  check((await g3.run({ callerId: "c_2", actor: "chat:c_2", policy: "allowlist", action: { action: "click", x: 4, y: 5 } })).ok === false, "and never for another caller");
  check(g3.noteApproved("c_1", "Bash", {}) === false && g3.noteApproved("c_1", "mcp__desktop__key", { combo: "a;b" }) === false, "only desktop tools with valid input become passes");

  const real = new approvalsMod.Approvals({ timeoutMs: 600_000 });
  const g4 = new desktop.DesktopGate({ desktop: fakeDesktop, approvals: real, log: () => {} });
  const t0 = Date.now();
  const timed = await g4.run({ callerId: "mcp", actor: "mcp", policy: "allowlist", action: { action: "key", combo: "Return" }, waitMs: 60 });
  check(timed.ok === false && Date.now() - t0 < 2000, "an unanswered card is refused when the caller's short wait ends", `${Date.now() - t0}ms`);
  check(real.list().length === 0, "and its card is withdrawn, so nobody can approve a click that will never land");
  check(/seconds/.test(timed.reason), "the reason says how long it waited", timed.reason);
}

/* ---------------------------------------------------------------- approvals/policy/auth/profiles */
console.log("\nthe shared modules learned about the desktop");
{
  const a = new approvalsMod.Approvals({ timeoutMs: 1000 });
  const p = a.ask("j_a_000000", { tool: "Desktop", input: { action: "click", x: 1, y: 2, button: "left" } }, { timeoutMs: 999_999 });
  check(a.list()[0].expiresAt - a.list()[0].askedAt === 1000, "a per-card wait can never be LONGER than the default");
  check(a.list()[0].summary === "Desktop: click left at (1, 2)", "a desktop card says what will happen", a.list()[0].summary);
  a.answer(a.list()[0].id, { allow: false });
  await p;
  check(policy.decide({ policy: "allowlist", tool: "mcp__desktop__screenshot" }).allow === true, "a desktop screenshot is a read for the permission prompt");
  check(policy.decide({ policy: "allowlist", tool: "mcp__desktop__click" }).allow === false, "a desktop click asks there too");
  check(profiles.profileEnv("p1", { tool: "claude" }).DISPLAY === ":1", "runs get DISPLAY=:1, so their windows appear on the shared desktop");
  check(auth.assertRecentSignIn(owner()) === true, "a sign-in from just now is fresh");
  await throws(async () => auth.assertRecentSignIn(owner({ auth_time: nowSec() - 31 * 60 }), { what: "Opening a terminal" }), "a 31-minute-old sign-in is not", /Opening a terminal needs a sign-in from the last 30 minutes/);
  await throws(async () => auth.assertRecentSignIn(owner({ auth_time: undefined })), "nor one with no auth_time", /last 30 minutes/);
}

/* ---------------------------------------------------------------- previews */
console.log("\npreview ports");
{
  check(preview.assertPreviewPort("3000") === 3000, "3000 is previewable");
  for (const p of ["80", "1023", "7777", "5901", "9222", "65536", "3000abc", "-1", "", "0x10"]) {
    await throws(async () => preview.assertPreviewPort(p), `port ${JSON.stringify(p)} is refused`, /not a preview port|belongs to agentd/);
  }
}

console.log("\npreview cookies: signed, short-lived, scoped to one port");
{
  let t = 5_000_000;
  const s = new preview.PreviewSigner({ secret: "k1", now: () => t });
  const { token } = s.sign({ port: 3000, kind: "session", ttlMs: 1000 });
  check(!!s.verify(token, { port: 3000, kind: "session" }), "a fresh cookie verifies");
  check(s.verify(token, { port: 3001, kind: "session" }) === null, "for its own port only");
  check(s.verify(token, { port: 3000, kind: "open" }) === null, "and its own kind only");
  const [b, sig] = token.split(".");
  check(s.verify(`${b}.${sig.slice(0, -2)}xx`, { port: 3000, kind: "session" }) === null, "a tampered signature fails");
  const forged = Buffer.from(JSON.stringify({ p: 3000, k: "session", e: t + 1e9, n: "x" })).toString("base64url");
  check(s.verify(`${forged}.${sig}`, { port: 3000, kind: "session" }) === null, "a rewritten payload fails");
  check(new preview.PreviewSigner({ secret: "k2", now: () => t }).verify(token, { port: 3000, kind: "session" }) === null, "a different secret (a restart) fails");
  check(s.verify(`${token}.extra`, { port: 3000, kind: "session" }) === null, "an extra segment fails");
  t += 1001;
  check(s.verify(token, { port: 3000, kind: "session" }) === null, "an expired cookie fails");
  const open = s.sign({ port: 3000, kind: "open", ttlMs: 1000 });
  const pl = s.verify(open.token, { port: 3000, kind: "open" });
  check(s.spend(pl) === true && s.spend(pl) === false, "an open link is spent on first use");
  const c = preview.setCookieHeader(3000, "v", 3600);
  check(/Path=\/preview\/3000\//.test(c) && /HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=None/.test(c), "the cookie is HttpOnly, Secure and pathed to /preview/3000/", c);
  check(preview.readCookie("a=1; agentd_pv_3000=tok; b=2", "agentd_pv_3000") === "tok", "it is read back by name");
  check(preview.stripPreviewCookies("a=1; agentd_pv_3000=tok; agentd_pv_4000=t2; b=2") === "a=1; b=2", "and never forwarded to the app");
}

console.log("\npreview paths and headers");
{
  const P = preview.parsePreviewPath;
  check(P("/preview/3000/a/b?x=1").port === "3000" && P("/preview/3000/a/b?x=1").rest === "/a/b?x=1", "the port and the rest are split");
  check(P("/preview/3000").bare === true && P("/preview/3000?x").bare === true, "a bare prefix is redirected to the slash form");
  check(P("/previewx/3000/") === null && P("/other") === null, "other paths are not previews");
  check(preview.isPreviewPath("/preview/3000/") && !preview.isPreviewPath("/previews"), "/previews (the API) is not a preview path");
  const h = preview.forwardRequestHeaders({ host: "agent.example", connection: "keep-alive, x-secret-hop", "x-secret-hop": "1", "keep-alive": "5", te: "trailers", authorization: "Bearer abc", cookie: "agentd_pv_3000=t; app=1", accept: "*/*" }, { port: 3000 });
  check(h.host === "127.0.0.1:3000" && h.accept === "*/*", "the upstream sees itself as host");
  check(!h.connection && !h["keep-alive"] && !h.te && !h["x-secret-hop"], "hop-by-hop headers, and those Connection names, are stripped");
  check(!h.authorization && h.cookie === "app=1", "the admin's bearer and the preview cookie never reach the app");
  const up = preview.forwardRequestHeaders({ connection: "Upgrade", upgrade: "websocket" }, { port: 5173, upgrade: true });
  check(up.connection === "Upgrade" && up.upgrade === "websocket", "a WebSocket upgrade keeps Upgrade/Connection");
  check(preview.rewriteLocation("http://localhost:3000/login", 3000) === "/preview/3000/login", "an absolute redirect to the app stays in the preview");
  check(preview.rewriteLocation("/dash", 3000) === "/preview/3000/dash", "so does a root-relative one");
  check(preview.rewriteLocation("https://accounts.example/x", 3000) === "https://accounts.example/x", "an external redirect is left alone");
  check(preview.rewriteLocation("http://127.0.0.1:9222/json", 3000) === "http://127.0.0.1:9222/json", "a redirect to ANOTHER loopback port is not rewritten into a preview of it");
  const rh = preview.forwardResponseHeaders({ "set-cookie": ["sid=1; Path=/", "x=2", "agentd_pv_3000=forged"], "transfer-encoding": "chunked", location: "/a" }, { port: 3000 });
  check(rh["set-cookie"][0] === "sid=1; Path=/preview/3000/" && /Path=\/preview\/3000\//.test(rh["set-cookie"][1]), "an app's cookies are scoped to its own preview", JSON.stringify(rh["set-cookie"]));
  check(rh["set-cookie"].length === 2, "and an app cannot set agentd's preview cookie");
  check(!rh["transfer-encoding"] && rh.location === "/preview/3000/a", "hop-by-hop response headers go; Location is rewritten");
}

console.log("\nlisting previews from ss");
{
  const ss = [
    'LISTEN 0      511          0.0.0.0:3000       0.0.0.0:*    users:(("node",pid=1234,fd=21))',
    'LISTEN 0      511             [::]:3000          [::]:*    users:(("node",pid=1234,fd=22))',
    'LISTEN 0      511        127.0.0.1:7777       0.0.0.0:*    users:(("node",pid=10,fd=3))',
    'LISTEN 0      5          127.0.0.1:5901       0.0.0.0:*    users:(("x11vnc",pid=11,fd=3))',
    'LISTEN 0      10         127.0.0.1:9222       0.0.0.0:*    users:(("chromium",pid=12,fd=3))',
    "LISTEN 0      128          0.0.0.0:22         0.0.0.0:*",
    "LISTEN 0      128        127.0.0.1:5432       0.0.0.0:*",
    'LISTEN 0      128         10.0.0.5:8080       0.0.0.0:*    users:(("python3",pid=55,fd=3))',
    'LISTEN 0      511            [::1]:5173          [::]:*    users:(("vite",pid=77,fd=19))',
    'LISTEN 0      511        127.0.0.1:4000       0.0.0.0:*    users:(("node",pid=99,fd=19))',
    "garbage line",
  ].join("\n");
  const rows = preview.parseSs(ss, { reserved: new Set([7777, 5901, 9222]) });
  check(rows.map((r) => r.port).join(",") === "3000,4000,5173", "loopback/any listeners this user owns, minus agentd's own", rows.map((r) => r.port).join(","));
  check(rows[0].process === "node" && rows[0].pid === 1234, "with the process and pid");
  check(!rows.some((r) => r.port === 5432), "a socket ss shows no owner for (someone else's) is not listed");
  check(!rows.some((r) => r.port === 8080), "nor one bound to a non-loopback interface");
  const mine = preview.parseSs(ss, { reserved: new Set(), uid: 1000, procUid: (pid) => (pid === 99 ? 0 : 1000) });
  check(!mine.some((r) => r.port === 4000), "a pid owned by another uid is dropped");
  check(preview.startedByFromCwd("/home/agent/.agentd/work/j_abc_12ab34/app") === "job:j_abc_12ab34" && preview.startedByFromCwd("/home/agent/.agentd/work/chats/c_x1/") === "chat:c_x1" && preview.startedByFromCwd("/tmp") === null, "the run that started it is read off its working directory");
}

console.log("\nthe preview flow: link → cookie → proxied request");
{
  const logged = [];
  const pv = new preview.Previews({ signer: new preview.PreviewSigner({ secret: "s" }), publicBase: "https://agent.example/", log: (e) => logged.push(e) });
  const fakeRes = () => {
    const r = { code: 0, headers: {}, body: "" };
    r.writeHead = (c, h) => ((r.code = c), Object.assign(r.headers, h || {}));
    r.end = (b) => (r.body += b || "");
    return r;
  };
  const o = pv.open(3000);
  check(o.url.startsWith("https://agent.example/preview/3000/?agentd_preview=") && o.expiresAt > Date.now(), "preview.open returns a link on the public host and an expiry");
  check(logged[0].kind === "preview" && logged[0].actor === "owner", "opening a preview is logged");
  await throws(async () => pv.open(9222), "the browser debugger can never be previewed", /belongs to agentd/);
  const r1 = fakeRes();
  check(pv.admit({ url: o.path, headers: {} }, r1) === null && r1.code === 302 && r1.headers.Location === "/preview/3000/", "the link sets a cookie and redirects to the clean URL", JSON.stringify(r1.headers));
  const cookie = r1.headers["Set-Cookie"].split(";")[0];
  const r2 = fakeRes();
  check(pv.admit({ url: o.path, headers: {} }, r2) === null && r2.code === 401, "the same link a second time is refused");
  const r3 = fakeRes();
  check(pv.admit({ url: "/preview/3000/x", headers: {} }, r3) === null && r3.code === 401, "no cookie, no preview");
  const ok = pv.admit({ url: "/preview/3000/x?y=1", headers: { cookie } }, fakeRes());
  check(ok && ok.port === 3000 && ok.rest === "/x?y=1", "with the cookie the request is admitted");
  check(pv.admit({ url: "/preview/3001/x", headers: { cookie: cookie.replace("3000", "3001") } }, fakeRes()) === null, "and a cookie for 3000 opens nothing on 3001");

  // A real upstream and a real proxy on loopback.
  const seen = [];
  const upstream = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    if (req.url === "/go") {
      res.writeHead(302, { Location: "/there" });
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "text/plain", "Set-Cookie": "sid=9; Path=/" });
    res.end("hello from the app");
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const port = upstream.address().port;
  const pv2 = new preview.Previews({ signer: new preview.PreviewSigner({ secret: "s2" }), log: () => {} });
  const front = http.createServer((req, res) => pv2.handleHttp(req, res));
  await new Promise((r) => front.listen(0, "127.0.0.1", r));
  const sess = pv2.signer.sign({ port, kind: "session", ttlMs: 60_000 }).token;
  const get = (p, headers = {}) =>
    new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port: front.address().port, path: p, headers }, (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
      }).on("error", reject);
    });
  if (port < 1024) {
    check(true, "(skipped: the OS gave the upstream a privileged port)");
  } else {
    const r = await get(`/preview/${port}/hello?q=1`, { cookie: `agentd_pv_${port}=${sess}; app=1`, authorization: "Bearer admin-token" });
    check(r.status === 200 && r.body === "hello from the app", "the app's page comes back through the proxy");
    check(seen[0].url === "/hello?q=1", "the app sees its own path, without the prefix");
    check(!seen[0].headers.authorization && seen[0].headers.cookie === "app=1", "and none of agentd's credentials");
    check(/Path=\/preview\//.test(String(r.headers["set-cookie"])), "its cookie comes back scoped to the preview");
    const g = await get(`/preview/${port}/go`, { cookie: `agentd_pv_${port}=${sess}` });
    check(g.status === 302 && g.headers.location === `/preview/${port}/there`, "its redirect stays inside the preview");
    const n = await get(`/preview/${port}/hello`);
    check(n.status === 401 && seen.length === 2, "without the cookie the app is never reached");
  }
  upstream.close();
  front.close();
}

/* ---------------------------------------------------------------- oplog */
console.log("\nthe review timeline");
{
  const log = tmpLog();
  const events = [];
  log.onEvent((e) => events.push(e));
  const e = log.record({ actor: "owner", kind: "terminal", summary: "$ export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456", detail: { token: "plain", nested: { line: "Bearer abcdefghijklmnopqrstu" } } });
  check(!/ghp_abcdef/.test(e.summary), "a token in a command line is stored masked", e.summary);
  check(e.detail.token === "••••••••" && !/abcdefghijklmnopqrstu/.test(e.detail.nested.line), "and a value under a secret-named key is dropped");
  check(events.length === 1 && events[0] === e, "every entry is announced (ops.event)");
  check(log.record({ actor: "owner", kind: "nope", summary: "x" }) === null, "an unknown kind is not written");
  check(log.record({ actor: "root; rm -rf /", kind: "desktop", summary: "x" }).actor === "unknown", "an actor that is not a known shape is recorded as unknown");
  check(log.record({ actor: "owner", kind: "approval", summary: "x", decision: "maybe" }).decision === "denied", "a decision that is not one of three words is recorded as denied");
  log.record({ actor: "chat:c_1", kind: "desktop", summary: "Click" });
  log.record({ actor: "job:j_a_000000", kind: "command", summary: "$ ls" });
  check(log.list({ kind: "desktop" }).length === 2, "filtered by kind");
  check(log.list({ actor: "chat:" }).length === 1 && log.list({ actor: "job:j_a_000000" }).length === 1, "by actor, exactly or by prefix");
  check(log.list({ limit: 1 })[0].summary === "$ ls", "newest first, limited");
  check(log.list({ since: new Date(Date.now() + 60_000).toISOString() }).length === 0, "and by time");

  const small = new oplog.OpLog({ file: path.join(fs.mkdtempSync(path.join(HOME, "rot-")), "ops.ndjson"), maxBytes: 600 });
  for (let i = 0; i < 12; i++) small.record({ actor: "owner", kind: "command", summary: `$ echo ${i} ${"x".repeat(60)}` });
  check(fs.existsSync(`${small.file}.1`) && fs.statSync(small.file).size <= 600, "the file rotates at its size cap, one generation kept");
  check(small.readAll().length > 0 && small.list({ limit: 1 })[0].summary.startsWith("$ echo 11"), "and reads span both generations");

  const rec = oplog.approvalRecorder(log);
  rec({ type: "approval.asked", card: { id: "a_1", jobId: "mcp", tool: "Desktop", summary: "Desktop: press Return", input: { action: "key", combo: "Return" } } });
  const ans = rec({ type: "approval.answered", id: "a_1", jobId: "mcp", allow: false, timedOut: true });
  check(ans.actor === "mcp" && ans.kind === "approval" && ans.decision === "denied" && /Timed out: Desktop: press Return/.test(ans.summary), "an approval decision lands on the timeline under its caller", JSON.stringify(ans));
}

/* ---------------------------------------------------------------- terminal */
console.log("\nterminal: output only to its opener");
{
  const L = new terminal.LineCapture();
  check(L.push("ls -la\r").join("|") === "ls -la", "a line is captured on Enter");
  check(L.push("gti\x7f\x7f\x7fgit status\r").join("|") === "git status", "backspace edits it");
  check(L.push("rm -rf x\x03").length === 0 && L.push("echo ok\r")[0] === "echo ok", "Ctrl-C abandons a line");
  check(L.push("\x1b[Aecho \x1bOAhi\r")[0] === "echo hi", "arrow keys are dropped, not logged as text");
  check(L.push("a\rb\nc\r").join("|") === "a|b|c", "a pasted block becomes several lines");

  const env = terminal.shellEnv({ AGENT_MCP_TOKEN: "x", AGENT_ADMIN_EMAILS: "y", PATH: "/bin" });
  check(!env.AGENT_MCP_TOKEN && !env.AGENT_ADMIN_EMAILS && env.PATH === "/bin" && env.DISPLAY === ":1" && env.TERM === "xterm-256color", "the shell's environment loses the daemon's secrets and gains the desktop");
  check(terminal.scriptArgs().join(" ") === "-qfc bash -l /dev/null", "the fallback is script -qfc \"bash -l\" /dev/null");

  const procs = [];
  const fakePty = async () => ({
    spawn: (cmd, args, opts) => {
      const p = { cmd, args, opts, written: [], killed: false, data: [], exit: [] };
      procs.push(p);
      return {
        pid: 4242,
        write: (d) => p.written.push(d),
        resize: (c, r) => (p.size = [c, r]),
        kill: () => (p.killed = true),
        onData: (f) => p.data.push(f),
        onExit: (f) => p.exit.push(f),
      };
    },
  });
  const logged = [];
  const T = new terminal.Terminals({ pty: fakePty, log: (e) => logged.push(e) });
  const ws = (authed = owner()) => ({ readyState: 1, authed, sent: [], send(t) {
    this.sent.push(JSON.parse(t));
  } });
  const a = ws();
  const b = ws();
  await throws(() => T.open(ws(owner({ auth_time: nowSec() - 3600 })), {}), "a stale sign-in cannot open a terminal", /needs a sign-in from the last 30 minutes/);
  const o = await T.open(a, { cols: 100, rows: 30 });
  check(/^t_/.test(o.termId) && o.backend === "node-pty" && o.resizable, "a fresh sign-in opens one");
  check(procs[0].cmd === "bash" && procs[0].args.join(" ") === "-l" && procs[0].opts.cols === 100, "bash -l in a pty of the asked size");
  check(procs[0].opts.cwd === profiles.paths.work, "starting in the workspaces by default");
  procs[0].data.forEach((f) => f("secret output"));
  check(a.sent.some((m) => m.type === "term.output" && m.data === "secret output"), "output reaches the opener");
  check(b.sent.length === 0, "and nobody else");
  await throws(async () => T.input(b, o.termId, "id\r"), "another socket cannot type into it", /No such terminal/);
  await throws(async () => T.close(b, o.termId), "or close it", /No such terminal/);
  T.input(a, o.termId, "echo GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234\r");
  const line = logged.find((e) => e.summary.startsWith("$ echo"));
  check(line && line.kind === "terminal" && line.actor === "owner", "each command line is logged");
  check(procs[0].written.at(-1).startsWith("echo GITHUB"), "and still reaches the shell unchanged");
  check(T.resize(a, o.termId, 120, 40).resized && procs[0].size.join("x") === "120x40", "resize reaches the pty");
  await throws(async () => T.input(a, o.termId, "x".repeat(70_000)), "an oversized paste is refused", /too large/);
  await throws(() => T.open(a, { cwd: path.join(HOME, "does-not-exist") }), "a missing cwd is refused", /does not exist/);
  for (let i = 0; i < terminal.MAX_PER_SOCKET - 1; i++) await T.open(a, {});
  await throws(() => T.open(a, {}), "terminals per window are capped", /At most 4/);
  check(T.closeAll(a) === terminal.MAX_PER_SOCKET && procs.slice(0, 4).every((p) => p.killed), "a closed socket kills every shell it opened");
  check(T.terms.size === 0, "and nothing is left behind");

  const F = new terminal.Terminals({
    pty: async () => null,
    log: () => {},
    spawnFn: (cmd, args) => {
      const { EventEmitter } = events;
      const c = new EventEmitter();
      c.cmd = cmd;
      c.args = args;
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.stdin = { writable: true, write: () => true };
      c.kill = () => true;
      F.lastChild = c;
      return c;
    },
  });
  const fo = await F.open(ws(), {});
  check(fo.backend === "script" && F.lastChild.cmd === "script" && F.lastChild.args.join(" ") === "-qfc bash -l /dev/null", "without node-pty it falls back to script");
  check(F.resize(F.terms.get(fo.termId).ws, fo.termId, 80, 24).resized === false, "and says it cannot resize");
}

/* ---------------------------------------------------------------- mcp-desktop + runner */
console.log("\nthe desktop MCP server forwards, it never acts");
{
  check(["screenshot", "click", "double_click", "move", "type", "key", "scroll", "open_url", "list_windows", "focus_window"].every((n) => mcpDesktop.TOOLS.some((t) => t.name === n)), "it offers every action and both looks");
  const none = await mcpDesktop.callDesktop("click", { x: 1, y: 1 }, { endpoint: "", token: "", caller: "" });
  check(none.isError && /not wired/.test(none.content[0].text), "unwired, it refuses");
  const sent = [];
  const f = (body) => async (url, opts) => (sent.push({ url, opts }), { ok: true, json: async () => body });
  const opt = { endpoint: "http://127.0.0.1:7777/internal/desktop", token: "jt", caller: "j_a_000000" };
  await mcpDesktop.callDesktop("click", { x: 3, y: 4 }, { ...opt, fetchFn: f({ ok: true }) });
  const body = JSON.parse(sent[0].opts.body);
  check(sent[0].opts.headers.Authorization === "Bearer jt" && body.callerId === "j_a_000000" && body.action.action === "click" && body.action.x === 3, "it posts the action to agentd with the run's secret");
  const shot = await mcpDesktop.callDesktop("screenshot", {}, { ...opt, fetchFn: f({ png: "iVBOR", width: 1600, height: 900 }) });
  check(shot.content[0].type === "image" && shot.content[0].mimeType === "image/png", "a screenshot comes back as an image");
  const den = await mcpDesktop.callDesktop("key", { combo: "Return" }, { ...opt, fetchFn: f({ denied: true, reason: "Denied." }) });
  check(den.isError && /Refused/.test(den.content[0].text), "a refusal is an error the model can read");
  const cfg = mcpDesktop.mcpDesktopConfig({ desktopUrl: "http://127.0.0.1:7777/internal/desktop", callerId: "c_1", token: "tk" });
  check(cfg.command === process.execPath && cfg.args[0].endsWith("mcp-desktop.js") && cfg.env.AGENTD_JOB_TOKEN === "tk", "mcpDesktopConfig points node at the bridge with the run's secret");
  const pw = mcpDesktop.playwrightMcpConfig();
  check(pw.args.includes("--cdp-endpoint") && pw.args[pw.args.indexOf("--cdp-endpoint") + 1] === "http://127.0.0.1:9222", "playwrightMcpConfig attaches to the desktop's own browser");
  const m = runner.mcpConfigFor({ bridge: "/b.js", approveUrl: "http://127.0.0.1:7777/internal/approve", jobId: "j_a_000000", jobToken: "jt", site: null, desktop: true });
  check(m.mcpServers.desktop?.env.AGENTD_DESKTOP_URL === "http://127.0.0.1:7777/internal/desktop", "a run's MCP config carries the desktop bridge beside the approval bridge");
  check(!runner.mcpConfigFor({ bridge: "/b.js", approveUrl: "u", jobId: "j", jobToken: "t", site: null, desktop: false }).mcpServers.desktop, "and leaves it out when the desktop is switched off");
}

/* ---------------------------------------------------------------- api.js */
console.log("\nthe HTTP API the site's MCP tools call");
{
  check(api.matchRoute("GET", "/desktop/screenshot")?.name === "desktopScreenshot" && api.matchRoute("POST", "/desktop/action")?.name === "desktopAction", "desktop routes match");
  check(api.matchRoute("GET", "/previews")?.name === "previews" && api.matchRoute("GET", "/ops?since=2026-10-10T00:00:00Z&kind=desktop")?.query.kind === "desktop", "previews and ops match, with the query");
  check(api.isApiPath("/desktop/action") && api.isApiPath("/ops?x") && api.isApiPath("/previews"), "they are API paths");
  check(!api.isApiPath("/desktop") && !api.isApiPath("/desktop?ticket=x") && !api.isApiPath("/preview/3000/"), "but the VNC socket and the previews themselves are not");
  const png = Buffer.alloc(30, 1);
  const out = { headers: null, body: null, code: 0 };
  const res = { writeHead: (c, h) => ((out.code = c), (out.headers = h)), end: (b) => (out.body = b) };
  await api.handleApi({ method: "GET", url: "/desktop/screenshot", headers: { authorization: "Bearer t" } }, res, { verifyToken: async () => ({}), ops: {}, workbench: { screenshot: async () => ({ png, width: 1600, height: 900 }) } });
  check(out.code === 200 && out.headers["Content-Type"] === "image/png" && out.body === png, "GET /desktop/screenshot answers PNG bytes");
  let q = null;
  await api.handleApi({ method: "GET", url: "/ops?actor=mcp&limit=5", headers: {} }, res, { verifyToken: async () => ({}), ops: {}, workbench: { ops: (x) => ((q = x), { ops: [] }) } });
  check(q.actor === "mcp" && q.limit === "5", "GET /ops passes its filters through");
  await api.handleApi({ method: "GET", url: "/previews", headers: {} }, res, { verifyToken: async () => {
    throw Object.assign(new Error("No token."), { status: 401 });
  }, ops: {}, workbench: {} });
  check(out.code === 401, "and nothing answers without the owner's token");
}

/* ---------------------------------------------------------------- workbench end to end */
console.log("\nwebsockify: ticketed /desktop, view-only enforced, bytes both ways");
{
  const log = tmpLog();
  const fakeDesktop = { screenshot: async () => ({ png: Buffer.alloc(0), width: 1, height: 1 }), act: async () => ({}) };
  const wb = createWorkbench({ approvals: { ask: async () => ({ allow: false, reason: "no" }) }, broadcast: () => {}, log, desktop: fakeDesktop, callerFor: (id) => (id === "j_a_000000" ? { token: "secret-1", policy: "allowlist" } : null) });
  const server = http.createServer(async (req, res) => {
    if (await wb.handleHttp(req, res)) return;
    res.writeHead(404);
    res.end();
  });
  const main = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (wb.claimsUpgrade(req.url)) return wb.handleUpgrade(req, socket, head);
    main.handleUpgrade(req, socket, head, (ws) => ws.close());
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `ws://127.0.0.1:${server.address().port}`;

  const replies = [];
  const panel = { authed: owner(), readyState: 1 };
  await wb.handleSocket(panel, { type: "desktop.ticket" }, (m) => replies.push(m));
  const t = replies[0];
  check(t.type === "desktop.ticket" && t.path === "/desktop" && t.viewOnly === true, "desktop.ticket answers a view-only ticket");
  await throws(() => wb.handleSocket({ authed: owner({ auth_time: nowSec() - 7200 }), readyState: 1 }, { type: "desktop.ticket", viewOnly: false }, () => {}), "taking control needs a fresh sign-in", /Taking control of the desktop needs a sign-in/);

  const refused = await new Promise((resolve) => {
    const c = new WebSocket(`${base}/desktop?ticket=wrong`, ["binary"]);
    c.on("unexpected-response", (_req, res) => resolve(res.statusCode));
    c.on("open", () => resolve("opened"));
    c.on("error", () => {});
  });
  check(refused === 401, "a wrong ticket gets 401 and no socket", String(refused));

  vncSeen.length = 0;
  const client = new WebSocket(`${base}/desktop?ticket=${t.ticket}`, ["binary"]);
  const got = [];
  client.on("message", (d) => got.push(Buffer.from(d)));
  await new Promise((r) => client.on("open", r));
  check(client.protocol === "binary", "the binary subprotocol is chosen");
  await tick(60);
  check(Buffer.concat(got).toString("latin1") === "RFB 003.008\n", "the VNC server's greeting arrives as binary");
  const hs = Buffer.concat([Buffer.from("RFB 003.008\n"), Buffer.from([1, 1])]);
  const fbur = Buffer.from([3, 1, 0, 0, 0, 0, 6, 64, 3, 132]);
  const key = Buffer.from([4, 1, 0, 0, 0, 0, 0, 0x61]);
  client.send(Buffer.concat([hs, key, fbur]));
  await tick(80);
  check(Buffer.concat(vncSeen).equals(Buffer.concat([hs, fbur])), "a view-only viewer's keystroke never reaches x11vnc", Buffer.concat(vncSeen).toString("hex"));
  client.close();
  await tick(40);
  const again = await new Promise((resolve) => {
    const c = new WebSocket(`${base}/desktop?ticket=${t.ticket}`, ["binary"]);
    c.on("unexpected-response", (_req, res) => resolve(res.statusCode));
    c.on("open", () => resolve("opened"));
    c.on("error", () => {});
  });
  check(again === 401, "the same ticket does not open a second connection");

  const r2 = [];
  await wb.handleSocket(panel, { type: "desktop.ticket", viewOnly: false }, (m) => r2.push(m));
  vncSeen.length = 0;
  const ctl = new WebSocket(`${base}/desktop?ticket=${r2[0].ticket}`, ["binary"]);
  await new Promise((r) => ctl.on("open", r));
  ctl.send(Buffer.concat([hs, key]));
  await tick(80);
  check(Buffer.concat(vncSeen).equals(Buffer.concat([hs, key])), "a fresh-sign-in controller's keystroke does");
  ctl.close();
  await tick(40);
  check(log.list({ kind: "desktop" }).some((e) => /Took control/.test(e.summary)), "taking control is on the timeline");

  // The loopback bridge for runs' MCP servers.
  const post = (body, token, p = "/internal/desktop") =>
    new Promise((resolve) => {
      const req = http.request({ host: "127.0.0.1", port: server.address().port, path: p, method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }, (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(b || "{}") }));
      });
      req.end(JSON.stringify(body));
    });
  check((await post({ callerId: "j_a_000000", action: { action: "list_windows" } }, "wrong")).status === 403, "the bridge refuses a run's id with the wrong secret");
  check((await post({ callerId: "j_unknown_000000", action: { action: "list_windows" } }, "secret-1")).status === 403, "or an unknown run");
  const lw = await post({ callerId: "j_a_000000", action: { action: "list_windows" } }, "secret-1");
  check(lw.status === 200 && lw.json.ok, "with the right secret a look goes through");
  const den = await post({ callerId: "j_a_000000", action: { action: "click", x: 1, y: 1 } }, "secret-1");
  check(den.status === 200 && den.json.denied === true, "and a click is put to the owner (here: refused)");
  const badAction = await post({ callerId: "j_a_000000", action: { action: "key", combo: "a;b" } }, "secret-1");
  check(badAction.status === 400, "a malformed action is a 400, never a spawn");
  const fake = { url: "/internal/desktop", method: "POST", headers: {}, socket: { remoteAddress: "203.0.113.9" } };
  const fr = { code: 0, writeHead(c) {
    this.code = c;
  }, end() {} };
  await wb.handleHttp(fake, fr);
  check(fr.code === 403, "and it answers on loopback only");

  // The rest of the socket surface.
  const sock = [];
  await wb.handleSocket(panel, { type: "ops.list", kind: "desktop" }, (m) => sock.push(m));
  check(sock[0].type === "ops" && Array.isArray(sock[0].ops) && sock[0].ops.every((e) => e.kind === "desktop"), "ops.list answers the filtered timeline");
  check((await wb.handleSocket(panel, { type: "jobs" }, () => {})) === false, "and the workbench leaves other messages to the daemon");
  const ops = wb.api.ops({ kind: "approval" });
  check(Array.isArray(ops.ops) && typeof ops.count === "number", "the API's ops view has the same shape");
  await throws(() => wb.api.action({ action: "click", x: 1, y: 1 }), "a site-MCP click that is not approved is a refusal, not a silent no-op", /Refused/);

  server.close();
  main.close();
}

/* ---------------------------------------------------------------- stream mode */
console.log("\nthe screenshot stream: JPEG fitted to the pane, the real screen size beside it");
{
  const jpeg = (w, h) => {
    const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0"), Buffer.alloc(9)]);
    const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
  };
  check(JSON.stringify(desktop.jpegSize(jpeg(800, 450))) === JSON.stringify({ height: 450, width: 800 }), "jpegSize reads the frame header");
  check(desktop.jpegSize(Buffer.from("nope")) === null && desktop.jpegSize(desktop.PNG_MAGIC) === null, "and refuses anything that is not a JPEG");

  const S = desktop.assertShotOptions;
  check(S().format === "png" && S({}).format === "png", "no options is the full PNG it always was");
  const j = S({ scale: 0.5 });
  check(j.format === "jpeg" && j.scale === 0.5 && j.quality === 70, "asking for a scale means a JPEG at quality 70");
  check(S({ format: "jpeg" }).scale === 1, "a JPEG with no scale is full size");
  check(S({ scale: 0.25 }).scale === 0.25 && S({ scale: 1 }).scale === 1, "0.25 and 1 are the bounds, inclusive");
  await throws(async () => S({ scale: 0.2 }), "a scale below 0.25 is refused", /scale must be a number from 0.25 to 1/);
  await throws(async () => S({ scale: 1.5 }), "a scale above 1 is refused", /scale must be/);
  await throws(async () => S({ scale: "0.5" }), "a scale given as a string is refused", /scale must be/);
  await throws(async () => S({ scale: NaN }), "NaN is not a scale", /scale must be/);
  await throws(async () => S({ quality: 101 }), "a quality over 95 is refused", /quality must be/);
  await throws(async () => S({ quality: 70.5 }), "a fractional quality is refused", /quality must be/);
  await throws(async () => S({ format: "png", scale: 0.5 }), "PNG with a scale is refused, not silently ignored", /JPEG screenshot only/);
  await throws(async () => S({ format: "gif" }), "an unknown format is refused", /png or jpeg/);
  check(desktop.screenshotArgs(S({ scale: 0.375, quality: 60 })).join(" ") === "-window root -resize 37.5% -quality 60 jpeg:-", "the JPEG argv resizes by percent and sets the quality");
  check(desktop.screenshotArgs(S({ format: "jpeg" })).join(" ") === "-window root -quality 70 jpeg:-", "and does not resize at full size");
  check(desktop.screenshotArgs(S()).join(" ") === "-window root png:-", "the PNG argv is unchanged");

  const calls = [];
  const d = new desktop.Desktop({
    run: async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "import") return jpeg(800, 450);
      if (cmd === "xdotool" && args[0] === "getdisplaygeometry") return Buffer.from("1600 900\n");
      return Buffer.alloc(0);
    },
    probe: async () => false,
    fetchFn: async () => ({ ok: true }),
  });
  const shot = await d.screenshot({ scale: 0.5, quality: 70 });
  check(shot.mime === "image/jpeg" && shot.imageWidth === 800 && shot.imageHeight === 450, "a scaled shot is a JPEG of the scaled size");
  check(shot.width === 1600 && shot.height === 900, "and carries the SCREEN's size, so a click maps back to real pixels", `${shot.width}x${shot.height}`);
  await d.screenshot({ scale: 0.5 });
  check(calls.filter((c) => c.args[0] === "getdisplaygeometry").length === 1, "the screen size is asked once and remembered");
  const blind = new desktop.Desktop({ run: async (cmd) => (cmd === "import" ? jpeg(400, 225) : Promise.reject(new Error("no xdotool"))) });
  const guessed = await blind.screenshot({ scale: 0.25 });
  check(guessed.width === 1600 && guessed.height === 900, "without xdotool the size is the image's undone by the scale");
  const notJpeg = new desktop.Desktop({ run: async () => Buffer.from("<html>") });
  await throws(() => notJpeg.screenshot({ scale: 0.5 }), "a JPEG request answered with something else is refused", /not a JPEG/);

  const st = await d.status();
  check(st.display === "up" && st.vnc === "down" && st.browser === "up", "status: display up, nothing on 5901 means vnc down, CDP answering means browser up", JSON.stringify(st));
  const dead = new desktop.Desktop({ run: async () => Promise.reject(new Error("no display")), probe: async () => true, fetchFn: async () => Promise.reject(new Error("refused")) });
  const st2 = await dead.status();
  check(st2.display === "down" && st2.vnc === "up" && st2.browser === "down", "and each probe fails on its own without throwing", JSON.stringify(st2));
  const closed = net.createServer();
  await new Promise((r) => closed.listen(0, "127.0.0.1", r));
  const closedPort = closed.address().port;
  await new Promise((r) => closed.close(r));
  check((await desktop.probePort(closedPort, { timeoutMs: 500 })) === false, "probePort answers false for a closed port");
  const open = net.createServer((sock) => sock.on("error", () => {}));
  await new Promise((r) => open.listen(0, "127.0.0.1", r));
  check((await desktop.probePort(open.address().port)) === true, "and true for a listening one");
  open.close();
}

console.log("\nthe owner drives over the socket: desktop.action");
{
  const log = tmpLog();
  const acted = [];
  const fakeDesktop = {
    screenshot: async (o = {}) => ({ image: Buffer.from([0xff, 0xd8, 1, 2]), format: o.scale ? "jpeg" : "png", mime: o.scale ? "image/jpeg" : "image/png", width: 1600, height: 900, imageWidth: 800, imageHeight: 450, scale: o.scale || 1 }),
    status: async () => ({ display: "up", vnc: "down", browser: "up" }),
    act: async (a) => (acted.push(a), a.action === "open_url" ? { tabId: "T1", url: a.url } : {}),
  };
  const wb = createWorkbench({ approvals: { ask: async () => ({ allow: false, reason: "no" }) }, log, desktop: fakeDesktop });
  const fresh = { authed: owner(), readyState: 1 };
  const stale = { authed: owner({ auth_time: nowSec() - 7200 }), readyState: 1 };
  const r = [];
  const say = (m) => r.push(m);

  await wb.handleSocket(fresh, { type: "desktop.action", action: "click", x: 812, y: 440 }, say);
  check(r[0]?.type === "desktop.acted" && r[0].action === "click" && typeof r[0].at === "number", "desktop.action answers desktop.acted {action, at}", JSON.stringify(r[0]));
  check(acted[0] && acted[0].x === 812 && acted[0].y === 440 && acted[0].button === "left", "and drives the desktop with the validated shape");
  check(!("type" in acted[0]), "the socket message's own type never reaches the action");
  const entry = log.list({ kind: "desktop" })[0];
  check(entry?.actor === "owner" && entry.kind === "desktop" && /Click left at \(812, 440\)/.test(entry.summary), "it is on the timeline as the owner, kind desktop", JSON.stringify(entry));
  check(entry && entry.decision === undefined, "with no gate decision: the owner was not asked");

  await wb.handleSocket(fresh, { type: "desktop.action", action: "click", x: 5, y: 6, button: "right" }, say);
  await wb.handleSocket(fresh, { type: "desktop.action", action: "double_click", x: 5, y: 6 }, say);
  await wb.handleSocket(fresh, { type: "desktop.action", action: "key", combo: "ctrl+l" }, say);
  await wb.handleSocket(fresh, { type: "desktop.action", action: "scroll", direction: "down", amount: 3 }, say);
  await wb.handleSocket(fresh, { type: "desktop.action", action: "open_url", url: "https://ravikishan.me/blog" }, say);
  check(acted.map((a) => a.action).join(",") === "click,click,double_click,key,scroll,open_url", "right-click, double-click, keys, scroll and Open URL all go through");
  check(acted[1].button === "right", "a right-click keeps its button");
  check(r[r.length - 1].result?.tabId === "T1", "open_url's result rides along");
  const urlEntry = log.list({ actor: "owner" })[0];
  check(urlEntry.kind === "desktop" && /Open https:\/\/ravikishan\.me\/blog/.test(urlEntry.summary), "an owner's Open URL is logged as a desktop action too");

  const before = acted.length;
  await throws(() => wb.handleSocket(stale, { type: "desktop.action", action: "click", x: 1, y: 1 }, say), "driving needs a sign-in from the last 30 minutes", /Driving the desktop needs a sign-in/);
  let status = 0;
  try {
    await wb.handleSocket(stale, { type: "desktop.action", action: "click", x: 1, y: 1 }, say);
  } catch (e) {
    status = e instanceof auth.AuthError ? e.status : -1;
  }
  check(status === 403, "and the refusal is a 403 AuthError the panel can step up from", String(status));
  await throws(() => wb.handleSocket({ authed: owner({ auth_time: undefined }), readyState: 1 }, { type: "desktop.action", action: "key", combo: "Return" }, say), "a token with no auth_time cannot drive", /needs a sign-in/);
  check(acted.length === before, "a refused drive never reaches xdotool");
  check(!log.list({ actor: "owner" }).some((e) => /\(1, 1\)/.test(e.summary)), "and is not logged as done");

  await throws(() => wb.handleSocket(fresh, { type: "desktop.action", action: "key", combo: "a;rm -rf /" }, say), "a combo that is not a combo is refused", /not a key combo/);
  await throws(() => wb.handleSocket(fresh, { type: "desktop.action", action: "click", x: -1, y: 4 }, say), "a negative coordinate is refused", /x must be a whole number/);
  await throws(() => wb.handleSocket(fresh, { type: "desktop.action", action: "click", x: 1.5, y: 4 }, say), "a fractional coordinate is refused", /x must be a whole number/);
  await throws(() => wb.handleSocket(fresh, { type: "desktop.action", action: "click", x: 10, y: true }, say), "a boolean coordinate is refused", /y must be a whole number/);
  await throws(() => wb.handleSocket(fresh, { type: "desktop.action", action: "click", x: 10 }, say), "a missing coordinate is refused", /y must be a whole number/);
  await throws(() => wb.handleSocket(fresh, { type: "desktop.action", action: "click", x: 10001, y: 4 }, say), "a coordinate past 10000 is refused", /x must be a whole number/);
  await throws(() => wb.handleSocket(fresh, { type: "desktop.action", action: "click", x: 1, y: 1, button: "both" }, say), "an unknown button is refused", /button must be/);
  await throws(() => wb.handleSocket(fresh, { type: "desktop.action", action: "type", text: "a\u0007b" }, say), "typed text with a control character is refused", /control characters/);
  await throws(() => wb.handleSocket(fresh, { type: "desktop.action", action: "open_url", url: "javascript:alert(1)" }, say), "a javascript: URL is refused", /Only http and https/);
  await throws(() => wb.handleSocket(fresh, { type: "desktop.action", action: "screenshot" }, say), "a look is not an action: screenshot is refused here", /use desktop.screenshot/);
  await throws(() => wb.handleSocket(fresh, { type: "desktop.action", action: "rm" }, say), "an unknown action is refused", /not a desktop action/);
  check(acted.length === before, "and none of those reached the desktop");

  await wb.handleSocket(fresh, { type: "desktop.action", action: "type", text: "export TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789" }, say);
  const typed = log.list({ actor: "owner" })[0];
  check(!/ghp_abcdefghijklmnopqrstuvwxyz0123456789/.test(JSON.stringify(typed)), "what the owner types is redacted on the timeline", JSON.stringify(typed).slice(0, 160));

  const flog = tmpLog();
  const failing = createWorkbench({ approvals: null, log: flog, desktop: { ...fakeDesktop, act: async () => Promise.reject(new desktop.DesktopError("xdotool failed (1)", 502)) } });
  await throws(() => failing.handleSocket(fresh, { type: "desktop.action", action: "key", combo: "Return" }, say), "a failed action is reported, not swallowed", /xdotool failed/);
  const fe = flog.list({ actor: "owner" })[0];
  check(fe && /failed/.test(fe.summary) && /xdotool failed/.test(fe.detail?.error || ""), "and the timeline says it failed", JSON.stringify(fe).slice(0, 160));

  const shots = [];
  await wb.handleSocket(stale, { type: "desktop.screenshot", scale: 0.5, quality: 70 }, (m) => shots.push(m));
  const s = shots[0];
  check(s.type === "desktop.screenshot" && s.mime === "image/jpeg" && s.format === "jpeg" && typeof s.data === "string" && !s.png, "desktop.screenshot with a scale answers a JPEG (watching needs no fresh sign-in)");
  check(s.width === 1600 && s.height === 900 && s.imageWidth === 800 && s.imageHeight === 450 && s.scale === 0.5, "with the screen size and the image size, for mapping clicks", JSON.stringify({ w: s.width, iw: s.imageWidth }));
  await wb.handleSocket(fresh, { type: "desktop.screenshot" }, (m) => shots.push(m));
  check(shots[1].mime === "image/png" && shots[1].png === shots[1].data, "without options it is still the PNG (with png for older panels)");
  const sts = [];
  await wb.handleSocket(fresh, { type: "desktop.status" }, (m) => sts.push(m));
  check(sts[0].type === "desktop.status" && sts[0].vnc === "down" && sts[0].display === "up" && sts[0].browser === "up", "desktop.status answers display, vnc and browser");
}

console.log("\nterminal over the workbench socket");
{
  const wb = createWorkbench({
    approvals: null,
    log: tmpLog(),
    desktop: { screenshot: async () => ({}), act: async () => ({}) },
    terminals: new terminal.Terminals({
      log: () => {},
      pty: async () => ({ spawn: () => ({ pid: 1, write() {}, resize() {}, kill() {}, onData: (f) => setTimeout(() => f("$ "), 5), onExit() {} }) }),
    }),
  });
  const sent = [];
  const opener = { authed: owner(), readyState: 1, send: (t) => sent.push(JSON.parse(t)) };
  const r = [];
  await wb.handleSocket(opener, { type: "term.open", cols: 80, rows: 24 }, (m) => r.push(m));
  check(r[0].type === "term.opened" && /^t_/.test(r[0].termId), "term.open answers term.opened {termId}");
  await tick(20);
  check(sent.some((m) => m.type === "term.output" && m.termId === r[0].termId), "term.output goes to the opener's socket");
  wb.onSocketClose(opener);
  check(wb.terminals.terms.size === 0, "and the terminal dies with it");
}

vnc.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("FAILURES:");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
process.exit(0);
