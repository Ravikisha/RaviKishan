// Design reference for the LinkedIn panel, rendered with the REAL parts.
//
// The live panel needs a LinkedIn app, credentials and a connected account,
// which makes most of its states impossible to look at — or assert on — from a
// fresh install. This renders the exported pieces of the panel against fixed
// data: no LinkedIn, no network.
//
// Every state that has its own design is here, because a reference that only
// shows the happy path is a reference for the easy case:
//   - the way in, before anything is configured, and with only Connect left
//   - the connection with plenty of time, and in its last fortnight
//   - the composer short, close to the cap, and over it (the edge fill and
//     the feed fold are the two pieces of motion in the panel)
//
// 404s in production: it is a design tool, not a page.
import React from "react";
import {
  AccountShelf,
  Composer,
  Connection,
  ExportProfile,
  Headline,
  JobSearch,
  Ledger,
  LinkedInStyles,
  PostHistory,
  Reach,
  SetupSteps,
} from "../components/admin/LinkedInPanel";
import { Styles } from "./admin";

// A real export, trimmed. The headline is the one actually on the account,
// which is the point of the section: it still leads with a title the
// positioning moved away from.
const EXPORT = {
  exportedAt: "2026-07-10",
  name: "Ravi Kishan",
  headline:
    "AI Engineer @ Zimyo | Full Stack Developer | Cloud-Native & Scalable Systems Architect | Multi-Paradigm Programming Expert | Freelancer | VIT'26 MCA",
  about:
    "I'm a software engineer drawn to the layers most people take for granted. From scratch I've built a deterministic UI runtime, a programming-language interpreter, a container runtime and a distributed key-value store.",
  connections: 1148,
  certifications: 47,
  projects: 23,
  companiesFollowed: 12,
  skills: { count: 100, sample: ["Rust", "Go", "Distributed Systems", "LangGraph", "Docker", "FastAPI"] },
  patents: [{ title: "A Multilingual Chatbot for Indian Epic", issuer: "India" }],
  positions: [
    { company: "Zimyo", title: "AI Engineer", from: "Apr 2026", to: "" },
    { company: "ArrowHead Capital Management LLP", title: "Quantitative Developer Intern", from: "Jul 2025", to: "Apr 2026" },
    { company: "CHITI INFOTECH", title: "Full-stack Developer intern", from: "Jan 2023", to: "Sep 2023" },
  ],
};

// A headline that already agrees, so the quiet state is visible too.
const EXPORT_OK = {
  ...EXPORT,
  headline: "Software Engineer | Distributed Systems, Systems Programming, Applied AI | Agentic AI Engineer @ Zimyo",
};

const REACH = {
  available: true,
  change: {
    sessions: { now: 34, before: 19, delta: 78.9 },
    activeUsers: { now: 29, before: 18, delta: 61.1 },
    screenPageViews: { now: 61, before: 44, delta: 38.6 },
  },
  previous: { startDate: "2026-08-12", endDate: "2026-09-08" },
  landed: [
    { landingPage: "/", screenPageViews: 23 },
    { landingPage: "/blog/building-a-container-runtime-from-scratch", screenPageViews: 17 },
    { landingPage: "/resume", screenPageViews: 9 },
  ],
};

// Nobody arrived: the empty state has to say what would change it.
const REACH_EMPTY = { available: true, change: {}, previous: REACH.previous, landed: [] };

// No Analytics account, which is an ordinary state rather than a failure.
const REACH_OFF = {
  available: false,
  why: "No account is connected for Site analytics. Connect one in Accounts.",
};

// Two accounts, one of them expired: a shelf with a single healthy chip shows
// neither the selection language nor the state the chip exists to carry.
const SHELF = [
  { accountId: "ye89-jdWNd", label: "ravikishan63392@gmail.com", email: "ravikishan63392@gmail.com", expiresInDays: 59 },
  { accountId: "qq12-ZZtt", label: "studio@example.com", email: "studio@example.com", expiresInDays: -3 },
];

const CAPS = {
  post: { available: true, how: "w_member_social, self-serve" },
  readBasicProfile: { available: true, how: "OIDC /v2/userinfo" },
  readFullProfile: {
    available: false,
    why: "r_fullprofile (headline, positions, skills) is partner-only.",
    instead: "The LinkedIn data export in linkedin/ carries all of it.",
  },
  updateProfile: {
    available: false,
    why: "LinkedIn has no profile write API at any tier.",
    instead: "Edit on linkedin.com. get_linkedin_drift shows exactly what to paste.",
  },
  searchJobs: {
    available: false,
    why: "Job search is Talent Solutions, partner-only, and new partnerships are closed.",
    instead: "linkedin_job_search_url builds the search; save what you find to the jobs tracker.",
  },
  applyToJobs: {
    available: false,
    why: "No application-submission API exists at any tier.",
    instead: "Apply on linkedin.com, then record it with create_job.",
  },
  listOwnPosts: {
    available: false,
    why: "r_member_social is restricted, so posts cannot be read back.",
    instead: "Every post made through here is recorded locally.",
  },
};

