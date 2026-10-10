// BROWSER. The Mail panel's client.
//
// Everything goes through /api/mail, which is admin-gated and calls the same
// mailBoard.js the MCP tools use. It is not a direct call to Gmail or Graph
// because neither sends CORS headers — a fetch from the page is blocked before
// it leaves — and because handing a mailbox credential to the browser would
// put it in history and in every log between here and there.
//
// adminFetch adds the org header, so "every mailbox" means every mailbox IN
// THIS ORG — the merged stream never shows another org's inbox.
import { adminJson, adminRequest } from "./adminFetch";

const call = (action, body = {}) => adminJson("/api/mail", { action, ...body });

export const mailAccounts = () => call("accounts");

// Whether each service could be connected AT ALL on this deployment. Asked
// only when nothing is connected, so the empty state can say "Outlook needs
// MS_TASKS_CLIENT_ID" instead of offering a button that cannot work.
export async function mailServicesConfigured() {
  let res;
  try {
    res = await adminRequest("/api/integrations/status", {});
  } catch (_) {
    return {}; // not signed in: nothing to say about setup yet
  }
  if (!res.ok) return {};
  const { providers = [] } = await res.json();
  const out = {};
  for (const p of providers) {
    if (p.provider === "gmail" || p.provider === "outlook") {
      out[p.provider] = p.configured !== false;
      out[`${p.provider}Missing`] = p.missing || [];
    }
  }
  return out;
}
export const readMailbox = (provider, accountId, opts = {}) =>
  call("list", { provider, accountId, ...opts });
export const readEveryMailbox = (opts = {}) => call("all", opts);
export const getMessage = (provider, accountId, messageId) =>
  call("get", { provider, accountId, messageId });
export const mailFolders = (provider, accountId) => call("folders", { provider, accountId });
export const mailAnalytics = (provider, accountId, opts = {}) =>
  call("analytics", { provider, accountId, ...opts });

// The two that cannot be taken back. Both take dryRun, and the panel always
// calls dryRun first — see MailPanel's Outbound component for why the button
// says the address rather than "Send".
export const sendMail = (body) => call("send", body);
export const replyToMail = (body) => call("reply", body);

export const updateMessage = (provider, accountId, messageId, change) =>
  call("update", { provider, accountId, messageId, change });

/* ---------------- shared with the server ---------------- *
 *
 * Imported from the one pure module rather than re-stated here, for the same
 * reason linkedinText.js is shared: the composer's own validation and the
 * server's refusal must be the same function, or the panel says "ready to
 * send" about something the server will bounce.
 */
export {
  CAPABILITIES,
  MAIL_PROVIDERS,
  MAX_RECIPIENTS,
  capability,
  formatAddress,
  isAddress,
  parseAddress,
  replySubject,
  toRecipients,
} from "./server/mailShape";

export const providerLabel = (id) =>
  ({ gmail: "Gmail", outlook: "Outlook" }[id] || id);

// A human time that does not pretend to more precision than it has. Mail is
// read as "when", not "at": an hour ago, yesterday, a date.
export function when(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!t) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export const fullWhen = (iso) => {
  const t = Date.parse(iso || "");
  return t ? new Date(t).toLocaleString() : "";
};

// Who a row is from, said the way a person would say it.
export const senderName = (m) => m?.from?.name || m?.from?.email || "Unknown sender";
