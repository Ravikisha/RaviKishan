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
  connectedToken,
  accountStatus,
  listAccounts,
  ConnectedAuthError,
} from "../../lib/server/connectedStore";
import * as yt from "../../lib/server/youtube";
import * as ig from "../../lib/server/instagram";
import * as xapi from "../../lib/server/xapi";
import * as insights from "../../lib/server/socialInsights";
import * as directory from "../../lib/server/accountDirectory";
import { withEnv } from "../../lib/server/envStore";

const PROVIDERS = ["youtube", "instagram", "x"];

async function handler(req, res) {
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
    // How did it do. Kept beside the posting actions rather than in a route of
    // its own because it is the same three accounts and the same credential —
    // a second route would mean a second allow-list to keep in step.
    if (action === "insights") {
      const service = String(req.body.service || "");
      const entry = Object.values(insights.INSIGHTS).find((i) => i.service === service);
      if (!entry) {
        return res.status(400).json({
          error: `Unknown service "${service}". Known: ${Object.values(insights.INSIGHTS)
            .map((i) => i.service)
            .join(", ")}.`,
        });
      }
      if (!entry.available) {
        // Not an error: a real answer about a real limitation, and the panel
        // renders it as a note rather than as a failure.
        return res.status(200).json({ available: false, ...entry });
      }
      try {
        const { token, account } = await directory.tokenFor(idToken, {
          service,
          accountId: req.body.accountId,
        });
        const who = { provider: account.provider, accountId: account.accountId, label: account.label };
        if (service === "video") {
          return res.status(200).json({
            available: true,
            account: who,
            ...(await insights.youtubeSummary(token, { range: req.body.range })),
          });
        }
        if (service === "photos") {
          return res.status(200).json({
            available: true,
            account: who,
            ...(await insights.instagramSummary(token, account.accountId, {
              range: req.body.range || "28d",
            })),
          });
        }
        if (service === "code") {
          if (!req.body.repo) return res.status(400).json({ error: "Name a repository." });
          return res.status(200).json({
            available: true,
            account: who,
            ...(await insights.githubTraffic(token, req.body.owner || account.accountId, req.body.repo)),
          });
        }
        return res.status(400).json({ error: `"${service}" is reported elsewhere.` });
      } catch (e) {
        if (e instanceof insights.InsightsError || e instanceof directory.ConnectedAuthError) {
          return res.status(200).json({ available: true, problem: e.message, code: e.code || "" });
        }
        throw e;
      }
    }

    if (action === "capabilities") {
      return res.status(200).json({ instagram: ig.CAPABILITIES, x: xapi.CAPABILITIES });
    }

    if (!PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `Unknown provider "${provider}".` });
    }
    // Same resolution as the MCP tools: an explicit account wins, then the
    // default saved in Accounts, then the only one connected.
    const { token } = await directory.tokenFor(idToken, {
      provider,
      accountId,
      service: { youtube: "video", instagram: "photos", x: "posts" }[provider] || "",
    });

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
      // Channel configuration — the title, description and keywords a
      // visitor reads before watching anything. Read-modify-write, like
      // videos.update, because channels.update replaces the whole part.
      if (action === "channelConfig") {
        return res.status(200).json(await yt.getChannelConfig(token));
      }
      if (action === "updateChannel") {
        return res.status(200).json(
          await yt.updateChannel(token, {
            title: req.body.title,
            description: req.body.description,
            keywords: req.body.keywords,
          })
        );
      }

      // Growth. A separate API, a separate scope, and a connection made
      // before that scope was added 403s here and nowhere else — which is
      // why the error says "reconnect" rather than repeating Google's.
      if (action === "growth") {
        try {
          return res.status(200).json({
            available: true,
            ...(await insights.youtubeSummary(token, { range: req.body.range })),
          });
        } catch (e) {
          if (e instanceof insights.InsightsError) {
            return res.status(200).json({ available: false, why: e.message, code: e.code || "" });
          }
          throw e;
        }
      }
      // Per-video numbers, which the Data API does not carry: views there are
      // lifetime, and the question on a growth page is always "in this window".
      if (action === "videoGrowth") {
        try {
          const report = await insights.youtubeReport(token, {
            range: req.body.range || "28d",
            metrics: ["views", "estimatedMinutesWatched", "averageViewDuration"],
            dimensions: ["video"],
            limit: req.body.limit || 10,
          });
          return res.status(200).json({ available: true, ...report });
        } catch (e) {
          if (e instanceof insights.InsightsError) {
            return res.status(200).json({ available: false, why: e.message, code: e.code || "" });
          }
          throw e;
        }
      }
      // The trend line: one row per day, so a sparkline is honest rather than
      // interpolated between two endpoints.
      if (action === "dailyGrowth") {
        try {
          const report = await insights.youtubeReport(token, {
            range: req.body.range || "28d",
            metrics: ["views", "subscribersGained"],
            dimensions: ["day"],
            limit: 400,
          });
          return res.status(200).json({ available: true, ...report });
        } catch (e) {
          if (e instanceof insights.InsightsError) {
            return res.status(200).json({ available: false, why: e.message, code: e.code || "" });
          }
          throw e;
        }
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
    if (e instanceof ConnectedAuthError) {
      return res.status(409).json({ error: e.message, code: e.code, provider: e.provider });
    }
    return res.status(e.status || 400).json({ error: e.message || "That did not work." });
  }
}

// Every variable is read from the database first (lib/server/envStore.js).
export default withEnv(handler);
