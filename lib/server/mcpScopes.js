// The MCP scope catalogue. PURE and browser-safe: mcpToken.js (which needs
// node's crypto) re-exports it for the server, and the OAuth consent page
// imports it directly, so the scopes the server will honour, the scopes the
// discovery document advertises and the scopes a human is offered on the
// consent screen are one list and cannot drift apart.

export const SCOPES = {
  read: "Read site content, résumé metadata, jobs, posts, links, contacts and vault listings",
  write: "Create and update content, jobs, posts and links",
  vault: "Read vault document metadata and mint download links",
  // Deliberately separate from read/write. A token holding this is equivalent
  // to the passwords it can read, so it is never implied by anything else —
  // every token minted before this scope existed cannot touch the secret
  // store at all, and granting it has to be a decision someone makes.
  secrets: "Read and write stored passwords and API keys (only those marked readable by agents)",
  // Starting a coding run on the agent server and answering its approval
  // cards. Implied by nothing, for the same reason as `secrets`: an approval
  // is the human check on code running on the owner's machine, and the token
  // every job is handed holds write — so with write, a job could approve
  // itself.
  agent: "Start runs on the agent server and answer their approval requests (the human gate)",
};

export const ALL_SCOPES = Object.keys(SCOPES);

// Never pre-ticked anywhere a human grants a token — the admin's MCP tab and
// the OAuth consent screen — even when a client asks for them. Each carries
// the one-line reason it is dangerous, shown beside the checkbox.
export const DANGEROUS_SCOPES = {
  secrets: "Equivalent to the passwords it can read.",
  agent: "Can say yes to code running on your server. Never give it to AGENT_MCP_TOKEN.",
};

export const isDangerousScope = (s) => Object.prototype.hasOwnProperty.call(DANGEROUS_SCOPES, s);

// What the consent screen ticks before the human touches it: whatever safe
// scopes the client asked for, read when it asked for none it may have, and
// never a dangerous one.
export function consentDefaults(requested) {
  const asked = String(Array.isArray(requested) ? requested.join(" ") : requested || "")
    .split(/[\s+,]+/)
    .filter(Boolean);
  const safe = [...new Set(asked)].filter((s) => ALL_SCOPES.includes(s) && !isDangerousScope(s));
  return safe.length ? safe : ["read"];
}
