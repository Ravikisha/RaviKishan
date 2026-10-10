// Is this box actually able to run a job? Answers before you find out the
// hard way, halfway through one.
//
//   npm run doctor
import { execFileSync } from "child_process";
import fs from "fs";
import { paths, listProfiles } from "./profiles.js";
import { allowedEmails, projectId } from "./auth.js";
import { LIMITS } from "./sessions.js";

const ok = (s) => console.log(`  \x1b[32mOK\x1b[0m  ${s}`);
const no = (s) => {
  console.log(`  \x1b[31mXX\x1b[0m  ${s}`);
  failed++;
};
let failed = 0;

const has = (bin, args = ["--version"]) => {
  try {
    return execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0];
  } catch (_) {
    return null;
  }
};

console.log("\ntools");
for (const [bin, why] of [
  ["git", "cloning repositories"],
  ["claude", "running Claude Code"],
  ["gh", "opening pull requests"],
]) {
  const v = has(bin);
  v ? ok(`${bin} — ${v}`) : no(`${bin} is missing — needed for ${why}`);
}
const codex = has("codex");
codex ? ok(`codex — ${codex}`) : console.log("  --  codex is not installed (optional)");

console.log("\ndirectories");
for (const [name, dir] of Object.entries(paths)) {
  if (!fs.existsSync(dir)) {
    no(`${name}: ${dir} does not exist`);
    continue;
  }
  const mode = (fs.statSync(dir).mode & 0o777).toString(8);
  // These hold credentials and checked-out source. Anything group- or
  // world-readable is a problem on a shared box.
  mode === "700" ? ok(`${name}: ${dir} (0700)`) : no(`${name}: ${dir} is mode ${mode}, expected 700`);
}

console.log("\nprofiles");
const profiles = listProfiles();
if (!profiles.length) {
  no("no profiles yet — run `claude auth login` with CLAUDE_CONFIG_DIR set, or add one from the panel");
} else {
  for (const p of profiles) {
    const signed = [p.claude && "claude", p.codex && "codex"].filter(Boolean);
    signed.length
      ? ok(`${p.name}: signed in for ${signed.join(", ")}`)
      : no(`${p.name}: no credentials — it exists but nothing is signed in`);
  }
}

console.log("\naccess");
const emails = allowedEmails();
emails.length ? ok(`allowed: ${emails.join(", ")}`) : no("AGENT_ADMIN_EMAILS is empty — nobody could drive this");
ok(`firebase project: ${projectId()}`);
// A daemon listening on a public interface is the one misconfiguration that
// turns this from a private tool into an open remote-execution service.
const host = process.env.AGENT_HOST || "127.0.0.1";
host === "127.0.0.1" || host === "localhost"
  ? ok(`binding to ${host} — reachable only through the tunnel`)
  : no(`binding to ${host} — this exposes agentd directly; it should be 127.0.0.1 behind Cloudflare Tunnel`);

// --- desktop ---
// The workbench's desktop, terminal and previews. Nothing here is required
// for jobs, so a missing piece is a warning line — except a desktop port bound
// beyond loopback, which is a real problem.
console.log("\ndesktop");
const warn = (s) => console.log(`  \x1b[33m--\x1b[0m  ${s}`);
const which = (bin) => {
  try {
    return execFileSync("sh", ["-c", 'command -v "$1"', "sh", bin], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (_) {
    return "";
  }
};
for (const [bin, why] of [
  ["Xvfb", "the virtual display"],
  ["x11vnc", "viewing the desktop"],
  ["xdotool", "desktop actions"],
  ["import", "screenshots (ImageMagick)"],
  ["xfce4-session", "the desktop session"],
  ["dbus-launch", "starting XFCE under Xvfb"],
  ["ss", "listing previews"],
  ["script", "the terminal fallback when node-pty is absent"],
]) {
  which(bin) ? ok(`${bin} — ${why}`) : warn(`${bin} is missing — needed for ${why}`);
}
const browserBin = which("chromium-browser") || which("chromium") || which("google-chrome");
browserBin ? ok(`browser — ${browserBin}`) : warn("no chromium-browser/chromium — the desktop has no browser");
try {
  await import("node-pty");
  ok("node-pty — terminals can be resized");
} catch (_) {
  warn("node-pty is not built — terminals fall back to `script` (no resize)");
}
for (const unit of ["agentd-desktop", "agentd-vnc", "agentd-browser"]) {
  let state = "";
  try {
    state = execFileSync("systemctl", ["is-active", unit], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (e) {
    state = String(e.stdout || "").trim();
  }
  state === "active" ? ok(`${unit}.service is active`) : warn(`${unit}.service is ${state || "not installed"}`);
}
let listening = "";
try {
  listening = execFileSync("ss", ["-tlnH"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch (_) {}
for (const [port, what] of [
  [Number(process.env.AGENT_VNC_PORT || 5901), "VNC"],
  [Number(process.env.AGENT_CDP_PORT || 9222), "the browser's debugger"],
]) {
  const rows = listening.split("\n").filter((l) => (l.trim().split(/\s+/)[3] || "").endsWith(`:${port}`));
  if (!rows.length) {
    warn(`nothing listens on ${port} (${what})`);
    continue;
  }
  // Both carry the whole desktop with no password: reachable only through
  // agentd, or they are an open remote desktop.
  const open = rows.map((l) => l.trim().split(/\s+/)[3]).filter((a) => !/^(127\.\d+\.\d+\.\d+|\[::1\]|::1)(%\w+)?:\d+$/.test(a));
  open.length ? no(`${what} on ${port} is bound beyond loopback: ${open[0]}`) : ok(`${what} on ${port} — loopback only`);
}
// --- /desktop ---

console.log("\nlimits");
ok(`${LIMITS.global} concurrent, ${LIMITS.perProfile} per profile, ${LIMITS.perDay} per day`);
if (LIMITS.perDay > 200) no("the daily cap is very high — it is a cap on spend as much as on load");

console.log(failed ? `\n${failed} problem(s).\n` : "\nReady.\n");
process.exit(failed ? 1 : 0);
