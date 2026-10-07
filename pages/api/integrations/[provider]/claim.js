// Step 3: the signed-in admin collects the sealed connection and writes it.
//
// The browser receives a blob it cannot open — the refresh token inside is
// sealed with INTEGRATION_SECRET, which only the deployment holds — and stores
// it under the admin-only `integrations/` rules. That split is the point: the
// browser has the Firestore credential and no key, the server has the key and
// no Firestore credential, and neither alone can hand the account away.
import { verifyAdmin, AuthError } from "../../../../lib/server/verifyAdmin";
import { getProvider } from "../../../../lib/server/integrations";
import { COOKIE_PREFIX } from "./callback";
import { withEnv } from "../../../../lib/server/envStore";

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    await verifyAdmin(req);
    const p = getProvider(String(req.query.provider || ""));
    const raw = readCookie(req, `${COOKIE_PREFIX}${p.id}`);
    if (!raw) {
      return res.status(404).json({
        error: `No ${p.label} connection is waiting to be saved. Press Connect to start one.`,
      });
    }

    // Burn it on read: the cookie exists for the seconds between the redirect
    // and this call, and a second claim should find nothing.
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_PREFIX}${p.id}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
    );

    let record;
    try {
      record = JSON.parse(raw);
    } catch (_) {
      return res.status(400).json({ error: "That connection could not be read. Press Connect again." });
    }

    // The browser needs to know WHERE to write it: a multi-account provider
    // goes to connectedAccounts/<provider>__<accountId>, everything else to
    // integrations/<docId>.
    const multi = !!p.multi;
    return res.status(200).json({
      record,
      collection: multi ? "connectedAccounts" : "integrations",
      docId: multi ? `${p.id}__${encodeURIComponent(record.accountId)}` : p.docId,
    });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    return res.status(e.status || 500).json({ error: e.message || "Could not save the connection." });
  }
}

// Every variable is read from the database first (lib/server/envStore.js).
export default withEnv(handler);
