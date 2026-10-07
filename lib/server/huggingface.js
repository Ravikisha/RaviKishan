// Hugging Face — the network half. Every rule worth testing lives in
// hfShape.js; this file only speaks HTTP and translates the answers.
//
// Endpoints are taken from the Hub's own OpenAPI document
// (https://huggingface.co/.well-known/openapi.json), not from memory.
import {
  apiBase,
  assertSlug,
  encodePath,
  encodeRev,
  optionalPath,
  assertFlavor,
  assertRepoId,
  assertRepoType,
  commitNdjson,
  hfError,
  HfInputError,
  planCommit,
  resolvePrefix,
  searchQuery,
  shapeRepo,
} from "./hfShape.js";

const HUB = "https://huggingface.co";
const ROUTER = "https://router.huggingface.co";

// Swappable for the no-network suite; null means the global fetch.
let fetchImpl = null;
export const setFetch = (fn) => {
  fetchImpl = fn;
};
const doFetch = (...a) => (fetchImpl || fetch)(...a);

async function hf(token, path, { method = "GET", body, raw, headers = {}, base = HUB, role = "" } = {}) {
  const init = { method, headers: { Authorization: `Bearer ${token}`, ...headers } };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    if (!init.headers["Content-Type"]) init.headers["Content-Type"] = "application/json";
  }
  const res = await doFetch(`${base}${path}`, init);
  if (!res.ok) {
    let b = {};
    try {
      b = await res.json();
    } catch (_) {
      /* not JSON */
    }
    throw hfError(res.status, b, role);
  }
  if (raw) return res;
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

const enc = new TextEncoder();
const toBytes = (f) => {
  if (f.contentBase64) return new Uint8Array(Buffer.from(f.contentBase64, "base64"));
  if (typeof f.content === "string") return enc.encode(f.content);
  throw new HfInputError(`${f.path}: give content (text) or contentBase64.`);
};

/* ---------------- identity and search ---------------- */

export const whoami = (t) => hf(t, "/api/whoami-v2");

export async function search(t, { type = "model", ...q } = {}) {
  const rows = await hf(t, `/api/${apiBase(type)}?${searchQuery(q)}`);
  return (rows || []).map((r) => shapeRepo(r, type));
}

export const searchPapers = (t, { q }) => hf(t, `/api/papers/search?q=${encodeURIComponent(q)}`);
export const dailyPapers = (t, { date } = {}) => hf(t, `/api/daily_papers${date ? `?date=${encodeURIComponent(date)}` : ""}`);
export const semanticSearchSpaces = (t, { q }) => hf(t, `/api/spaces/semantic-search?q=${encodeURIComponent(q)}`);
export const searchDocs = (t, { q }) => hf(t, `/api/docs/search?q=${encodeURIComponent(q)}`);

/* ---------------- repos ---------------- */

export async function getRepo(t, { type = "model", id }) {
  const r = await hf(t, `/api/${apiBase(type)}/${assertRepoId(id)}`);
  return {
    ...shapeRepo(r, type),
    cardData: r.cardData || null,
    siblings: (r.siblings || []).map((s) => s.rfilename),
    sha: r.sha || "",
  };
}

export const listFiles = (t, { type = "model", id, rev = "main", path = "", recursive = false }) =>
  hf(t, `/api/${apiBase(type)}/${assertRepoId(id)}/tree/${encodeRev(rev)}/${optionalPath(path)}${recursive ? "?recursive=true" : ""}`);

export const MAX_READ_BYTES = 200 * 1024;

export async function readFile(t, { type = "model", id, rev = "main", path }) {
  const res = await hf(t, `/${resolvePrefix(type)}${assertRepoId(id)}/resolve/${encodeRev(rev)}/${encodePath(path)}`, { raw: true });
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.some((b) => b === 0)) return { path, bytes: buf.byteLength, binary: true, content: null };
  if (buf.byteLength > MAX_READ_BYTES) {
    return { path, bytes: buf.byteLength, truncated: true, content: new TextDecoder().decode(buf.slice(0, MAX_READ_BYTES)) };
  }
  return { path, bytes: buf.byteLength, content: new TextDecoder().decode(buf) };
}

export const listCommits = (t, { type = "model", id, rev = "main" }) =>
  hf(t, `/api/${apiBase(type)}/${assertRepoId(id)}/commits/${encodeRev(rev)}`);

export async function createRepo(t, { type = "model", name, organization, private: priv = true, sdk }) {
  assertRepoType(type);
  if (!name || /[\/\s]/.test(name)) throw new HfInputError("Give the repo a bare name (no owner, no spaces).");
  if (type === "space" && !["gradio", "docker", "static"].includes(sdk)) {
    throw new HfInputError("A Space needs sdk: gradio, docker or static.");
  }
  // Private unless the caller explicitly says otherwise — a public repo is a
  // disclosure, and the default should never make one.
  const body = { name, type, private: priv !== false };
  if (organization) body.organization = organization;
  if (sdk) body.sdk = sdk;
  return hf(t, "/api/repos/create", { method: "POST", body });
}

