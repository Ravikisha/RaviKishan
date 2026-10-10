// MCP tools for the ML lab: Hugging Face and Kaggle. Kept out of mcpTools.js
// (already ~4,700 lines) and spread into TOOLS there, so the registry, scope
// filtering and mcp:check treat them exactly like every other family.
//
// Every tool resolves its account through the directory under the `ml` job:
// explicit accountId > saved default > the only one connected, and it refuses
// rather than guessing between two.
import * as directory from "./accountDirectory.js";
import * as hf from "./huggingface.js";
import { assertFlavor, assertWritable, jobCostEstimate } from "./hfShape.js";
import * as kg from "./kaggle.js";
import { kernelRequest, notebookFromCells, SORT_NAMES } from "./kaggleShape.js";
import { getDocument, createDocument } from "./firestoreRest.js";
import { accountPath, assertAccountOrg } from "./connectedStore.js";
import { currentOrg } from "./orgContext.js";
import { unseal, getProvider } from "./integrations.js";
import { credentialMaterial } from "./mlKeys.js";

const str = { type: "string" };
const accountArg = {
  type: "string",
  description: "Which connected account. Optional when only one of that provider is connected.",
};
const repoType = { type: "string", enum: ["model", "dataset", "space"], description: "Default model." };

export async function mlCtx(idToken, provider, accountId) {
  return directory.tokenFor(idToken, { service: "ml", provider, accountId });
}
const hfTok = async (idToken, accountId) => (await mlCtx(idToken, "huggingface", accountId)).token;
const hfMe = async (idToken, accountId) => {
  const { token, account } = await mlCtx(idToken, "huggingface", accountId);
  return { token, me: account.accountId, role: account.scope || "" };
};
// The token role was recorded at connect time (whoami's auth.accessToken.role).
// A read token is refused BEFORE a write is attempted, naming the real cause.
const hfWrite = async (idToken, accountId, action) => {
  const { token, me, role } = await hfMe(idToken, accountId);
  assertWritable(role, action);
  return { token, me };
};

/* ---------- Hugging Face ---------- */

