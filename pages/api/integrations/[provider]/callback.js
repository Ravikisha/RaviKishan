// Step 2: the provider sends the admin back here with a code.
//
// This route cannot store anything. It has no Firestore credential of its own
// — that is the no-service-account rule the whole deployment is built on — so
// it seals the refresh token and parks the sealed blob in a short-lived,
// httpOnly cookie for the signed-in admin's browser to claim and write under
// the admin-only `integrations/` rules.
//
// A cookie rather than a query parameter, deliberately: a redirect URL is
// written to browser history, to the referrer of the next request, and to
// every access log in between. The blob is useless without INTEGRATION_SECRET,
// but "useless without the key" is not a reason to broadcast it.
import {
  connectionRecord,
  exchangeCode,
  getProvider,
  readState,
  redirectUriFor,
  seal,
} from "../../../../lib/server/integrations";
import { connectedRecord } from "../../../../lib/server/connectedStore";

export const COOKIE_PREFIX = "rk_conn_";
const COOKIE_MAX_AGE = 300;

// Which tab to land on. Sending every provider back to Tasks was fine when
// Tasks was the only thing connected; now a YouTube consent that returns to
// the Tasks board looks like it did nothing.
const TAB_FOR = {
  google: "tasks",
  microsoft: "tasks",
  github: "github",
  linkedin: "linkedin",
  youtube: "social",
  instagram: "social",
  x: "social",
};

const back = (res, query, provider) => {
  const tab = TAB_FOR[provider] || "tasks";
  res.writeHead(302, {
    Location: `/admin?tab=${tab}&${new URLSearchParams(query).toString()}`,
  });
  res.end();
};

export default async function handler(req, res) {
  const provider = String(req.query.provider || "");

  // The provider reports a refusal here too — a declined consent screen is not
  // an error to shout about, but it must not look like success.
  if (req.query.error) {
    return back(
      res,
      { connectError: String(req.query.error_description || req.query.error).slice(0, 200) },
      provider
    );
  }

  try {
    const p = getProvider(provider);
    const state = readState(String(req.query.state || ""));
    if (state.provider !== p.id) throw new Error("This sign-in was started for a different account.");

    const redirectUri = redirectUriFor(req, p.id);
    // The redirect URI is part of the code exchange and both sides must agree.
    // If the deployment is reached by a host the consent screen did not see,
    // this is where it surfaces — with the two values, rather than "invalid".
    if (state.redirectUri && state.redirectUri !== redirectUri) {
      throw new Error(
        `This deployment was reached at a different address than the one that started the connection (${state.redirectUri} vs ${redirectUri}).`
      );
    }

    const { refreshToken, accessToken, expiresAt, email, scope, accountId, accountLabel } =
      await exchangeCode({
        provider: p.id,
        code: String(req.query.code || ""),
        redirectUri,
        // Sealed into the state at /start; X will not exchange the code
        // without it.
        verifier: state.verifier || "",
      });

    // Seal whichever credential this provider actually issued. Google and
    // Microsoft always give a refresh token; GitHub never does; LinkedIn gives
    // one only to approved partners. Sealing `{ refreshToken: null }` for the
    // ones that do not would store a connection that unseals to nothing.
    const usingRefresh = !!refreshToken;
    const sealed = usingRefresh
      ? seal({ refreshToken }, "refresh")
      : seal({ accessToken }, "refresh");
    const kind = usingRefresh ? "refresh" : "access";

    // A multi-account provider stores ONE DOCUMENT PER ACCOUNT, keyed on the
    // provider's own id for it, so reconnecting the same channel or handle
    // updates that row instead of adding a rival one. Without an id there is
    // nothing to key on and the connection would overwrite whichever account
    // was connected last.
    if (p.multi && !accountId) {
      throw new Error(
        `${p.label} did not say which account consented, so this connection cannot be stored safely. Try again, and make sure the account is one this app can read (an Instagram account must be Professional, and a Google account must have a YouTube channel).`
      );
    }

    const record = p.multi
      ? connectedRecord({
          provider: p.id,
          accountId,
          label: accountLabel || email,
          sealed,
          kind,
          expiresAt: usingRefresh ? "" : expiresAt || "",
          scope,
        })
      : connectionRecord({
          provider: p.id,
          sealed,
          kind,
          // Only an access token has an expiry worth showing.
          expiresAt: usingRefresh ? "" : expiresAt || "",
          email,
          scope,
        });

    res.setHeader(
      "Set-Cookie",
      [
        `${COOKIE_PREFIX}${p.id}=${encodeURIComponent(JSON.stringify(record))}`,
        "Path=/",
        `Max-Age=${COOKIE_MAX_AGE}`,
        "HttpOnly",
        "SameSite=Lax",
        ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
      ].join("; ")
    );

    return back(res, { connected: p.id, account: accountLabel || email || "" }, p.id);
  } catch (e) {
    return back(res, { connectError: String(e.message || "The connection failed.").slice(0, 300) }, provider);
  }
}
