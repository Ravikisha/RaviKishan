// A launch: idea → notes → repo → deploy → package → blog → post → portfolio.
//
// WHY A RECORD AND NOT JUST A SEQUENCE
// ------------------------------------
// The pipeline is eight or nine steps long and every one of them can fail. The
// interesting failures are in the middle: the repo exists, the package is
// published, and then the LinkedIn step throws. Without a record the only way
// to continue is to run it again — which re-creates the repo, re-publishes a
// version number that is now burned forever, and posts to LinkedIn twice.
//
// So the record is not bookkeeping. It is the thing that makes the pipeline
// safe to re-run, and the steps that need it most are the ones that cannot be
// undone:
//
//   npm publish   a version number can never be reused. `npm unpublish` is
//                 refused after 72 hours and refused immediately once anything
//                 depends on it.
//   LinkedIn      published to a feed. Deleting it does not unsend it.
//   dev.to        same, plus it carries a canonical URL back here.
//
// `claimStep` is what enforces it: a step already marked done is REFUSED
// rather than repeated, so double-posting is structurally impossible instead
// of being a thing the caller has to remember. That is the same call as the
// short-link click rule — the control is the rule, not the caller's care.
//
// Everything here except `readLaunch`/`writeLaunch` is pure, so the ordering,
// the refusals and the resume logic are tested without a network — the same
// split as repoAudit.js and accountDirectory.js.
import { createDocument, getDocument, listDocuments, patchDocument } from "./firestoreRest.js";

export const COLLECTION = "launches";

// Ordered, because the order is a real constraint rather than a preference:
//
//  - `deploy` before `blog` and `announce`, or they link at a URL that 404s.
//  - `package` before `blog`, if the post shows an install line.
//  - `blog` before `crosspost`, because the canonical copy lives here and
//    whichever copy goes second defers to the first.
//  - `profile` last: it is the one step software cannot do, so it is a note
//    for a human and should list what actually shipped.
export const STEPS = [
  { id: "plan", label: "Write the plan to notes", reversible: true },
  { id: "repo", label: "Create the GitHub repository", reversible: true },
  { id: "code", label: "Commit the code", reversible: true },
  { id: "deploy", label: "Link it to Vercel so pushes deploy", reversible: true },
  { id: "package", label: "Publish to npm", reversible: false },
  { id: "blog", label: "Write and publish the blog post", reversible: true },
  { id: "crosspost", label: "Cross-post to dev.to", reversible: false },
  { id: "portfolio", label: "Add it to the portfolio", reversible: true },
  { id: "announce", label: "Post about it on LinkedIn", reversible: false },
  { id: "profile", label: "Queue the LinkedIn profile edit (manual)", reversible: true },
];

export const STEP_IDS = STEPS.map((s) => s.id);
export const stepById = (id) => STEPS.find((s) => s.id === id);
export const IRREVERSIBLE = STEPS.filter((s) => !s.reversible).map((s) => s.id);

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertSlug(slug) {
  const s = String(slug || "").trim();
  if (!SLUG_RE.test(s))
    throw new Error(
      `"${slug}" is not a usable slug — lowercase letters, digits and single hyphens. It becomes the document id, the repo name and the blog URL, so it cannot be changed later.`
    );
  return s;
}

export function assertStep(id) {
  if (!STEP_IDS.includes(id))
    throw new Error(`Unknown step "${id}". The steps are: ${STEP_IDS.join(", ")}.`);
  return id;
}

/* ---------------- the record ---------------- */