const HF_TOOLS = [
  {
    name: "hf_whoami",
    description:
      "The connected Hugging Face account: username, orgs, token role (read/write/fineGrained). Start here to see which account a tool will act as.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg } },
    handler: async (a, { idToken }) => {
      const j = await hf.whoami(await hfTok(idToken, a.accountId));
      return {
        name: j.name,
        fullname: j.fullname,
        orgs: (j.orgs || []).map((o) => o.name),
        role: j.auth?.accessToken?.role || "",
        isPro: !!j.isPro,
      };
    },
  },
  {
    name: "hf_search",
    description:
      "Search the Hugging Face Hub for models, datasets or Spaces (type: model|dataset|space|all). Filter by author or tags (e.g. text-classification, pytorch), sort by downloads|likes|trendingScore|lastModified|createdAt, limit ≤ 100.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        accountId: accountArg,
        type: { type: "string", enum: ["model", "dataset", "space", "all"] },
        search: str,
        author: str,
        filter: { type: "array", items: str },
        sort: str,
        limit: { type: "number" },
      },
    },
    handler: async (a, { idToken }) => {
      const t = await hfTok(idToken, a.accountId);
      const q = { search: a.search, author: a.author, filter: a.filter, sort: a.sort, limit: a.limit };
      if ((a.type || "model") !== "all") return hf.search(t, { type: a.type || "model", ...q });
      const [models, datasets, spaces] = await Promise.all(
        ["model", "dataset", "space"].map((type) => hf.search(t, { type, ...q }))
      );
      return { models, datasets, spaces };
    },
  },
  {
    name: "hf_search_papers",
    description: "Search papers indexed on Hugging Face (arXiv-backed) by free text. Returns ids, titles, summaries and linked repos.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, q: str }, required: ["q"] },
    handler: async (a, { idToken }) => hf.searchPapers(await hfTok(idToken, a.accountId), { q: a.q }),
  },
  {
    name: "hf_daily_papers",
    description: "Hugging Face's daily papers feed, optionally for a date (YYYY-MM-DD). Good for staying current on what is new.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, date: str } },
    handler: async (a, { idToken }) => hf.dailyPapers(await hfTok(idToken, a.accountId), { date: a.date }),
  },
  {
    name: "hf_semantic_search_spaces",
    description:
      "Semantic (meaning-based) search over Hugging Face Spaces — 'a demo that removes image backgrounds' finds apps whose names never say so.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, q: str }, required: ["q"] },
    handler: async (a, { idToken }) => hf.semanticSearchSpaces(await hfTok(idToken, a.accountId), { q: a.q }),
  },
  {
    name: "hf_search_docs",
    description: "Search Hugging Face documentation (transformers, datasets, hub, …) and return matching pages.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, q: str }, required: ["q"] },
    handler: async (a, { idToken }) => hf.searchDocs(await hfTok(idToken, a.accountId), { q: a.q }),
  },
  {
    name: "hf_get_repo",
    description:
      "One Hugging Face repo (model, dataset or Space): card data, file list, downloads, likes, tags, gating, last commit sha.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, type: repoType, id: str }, required: ["id"] },
    handler: async (a, { idToken }) => hf.getRepo(await hfTok(idToken, a.accountId), { type: a.type, id: a.id }),
  },
  {
    name: "hf_list_files",
    description: "List files in a Hugging Face repo at a revision and path, with sizes; recursive optional.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { accountId: accountArg, type: repoType, id: str, rev: str, path: str, recursive: { type: "boolean" } },
      required: ["id"],
    },
    handler: async (a, { idToken }) => hf.listFiles(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_read_file",
    description:
      "Read a text file from a Hugging Face repo (README, config.json, metrics). Text only, first 200 KB; a binary file returns its size and no content.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { accountId: accountArg, type: repoType, id: str, rev: str, path: str },
      required: ["id", "path"],
    },
    handler: async (a, { idToken }) => hf.readFile(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_list_commits",
    description: "Commit history of a Hugging Face repo at a revision.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, type: repoType, id: str, rev: str }, required: ["id"] },
    handler: async (a, { idToken }) => hf.listCommits(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_list_my_repos",
    description:
      "Repos owned by the connected account (or an org it belongs to): models, datasets or Spaces, private ones included, newest change first.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, type: repoType, owner: str } },
    handler: async (a, { idToken }) => {
      const { token, me } = await hfMe(idToken, a.accountId);
      return hf.search(token, { type: a.type || "model", author: a.owner || me, limit: 100, sort: "lastModified" });
    },
  },
  {
    name: "hf_list_collections",
    description: "List Hugging Face collections, by owner and/or a search term.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, owner: str, q: str, limit: { type: "number" } } },
    handler: async (a, { idToken }) => hf.listCollections(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_get_collection",
    description: "One Hugging Face collection by its slug (namespace/slug-id), with its items.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, slug: str }, required: ["slug"] },
    handler: async (a, { idToken }) => hf.getCollection(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_create_repo",
    description:
      "Create a Hugging Face model, dataset or Space repo. PRIVATE by default — pass private:false only when the owner asked for a public repo. A Space needs sdk (gradio|docker|static).",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: { accountId: accountArg, type: repoType, name: str, organization: str, private: { type: "boolean" }, sdk: str },
      required: ["name"],
    },
    handler: async (a, { idToken }) => hf.createRepo((await hfWrite(idToken, a.accountId, "create a repo")).token, a),
  },
  {
    name: "hf_commit_files",
    description:
      "Commit text/JSON files to a Hugging Face repo in one commit (model cards, configs, metrics, small scripts). Each file: {path, content} or {path, contentBase64}. ≤ 10 MB total; files HF requires LFS for (weights) are refused by name — push those from a CLI.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        accountId: accountArg,
        type: repoType,
        id: str,
        rev: str,
        summary: str,
        description: str,
        files: {
          type: "array",
          items: { type: "object", properties: { path: str, content: str, contentBase64: str }, required: ["path"] },
        },
      },
      required: ["id", "summary", "files"],
    },
    handler: async (a, { idToken }) => hf.commitFiles((await hfWrite(idToken, a.accountId, "commit")).token, a),
  },
  {
    name: "hf_delete_file",
    description: "Delete files from a Hugging Face repo as one commit. Needs confirm:true. Git history keeps the old content.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: { accountId: accountArg, type: repoType, id: str, rev: str, paths: { type: "array", items: str }, confirm: { type: "boolean" } },
      required: ["id", "paths"],
    },
    handler: async (a, { idToken }) => {
      if (a.confirm !== true) {
        return { isError: true, error: `Deleting ${(a.paths || []).join(", ")} from ${a.id} needs confirm:true.` };
      }
      return hf.commitFiles((await hfWrite(idToken, a.accountId, "delete files")).token, {
        type: a.type,
        id: a.id,
        rev: a.rev,
        summary: `Delete ${a.paths.join(", ")}`,
        files: [],
        deletes: a.paths,
      });
    },
  },
  {
    name: "hf_add_to_collection",
    description:
      "Add a model, dataset, Space, paper or collection to one of your Hugging Face collections, with an optional note (≤ 500 chars).",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        accountId: accountArg,
        slug: str,
        itemType: { type: "string", enum: ["paper", "collection", "space", "model", "dataset"] },
        itemId: str,
        note: str,
      },
      required: ["slug", "itemType", "itemId"],
    },
    handler: async (a, { idToken }) => hf.addToCollection((await hfWrite(idToken, a.accountId, "change a collection")).token, a),
  },
  {
    name: "hf_space_status",
    description: "A Space's runtime: stage (RUNNING, BUILDING, SLEEPING, RUNTIME_ERROR…), hardware and error message if any.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, id: str }, required: ["id"] },
    handler: async (a, { idToken }) => hf.spaceRuntime(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_restart_space",
    description: "Restart a Hugging Face Space (e.g. after changing a secret or when stuck).",
    scope: "write",
    inputSchema: { type: "object", properties: { accountId: accountArg, id: str }, required: ["id"] },
    handler: async (a, { idToken }) => hf.restartSpace((await hfWrite(idToken, a.accountId, "restart a Space")).token, a),
  },
  {
    name: "hf_set_space_secret",
    description:
      "Set a secret on a Hugging Face Space (key/value; the value is never returned). The Space must be restarted to read it. Behind the secrets scope like every other tool that handles a credential value: it puts one into third-party infrastructure.",
    scope: "secrets",
    inputSchema: {
      type: "object",
      properties: { accountId: accountArg, id: str, key: str, value: str, description: str },
      required: ["id", "key", "value"],
    },
    handler: async (a, { idToken }) => {
      await hf.setSpaceSecret((await hfWrite(idToken, a.accountId, "set a Space secret")).token, a);
      return { id: a.id, key: a.key, set: true, note: "Restart the Space for it to take effect." };
    },
  },
  {
    name: "hf_inference",
    description:
      "Run a chat completion on a model through Hugging Face Inference Providers (OpenAI-compatible router). Spends the account's inference credits — keep maxTokens small.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        accountId: accountArg,
        model: str,
        messages: { type: "array", items: { type: "object", properties: { role: str, content: str } } },
        maxTokens: { type: "number" },
      },
      required: ["model", "messages"],
    },
    handler: async (a, { idToken }) => hf.inference(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_jobs_hardware",
    description: "Hardware flavors available to Hugging Face Jobs with their per-hour prices. Read this before hf_run_job to pick and cost a flavor.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg } },
    handler: async (a, { idToken }) => hf.jobsHardware(await hfTok(idToken, a.accountId)),
  },
  {
    name: "hf_run_job",
    description:
      "Run a command on Hugging Face Jobs (paid per minute): a Docker image OR a Space, a command array, env, secrets, a hardware flavor and a timeout. dryRun:true returns the worst-case cost (flavor price × timeout) without starting anything — do that first.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        accountId: accountArg,
        namespace: str,
        image: str,
        spaceId: str,
        command: { type: "array", items: str },
        args: { type: "array", items: str },
        env: { type: "object" },
        secrets: { type: "object" },
        flavor: str,
        timeoutSeconds: { type: "number" },
        dryRun: { type: "boolean" },
      },
      required: ["command", "flavor"],
    },
    handler: async (a, { idToken }) => {
      assertFlavor(a.flavor);
      const { token, me } = a.dryRun ? await hfMe(idToken, a.accountId) : await hfWrite(idToken, a.accountId, "run a job");
      const namespace = a.namespace || me;
      if (a.dryRun) {
        const hw = await hf.jobsHardware(token);
        const rows = Array.isArray(hw) ? hw : hw.hardware || [];
        const row = rows.find((h) => h.name === a.flavor) || null;
        const timeout = a.timeoutSeconds || 1800;
        return { dryRun: true, namespace, flavor: a.flavor, timeoutSeconds: timeout, ...jobCostEstimate(row, timeout), priceRow: row };
      }
      return hf.runJob(token, { ...a, namespace });
    },
  },
  {
    name: "hf_list_jobs",
    description: "Hugging Face Jobs in a namespace (default: your username), newest first, with status.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, namespace: str } },
    handler: async (a, { idToken }) => {
      const { token, me } = await hfMe(idToken, a.accountId);
      return hf.listJobs(token, { namespace: a.namespace || me });
    },
  },
  {
    name: "hf_get_job",
    description: "One Hugging Face Job: status stage, flavor, timing, command.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, namespace: str, id: str }, required: ["id"] },
    handler: async (a, { idToken }) => {
      const { token, me } = await hfMe(idToken, a.accountId);
      return hf.getJob(token, { namespace: a.namespace || me, id: a.id });
    },
  },
  {
    name: "hf_job_logs",
    description: "The last N lines (default 200, max 2000) of a Hugging Face Job's logs.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { accountId: accountArg, namespace: str, id: str, tail: { type: "number" } },
      required: ["id"],
    },
    handler: async (a, { idToken }) => {
      const { token, me } = await hfMe(idToken, a.accountId);
      return hf.jobLogs(token, { namespace: a.namespace || me, id: a.id, tail: a.tail });
    },
  },
  {
    name: "hf_cancel_job",
    description: "Cancel a running Hugging Face Job (stops billing).",
    scope: "write",
    inputSchema: { type: "object", properties: { accountId: accountArg, namespace: str, id: str }, required: ["id"] },
    handler: async (a, { idToken }) => {
      const { token, me } = await hfWrite(idToken, a.accountId, "cancel a job");
      return hf.cancelJob(token, { namespace: a.namespace || me, id: a.id });
    },
  },
  {
    name: "hf_usage",
    description:
      "What the Hugging Face account has consumed: billing usage for a date range (YYYY-MM-DD, default this month), Jobs usage, and the ZeroGPU quota. A part HF refuses (e.g. a read token on billing) comes back as {error} rather than failing the rest.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, startDate: str, endDate: str } },
    handler: async (a, { idToken }) => {
      const now = new Date();
      const start = a.startDate || `${now.toISOString().slice(0, 8)}01`;
      return hf.usage(await hfTok(idToken, a.accountId), {
        startDate: start,
        endDate: a.endDate || now.toISOString().slice(0, 10),
      });
    },
  },
];

