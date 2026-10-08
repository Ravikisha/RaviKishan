// Publishing a package, and putting a new repo on Vercel.
//
// THE DIVISION OF LABOUR
// ----------------------
// A Vercel function cannot run `npm install`, build a bundle, run tests or
// pack a tarball. It has seconds and no toolchain. So nothing here publishes
// anything: the MCP server ORCHESTRATES and CI EXECUTES.
//
// `npm publish` lives in a workflow file this module writes, triggered by a
// release this module creates. That is the same call already made three times
// in this codebase — the dev.to renderer runs in the browser because a
// function cannot lay out a diagram, Kaggle is the unattended ML runner
// because Colab has no API, and vault encryption happens in the browser.
// Trying to publish from a serverless function would be the fourth time
// learning it.
//
// NOTHING HERE SHIPS THE PRODUCTION SITE EITHER. Vercel deploys on push for a
// linked project, so the capability needed is "link this repo once", not
// "deploy now" — which keeps the rule the rest of this codebase already holds:
// setting a variable and shipping production are two decisions and should not
// be made in one call.

const NPM_REGISTRY = "https://registry.npmjs.org";

/* ---------------- npm: what is already out there ---------------- */

// Read-only and UNAUTHENTICATED — the registry is public, so this works with
// no token at all and can be checked before anything is set up.
//
// This is the guard that matters: a version number, once published, is burned
// forever. `npm unpublish` is refused after 72 hours, and refused immediately
// once anything depends on the package. So "is this version taken" has to be
// answerable before the release is cut, not after the workflow fails.
export async function npmPackage(name) {
  const res = await fetch(`${NPM_REGISTRY}/${encodeURIComponent(name).replace(/^%40/, "@")}`, {
    headers: { Accept: "application/vnd.npm.install-v1+json" },
  });
  if (res.status === 404) return { name, exists: false, versions: [], latest: null };
  if (!res.ok) throw new Error(`npm registry answered ${res.status} for ${name}.`);
  const json = await res.json();
  const versions = Object.keys(json.versions || {});
  return {
    name,
    exists: true,
    versions,
    latest: json["dist-tags"]?.latest || null,
    modified: json.modified || null,
  };
}

export const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?$/;

export async function checkVersion(name, version) {
  if (!SEMVER_RE.test(String(version || "")))
    throw new Error(`"${version}" is not a semver version (1.2.3, optionally with a -tag).`);
  const pkg = await npmPackage(name);
  const taken = pkg.versions.includes(version);
  return {
    name,
    version,
    packageExists: pkg.exists,
    latest: pkg.latest,
    taken,
    // Said as a sentence, because the consequence is the whole point.
    verdict: taken
      ? `${name}@${version} is already published and a version number can never be reused. Pick a higher one.`
      : pkg.exists
      ? `${name}@${version} is free. The current latest is ${pkg.latest}.`
      : `${name} is not on the registry at all; this would be its first publish.`,
    // Name squatting is the other way a first publish fails, and it fails at
    // the very end of the pipeline if nobody looked.
    nameAvailable: !pkg.exists,
  };
}

/* ---------------- the workflow that does the publishing ---------------- */

// Written into the repo rather than run here. Pinned to a tag trigger so a
// publish is always something you deliberately cut a release for, never a
// side effect of pushing to a branch.
//
// `--provenance` asks npm to record where the package was built, which needs
// `id-token: write`. It costs nothing and makes the supply chain checkable.
export function releaseWorkflow({ nodeVersion = "20", runTests = true } = {}) {
  return `# Publishes to npm when a release is published.
#
# Written by the launch pipeline. Two things make this safe to leave enabled:
# it triggers only on a published release (never on a push), and NPM_TOKEN must
# be an npm **granular access token of type Automation** — that is the only
# kind that bypasses the 2FA prompt a publish otherwise blocks on.
name: Publish to npm

on:
  release:
    types: [published]

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "${nodeVersion}"
          registry-url: "https://registry.npmjs.org"
      - run: npm ci || npm install
${runTests ? '      - run: npm test --if-present\n' : ""}      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
`;
}

/* ---------------- Vercel: link, do not deploy ---------------- */

const VERCEL_API = "https://api.vercel.com";

export function vercelConfigured(env = process.env) {
  return !!env.VERCEL_TOKEN;
}

function vercelAuth(env = process.env) {
  const token = env.VERCEL_TOKEN;
  if (!token)
    throw new Error(
      "VERCEL_TOKEN is not set. Add it in the admin's Environment tab — a token with project-create scope. VERCEL_TEAM_ID too if the project belongs to a team rather than your personal account."
    );
  return token;
}

async function vercelCall(path, { method = "GET", body } = {}, env = process.env) {
  const team = env.VERCEL_TEAM_ID ? `${path.includes("?") ? "&" : "?"}teamId=${env.VERCEL_TEAM_ID}` : "";
  const res = await fetch(`${VERCEL_API}${path}${team}`, {
    method,
    headers: {
      Authorization: `Bearer ${vercelAuth(env)}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `Vercel answered ${res.status}.`;
    const e = new Error(
      res.status === 403
        ? `${msg} — the token may lack project scope, or the project belongs to a team and VERCEL_TEAM_ID is not set.`
        : msg
    );
    e.status = res.status;
    throw e;
  }
  return json;
}

// Create a Vercel project bound to a GitHub repository. From then on Vercel
// builds every push itself, which is why there is no "deploy" function in this
// module and no tool that ships production on a prompt.
export async function linkVercelProject(
  { name, repo, framework = null, rootDirectory = null, env: vars = {} },
  env = process.env
) {
  if (!name) throw new Error("A Vercel project needs a name.");
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo || "")))
    throw new Error(`repo must be "owner/name"; got "${repo}".`);

  const project = await vercelCall(
    "/v10/projects",
    {
      method: "POST",
      body: {
        name,
        framework,
        ...(rootDirectory ? { rootDirectory } : {}),
        gitRepository: { type: "github", repo },
        ...(Object.keys(vars).length
          ? {
              environmentVariables: Object.entries(vars).map(([key, value]) => ({
                key,
                value: String(value),
                type: "encrypted",
                target: ["production", "preview", "development"],
              })),
            }
          : {}),
      },
    },
    env
  );

  return {
    id: project.id,
    name: project.name,
    repo,
    // There is no deployment yet and saying otherwise would be the one
    // misleading thing this function could do: Vercel builds on the next push.
    deployed: false,
    note: "Linked. Vercel builds on the next push to the default branch; nothing was deployed by this call.",
    dashboard: `https://vercel.com/${project.accountId ? "" : ""}${project.name}`,
  };
}

export async function vercelProjectByName(name, env = process.env) {
  return vercelCall(`/v9/projects/${encodeURIComponent(name)}`, {}, env).catch((e) => {
    if (e.status === 404) return null;
    throw e;
  });
}
