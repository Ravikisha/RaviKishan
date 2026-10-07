// Hugging Face — the PURE half. No fetch, no Firestore, no environment, so
// every rule here is testable with plain node (scripts/ml-check.mjs).

export class HfInputError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.code = "hf/input";
  }
}

export const REPO_TYPES = ["model", "dataset", "space"];
const SEG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

export function assertRepoId(id) {
  const s = String(id || "").trim();
  const parts = s.split("/");
  if (parts.length !== 2 || !parts.every((p) => SEG.test(p) && p !== "." && p !== "..")) {
    throw new HfInputError(`"${s}" is not a repo id. Use owner/name, e.g. openai/whisper-tiny.`);
  }
  return s;
}

export function assertRepoType(t = "model") {
  const v = String(t || "model");
  if (!REPO_TYPES.includes(v)) throw new HfInputError(`Unknown repo type "${v}". Use one of ${REPO_TYPES.join(", ")}.`);
  return v;
}

export const apiBase = (type) => `${assertRepoType(type)}s`;
export const resolvePrefix = (type) => (assertRepoType(type) === "model" ? "" : `${type}s/`);

const SORTS = ["downloads", "likes", "trendingScore", "lastModified", "createdAt"];

export function searchQuery({ search, author, filter, sort, limit = 20, full } = {}) {
  const q = new URLSearchParams();
  if (search) q.set("search", String(search));
  if (author) q.set("author", String(author));
  for (const f of [].concat(filter || [])) if (f) q.append("filter", String(f));
  if (sort) {
    if (!SORTS.includes(sort)) throw new HfInputError(`Unknown sort "${sort}". Use one of ${SORTS.join(", ")}.`);
    q.set("sort", sort);
    q.set("direction", "-1");
  }
  q.set("limit", String(Math.max(1, Math.min(100, Number(limit) || 20))));
  if (full) q.set("full", "true");
  return q;
}

export function shapeRepo(raw = {}, type = "model") {
  const id = raw.id || raw.modelId || "";
  return {
    id,
    type,
    author: raw.author || id.split("/")[0] || "",
    downloads: raw.downloads || 0,
    likes: raw.likes || 0,
    tags: raw.tags || [],
    pipeline: raw.pipeline_tag || "",
    lastModified: raw.lastModified || "",
    private: !!raw.private,
    gated: raw.gated || false,
    url: `https://huggingface.co/${resolvePrefix(type)}${id}`,
  };
}

// From the Hub's own OpenAPI document (POST /api/jobs/{namespace}, `flavor`).
export const JOB_FLAVORS = [
  "cpu-basic", "cpu-upgrade", "cpu-performance", "cpu-xl", "sprx8", "zero-a10g",
  "t4-small", "t4-medium", "l4x1", "l4x4", "l40sx1", "l40sx4", "l40sx8",
  "a10g-small", "a10g-large", "a10g-largex2", "a10g-largex4",
  "a100-large", "a100x4", "a100x8", "h200", "h200x2", "h200x4", "h200x8",
];

export function assertFlavor(f) {
  if (!JOB_FLAVORS.includes(f)) throw new HfInputError(`Unknown hardware flavor "${f}". Use one of ${JOB_FLAVORS.join(", ")}.`);
  return f;
}

export const MAX_COMMIT_BYTES = 10 * 1024 * 1024;

const safePath = (p) => {
  const s = String(p || "");
  if (!s || s.startsWith("/") || s.split("/").some((x) => x === ".." || x === "")) {
    throw new HfInputError(`"${s}" is not a usable file path inside a repo.`);
  }
  return s;
};

// Decides, before any commit is attempted, whether these files can go in one
// inline commit. HF's preupload answer says which files must be LFS; LFS is
// not implemented here, so those are refused by name rather than half-pushed.
export function planCommit(files, preupload = { files: [] }) {
  let totalBytes = 0;
  for (const f of files) {
    safePath(f.path);
    totalBytes += f.bytes.byteLength;
  }
  if (totalBytes > MAX_COMMIT_BYTES) {
    throw new HfInputError(`This commit is ${(totalBytes / 1048576).toFixed(1)} MB; inline commits are capped at 10 MB.`);
  }
  const lfs = (preupload.files || []).filter((x) => x.uploadMode === "lfs").map((x) => x.path);
  if (lfs.length) {
    throw new HfInputError(
      `${lfs.join(", ")} must be uploaded through LFS, which this tool does not do. Commit small text/JSON files here and large weights from a CLI.`
    );
  }
  return { ok: true, totalBytes };
}

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

// The commit endpoint takes newline-delimited JSON: a header, then one line
// per added file and one per deleted file.
export function commitNdjson({ summary, description = "", files = [], deletes = [] }) {
  const lines = [{ key: "header", value: { summary: String(summary || "Update"), description } }];
  for (const f of files) lines.push({ key: "file", value: { path: safePath(f.path), content: b64(f.bytes), encoding: "base64" } });
  for (const d of deletes) lines.push({ key: "deletedFile", value: { path: safePath(d) } });
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

export function hfError(status, body = {}, role = "") {
  const said = body.error || body.message || "";
  let msg;
  if (status === 401) {
    msg = "Hugging Face rejected the stored token (401). It was probably revoked — paste a new one in the Accounts tab.";
  } else if (status === 403) {
    msg =
      role === "read"
        ? "This is a read token, so Hugging Face refused a write. Paste a write or fine-grained token in the Accounts tab."
        : `Hugging Face refused this (403)${said ? `: ${said}` : ""}. A fine-grained token may be missing this permission.`;
  } else if (status === 404) {
    msg = `Not found on Hugging Face${said ? `: ${said}` : ""}.`;
  } else if (status === 429) {
    msg = "Hugging Face rate-limited this request (429). Wait a minute and retry.";
  } else {
    msg = `Hugging Face answered ${status}${said ? `: ${said}` : ""}.`;
  }
  const e = new Error(msg);
  e.status = status;
  e.code = `hf/${status}`;
  return e;
}
