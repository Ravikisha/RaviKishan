// Kaggle — the network half. kagglesdk's convention, read from its source:
// every call is POST https://api.kaggle.com/v1/<service>/<Method> with a JSON
// body, authenticated by a bearer token (or HTTP Basic for a legacy key).
import {
  authHeader,
  kaggleError,
  KaggleInputError,
  normalizeStatus,
  shapeQuota,
  sortFor,
  splitRef,
} from "./kaggleShape.js";

const BASE = "https://api.kaggle.com/v1";

// Swappable for the no-network suite; null means the global fetch.
let fetchImpl = null;
export const setFetch = (fn) => {
  fetchImpl = fn;
};
const doFetch = (...a) => (fetchImpl || fetch)(...a);

export async function call(token, service, method, body = {}) {
  const res = await doFetch(`${BASE}/${service}/${method}`, {
    method: "POST",
    headers: { Authorization: authHeader(token), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let b = {};
    try {
      b = await res.json();
    } catch (_) {
      /* not JSON */
    }
    throw kaggleError(res.status, b);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

const K = "kernels.KernelsApiService";
const D = "datasets.DatasetApiService";
const C = "competitions.CompetitionApiService";
const M = "models.ModelApiService";

// Unset fields are left out rather than sent empty: an empty enum string is
// not "unspecified" to the server, it is an invalid value.
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && v !== null));

export const introspect = (t) => call(t, "security.OAuthService", "IntrospectToken", { token: t });

/* ---------------- search ---------------- */

export const searchDatasets = (t, { search, sort, user, page = 1, pageSize = 20 } = {}) =>
  call(t, D, "ListDatasets", clean({ search, sortBy: sortFor("datasets", sort), user, page, pageSize: Math.min(100, pageSize) }));
export const searchCompetitions = (t, { search, sort, category, page = 1 } = {}) =>
  call(t, C, "ListCompetitions", clean({ search, sortBy: sortFor("competitions", sort), category, page }));
export const searchKernels = (t, { search, sort, user, competition, dataset, page = 1, pageSize = 20 } = {}) =>
  call(t, K, "ListKernels", clean({ search, sortBy: sortFor("kernels", sort), user, competition, dataset, page, pageSize: Math.min(100, pageSize) }));
export const searchModels = (t, { search, sort, owner, pageSize = 20 } = {}) =>
  call(t, M, "ListModels", clean({ search, sortBy: sortFor("models", sort), owner, pageSize: Math.min(100, pageSize) }));

/* ---------------- datasets and competitions ---------------- */

export function getDataset(t, { ref }) {
  const { owner, slug } = splitRef(ref);
  return call(t, D, "GetDataset", { ownerSlug: owner, datasetSlug: slug });
}
export function listDatasetFiles(t, { ref }) {
  const { owner, slug } = splitRef(ref);
  return call(t, D, "ListDatasetFiles", { ownerSlug: owner, datasetSlug: slug, pageSize: 200 });
}
export const getCompetition = (t, { name }) => call(t, C, "GetCompetition", { competitionName: name });
export const leaderboard = (t, { name, pageSize = 50 }) => call(t, C, "GetLeaderboard", { competitionName: name, pageSize });
export const listSubmissions = (t, { name }) => call(t, C, "ListSubmissions", { competitionName: name, pageSize: 50 });

/* ---------------- kernels ---------------- */

export const pushKernel = (t, request) => call(t, K, "SaveKernel", request);

export async function kernelStatus(t, { ref }) {
  const { owner, slug } = splitRef(ref);
  const r = await call(t, K, "GetKernelSessionStatus", { userName: owner, kernelSlug: slug });
  return { ref, status: normalizeStatus(r.status), raw: r.status || "", failureMessage: r.failureMessage || "" };
}
export async function kernelOutput(t, { ref }) {
  const { owner, slug } = splitRef(ref);
  const r = await call(t, K, "ListKernelSessionOutput", { userName: owner, kernelSlug: slug, pageSize: 100 });
  return { files: (r.files || []).map((f) => ({ name: f.fileName, url: f.url })), log: r.log || "", next: r.nextPageToken || "" };
}
export function getKernel(t, { ref }) {
  const { owner, slug } = splitRef(ref);
  return call(t, K, "GetKernel", { userName: owner, kernelSlug: slug });
}
export const cancelKernel = (t, { sessionId }) => call(t, K, "CancelKernelSession", { kernelSessionId: Number(sessionId) });
export const quota = async (t) => shapeQuota(await call(t, K, "GetAcceleratorQuotaStatistics", {}));

/* ---------------- uploads ---------------- */

// Uploads are two steps: ask for a signed URL + token, PUT the bytes there,
// then hand the token to the create call.
export async function uploadBlob(t, { kind, competition, fileName, bytes }) {
  const meta = { fileName, contentLength: bytes.byteLength, lastModifiedEpochSeconds: Math.floor(Date.now() / 1000) };
  const start =
    kind === "submission"
      ? await call(t, C, "StartSubmissionUpload", { competitionName: competition, ...meta })
      : await call(t, D, "UploadDatasetFile", meta);
  if (!start.createUrl || !start.token) throw new KaggleInputError("Kaggle did not return an upload URL.");
  const put = await doFetch(start.createUrl, { method: "PUT", body: bytes, headers: { "Content-Type": "application/octet-stream" } });
  if (!put.ok) throw kaggleError(put.status, {});
  return start.token;
}

export async function createDatasetVersion(t, { ref, notes, files }) {
  const { owner, slug } = splitRef(ref);
  const tokens = [];
  for (const f of files) tokens.push({ token: await uploadBlob(t, { kind: "dataset", fileName: f.name, bytes: f.bytes }) });
  return call(t, D, "CreateDatasetVersion", {
    ownerSlug: owner,
    datasetSlug: slug,
    body: { versionNotes: notes || "Update", files: tokens },
  });
}

export async function submit(t, { competition, fileName, bytes, description }) {
  const token = await uploadBlob(t, { kind: "submission", competition, fileName, bytes });
  return call(t, C, "CreateSubmission", {
    competitionName: competition,
    blobFileTokens: token,
    submissionDescription: description || "",
  });
}
