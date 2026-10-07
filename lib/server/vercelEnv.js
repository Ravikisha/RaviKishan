// SERVER ONLY. The Vercel project's environment variables, over the REST API.
//
// THE THING TO UNDERSTAND BEFORE USING THIS: writing a variable here does NOT
// change the running process. Vercel bakes the environment at build time, so a
// change takes effect on the NEXT DEPLOYMENT and not a moment sooner. Every
// write returns `effectiveOn: "next deployment"` so a caller cannot mistake a
// successful save for a live change — that confusion costs an afternoon.
//
// Two more things the API itself enforces, worth knowing rather than
// discovering:
//   - a variable created as `sensitive` can never be read back, by anyone,
//     including this code. Vercel reports a readable secret as a
//     `securityIssue`, so sensitive is the correct type for a secret and the
//     unreadability is the feature.
//   - `decrypt=true` returns values for the non-sensitive types. This file
//     never asks for it. Nothing in this app needs to read a deployment
//     secret back, and a fetch that could is one that can leak.
import { assertKey, assertManageable, isPublic } from "./envRegistry.js";

const API = "https://api.vercel.com";

export class VercelError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = "VercelError";
    this.status = status;
  }
}

export const isConfigured = () =>
  !!(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID);

function config() {
  const token = process.env.VERCEL_TOKEN;
  const project = process.env.VERCEL_PROJECT_ID;
  if (!token || !project) {
    throw new VercelError(
      "Vercel is not configured here (needs VERCEL_TOKEN and VERCEL_PROJECT_ID). Deployment variables can still be set in the Vercel dashboard.",
      { status: 503 }
    );
  }
  return { token, project, team: process.env.VERCEL_TEAM_ID || "" };
}

async function call(path, { method = "GET", body } = {}) {
  const { token, project, team } = config();
  const url = new URL(`${API}${path.replace("{project}", encodeURIComponent(project))}`);
  if (team) url.searchParams.set("teamId", team);

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401 || res.status === 403) {
    throw new VercelError(
      "Vercel rejected the token. It needs access to this project, and a team project also needs VERCEL_TEAM_ID.",
      { status: res.status }
    );
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json())?.error?.message || msg;
    } catch (_) {}
    throw new VercelError(`Vercel: ${msg}`, { status: res.status });
  }
  return res.status === 204 ? null : res.json();
}

const TARGETS = ["production", "preview", "development"];

function assertTargets(targets) {
  const t = Array.isArray(targets) && targets.length ? targets : ["production"];
  const bad = t.filter((x) => !TARGETS.includes(x));
  if (bad.length) {
    throw new VercelError(`Unknown target(s): ${bad.join(", ")}. Use ${TARGETS.join(", ")}.`);
  }
  return t;
}

/* ---------------- read ---------------- */

// Note what is NOT returned: a value. The list is deliberately metadata only,
// and `decrypt` is never requested — see the header.
export async function listEnv() {
  const data = await call("/v10/projects/{project}/env");
  const rows = data?.envs || (Array.isArray(data) ? data : []);
  return rows.map((e) => ({
    id: e.id,
    key: e.key,
    target: Array.isArray(e.target) ? e.target : [e.target].filter(Boolean),
    type: e.type,
    // Vercel's own flag for "this secret can be read back", which is a thing
    // worth surfacing rather than hiding.
    readableSecret: (e.securityIssues || []).includes("readable-secret"),
    updatedAt: e.updatedAt ? new Date(e.updatedAt).toISOString() : "",
    comment: e.comment || "",
  }));
}

/* ---------------- write ---------------- */

// A secret is created `sensitive` so Vercel itself refuses to hand it back
// later. Public variables are `plain`, because they are compiled into the
// browser bundle anyway and pretending otherwise is theatre.
const typeFor = (key) => (isPublic(key) ? "plain" : "sensitive");

export async function setEnv(key, value, { targets, comment } = {}) {
  const k = assertManageable(key, { action: "change" });
  if (typeof value !== "string" || value === "") {
    throw new VercelError(`${k} needs a value.`);
  }
  const target = assertTargets(targets);

  // Vercel has no upsert: creating an existing key is a conflict, so the
  // existing row is found and PATCHed instead. Doing it the other way round
  // leaves a duplicate key on different targets, which resolves unpredictably.
  const existing = (await listEnv()).find(
    (e) => e.key === k && target.every((t) => e.target.includes(t))
  );

  if (existing) {
    await call(`/v9/projects/{project}/env/${encodeURIComponent(existing.id)}`, {
      method: "PATCH",
      body: { value, target, type: typeFor(k), ...(comment ? { comment } : {}) },
    });
    return {
      key: k,
      created: false,
      updated: true,
      target,
      effectiveOn: "next deployment",
      note: "Vercel bakes the environment at build time, so the running deployment still has the old value until it is redeployed.",
    };
  }

  await call("/v10/projects/{project}/env", {
    method: "POST",
    body: { key: k, value, type: typeFor(k), target, ...(comment ? { comment } : {}) },
  });
  return {
    key: k,
    created: true,
    updated: false,
    target,
    effectiveOn: "next deployment",
    note: "Vercel bakes the environment at build time, so this takes effect when the project is next deployed.",
  };
}

export async function deleteEnv(key, { targets } = {}) {
  const k = assertManageable(key, { action: "delete" });
  const target = assertTargets(targets);
  const rows = (await listEnv()).filter(
    (e) => e.key === k && target.some((t) => e.target.includes(t))
  );
  if (!rows.length) {
    throw new VercelError(`No environment variable ${k} on ${target.join(", ")}.`, { status: 404 });
  }
  for (const row of rows) {
    await call(`/v9/projects/{project}/env/${encodeURIComponent(row.id)}`, { method: "DELETE" });
  }
  return {
    key: k,
    deleted: rows.length,
    effectiveOn: "next deployment",
    note: "The running deployment keeps the old value until it is redeployed.",
  };
}

// Deliberately absent: nothing here triggers a deployment. A tool that could
// redeploy the production site from a chat client is a much larger blast
// radius than setting a variable, and the two decisions should not be made in
// the same breath.
export const REDEPLOY_NOTE =
  "Nothing here redeploys. Push a commit, or press Redeploy in the Vercel dashboard, once the variables are right.";

export { assertKey };