export function newLaunch({ slug, title, idea = "", notes = "" }) {
  return {
    slug: assertSlug(slug),
    title: String(title || slug),
    idea: String(idea || "").slice(0, 4000),
    notes: String(notes || "").slice(0, 2000),
    status: "open",
    steps: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const stepState = (rec, id) => rec?.steps?.[id] || null;
export const isDone = (rec, id) => stepState(rec, id)?.status === "done";
export const isSkipped = (rec, id) => stepState(rec, id)?.status === "skipped";

// Done or deliberately skipped both mean "do not do this again".
const settled = (rec, id) => isDone(rec, id) || isSkipped(rec, id);

// The first step not yet settled. Not "the next one that COULD run" — the
// pipeline is ordered, so reporting a later step while an earlier one is
// outstanding would invite doing them out of order.
export function nextStep(rec) {
  return STEP_IDS.find((id) => !settled(rec, id)) || null;
}

export function launchProgress(rec) {
  const done = STEP_IDS.filter((id) => isDone(rec, id));
  const skipped = STEP_IDS.filter((id) => isSkipped(rec, id));
  const remaining = STEP_IDS.filter((id) => !settled(rec, id));
  const next = remaining[0] || null;
  return {
    slug: rec?.slug,
    title: rec?.title,
    status: remaining.length ? "open" : "complete",
    done,
    skipped,
    remaining,
    nextStep: next,
    nextLabel: next ? stepById(next).label : null,
    // Said out loud rather than left for the caller to work out, because the
    // whole point of the record is to stop a second LinkedIn post.
    nextIsIrreversible: next ? IRREVERSIBLE.includes(next) : false,
    alreadyDone: done.map((id) => ({ step: id, ...stepState(rec, id) })),
    results: Object.fromEntries(done.map((id) => [id, stepState(rec, id)?.result || {}])),
  };
}

/* ---------------- the guard ---------------- */

// Refuse a step that is already settled. This is the function that makes
// re-running a half-finished launch safe: the caller does not have to
// remember what it already did, because the record refuses.
export function assertClaimable(rec, id, { force = false } = {}) {
  assertStep(id);
  if (!rec) throw new Error("No such launch. Start it first.");
  const st = stepState(rec, id);
  if (st && st.status === "done" && !force) {
    const what = st.result && Object.keys(st.result).length ? ` It produced: ${JSON.stringify(st.result)}.` : "";
    throw new Error(
      `"${id}" is already done for ${rec.slug} (${st.at}).${what} Doing it again would ${
        IRREVERSIBLE.includes(id)
          ? "duplicate something that cannot be undone"
          : "overwrite what is there"
      }. Pass force only if you mean to repeat it.`
    );
  }
  if (st && st.status === "skipped" && !force)
    throw new Error(`"${id}" was skipped for ${rec.slug}. Pass force to do it after all.`);

  // Order matters: the blog must not go out before the deploy it links to.
  const earlier = STEP_IDS.slice(0, STEP_IDS.indexOf(id)).filter((p) => !settled(rec, p));
  if (earlier.length && !force)
    throw new Error(
      `"${id}" comes after ${earlier.join(", ")}, which ${
        earlier.length === 1 ? "is" : "are"
      } not done. The order is not a preference: a post published before the deploy links at a URL that 404s, and a cross-post before the blog takes the canonical copy. Do them in order, or pass force.`
    );
  return true;
}

export function markStep(rec, id, { status = "done", result = {}, note = "" } = {}) {
  assertStep(id);
  return {
    ...rec,
    steps: {
      ...(rec.steps || {}),
      [id]: { status, result, note: String(note || "").slice(0, 400), at: new Date().toISOString() },
    },
    status: STEP_IDS.every((s) => {
      const next = s === id ? status : rec?.steps?.[s]?.status;
      return next === "done" || next === "skipped";
    })
      ? "complete"
      : "open",
    updatedAt: new Date().toISOString(),
  };
}

/* ---------------- I/O ---------------- */

export async function readLaunch(idToken, slug) {
  return getDocument(idToken, `${COLLECTION}/${assertSlug(slug)}`).catch(() => null);
}

export async function listLaunches(idToken, { pageSize = 100 } = {}) {
  const rows = await listDocuments(idToken, COLLECTION, { pageSize });
  return rows.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export async function createLaunch(idToken, fields) {
  const rec = newLaunch(fields);
  const existing = await readLaunch(idToken, rec.slug);
  if (existing)
    throw new Error(
      `A launch called "${rec.slug}" already exists (${existing.status}, started ${existing.createdAt}). Use it rather than starting a second one — the slug is the repo name and the blog URL.`
    );
  await createDocument(idToken, COLLECTION, rec.slug, rec);
  return rec;
}

export async function saveStep(idToken, slug, id, patch) {
  const rec = await readLaunch(idToken, slug);
  if (!rec) throw new Error(`No launch called "${slug}".`);
  const next = markStep(rec, id, patch);
  await patchDocument(idToken, `${COLLECTION}/${rec.slug}`, {
    steps: next.steps,
    status: next.status,
    updatedAt: next.updatedAt,
  });
  return next;
}
