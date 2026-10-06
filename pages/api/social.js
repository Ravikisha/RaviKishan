// The admin panel's route for YouTube, Instagram and X.
//
// It exists for the same reason the LinkedIn one does: none of these three
// send CORS headers, so the browser cannot call them directly even though it
// is the admin's own browser holding the admin's own session.
//
// Admin-gated on every action, and the actions are an ALLOW-LIST rather than a
// proxied path — this must never become a general tunnel to three social APIs
// carrying the owner's posting credentials.
import { verifyAdmin, AuthError } from "../../lib/server/verifyAdmin";
import {
  socialToken,
  accountStatus,
  listAccounts,
  SocialAuthError,
} from "../../lib/server/socialAccounts";
import * as yt from "../../lib/server/youtube";
import * as ig from "../../lib/server/instagram";
import * as xapi from "../../lib/server/xapi";

const PROVIDERS = ["youtube", "instagram", "x"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    await verifyAdmin(req);
    const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const { action, provider, accountId } = req.body || {};
    res.setHeader("Cache-Control", "no-store");

    // Answerable with no provider credential, so the panel can render before
    // anything is connected — which is when it most needs to explain itself.
    if (action === "accounts") {
      const all = await Promise.all(
        PROVIDERS.map((p) =>
          accountStatus(idToken, p).catch((e) => ({
            provider: p,
            configured: false,
            count: 0,
            accounts: [],
            detail: e?.message || "",
          }))
        )
      );
      return res.status(200).json({ providers: all });
    }
    if (action === "capabilities") {
      return res.status(200).json({ instagram: ig.CAPABILITIES, x: xapi.CAPABILITIES });
    }

    if (!PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `Unknown provider "${provider}".` });
    }
    const { token } = await socialToken(idToken, provider, accountId);

    /* ---- YouTube ---- */
    if (provider === "youtube") {
      if (action === "channel") return res.status(200).json(await yt.getChannel(token));
      if (action === "videos")
        return res.status(200).json(await yt.listVideos(token, { max: req.body.max || 25 }));
      if (action === "updateVideo") {
        const { videoId, ...patch } = req.body;
        delete patch.action;
        delete patch.provider;
        delete patch.accountId;
        return res.status(200).json(await yt.updateVideo(token, videoId, patch));
      }
      if (action === "playlists") return res.status(200).json({ playlists: await yt.listPlaylists(token) });
      if (action === "comments")
        return res.status(200).json({ comments: await yt.listComments(token, req.body.videoId) });
      if (action === "replyComment")
        return res.status(200).json(await yt.replyToComment(token, req.body.commentId, req.body.text));
    }

    /* ---- Instagram ---- */
    if (provider === "instagram") {
      if (action === "account") {
        const [account, limit] = await Promise.all([
          ig.getAccount(token),
          ig.publishingLimit(token).catch(() => null),
        ]);
        return res.status(200).json({ ...account, publishingLimit: limit });
      }
      if (action === "media")
        return res.status(200).json({ media: await ig.listMedia(token, { max: req.body.max || 25 }) });
      if (action === "publish") {
        const caption = ig.assertCaption(req.body.caption);
        const { containerId } = await ig.createContainer(token, {
          imageUrl: req.body.imageUrl,
          videoUrl: req.body.videoUrl,
          caption,
          isReel: req.body.isReel,
          isStory: req.body.isStory,
        });
        if (req.body.videoUrl) {
          for (let i = 0; i < 20; i++) {
            const st = await ig.containerStatus(token, containerId);
            if (st.code === "FINISHED") break;
            if (st.code === "ERROR") {
              return res.status(400).json({ error: `Instagram could not process that video: ${st.detail}` });
            }
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
        const out = await ig.publishContainer(token, containerId);
        return res.status(200).json(await ig.getMedia(token, out.id).catch(() => out));
      }
      if (action === "comments")
        return res.status(200).json({ comments: await ig.listComments(token, req.body.mediaId) });
      if (action === "replyComment")
        return res.status(200).json(await ig.replyToComment(token, req.body.commentId, req.body.message));
    }

    /* ---- X ---- */
    if (provider === "x") {
      if (action === "account") return res.status(200).json(await xapi.getAccount(token));
      if (action === "posts") {
        const me = await xapi.getAccount(token);
        return res
          .status(200)
          .json({ posts: await xapi.listPosts(token, me.id, { max: req.body.max || 10 }) });
      }
      if (action === "publish") {
        const text = xapi.assertPostable(req.body.text);
        const me = await xapi.getAccount(token).catch(() => ({ username: "" }));
        const out = await xapi.createPost(token, { text });
        return res.status(200).json({ ...out, url: xapi.postUrl(me.username, out.id) });
      }
      if (action === "thread") {
        const parts = (req.body.texts || []).map((t) => xapi.assertPostable(t));
        return res.status(200).json(await xapi.createThread(token, parts));
      }
      if (action === "delete") return res.status(200).json(await xapi.deletePost(token, req.body.postId));
    }

    return res.status(400).json({ error: `Unknown action "${action}" for ${provider}.` });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    if (e instanceof SocialAuthError) {
      return res.status(409).json({ error: e.message, code: e.code, provider: e.provider });
    }
    return res.status(e.status || 400).json({ error: e.message || "That did not work." });
  }
}
