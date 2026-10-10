// BROWSER. YouTube, Instagram and X for the admin panel.
//
// None of the three send CORS headers, so unlike Google Tasks and Microsoft
// Graph nothing here talks to the provider directly — every call goes through
// our own admin-gated /api/social, which already holds the credential.
//
// The weighted character count for X is imported from the server module rather
// than reimplemented: a counter that disagrees with the validator is worse
// than no counter, because it tells you the post will fit and then it does not.
import { db } from "./firebase";
import { arrayUnion, collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { adminJson } from "./adminFetch";
import { currentOrgId } from "./orgState";
import { claimOrgIds, inOrg } from "./server/orgShape";

export { MAX_POST_CHARS as X_MAX, weightedLength, charsLeft } from "./server/xapi";
export { MAX_CAPTION as IG_MAX } from "./server/instagram";

// What it takes to make each service connectable on a deployment that has not
// got it yet. "Not set up — missing X_CLIENT_ID" names a state and offers no
// route out, and the route is genuinely non-obvious for all three: X needs a
// developer account that does not exist until you enrol and a credit balance
// because there is no free tier, Instagram refuses an http:// redirect and
// needs a tester role, and YouTube needs two separate APIs switched on.
//
// A SEQUENCE, so it is numbered — the one case where numbered markers carry
// information rather than decorating a list.
//
// `uris: true` on a step means "list every callback URL to register", built
// from the origin the admin is actually being served from, so the one you need
// for the machine in front of you is always in the list.
const CALLBACK = (id) => `/api/integrations/${id}/callback`;

export function redirectUrisFor(providerId, currentOrigin = "") {
  const origins = ["https://www.ravikishan.me", "https://ravikishan.me"];
  const here = String(currentOrigin || "").replace(/\/+$/, "");
  if (/^https?:\/\/[^/]+$/.test(here) && !origins.includes(here)) origins.push(here);
  return origins.map((o) => o + CALLBACK(providerId));
}

export const PROVIDERS = [
  {
    id: "youtube",
    label: "YouTube",
    noun: "channel",
    setup: {
      why: "YouTube borrows the Google Tasks OAuth client, so it usually needs no credentials of its own. If this panel says otherwise, the shared client is missing too.",
      steps: [
        {
          title: "Enable both APIs",
          body: "YouTube Data API v3 AND YouTube Analytics API. With only the first, the connection works everywhere except the reports, which then fail with an error naming an API rather than the reason.",
          link: "https://console.cloud.google.com/apis/library",
        },
        {
          title: "Register the callback on the OAuth client",
          body: "Google matches the redirect character for character. A change takes 5 minutes to a few hours to take effect, so a mismatch straight after saving is propagation, not a fault.",
          uris: true,
        },
        {
          title: "Tick all three permissions on the consent screen",
          body: "They are presented as individually unticked checkboxes. Missing the analytics one yields a connection that looks fine until a report 403s.",
        },
      ],
      env: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
    },
  },
  {
    id: "instagram",
    label: "Instagram",
    noun: "account",
    setup: {
      why: "The account must be Professional (Business or Creator) — free to switch in the app. A personal account cannot be connected at all; the API that served them shut down on 4 December 2024.",
      steps: [
        {
          title: "Create a Meta app and add Instagram",
          body: "Use Instagram Login, not Facebook Login — it needs no linked Page.",
          link: "https://developers.facebook.com/apps",
        },
        {
          title: "Register the callback URLs",
          body: "Meta will not save an http:// redirect at all, not even for localhost — it refuses the whole form. Run `npm run dev:https` and use the https://localhost address below.",
          uris: true,
        },
        {
          title: "Assign the Instagram Tester role",
          body: "While the app is in Development mode only an account holding a role may authorize it, and the refusal reads \"Insufficient Developer Role\" with no mention of roles. Add the handle under App roles, then accept the invite on instagram.com under Settings → Apps and websites → Tester Invites.",
        },
      ],
      env: ["INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"],
    },
  },
  {
    id: "x",
    label: "X",
    noun: "handle",
    setup: {
      why: "X is the one service here that costs money to use. There is no free tier: the API is pay-per-usage against a credit balance you buy up front, so an app with no credits authenticates fine and then refuses every call.",
      // Read off the live pricing page rather than remembered, because the
      // second line is the one that matters and is easy to miss: a post
      // carrying a link costs THIRTEEN TIMES a plain one, and almost every
      // post this site would make carries a link to an article.
      cost: [
        ["Post a plain post", "$0.015 per post"],
        ["Post containing a link", "$0.200 per post"],
        ["Delete a post", "$0.010 per request"],
        ["Read your own posts", "$0.001 each"],
      ],
      steps: [
        {
          title: "Enrol as a developer",
          body: "Every portal URL redirects here until you do. It asks you to describe your use of the API and to accept the X Developer Agreement and Developer Policy.",
          link: "https://console.x.com",
        },
        {
          title: "Create a project, then an app inside it",
          body: "An app on its own cannot hold OAuth 2.0 settings; it has to belong to a project.",
        },
        {
          title: "Set up user authentication",
          body: "OAuth 2.0, type Confidential client, app type Web App. Permissions must be Read and write — Read only authorises but cannot post.",
          uris: true,
        },
        {
          title: "Add credits",
          body: "Saving a payment card earns $20 in free credits, and a first auto-recharge is matched up to $50. Set a spending limit at the same time; it is the only hard stop on cost.",
          link: "https://console.x.com",
        },
      ],
      env: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
      warning:
        "X has no edit endpoint at any tier and no free tier. Both are properties of the service, not of this app.",
    },
  },
];

export const providerLabel = (id) => PROVIDERS.find((p) => p.id === id)?.label || id;

// Every call to our own routes goes through adminFetch, which adds the bearer
// AND the x-org-id header — the server acts in the org this page is in.
const call = (path, body) => adminJson(path, body);

const social = (body) => call("/api/social", body);

/* ---------------- accounts ---------------- */

export const listAccounts = () => social({ action: "accounts" }).then((j) => j.providers);
export const capabilities = () => social({ action: "capabilities" });

export async function beginConnect(provider) {
  const { url } = await call(`/api/integrations/${provider}/start`);
  window.location.assign(url);
}

// Collect the sealed connection the callback left in a cookie and store it.
// The server tells us WHERE — a multi-account provider lands one document per
// account in connectedAccounts, keyed so reconnecting the same channel updates
// that row rather than adding a second one beside it.
//
// Every connect flow in the admin ends here (Accounts, Tasks, Mail, GitHub,
// YouTube, GA, Social), so this is where org membership is written.
//
// MEMBERSHIP IS A UNION. The record names the org the consent was started in
// (sealed into the OAuth state at /start, so it survives the trip to the
// provider). `setDoc(..., {merge: true})` REPLACES an array field wholesale,
// so writing `orgIds: ["acme"]` would quietly evict a channel Relax already
// uses. `arrayUnion` adds Acme and leaves Relax where it was.
export async function finishConnect(provider) {
  const claim = await call(`/api/integrations/${provider}/claim`);
  const { record, collection: col, docId } = claim;
  if (col === "connectedAccounts") {
    const { orgIds, ...rest } = record || {};
    const named = Array.isArray(claim.orgIds) && claim.orgIds.length ? claim.orgIds : orgIds;
    const ids = Array.isArray(named) && named.length ? named : [currentOrgId()];
    const ref = doc(db, col, docId);
    // A document written before orgs has NO orgIds and reads as Relax's; an
    // arrayUnion onto the missing field would write only `ids` and evict it
    // from Relax. claimOrgIds says when the merged array must be written whole.
    const snap = await getDoc(ref);
    const existing = snap.exists() ? snap.data() : null;
    const whole = claimOrgIds(existing, ids);
    // The callback's record carries an empty identityId; writing it would
    // un-file a reconnected account from its person.
    if (!rest.identityId) delete rest.identityId;
    await setDoc(ref, { ...rest, orgIds: whole || arrayUnion(...ids) }, { merge: true });
  } else {
    await setDoc(doc(db, col, docId), record, { merge: true });
  }
  return record;
}

// Disconnecting is PER ORG, so it goes through the server rather than a
// browser deleteDoc: an account shared by Relax and Acme is one credential,
// and disconnecting it in Acme must take Acme off it and leave Relax's
// working. The document goes only when no org is left using it.
export const disconnect = (provider, accountId) =>
  call("/api/accounts", { action: "forget", provider, accountId });

// Read straight from Firestore — the rules already make it admin-only, and the
// sealed secret is never part of what the panel renders. The rules know
// nothing of orgs, so the filter is here: only accounts in the current org,
// with a document that predates orgs counting as Relax's.
export async function readAccounts() {
  const org = currentOrgId();
  const snap = await getDocs(collection(db, "connectedAccounts"));
  return snap.docs
    .map((d) => {
      const { secret, ...rest } = d.data();
      return { id: d.id, ...rest };
    })
    .filter((row) => inOrg(row, org));
}

/* ---------------- YouTube ---------------- */

export const ytChannel = (accountId) => social({ action: "channel", provider: "youtube", accountId });
export const ytVideos = (accountId, max) =>
  social({ action: "videos", provider: "youtube", accountId, max });
export const ytUpdateVideo = (accountId, videoId, patch) =>
  social({ action: "updateVideo", provider: "youtube", accountId, videoId, ...patch });
export const ytPlaylists = (accountId) =>
  social({ action: "playlists", provider: "youtube", accountId });
export const ytComments = (accountId, videoId) =>
  social({ action: "comments", provider: "youtube", accountId, videoId });

/* ---------------- Instagram ---------------- */

export const igAccount = (accountId) => social({ action: "account", provider: "instagram", accountId });
export const igMedia = (accountId, max) => social({ action: "media", provider: "instagram", accountId, max });
export const igPublish = (accountId, body) =>
  social({ action: "publish", provider: "instagram", accountId, ...body });
export const igComments = (accountId, mediaId) =>
  social({ action: "comments", provider: "instagram", accountId, mediaId });

/* ---------------- X ---------------- */

export const xAccount = (accountId) => social({ action: "account", provider: "x", accountId });
export const xPosts = (accountId, max) => social({ action: "posts", provider: "x", accountId, max });
export const xPublish = (accountId, text) => social({ action: "publish", provider: "x", accountId, text });
export const xThread = (accountId, texts) => social({ action: "thread", provider: "x", accountId, texts });
export const xDelete = (accountId, postId) =>
  social({ action: "delete", provider: "x", accountId, postId });
