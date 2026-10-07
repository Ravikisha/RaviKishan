// Kaggle — the PURE half. Field names follow kagglesdk's request classes
// (camelCase JSON); enum values are sent as their string names. Nothing here
// touches the network, so every rule is testable with plain node.

export class KaggleInputError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.code = "kaggle/input";
  }
}

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
export function splitRef(ref) {
  const parts = String(ref || "").trim().split("/");
  if (parts.length !== 2 || !parts.every((p) => SLUG.test(p))) {
    throw new KaggleInputError(`"${ref}" is not a Kaggle reference. Use owner/slug, e.g. ravi/titanic-baseline.`);
  }
  return { owner: parts[0], slug: parts[1] };
}

// Kaggle has RETIRED the P100 and the v3-8 TPU: a request for either runs on
// the T4 / v5e-8 instead (kagglesdk's own _RETIRED_ACCELERATORS). The aliases
// ask for what will actually run, so a status or a quota reading is not
// describing hardware that was never used.
export const ACCELERATORS = {
  t4: "NvidiaTeslaT4",
  p100: "NvidiaTeslaT4",
  t4highmem: "NvidiaTeslaT4Highmem",
  l4: "NvidiaL4",
  l4x1: "NvidiaL4X1",
  a100: "NvidiaTeslaA100",
  h100: "NvidiaH100",
  rtxpro6000: "NvidiaRtxPro6000",
  tpu: "TpuV5E8",
};
const SHAPES = new Set(Object.values(ACCELERATORS));
const isTpu = (shape) => /^Tpu/.test(shape || "");

export function machineShape(acc) {
  if (!acc) return null;
  if (SHAPES.has(acc)) return acc;
  const hit = ACCELERATORS[String(acc).toLowerCase()];
  if (!hit) {
    throw new KaggleInputError(
      `Unknown accelerator "${acc}". Use one of ${Object.keys(ACCELERATORS)
        .map((k) => k.toUpperCase())
        .join(", ")} (the free tier is T4).`
    );
  }
  return hit;
}

export function kernelRequest({
  ref,
  title,
  source,
  kind = "notebook",
  language = "python",
  accelerator,
  internet = true,
  isPrivate = true,
  datasets = [],
  competitions = [],
  kernels = [],
  models = [],
  timeoutSeconds,
}) {
  splitRef(ref);
  // Publishing a notebook is a disclosure, so it is never done from here.
  if (isPrivate === false) throw new KaggleInputError("Kernels are kept private here; publish one from kaggle.com if you mean to.");
  if (!["notebook", "script"].includes(kind)) throw new KaggleInputError("kind must be notebook or script.");
  if (!["python", "r"].includes(language)) throw new KaggleInputError("language must be python or r.");
  if (!title) throw new KaggleInputError("A kernel needs a title.");
  if (!source) throw new KaggleInputError("A kernel needs source (notebook JSON or script text).");
  const shape = machineShape(accelerator);
  const req = {
    slug: ref,
    newTitle: title,
    text: source,
    language,
    kernelType: kind,
    isPrivate: true,
    enableGpu: !!shape && !isTpu(shape),
    enableTpu: isTpu(shape),
    enableInternet: !!internet,
    datasetDataSources: datasets,
    competitionDataSources: competitions,
    kernelDataSources: kernels,
    modelDataSources: models,
  };
  if (shape) req.machineShape = shape;
  if (timeoutSeconds) req.sessionTimeoutSeconds = Math.max(60, Number(timeoutSeconds));
  return req;
}

export function notebookFromCells(cells = []) {
  const lines = (s) => String(s).split(/(?<=\n)/);
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: "python3", display_name: "Python 3", language: "python" },
      language_info: { name: "python" },
    },
    cells: cells.map((c) =>
      c.type === "markdown"
        ? { cell_type: "markdown", metadata: {}, source: lines(c.source) }
        : { cell_type: "code", metadata: {}, execution_count: null, outputs: [], source: lines(c.source) }
    ),
  });
}

const STATUS = {
  QUEUED: "queued",
  NEW_SCRIPT: "queued",
  RUNNING: "running",
  COMPLETE: "complete",
  ERROR: "error",
  CANCEL_REQUESTED: "cancelled",
  CANCEL_ACKNOWLEDGED: "cancelled",
};
export function normalizeStatus(s) {
  const key = String(s || "").split(".").pop().toUpperCase();
  return STATUS[key] || "unknown";
}

