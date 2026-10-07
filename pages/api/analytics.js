// Google Analytics for the admin panel.
//
// Needed because analyticsdata.googleapis.com sends no CORS headers, so the
// browser cannot reach it even as the signed-in admin. Admin-gated, and the
// actions are an allow-list rather than a proxied path.
//
// There is no write action here and there cannot usefully be one: the stored
// connection holds `analytics.readonly`.
import { verifyAdmin, AuthError } from "../../lib/server/verifyAdmin";
import { connectedToken, accountStatus, ConnectedAuthError } from "../../lib/server/connectedStore";
import * as ga from "../../lib/server/googleAnalytics";
import { withEnv } from "../../lib/server/envStore";

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    await verifyAdmin(req);
    const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const { action, accountId, propertyId } = req.body || {};
    res.setHeader("Cache-Control", "no-store");

    // Answerable with no provider credential, so the panel renders a Connect
    // button that explains itself before anything is connected.
    if (action === "accounts") {
      return res.status(200).json(
        await accountStatus(idToken, "analytics").catch((e) => ({
          provider: "analytics",
          configured: false,
          count: 0,
          accounts: [],
          detail: e?.message || "",
        }))
      );
    }
    if (action === "fields") {
      return res
        .status(200)
        .json({ metrics: ga.METRICS, dimensions: ga.DIMENSIONS, ranges: Object.keys(ga.RANGES) });
    }

    const { token } = await connectedToken(idToken, "analytics", accountId);

    if (action === "properties") {
      return res.status(200).json({ properties: await ga.listProperties(token) });
    }
    if (action === "summary") {
      return res.status(200).json(
        await ga.summary(token, propertyId, {
          range: req.body.range,
          startDate: req.body.startDate,
          endDate: req.body.endDate,
        })
      );
    }
    if (action === "topPages") {
      return res.status(200).json(
        await ga.runReport(token, propertyId, {
          metrics: ["screenPageViews", "activeUsers", "engagementRate"],
          dimensions: ["pagePath"],
          range: req.body.range || "28d",
          limit: req.body.limit || 15,
          orderByMetric: "screenPageViews",
        })
      );
    }
    if (action === "sources") {
      return res.status(200).json(
        await ga.runReport(token, propertyId, {
          metrics: ["sessions", "activeUsers"],
          dimensions: ["sessionDefaultChannelGroup", "sessionSource"],
          range: req.body.range || "28d",
          limit: req.body.limit || 10,
          orderByMetric: "sessions",
        })
      );
    }
    if (action === "trend") {
      return res.status(200).json(
        await ga.runReport(token, propertyId, {
          metrics: ["activeUsers"],
          dimensions: ["date"],
          range: req.body.range || "28d",
          limit: 400,
        })
      );
    }
    if (action === "realtime") {
      return res.status(200).json(await ga.realtime(token, propertyId, { dimensions: ["country"] }));
    }
    if (action === "report") {
      return res.status(200).json(await ga.runReport(token, propertyId, req.body));
    }

    return res.status(400).json({ error: `Unknown action "${action}".` });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    if (e instanceof ConnectedAuthError) {
      return res.status(409).json({ error: e.message, code: e.code });
    }
    if (e instanceof ga.AnalyticsError) {
      return res.status(e.status || 400).json({ error: e.message });
    }
    return res.status(500).json({ error: e.message || "That did not work." });
  }
}

// Every variable is read from the database first (lib/server/envStore.js).
export default withEnv(handler);
