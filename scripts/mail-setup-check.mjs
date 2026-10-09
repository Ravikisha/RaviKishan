// What still has to be done in a console before a mailbox can be connected.
//
//   npm run mail:setup
//
// Connecting a mailbox needs three things that live outside this repository:
// an OAuth client, an API enabled on it, and the callback URL registered
// character for character. Only the first is visible from here, so this says
// what it can prove and names the rest as a checklist rather than guessing.
//
// It prints no secret -- only whether a value is present, and the public
// client id, which is compiled into every consent URL anyway.
import fs from "fs";
import path from "path";

for (const f of [".env.local", ".env"]) {
  const p = path.resolve(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const { hydrateEnv } = await import("../lib/server/envStore.js");
await hydrateEnv().catch((e) => console.log(`  (sealed store unreadable: ${e.message})`));

const { providerConfig, getProvider, authorizeUrl } = await import("../lib/server/integrations.js");

const ORIGINS = [
  "https://www.ravikishan.me",
  "https://ravikishan.me",
  "https://localhost:3443",
  "http://localhost:3000",
];

for (const id of ["gmail", "outlook"]) {
  const p = getProvider(id);
  const cfg = providerConfig(id);
  console.log(`\n${p.label}`);
  console.log(`  client     ${cfg.configured ? "present" : `MISSING ${cfg.missing.join(", ")}`}`);
  if (cfg.configured) {
    // Public by definition: it is in the query string of every consent URL.
    console.log(`  client id  ${String(cfg.clientId || "").slice(0, 28)}…`);
    console.log(`  borrowed   ${cfg.borrowed ? `yes, from ${p.borrowsFrom.id}` : "no, its own"}`);
  }
  console.log(`  scopes     ${p.scopes.join("\n             ")}`);
  console.log("  register this callback on the client, for EVERY origin:");
  for (const o of ORIGINS) console.log(`             ${o}/api/integrations/${id}/callback`);
}

console.log(`
Still to do by hand, because nothing here can see it:

  Gmail    Google Cloud console -> APIs & Services -> Library
           Enable "Gmail API" on the SAME project as the OAuth client above.
           gmail.modify and gmail.send are RESTRICTED scopes: an unverified app
           may use them for up to 100 users behind the "Google hasn't verified
           this app" screen, which is reached through Advanced. Declaring them
           on the consent screen opens a verification submission, so do not.

  Outlook  Azure portal -> App registrations -> API permissions
           Add DELEGATED Microsoft Graph permissions Mail.ReadWrite and
           Mail.Send. Application permissions would grant the whole tenant's
           mail; these are the per-user ones and need no admin consent.

  Both     A redirect URI change can take minutes to propagate. A
           redirect_uri_mismatch straight after saving is propagation, not a
           fault -- and Google validates the redirect LATE, so a probe that
           stops at the sign-in screen proves nothing.
`);