// A protobuf Duration arrives as "123.5s" in JSON, but be liberal: a number
// or a {seconds, nanos} object is the same value.
export function seconds(d) {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  if (typeof d === "string") return parseFloat(d) || 0;
  if (typeof d === "object") return (Number(d.seconds) || 0) + (Number(d.nanos) || 0) / 1e9;
  return 0;
}

const hours = (s) => Math.round((s / 3600) * 100) / 100;
const quotaOf = (q = {}) => {
  const used = seconds(q.timeUsed);
  const limit = seconds(q.totalTimeAllowed);
  return { usedHours: hours(used), limitHours: hours(limit), leftHours: hours(Math.max(0, limit - used)) };
};
export function shapeQuota(r = {}) {
  return { refreshesAt: r.quotaRefreshTime || "", gpu: quotaOf(r.gpuQuota), tpu: quotaOf(r.tpuQuota) };
}

const SORTS = {
  datasets: {
    hottest: "DATASET_SORT_BY_HOTTEST",
    votes: "DATASET_SORT_BY_VOTES",
    updated: "DATASET_SORT_BY_UPDATED",
    active: "DATASET_SORT_BY_ACTIVE",
    published: "DATASET_SORT_BY_PUBLISHED",
    relevance: "DATASET_SORT_BY_RELEVANCE",
    usability: "DATASET_SORT_BY_USABILITY",
    downloads: "DATASET_SORT_BY_DOWNLOAD_COUNT",
  },
  competitions: {
    grouped: "COMPETITION_SORT_BY_GROUPED",
    best: "COMPETITION_SORT_BY_BEST",
    prize: "COMPETITION_SORT_BY_PRIZE",
    deadline: "COMPETITION_SORT_BY_EARLIEST_DEADLINE",
    teams: "COMPETITION_SORT_BY_NUMBER_OF_TEAMS",
    relevance: "COMPETITION_SORT_BY_RELEVANCE",
    recent: "COMPETITION_SORT_BY_RECENTLY_CREATED",
  },
  kernels: {
    hotness: "HOTNESS",
    comments: "COMMENT_COUNT",
    created: "DATE_CREATED",
    run: "DATE_RUN",
    relevance: "RELEVANCE",
    score: "SCORE_DESCENDING",
    views: "VIEW_COUNT",
    votes: "VOTE_COUNT",
  },
  models: {
    hotness: "LIST_MODELS_ORDER_BY_HOTNESS",
    downloads: "LIST_MODELS_ORDER_BY_DOWNLOAD_COUNT",
    votes: "LIST_MODELS_ORDER_BY_VOTE_COUNT",
    notebooks: "LIST_MODELS_ORDER_BY_NOTEBOOK_COUNT",
    published: "LIST_MODELS_ORDER_BY_PUBLISH_TIME",
    updated: "LIST_MODELS_ORDER_BY_UPDATE_TIME",
  },
};
export function sortFor(kind, sort) {
  if (!sort) return undefined;
  const hit = SORTS[kind]?.[sort];
  if (!hit) {
    throw new KaggleInputError(`Unknown sort "${sort}" for ${kind}. Use one of ${Object.keys(SORTS[kind] || {}).join(", ")}.`);
  }
  return hit;
}
export const SORT_NAMES = Object.fromEntries(Object.entries(SORTS).map(([k, v]) => [k, Object.keys(v)]));

// A legacy kaggle.json key is stored pre-encoded as "Basic …" so the rest of
// the system can treat every credential as one opaque string.
export const authHeader = (token) => (String(token).startsWith("Basic ") ? String(token) : `Bearer ${token}`);

export function kaggleError(status, body = {}) {
  const said = body.message || body.error || "";
  let msg;
  if (status === 401) {
    msg = "Kaggle rejected the stored token (401). It expired or was revoked — generate a new one at kaggle.com/settings and paste it in the Accounts tab.";
  } else if (status === 403) {
    msg = `Kaggle refused this (403)${said ? `: ${said}` : ""}. For a competition, accept its rules on kaggle.com first.`;
  } else if (status === 404) {
    msg = `Not found on Kaggle${said ? `: ${said}` : ""}.`;
  } else if (status === 429) {
    msg = "Kaggle rate-limited this request (429). Wait and retry.";
  } else {
    msg = `Kaggle answered ${status}${said ? `: ${said}` : ""}.`;
  }
  const e = new Error(msg);
  e.status = status;
  e.code = `kaggle/${status}`;
  return e;
}