const POSTS = [
  {
    id: "1",
    text: "Spent the week writing a container runtime from scratch — namespaces, cgroups, an overlay filesystem and a tiny init. The part that surprised me was how little of it is kernel magic and how much is careful bookkeeping.",
    postedAt: "2026-10-02T09:14:00.000Z",
    visibility: "PUBLIC",
    url: "#",
    urn: "urn:li:share:7380000000000000001",
    editedAt: "2026-10-03T08:00:00.000Z",
  },
  {
    id: "2",
    text: "New piece on the deterministic UI runtime I have been building, and why reconciliation is the easy half.",
    postedAt: "2026-09-21T16:02:00.000Z",
    visibility: "PUBLIC",
    url: "#",
    urn: "urn:li:share:7370000000000000002",
  },
  {
    id: "3",
    text: "A draft I pulled after ten minutes — leaving it here because the record should match what actually went out.",
    postedAt: "2026-09-04T11:40:00.000Z",
    visibility: "CONNECTIONS",
    url: "#",
    deletedAt: "2026-09-04T11:52:00.000Z",
  },
];

const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

const HOOK =
  "I wrote a container runtime from scratch this month, and the hardest part was not the kernel.\n\nIt was bookkeeping: which mount belongs to which namespace, which cgroup to tear down first, and what to do when init dies before the child it was meant to reap. Here is what I learned.";

function Frame({ id, title, children }) {
  return (
    <section className="lp-frame" data-state={id}>
      <p className="lp-label">{title}</p>
      {children}
    </section>
  );
}

const noop = async () => false;

const PROFILE = {
  name: "Ravi Kishan",
  email: "ravikishan63392@gmail.com",
  authorUrn: "urn:li:person:x9Kq2LmNpR",
  picture: "",
};

export default function LinkedInPreview() {
  const filler = (n) => "Shipping a thing and writing about it. ".repeat(n);

  return (
    <main className="admin-main li-main" style={{ minHeight: "100vh", padding: "88px 24px 48px" }}>
      <Frame id="setup" title="Not set up">
        <SetupSteps
          status={{
            configured: false,
            missing: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
            connected: false,
          }}
          onConnect={() => {}}
          busy={false}
        />
      </Frame>

      <Frame id="ready" title="Credentials in place, not yet connected">
        <SetupSteps
          status={{ configured: true, missing: [], connected: false }}
          onConnect={() => {}}
          busy={false}
        />
      </Frame>

      <Frame id="conn-fine" title="Connected">
        <Connection
          status={{
            connected: true,
            email: "ravikishan63392@gmail.com",
            expiresInDays: 41,
            expiresAt: inDays(41),
          }}
          profile={PROFILE}
          name="Ravi Kishan"
          onReconnect={() => {}}
        />
      </Frame>
      <Frame id="conn-soon" title="Connected, last fortnight">
        <Connection
          status={{
            connected: true,
            email: "ravikishan63392@gmail.com",
            expiresInDays: 9,
            expiresAt: inDays(9),
          }}
          profile={PROFILE}
          name="Ravi Kishan"
          onReconnect={() => {}}
        />
      </Frame>

      <Frame id="shelf" title="Two accounts, one expired">
        <AccountShelf
          accounts={SHELF}
          selected="ye89-jdWNd"
          onSelect={() => {}}
          onAdd={() => {}}
        />
      </Frame>
      <Frame id="shelf-second" title="The expired one selected">
        <AccountShelf
          accounts={SHELF}
          selected="qq12-ZZtt"
          onSelect={() => {}}
          onAdd={() => {}}
        />
      </Frame>

      <Frame id="headline-drift" title="Headline: still carries a retired title">
        <Headline profile={EXPORT} />
      </Frame>
      <Frame id="headline-match" title="Headline: agrees with the site">
        <Headline profile={EXPORT_OK} />
      </Frame>
      <Frame id="headline-unknown" title="Headline: no export snapshotted yet">
        <Headline profile={null} />
      </Frame>

      <Frame id="reach" title="Reach: what LinkedIn sent to the site">
        <Reach reach={REACH} range="28d" onRange={() => {}} postCount={3} />
      </Frame>
      <Frame id="reach-empty" title="Reach: nobody arrived">
        <Reach reach={REACH_EMPTY} range="7d" onRange={() => {}} postCount={0} />
      </Frame>
      <Frame id="reach-off" title="Reach: no analytics account">
        <Reach reach={REACH_OFF} range="28d" onRange={() => {}} postCount={0} />
      </Frame>

      <Frame id="export" title="The profile the API refuses to return">
        <ExportProfile profile={EXPORT} />
      </Frame>

      <Frame id="compose-hook" title="Composer: an opening longer than the fold">
        <Composer onPublish={noop} initial={HOOK} />
      </Frame>
      <Frame id="compose-close" title="Composer: close to the cap">
        <Composer onPublish={noop} initial={filler(72)} label="Close to the cap" />
      </Frame>
      <Frame id="compose-over" title="Composer: over the cap">
        <Composer onPublish={noop} initial={filler(82)} label="Over the cap" />
      </Frame>

      <PostHistory posts={POSTS} onDelete={() => {}} onEdit={async () => true} />
      <JobSearch onSearch={() => {}} />
      <Ledger caps={CAPS} />

      <Styles />
      <LinkedInStyles />
      <style jsx global>{`
        body {
          margin: 0;
          background: #08090d;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        }
        .lp-frame {
          margin: 0 0 28px;
        }
        .lp-label {
          margin: 0 0 -6px;
          font-size: 12px;
          color: #6b7285;
        }
      `}</style>
    </main>
  );
}

// Dev-only: a design tool, not a page.
export async function getStaticProps() {
  if (process.env.NODE_ENV === "production") return { notFound: true };
  return { props: {} };
}
