// Design reference for the Memory tab, rendered with the REAL components.
//
// The live tab needs a signed-in Firestore, so without this the confidence
// edge, the layer filter and the refusals could not be looked at or asserted
// on at all. It renders the panel's exported parts — `MemoryHeadline`,
// `RememberForm`, `RecallProbe`, `MemoryFilters`, `MemoryList` — inside the
// real AdminShell, against the real TABS, never a copy of their markup.
//
// The seed is deliberately unflattering:
//   - a guess at 20% beside a belief at 100%, so the edge weights are visible;
//   - a memory nobody has recalled in half a year (the stale colour);
//   - an archived memory replaced by a newer decision (dashed edge, "replaced");
//   - a sentence long enough to wrap twice at 390px;
//   - a recall result already run, so the ranked list shows without a server.
//
// Nothing here calls an API: every action edits local state. 404s in
// production: it is a design tool.
import React, { useState } from "react";
import AdminShell from "../components/admin/AdminShell";
import { TABS } from "./admin";
import {
  MemoryFilters,
  MemoryHeadline,
  MemoryList,
  MemoryStyles,
  RecallProbe,
  RememberForm,
  useMemoryView,
} from "../components/admin/MemoryPanel";
import { memoryShape, rankMemories } from "../lib/server/memoryShape";

const NOW = Date.parse("2026-10-10T09:00:00Z");
const day = (n) => new Date(NOW - n * 86400000).toISOString();

const SEED = [
  {
    id: "m_pref_amber",
    scope: "global",
    kind: "preference",
    text: "Amber #FFB020 is the only accent, and it means 'the selected one'. Never reintroduce the purple/pink gradient anywhere.",
    tags: ["design"],
    confidence: 1,
    source: "admin",
    reinforced: 3,
    uses: 41,
    createdAt: day(120),
    updatedAt: day(2),
    lastUsedAt: day(0),
  },
  {
    id: "m_fact_position",
    scope: "global",
    kind: "fact",
    text: "Lead as Software Engineer — distributed systems, systems programming and applied AI. Not 'Full Stack Developer'.",
    tags: ["positioning", "linkedin"],
    confidence: 0.9,
    source: "mcp:remember",
    uses: 12,
    createdAt: day(60),
    updatedAt: day(60),
    lastUsedAt: day(5),
  },
  {
    id: "m_guess_time",
    scope: "org",
    orgId: "relax",
    kind: "preference",
    text: "Probably prefers LinkedIn posts in the morning, IST.",
    tags: ["linkedin"],
    confidence: 0.2,
    source: "reflection:sess-7f2",
    context: "Drafted a launch post; owner rescheduled it to 9am.",
    uses: 1,
    createdAt: day(9),
    updatedAt: day(9),
    lastUsedAt: day(9),
  },
  {
    id: "m_lesson_order",
    scope: "org",
    orgId: "relax",
    kind: "lesson",
    text: "Deploy before announcing. The dev.to cross-post of the container-runtime launch linked a live 404 for forty minutes because the Vercel build was still queued, and two comments on LinkedIn pointed it out before anyone here noticed — so the launch record now refuses an announce step while the deploy step is unsettled.",
    tags: ["launch", "devto"],
    confidence: 0.75,
    source: "agent:job-0931",
    reinforced: 1,
    lastSource: "reflection:sess-a11",
    uses: 4,
    createdAt: day(40),
    updatedAt: day(12),
    lastUsedAt: day(12),
  },
  {
    id: "m_ref_vault",
    scope: "org",
    orgId: "relax",
    kind: "reference",
    text: "The Obsidian vault lives in the GitHub repo Ravikisha/notes, folder vault/.",
    tags: ["notes"],
    confidence: 0.6,
    source: "admin",
    uses: 0,
    createdAt: day(180),
    updatedAt: day(180),
  },
  {
    id: "m_dec_new",
    scope: "org",
    orgId: "relax",
    kind: "decision",
    text: "Host the portfolio on Vercel, because Netlify builds timed out on the three.js chunk.",
    tags: ["deploy"],
    confidence: 0.85,
    source: "admin",
    supersedes: "m_dec_old",
    uses: 2,
    createdAt: day(30),
    updatedAt: day(30),
    lastUsedAt: day(3),
  },
  {
    id: "m_dec_old",
    scope: "org",
    orgId: "relax",
    kind: "decision",
    text: "Host the portfolio on Netlify.",
    tags: ["deploy"],
    confidence: 0.7,
    source: "admin",
    archived: true,
    archivedAt: day(30),
    supersededBy: "m_dec_new",
    createdAt: day(300),
    updatedAt: day(30),
  },
].map(memoryShape);

const RECALL = {
  task: "write a LinkedIn post about the container runtime launch",
  memories: rankMemories(SEED, "write a LinkedIn post about the container runtime launch", { mode: "any", limit: 5, now: NOW }),
};

export default function MemoryPreview() {
  const [view, setView] = useState("memory");
  const [memories, setMemories] = useState(SEED);
  const [openId, setOpenId] = useState("m_lesson_order");
  const v = useMemoryView(memories);
  const orgId = "relax";

  const onRemember = async (m) => {
    const memory = memoryShape({ ...m, id: `m_local_${memories.length}`, confidence: 0.9, source: "admin", createdAt: day(0), updatedAt: day(0) });
    setMemories((all) => [memory, ...all]);
    return { action: "created", memory };
  };
  const onSave = async (id, patch) =>
    setMemories((all) => all.map((m) => (m.id === id ? memoryShape({ ...m, ...patch, updatedAt: day(0) }) : m)));
  const onForget = async (id, confirm) => {
    setMemories((all) => (confirm ? all.filter((m) => m.id !== id) : all.map((m) => (m.id === id ? { ...m, archived: true } : m))));
    setOpenId("");
  };

  return (
    <AdminShell
      tabs={TABS}
      view={view}
      onView={setView}
      email="ravikishan63392@gmail.com"
      org={{ id: orgId, name: "Relax", isDefault: true }}
      orgId={orgId}
      orgs={[{ id: orgId, name: "Relax", isDefault: true }]}
      onOrg={() => {}}
      onSignOut={() => {}}
    >
      <div className="mm">
        <MemoryHeadline memories={memories} orgId={orgId} now={NOW} />
        <RememberForm orgId={orgId} onRemember={onRemember} />
        <RecallProbe initial={RECALL} onRecall={async (task) => ({ task, memories: rankMemories(memories, task, { mode: "any", limit: 8, now: NOW }) })} />
        <MemoryFilters orgId={orgId} {...v} />
        <MemoryList shown={v.shown} orgId={orgId} openId={openId} setOpenId={setOpenId} onSave={onSave} onForget={onForget} now={NOW} />
        <MemoryStyles />
      </div>
      <style jsx global>{`
        body {
          margin: 0;
          background: #08090d;
        }
      `}</style>
    </AdminShell>
  );
}

// Dev-only: a design tool, not a page.
export async function getStaticProps() {
  if (process.env.NODE_ENV === "production") return { notFound: true };
  return { props: {} };
}
