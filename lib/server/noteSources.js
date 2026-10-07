// Where notes can live, and what each place can actually do.
//
// PURE registry — no network, no credentials. The adapters are wired on top of
// this in noteBoard.js; this file is only the honest description of each
// source, so a caller can be told what will happen BEFORE it tries.
//
// The point of declaring capabilities rather than discovering them: four
// services disagree about almost everything. Trello has no free-text tags
// (labels are board-wide objects), Notion has no concept of pinning, Obsidian
// has no archive, and Google Keep cannot be reached at all from a personal
// account. Every one of those is a thing a note-taking UI naturally offers, and
// every one of them would otherwise fail at save time with a provider error
// that names none of this.

// `available: false` means the source is DECLARED unusable here, with the
// reason — not missing, not forgotten, and not a button that 403s.
export const NOTE_SOURCES = {
  local: {
    id: "local",
    label: "Notes here",
    // The default on purpose. It is the one source that needs no third party,
    // no consent screen and no key: the thing the user asked for when they said
    // "a custom own note system I can use when I don't want these settings".
    kind: "builtin",
    available: true,
    needsConnection: false,
    store: "Firestore collection `notes/`, admin-only",
    capabilities: {
      create: true,
      update: true,
      delete: true,
      tags: true,
      containers: true, // notebooks, which are just a string on the note
      pinned: true,
      archive: true,
      search: "full-text, in memory",
      body: "markdown",
    },
  },

  notion: {
    id: "notion",
    label: "Notion",
    kind: "oauth",
    available: true,
    needsConnection: true,
    provider: "notion", // the connected-accounts provider id
    store: "Pages inside the databases the integration was shared with",
    capabilities: {
      create: true,
      update: true,
      delete: true, // Notion "delete" is archive; the API has no hard delete
      tags: true, // a multi-select property
      containers: true, // databases
      // Notion has no pin. Starring a page is a UI affordance the API does not
      // expose, so the panel hides the control rather than dropping the value.
      pinned: false,
      archive: true,
      search: "Notion's own /v1/search endpoint",
      body: "blocks, converted to and from markdown",
    },
    limits: [
      "A Notion integration only sees pages and databases it has been SHARED with — connecting is not enough, each database must be shared with the integration in Notion's UI.",
      "Rich text runs cap at 2000 characters, so a long body is split across blocks on write and rejoined on read.",
    ],
    setup: {
      why:
        "Notion uses OAuth, so this needs an integration of yours with a client id and secret. A PUBLIC integration is the one that issues those — an internal integration gives a single token and no OAuth flow.",
      steps: [
        {
          title: "Create a public integration",
          body: "Open notion.so/my-integrations, press New integration, and set its type to Public. Fill in the name and the required URLs; Notion will not issue a client id until it is public.",
          link: "https://www.notion.so/my-integrations",
        },
        {
          title: "Add the redirect URLs",
          body: "Under OAuth Domain & URIs, add the callback for every host this runs on. Notion compares them exactly.",
          uris: ["/api/integrations/notion/callback"],
        },
        {
          title: "Paste the keys into Environment",
          body: "Add NOTION_CLIENT_ID and NOTION_CLIENT_SECRET in the admin's Environment tab, then press Connect here.",
          env: ["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET"],
        },
        {
          title: "Share the pages with it",
          body: "This is the step everyone misses. Connecting grants NOTHING on its own — in Notion, open each database or page, press the dots menu, Connections, and add your integration. A database that is not shared is invisible, not empty.",
        },
      ],
    },
  },

  trello: {
    id: "trello",
    label: "Trello",
    kind: "key",
    available: true,
    needsConnection: true,
    env: ["TRELLO_API_KEY", "TRELLO_TOKEN"],
    store: "Cards; the card description is the note body",
    capabilities: {
      create: true,
      update: true,
      delete: true,
      // Trello labels are board-scoped objects with ids and colours, not free
      // text. Writing an arbitrary tag would mean creating a label on the
      // board, which is a bigger act than tagging a note.
      tags: false,
      containers: true, // lists, within a board
      pinned: false,
      archive: true, // Trello calls it "closed"
      search: "Trello's own /1/search endpoint",
      body: "markdown, in the card description",
    },
    limits: [
      "Labels are board-wide objects, not free text, so tags are read-only here.",
      "A card belongs to a list on one board; moving between boards means choosing a list on the other board.",
    ],
    // How to get the credentials. DATA rather than prose in the panel, so the
    // admin, the setup doc and any future audit read the same steps — the
    // same reasoning as CAPABILITIES in lib/server/linkedin.js.
    setup: {
      why:
        "Trello has no OAuth app for this: it authenticates with an API key and a token belonging to YOUR account, both pasted in. That is also why the token never expires on its own — revoking it in Trello is what ends it.",
      steps: [
        {
          title: "Get an API key",
          body: "Open trello.com/power-ups/admin and create a Power-Up (any name — it exists only to own the key). On its API key tab, press Generate.",
          link: "https://trello.com/power-ups/admin",
        },
        {
          title: "Authorise your own account",
          body: "Beside the key there is a Token link. Open it and approve — that is you granting this key access to your own boards. Copy the token it shows; it is only shown once.",
        },
        {
          title: "Paste both into Environment",
          body: "Add TRELLO_API_KEY and TRELLO_TOKEN in the admin's Environment tab. They are stored in the database sealed under ENV_KEY and take effect on the next request — no redeploy.",
          env: ["TRELLO_API_KEY", "TRELLO_TOKEN"],
        },
      ],
      warning:
        "The token is a bearer credential that rides in the query string of every Trello call, which is why it is held server-side and never handed to the browser.",
    },
  },

  obsidian: {
    id: "obsidian",
    label: "Obsidian",
    kind: "git",
    available: true,
    needsConnection: true,
    provider: "github", // reuses the GitHub connection
    store: "Markdown files in a GitHub repository holding the vault",
    capabilities: {
      create: true,
      update: true,
      delete: true,
      tags: true, // YAML front matter
      containers: true, // folders
      pinned: true, // a front-matter flag
      // There is no archive in a vault; a file is either there or it is not.
      archive: false,
      search: "in memory, over the files fetched",
      body: "markdown, verbatim",
    },
    limits: [
      "Obsidian has NO cloud API — a vault is Markdown files on disk, and this deployment's filesystem is read-only at runtime. So the vault is read and written as a GitHub repository, which is how most people already sync one.",
      "Every write is a real commit on the default branch.",
      "The whole vault is listed per read, so a very large vault is slow; the folder setting narrows it.",
    ],
  },

  keep: {
    id: "keep",
    label: "Google Keep",
    kind: "unavailable",
    available: false,
    needsConnection: false,
    // Measured, not assumed — see scripts/notes-check.mjs and the probe in
    // CLAUDE.md. The API is real and it is not for this.
    reason:
      "Google Keep has no API for a personal account. The Keep API exists, but its own discovery document describes it as " +
      '"used in an enterprise environment to manage Google Keep content and resolve issues identified by cloud security software" ' +
      "— it is a Google Workspace admin and DLP API (scopes auth/keep and auth/keep.readonly, documented under " +
      "developers.google.com/workspace/keep/api), it requires a Workspace domain, and it is not reachable from a personal " +
      "gmail.com account at any tier.",
    alternative:
      "Use the built-in notes here, or Obsidian over a GitHub vault. Google Tasks is already connected in the Tasks tab for anything checklist-shaped.",
    capabilities: {
      create: false,
      update: false,
      delete: false,
      tags: false,
      containers: false,
      pinned: false,
      archive: false,
      search: false,
      body: false,
    },
  },
};

export const DEFAULT_SOURCE = "local";

export const sourceIds = () => Object.keys(NOTE_SOURCES);
export const usableSourceIds = () => sourceIds().filter((id) => NOTE_SOURCES[id].available);

export function getSource(id) {
  const s = NOTE_SOURCES[String(id || DEFAULT_SOURCE).toLowerCase()];
  if (!s) {
    const e = new Error(
      `Unknown note source "${id}". Known sources: ${sourceIds().join(", ")}.`
    );
    e.status = 400;
    throw e;
  }
  return s;
}

// Called before any adapter work. A source that cannot work says so with its
// evidence and its alternative, rather than failing somewhere in a fetch.
export function assertUsable(id) {
  const s = getSource(id);
  if (!s.available) {
    const e = new Error(`${s.label} cannot be used here. ${s.reason} ${s.alternative || ""}`.trim());
    e.status = 501;
    e.code = "notes/source-unavailable";
    throw e;
  }
  return s;
}
