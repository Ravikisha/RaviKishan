// MCP tools for the ML lab: Hugging Face and Kaggle. Kept out of mcpTools.js
// (already ~4,700 lines) and spread into TOOLS there, so the registry, scope
// filtering and mcp:check treat them exactly like every other family.
//
// Every tool resolves its account through the directory under the `ml` job:
// explicit accountId > saved default > the only one connected, and it refuses
// rather than guessing between two.
import * as directory from "./accountDirectory.js";
import * as hf from "./huggingface.js";

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
  return { token, me: account.accountId };
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
    handler: async (a, { idToken }) => hf.createRepo(await hfTok(idToken, a.accountId), a),
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
    handler: async (a, { idToken }) => hf.commitFiles(await hfTok(idToken, a.accountId), a),
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
      return hf.commitFiles(await hfTok(idToken, a.accountId), {
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
    handler: async (a, { idToken }) => hf.addToCollection(await hfTok(idToken, a.accountId), a),
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
    handler: async (a, { idToken }) => hf.restartSpace(await hfTok(idToken, a.accountId), a),
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
      await hf.setSpaceSecret(await hfTok(idToken, a.accountId), a);
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
      const { token, me } = await hfMe(idToken, a.accountId);
      const namespace = a.namespace || me;
      if (a.dryRun) {
        const hw = await hf.jobsHardware(token);
        const rows = Array.isArray(hw) ? hw : hw.hardware || [];
        const row = rows.find((h) => h.name === a.flavor || h.flavor === a.flavor);
        const perHour = row?.unitCostUSD ?? row?.pricePerHour ?? row?.price ?? null;
        const timeout = a.timeoutSeconds || 1800;
        return {
          dryRun: true,
          namespace,
          flavor: a.flavor,
          timeoutSeconds: timeout,
          maxCostUSD: perHour == null ? null : Math.round(perHour * (timeout / 3600) * 100) / 100,
          priceRow: row || null,
        };
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
      const { token, me } = await hfMe(idToken, a.accountId);
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

export const ML_TOOLS = [...HF_TOOLS];