/* ---------- Kaggle ---------- */
//
// Kaggle is the free, unattended runner: push a private kernel, poll its
// status, read its output. Everything a kernel needs (datasets, competitions,
// models) is mounted read-only under /kaggle/input; it writes to /kaggle/working.

const kgTok = async (idToken, accountId) => (await mlCtx(idToken, "kaggle", accountId)).token;
const kgMe = async (idToken, accountId) => {
  const { token, account } = await mlCtx(idToken, "kaggle", accountId);
  return { token, me: account.accountId };
};
const enc = new TextEncoder();
const bytesOf = (f) =>
  f.contentBase64 ? new Uint8Array(Buffer.from(f.contentBase64, "base64")) : enc.encode(String(f.content ?? ""));
const MAX_UPLOAD = 10 * 1024 * 1024;

const KAGGLE_TOOLS = [
  {
    name: "kaggle_whoami",
    description: "The connected Kaggle account (username) and this week's GPU/TPU quota. Start here before pushing a kernel.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg } },
    handler: async (a, { idToken }) => {
      const { token, me } = await kgMe(idToken, a.accountId);
      return { username: me, quota: await kg.quota(token) };
    },
  },
  {
    name: "kaggle_search_datasets",
    description: `Search Kaggle datasets by text, owner, sort (${SORT_NAMES.datasets.join("|")}), page.`,
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { accountId: accountArg, search: str, sort: str, user: str, page: { type: "number" }, pageSize: { type: "number" } },
    },
    handler: async (a, { idToken }) => kg.searchDatasets(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_search_competitions",
    description: `Search Kaggle competitions by text, category, sort (${SORT_NAMES.competitions.join("|")}).`,
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, search: str, sort: str, category: str, page: { type: "number" } } },
    handler: async (a, { idToken }) => kg.searchCompetitions(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_search_notebooks",
    description: `Search Kaggle notebooks (kernels) by text, author, competition or dataset; sort (${SORT_NAMES.kernels.join("|")}). Good for finding strong baselines to learn from.`,
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        accountId: accountArg,
        search: str,
        sort: str,
        user: str,
        competition: str,
        dataset: str,
        page: { type: "number" },
        pageSize: { type: "number" },
      },
    },
    handler: async (a, { idToken }) => kg.searchKernels(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_search_models",
    description: `Search Kaggle Models by text and owner; sort (${SORT_NAMES.models.join("|")}).`,
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, search: str, sort: str, owner: str, pageSize: { type: "number" } } },
    handler: async (a, { idToken }) => kg.searchModels(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_get_dataset",
    description: "One Kaggle dataset by owner/slug: title, size, license, usability, versions.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, ref: str }, required: ["ref"] },
    handler: async (a, { idToken }) => kg.getDataset(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_list_dataset_files",
    description: "Files in a Kaggle dataset (owner/slug) with sizes — read before referencing paths under /kaggle/input in a kernel.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, ref: str }, required: ["ref"] },
    handler: async (a, { idToken }) => kg.listDatasetFiles(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_get_competition",
    description: "One Kaggle competition by its url name (e.g. titanic): deadline, metric, reward, whether you have entered.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, name: str }, required: ["name"] },
    handler: async (a, { idToken }) => kg.getCompetition(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_leaderboard",
    description: "The public leaderboard of a Kaggle competition (top N).",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, name: str, pageSize: { type: "number" } }, required: ["name"] },
    handler: async (a, { idToken }) => kg.leaderboard(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_list_submissions",
    description: "Your submissions to a Kaggle competition with their public scores and status.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, name: str }, required: ["name"] },
    handler: async (a, { idToken }) => kg.listSubmissions(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_push_kernel",
    description:
      "Create or update a PRIVATE Kaggle notebook/script and run it on Kaggle (free GPU: accelerator T4; weekly quota — check kaggle_whoami). Give either source (notebook JSON or script text) or cells [{type:code|markdown, source}]. ref is your-username/slug. Inputs mount under /kaggle/input; write outputs (and metrics.json) to /kaggle/working. Poll kaggle_kernel_status, then read kaggle_kernel_output.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        accountId: accountArg,
        ref: str,
        title: str,
        kind: { type: "string", enum: ["notebook", "script"] },
        language: { type: "string", enum: ["python", "r"] },
        source: str,
        cells: { type: "array", items: { type: "object", properties: { type: str, source: str } } },
        accelerator: str,
        internet: { type: "boolean" },
        timeoutSeconds: { type: "number" },
        datasets: { type: "array", items: str },
        competitions: { type: "array", items: str },
        kernels: { type: "array", items: str },
        models: { type: "array", items: str },
      },
      required: ["ref", "title"],
    },
    handler: async (a, { idToken }) => {
      const { token, me } = await kgMe(idToken, a.accountId);
      if (!String(a.ref || "").startsWith(`${me}/`)) {
        return { isError: true, error: `ref must be under your own account: ${me}/<slug>.` };
      }
      const kind = a.cells ? "notebook" : a.kind || "script";
      const source = a.cells ? notebookFromCells(a.cells) : a.source;
      const out = await kg.pushKernel(token, kernelRequest({ ...a, kind, source }));
      if (out.error) {
        return {
          isError: true,
          error: out.error,
          invalid: {
            tags: out.invalidTags,
            datasets: out.invalidDatasetSources,
            competitions: out.invalidCompetitionSources,
            kernels: out.invalidKernelSources,
            models: out.invalidModelSources,
          },
        };
      }
      return {
        ref: out.ref || a.ref,
        url: out.url,
        version: out.versionNumber,
        next: "Poll kaggle_kernel_status every minute or two; output is available once it reads complete.",
      };
    },
  },
  {
    name: "kaggle_kernel_status",
    description: "Status of your Kaggle kernel's latest run: queued | running | complete | error | cancelled, with the failure message on error.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, ref: str }, required: ["ref"] },
    handler: async (a, { idToken }) => kg.kernelStatus(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_kernel_output",
    description: "Output files (with download URLs) and the run log of a Kaggle kernel. The log is only filled once the run is complete or errored.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, ref: str }, required: ["ref"] },
    handler: async (a, { idToken }) => {
      const out = await kg.kernelOutput(await kgTok(idToken, a.accountId), a);
      return { ...out, log: out.log.length > 20000 ? `…${out.log.slice(-20000)}` : out.log };
    },
  },
  {
    name: "kaggle_get_kernel",
    description: "A Kaggle kernel's metadata and source (its code), e.g. to study or fork a public baseline.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, ref: str }, required: ["ref"] },
    handler: async (a, { idToken }) => kg.getKernel(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_cancel_kernel",
    description: "Cancel a running Kaggle kernel session by its numeric session id (stops spending GPU quota).",
    scope: "write",
    inputSchema: { type: "object", properties: { accountId: accountArg, sessionId: { type: "number" } }, required: ["sessionId"] },
    handler: async (a, { idToken }) => kg.cancelKernel(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_quota",
    description: "This week's Kaggle GPU and TPU quota: hours used, limit, hours left, and when it refreshes.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg } },
    handler: async (a, { idToken }) => kg.quota(await kgTok(idToken, a.accountId)),
  },
  {
    name: "kaggle_create_dataset_version",
    description:
      "Publish a new version of one of your Kaggle datasets from small files (≤ 10 MB total): [{name, content|contentBase64}] plus version notes. A Kaggle version is a full SNAPSHOT: the new version holds ONLY the files sent, and every file not sent disappears from it — so this needs replaceAll:true. Send every file the dataset should contain. Visibility is unchanged.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        accountId: accountArg,
        ref: str,
        notes: str,
        replaceAll: { type: "boolean", description: "Must be true: the version holds only the files sent." },
        files: {
          type: "array",
          items: { type: "object", properties: { name: str, content: str, contentBase64: str }, required: ["name"] },
        },
      },
      required: ["ref", "files"],
    },
    handler: async (a, { idToken }) => {
      if (a.replaceAll !== true) {
        return {
          isError: true,
          error: `A new version of ${a.ref} will contain ONLY the ${(a.files || []).length} file(s) sent; everything else drops out of it. Send the complete file set with replaceAll:true. (kaggle_list_dataset_files shows what is there now.)`,
        };
      }
      const files = (a.files || []).map((f) => ({ name: f.name, bytes: bytesOf(f) }));
      const total = files.reduce((n, f) => n + f.bytes.byteLength, 0);
      if (total > MAX_UPLOAD) {
        return { isError: true, error: `These files are ${(total / 1048576).toFixed(1)} MB; the limit here is 10 MB.` };
      }
      return kg.createDatasetVersion(await kgTok(idToken, a.accountId), { ref: a.ref, notes: a.notes, files });
    },
  },
  {
    name: "kaggle_submit",
    description:
      "Submit a predictions file to a Kaggle competition. Uses one of a FINITE number of daily submissions, so it needs confirm:true. You must have accepted the competition's rules on kaggle.com.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        accountId: accountArg,
        competition: str,
        fileName: str,
        content: str,
        contentBase64: str,
        description: str,
        confirm: { type: "boolean" },
      },
      required: ["competition", "fileName"],
    },
    handler: async (a, { idToken }) => {
      if (a.confirm !== true) {
        return { isError: true, error: `Submitting to ${a.competition} spends a daily submission; call again with confirm:true.` };
      }
      const bytes = bytesOf(a);
      if (bytes.byteLength > MAX_UPLOAD) return { isError: true, error: "Submission files over 10 MB are not sent from here." };
      return kg.submit(await kgTok(idToken, a.accountId), {
        competition: a.competition,
        fileName: a.fileName,
        bytes,
        description: a.description,
      });
    },
  },
];

