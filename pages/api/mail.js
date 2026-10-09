// The Mail panel's one way in.
//
// This route exists because neither service can be called from a browser:
// Gmail's API and Microsoft Graph both send no CORS headers, so a fetch from
// the page is blocked before it leaves. The same reason /api/linkedin and
// /api/social exist.
//
// Its actions are an ALLOW-LIST, never a proxied path. It must not become a
// tunnel that forwards an arbitrary URL to Gmail carrying the owner's mailbox
// credential — which is exactly what a `path` parameter would make it.
import { verifyAdmin, AuthError } from "../../lib/server/verifyAdmin";
import { recordActivity } from "../../lib/server/activityLog.js";
import { withEnv } from "../../lib/server/envStore";
import * as mail from "../../lib/server/mailBoard.js";

const audit = (idToken, claims, action, target, detail = "") =>
  recordActivity(idToken, {
    action,
    source: "admin",
    target,
    detail,
    actor: { email: claims.email || "admin" },
  });

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only." });
  }
  try {
    const claims = await verifyAdmin(req);
    const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const { action, provider, accountId } = req.body || {};
    res.setHeader("Cache-Control", "no-store");

    if (action === "accounts") {
      const boxes = await mail.everyMailbox(idToken);
      return res.status(200).json({
        accounts: boxes.map((a) => ({
          accountId: a.accountId,
          key: a.key,
          account: a.label || a.email || a.accountId,
          provider: a.provider,
          needsReconnect: !!a.needsReconnect,
        })),
        capabilities: mail.CAPABILITIES,
      });
    }

    if (action === "list") {
      const { api, token, account } = await mail.mailboxFor(idToken, provider, accountId);
      const messages = await api.list(token, {
        max: req.body.max || 25,
        query: req.body.query || "",
      });
      return res
        .status(200)
        .json({ provider: api.id, account: account.email || account.label || "", messages });
    }

    if (action === "all") {
      return res.status(200).json(
        await mail.readEverywhere(idToken, {
          max: req.body.max || 20,
          query: req.body.query || "",
        })
      );
    }

    if (action === "get") {
      const { api, token } = await mail.mailboxFor(idToken, provider, accountId);
      return res.status(200).json(await api.get(token, req.body.messageId));
    }

    if (action === "analytics") {
      return res.status(200).json(
        await mail.mailAnalytics(idToken, {
          provider,
          accountId,
          days: req.body.days || 7,
          max: req.body.max || 100,
        })
      );
    }

    if (action === "folders") {
      const { api, token } = await mail.mailboxFor(idToken, provider, accountId);
      return res.status(200).json({ provider: api.id, folders: await api.folders(token) });
    }

    // --- the two that cannot be undone -----------------------------------
    if (action === "send") {
      const out = await mail.sendMail(idToken, { provider, accountId, ...req.body });
      if (!out.dryRun) {
        await audit(idToken, claims, "mail.send", out.sentAs || "", `to ${(out.to || []).join(", ")}`);
      }
      return res.status(200).json(out);
    }

    if (action === "reply") {
      const out = await mail.replyToMail(idToken, { provider, accountId, ...req.body });
      if (!out.dryRun) {
        await audit(idToken, claims, "mail.reply", out.sentAs || "", `to ${out.to || ""}`);
      }
      return res.status(200).json(out);
    }

    if (action === "update") {
      const { api, token } = await mail.mailboxFor(idToken, provider, accountId);
      const { messageId, change } = req.body;
      let out;
      if (change === "read" || change === "unread") out = await api.setRead(token, messageId, change === "read");
      else if (change === "archive") out = await api.archive(token, messageId);
      else if (change === "trash") out = await api.trash(token, messageId);
      else return res.status(400).json({ error: `Unknown change "${change}".` });
      await audit(idToken, claims, `mail.${change}`, messageId);
      return res.status(200).json(out);
    }

    return res.status(400).json({ error: `Unknown action "${action}".` });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status || 401).json({ error: e.message });
    return res
      .status(e?.status && e.status >= 400 && e.status < 600 ? e.status : 400)
      .json({ error: e?.message || "That failed.", code: e?.code || "" });
  }
}

export default withEnv(handler);