export async function commitFiles(t, { type = "model", id, rev = "main", summary, description = "", files = [], deletes = [] }) {
  const repo = assertRepoId(id);
  const withBytes = files.map((f) => ({ path: f.path, bytes: toBytes(f) }));
  // Size and path rules first, so an oversized commit is refused before any request.
  planCommit(withBytes, { files: [] });
  const pre = withBytes.length
    ? await hf(t, `/api/${apiBase(type)}/${repo}/preupload/${encodeRev(rev)}`, {
        method: "POST",
        body: {
          files: withBytes.map((f) => ({
            path: f.path,
            size: f.bytes.byteLength,
            sample: Buffer.from(f.bytes.slice(0, 512)).toString("base64"),
          })),
        },
      })
    : { files: [] };
  planCommit(withBytes, pre);
  return hf(t, `/api/${apiBase(type)}/${repo}/commit/${encodeRev(rev)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-ndjson" },
    body: commitNdjson({ summary, description, files: withBytes, deletes }),
  });
}

/* ---------------- collections ---------------- */

export function listCollections(t, { owner, q, limit = 20 } = {}) {
  const p = new URLSearchParams();
  if (owner) p.set("owner", owner);
  if (q) p.set("q", q);
  p.set("limit", String(Math.min(100, limit)));
  return hf(t, `/api/collections?${p}`);
}
export const getCollection = (t, { slug }) => hf(t, `/api/collections/${assertSlug(slug)}`);
export const addToCollection = (t, { slug, itemType, itemId, note }) =>
  hf(t, `/api/collections/${assertSlug(slug)}/items`, {
    method: "POST",
    body: { item: { type: itemType, id: itemId }, ...(note ? { note } : {}) },
  });

/* ---------------- spaces ---------------- */

export const spaceRuntime = (t, { id }) => hf(t, `/api/spaces/${assertRepoId(id)}/runtime`);
export const restartSpace = (t, { id }) => hf(t, `/api/spaces/${assertRepoId(id)}/restart`, { method: "POST" });
export const setSpaceSecret = (t, { id, key, value, description = "" }) =>
  hf(t, `/api/spaces/${assertRepoId(id)}/secrets`, { method: "POST", body: { key, value, description } });

/* ---------------- inference ---------------- */

export const inference = (t, { model, messages, maxTokens = 512 }) =>
  hf(t, "/v1/chat/completions", { method: "POST", base: ROUTER, body: { model, messages, max_tokens: maxTokens } });

/* ---------------- jobs ---------------- */

export const jobsHardware = (t) => hf(t, "/api/jobs/hardware");

export function runJob(t, { namespace, image, spaceId, command, args = [], env = {}, secrets = {}, flavor = "cpu-basic", timeoutSeconds = 1800 }) {
  if (!namespace) throw new HfInputError("Name the namespace (your username) to run the job under.");
  if (!image === !spaceId) throw new HfInputError("Give exactly one of image (a Docker image) or spaceId.");
  if (!Array.isArray(command) || !command.length) {
    throw new HfInputError('command must be a non-empty array, e.g. ["python", "train.py"].');
  }
  const body = {
    command,
    arguments: args,
    environment: env,
    flavor: assertFlavor(flavor),
    timeoutSeconds: Math.max(60, Number(timeoutSeconds) || 1800),
  };
  if (image) body.dockerImage = image;
  else body.spaceId = spaceId;
  if (Object.keys(secrets).length) body.secrets = secrets;
  return hf(t, `/api/jobs/${encodeURIComponent(namespace)}`, { method: "POST", body });
}
export const listJobs = (t, { namespace }) => hf(t, `/api/jobs/${encodeURIComponent(namespace)}`);
export const getJob = (t, { namespace, id }) => hf(t, `/api/jobs/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`);
// /logs is a Server-Sent Events stream that stays open while the job runs, so
// reading it to the end would wait for the job itself. Read for a few seconds,
// then cancel, and turn each `data: {...}` frame into its log line.
export async function jobLogs(t, { namespace, id, tail = 200, deadlineMs = 4000 }) {
  const n = Math.max(1, Math.min(2000, Number(tail) || 200));
  const res = await hf(t, `/api/jobs/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}/logs?tail=${n}`, {
    raw: true,
    headers: { Accept: "text/event-stream" },
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let timedOut = false;
  const deadline = new Promise((r) => setTimeout(() => {
    timedOut = true;
    r({ done: true });
  }, deadlineMs));
  for (;;) {
    const { done, value } = await Promise.race([reader.read(), deadline]);
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  const lines = [];
  for (const raw of text.split("\n")) {
    if (!raw.startsWith("data:")) continue;
    const payload = raw.slice(5).trim();
    try {
      const j = JSON.parse(payload);
      lines.push(typeof j.data === "string" ? j.data : JSON.stringify(j));
    } catch (_) {
      lines.push(payload);
    }
  }
  return { lines: lines.slice(-n), stillStreaming: timedOut };
}
export const cancelJob = (t, { namespace, id }) =>
  hf(t, `/api/jobs/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}/cancel`, { method: "POST" });

/* ---------------- consumption ---------------- */

// Each part independently: a read token can see jobs but not billing, and one
// refusal should not hide the parts that answered.
// The Hub's OpenAPI declares usage-v2's startDate/endDate as INTEGERS; a
// YYYY-MM-DD string was refused and the {error} fallback hid it. Sent as epoch
// milliseconds (JavaScript's own unit) — `npm run ml:live` is what confirms it.
const epochMs = (d, endOfDay) => {
  const ms = Date.parse(`${d}T${endOfDay ? "23:59:59" : "00:00:00"}Z`);
  if (Number.isNaN(ms)) throw new HfInputError(`"${d}" is not a date. Use YYYY-MM-DD.`);
  return String(ms);
};
export async function usage(t, { startDate, endDate } = {}) {
  const q = new URLSearchParams();
  if (startDate) q.set("startDate", epochMs(startDate, false));
  if (endDate) q.set("endDate", epochMs(endDate, true));
  const [billing, jobs, zeroGpu] = await Promise.all([
    hf(t, `/api/settings/billing/usage-v2?${q}`).catch((e) => ({ error: e.message })),
    hf(t, "/api/settings/billing/usage/jobs").catch((e) => ({ error: e.message })),
    hf(t, "/api/spaces/zero-gpu/quota").catch((e) => ({ error: e.message })),
  ]);
  return { billing, jobs, zeroGpu };
}