/* ---------- Credentials ---------- */
//
// The `secrets` side of the trade the secret store already made: an agent can
// read a value only when the owner switched it on for that account, and every
// read leaves an audit entry. The hf_*/kaggle_* tools never need this.

const CREDENTIAL_TOOLS = [
  {
    name: "get_ml_credentials",
    description:
      "The raw API credential for a connected Hugging Face or Kaggle account, as ready-to-use material: HF → env.HF_TOKEN; Kaggle → env.KAGGLE_API_TOKEN, or kaggleJson + env.KAGGLE_USERNAME/KAGGLE_KEY for a legacy key. Refused unless the owner switched on 'Agent may read this token' for that account in the Accounts tab. Every read is audited. HANDLING: this is for USE in the step that needs it (an env var for a CLI, ~/.kaggle/kaggle.json). Do not echo it into the conversation, a commit, a log, or a file you were not asked to write. Prefer the hf_*/kaggle_* tools, which never expose it.",
    scope: "secrets",
    inputSchema: {
      type: "object",
      properties: { provider: { type: "string", enum: ["huggingface", "kaggle"] }, accountId: accountArg },
      required: ["provider"],
    },
    handler: async (a, { idToken, claims }) => {
      const p = getProvider(a.provider);
      if (p.auth !== "apiKey") return { isError: true, error: "Only Hugging Face and Kaggle credentials are exported here." };
      // Resolved, not tokenFor: nothing here needs a fresh token, only to know
      // WHICH account — and resolution is already confined to the current org.
      const account = await directory.resolveAccount(idToken, {
        service: "ml",
        provider: p.id,
        accountId: a.accountId,
      });
      const doc = await getDocument(idToken, accountPath(p.id, account.accountId)).catch(() => null);
      if (!doc?.secret) return { isError: true, error: `No ${p.label} account "${account.accountId}" is connected.` };
      // The raw document is read again here, so membership is checked again
      // on THAT document: the credential handed out must be one the org holds
      // at the moment it is read, not merely one it held when it resolved.
      assertAccountOrg(doc, p.id, account.accountId, currentOrg());
      if (doc.agentReadable !== true) {
        return {
          isError: true,
          error: `${p.label} account ${account.label} is not readable by an agent. The owner can switch on "Agent may read this token" in the admin's Accounts tab.`,
        };
      }
      const { accessToken } = unseal(doc.secret, "refresh");
      await createDocument(idToken, "auditLog", null, {
        action: "ml.credentials.read",
        target: `${p.id}:${account.accountId}`,
        detail: "read over MCP",
        orgId: currentOrg(),
        actor: `mcp:${claims?.jti || "token"}`,
        at: new Date().toISOString(),
      }).catch(() => {});
      return {
        provider: p.id,
        accountId: account.accountId,
        orgId: currentOrg(),
        ...credentialMaterial(p.id, accessToken),
      };
    },
  },
];

export const ML_TOOLS = [...HF_TOOLS, ...KAGGLE_TOOLS, ...CREDENTIAL_TOOLS];
