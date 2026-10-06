// SERVER ONLY. Notion as a note source.
//
// Notion does not store a note body. It stores a tree of typed BLOCKS, so every
// read converts blocks to Markdown and every write converts Markdown back. That
// conversion is lossy in one direction and this file is explicit about which:
// the block types a note actually uses round-trip exactly, and anything else
// (databases inline, synced blocks, embeds, columns) is read as its plain text
// and is NOT rewritten — an update replaces the page body, so an exotic block
// would be silently destroyed by a round trip it never survived.
//
// `preservesEverything` on a read says whether that happened, so a caller can
// refuse to write back rather than quietly flattening someone's page.
import { NoteError, shapeNote, cleanTags, toIso } from "./noteShape.js";

const API = "https://api.notion.com/v1";
// Pinned deliberately. Notion dates its API and an unversioned request is
// rejected; floating to "latest" would make a silent upstream change our bug.
const VERSION = "2022-06-28";

// Notion rejects a rich-text run longer than this, with a validation error that
// does not say which block was at fault.
const RUN_LIMIT = 2000;

export class NotionError extends Error {}

async function call(token, path, { method = "GET", body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": VERSION,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401) {
    throw new NotionError("Notion rejected the connection. Reconnect Notion in the admin's Notes tab.");
  }
  if (res.status === 404) {
    // Notion answers 404 for "exists but not shared with this integration",
    // which is its single most confusing behaviour: connecting is not enough,
    // each page or database must be shared with the integration in Notion's UI.
    throw new NotionError(
      "Notion answered 404. Either that page does not exist, or it has not been shared with this integration — open it in Notion, press Share, and add the integration."
    );
  }
  if (res.status === 429) {
    throw new NotionError(`Notion is rate-limiting; retry after ${res.headers.get("retry-after") || "a few"} seconds.`);
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.message || msg;
    } catch (_) {}
    throw new NotionError(`Notion: ${msg}`);
  }
  return res.status === 204 ? null : res.json();
}

/* ---------------- rich text ---------------- */

// Notion sets `plain_text` on everything it RETURNS, but a block this file
// just built carries only `text.content` — so reading one back in the same
// process produced empty strings. Accepting both makes the conversion
// symmetric, which is the only way the round trip can be tested at all.
const plain = (rich) =>
  (rich || []).map((r) => r?.plain_text ?? r?.text?.content ?? "").join("");

// One long string becomes several runs, because Notion refuses a single run
// over 2000 characters. Split on a space near the limit where possible so a
// word is not cut in half.
function toRich(text) {
  const s = String(text || "");
  if (!s) return [];
  const runs = [];
  let rest = s;
  while (rest.length > RUN_LIMIT) {
    let cut = rest.lastIndexOf(" ", RUN_LIMIT);
    if (cut < RUN_LIMIT * 0.6) cut = RUN_LIMIT;
    runs.push({ type: "text", text: { content: rest.slice(0, cut) } });
    rest = rest.slice(cut).replace(/^\s/, "");
  }
  if (rest) runs.push({ type: "text", text: { content: rest } });
  return runs;
}

/* ---------------- blocks <-> markdown ---------------- */

// The block types a note actually uses. Anything outside this set is read as
// text and reported as lossy rather than pretended away.
const READABLE = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "quote",
  "code",
  "divider",
]);

export function blocksToMarkdown(blocks) {
  const lines = [];
  let lossy = false;
  let numbered = 0;

  for (const b of blocks || []) {
    const t = b.type;
    if (t !== "numbered_list_item") numbered = 0;
    if (!READABLE.has(t)) lossy = true;

    const text = plain(b[t]?.rich_text);
    switch (t) {
      case "heading_1":
        lines.push(`# ${text}`, "");
        break;
      case "heading_2":
        lines.push(`## ${text}`, "");
        break;
      case "heading_3":
        lines.push(`### ${text}`, "");
        break;
      case "bulleted_list_item":
        lines.push(`- ${text}`);
        break;
      case "numbered_list_item":
        numbered += 1;
        lines.push(`${numbered}. ${text}`);
        break;
      case "to_do":
        lines.push(`- [${b.to_do?.checked ? "x" : " "}] ${text}`);
        break;
      case "quote":
        lines.push(`> ${text}`, "");
        break;
      case "code":
        lines.push("```" + (b.code?.language === "plain text" ? "" : b.code?.language || ""), text, "```", "");
        break;
      case "divider":
        lines.push("---", "");
        break;
      default: {
        // Unknown block: keep whatever text it carries so nothing disappears
        // from the READ, and flag it so the write path can refuse.
        const fallback = text || plain(b[t]?.caption) || "";
        if (fallback) lines.push(fallback, "");
        break;
      }
    }
  }

  return { markdown: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), lossy };
}

export function markdownToBlocks(markdown) {
  const out = [];
  const lines = String(markdown || "").split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code first: its contents must not be parsed as anything else.
    const fence = /^```(\S*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] || "plain text";
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      out.push({
        object: "block",
        type: "code",
        code: { rich_text: toRich(buf.join("\n")), language: notionLanguage(lang) },
      });
      continue;
    }

    if (!line.trim()) continue;
    if (/^---+\s*$/.test(line)) {
      out.push({ object: "block", type: "divider", divider: {} });
      continue;
    }

    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      const type = `heading_${m[1].length}`;
      out.push({ object: "block", type, [type]: { rich_text: toRich(m[2]) } });
    } else if ((m = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line))) {
      out.push({
        object: "block",
        type: "to_do",
        to_do: { rich_text: toRich(m[2]), checked: m[1].toLowerCase() === "x" },
      });
    } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
      out.push({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: toRich(m[1]) } });
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      out.push({ object: "block", type: "numbered_list_item", numbered_list_item: { rich_text: toRich(m[1]) } });
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      out.push({ object: "block", type: "quote", quote: { rich_text: toRich(m[1]) } });
    } else {
      out.push({ object: "block", type: "paragraph", paragraph: { rich_text: toRich(line) } });
    }
  }
  return out;
}

// Notion only accepts languages from its own list and rejects anything else
// outright, so an unknown one becomes plain text rather than a failed write.
const NOTION_LANGS = new Set([
  "javascript", "typescript", "python", "rust", "go", "java", "c", "c++", "c#",
  "bash", "shell", "json", "yaml", "sql", "html", "css", "markdown", "diff",
  "docker", "graphql", "php", "ruby", "swift", "kotlin", "scala", "r", "lua",
  "plain text",
]);
const LANG_ALIAS = { js: "javascript", ts: "typescript", py: "python", sh: "bash", yml: "yaml", md: "markdown", cpp: "c++", cs: "c#" };
export const notionLanguage = (raw) => {
  const l = String(raw || "").toLowerCase().trim();
  const mapped = LANG_ALIAS[l] || l;
  return NOTION_LANGS.has(mapped) ? mapped : "plain text";
};

/* ---------------- databases ---------------- */

// Only what the integration was shared with. There is no "list everything"
// endpoint, and that is the point of Notion's permission model.
export async function listDatabases(token) {
  const out = [];
  let cursor;
  for (let page = 0; page < 10; page++) {
    const body = { filter: { property: "object", value: "database" }, page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const d = await call(token, "/search", { method: "POST", body });
    for (const db of d.results || []) {
      out.push({
        id: db.id,
        name: plain(db.title) || "Untitled database",
        url: db.url || "",
        // Which property holds the title, because it is NOT always called
        // "Name" — a database created from a template often calls it something
        // else, and writing to the wrong property creates a blank page.
        titleProp: titlePropertyOf(db),
        tagProp: tagPropertyOf(db),
      });
    }
    if (!d.has_more) break;
    cursor = d.next_cursor;
  }
  return out;
}

const titlePropertyOf = (db) =>
  Object.entries(db.properties || {}).find(([, p]) => p.type === "title")?.[0] || "Name";

const tagPropertyOf = (db) =>
  Object.entries(db.properties || {}).find(([, p]) => p.type === "multi_select")?.[0] || "";

/* ---------------- pages as notes ---------------- */

function pageToNote(page, { containerName = "", titleProp, tagProp } = {}) {
  const props = page.properties || {};
  const titleKey =
    titleProp && props[titleProp]
      ? titleProp
      : Object.entries(props).find(([, p]) => p.type === "title")?.[0];
  const tagKey =
    tagProp && props[tagProp]
      ? tagProp
      : Object.entries(props).find(([, p]) => p.type === "multi_select")?.[0];

  return shapeNote(
    {
      id: page.id,
      title: plain(props[titleKey]?.title) || "Untitled",
      body: "",
      tags: (props[tagKey]?.multi_select || []).map((t) => t.name),
      container: page.parent?.database_id || "",
      containerName,
      archived: !!page.archived,
      createdAt: toIso(page.created_time),
      updatedAt: toIso(page.last_edited_time),
      url: page.url || "",
    },
    { source: "notion" }
  );
}

export async function listPages(token, databaseId, { containerName, titleProp, tagProp } = {}) {
  const out = [];
  let cursor;
  for (let page = 0; page < 10; page++) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const d = await call(token, `/databases/${databaseId}/query`, { method: "POST", body });
    for (const p of d.results || []) out.push(pageToNote(p, { containerName, titleProp, tagProp }));
    if (!d.has_more) break;
    cursor = d.next_cursor;
  }
  return out;
}

async function allChildren(token, blockId) {
  const out = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ page_size: "100" });
    if (cursor) q.set("start_cursor", cursor);
    const d = await call(token, `/blocks/${blockId}/children?${q}`);
    out.push(...(d.results || []));
    if (!d.has_more) break;
    cursor = d.next_cursor;
  }
  return out;
}

export async function getPage(token, pageId) {
  const [page, blocks] = await Promise.all([call(token, `/pages/${pageId}`), allChildren(token, pageId)]);
  const { markdown, lossy } = blocksToMarkdown(blocks);
  const note = pageToNote(page);
  return {
    ...note,
    body: markdown,
    // A page containing blocks this converter cannot rebuild must not be
    // written back: replacing its children would destroy them.
    readOnly: lossy,
    ...(lossy
      ? {
          warning:
            "This page contains blocks that do not round-trip (an embed, a column layout, a synced or child database). It is readable here but writing would replace them, so it is marked read-only.",
        }
      : {}),
  };
}

export async function createPage(token, databaseId, { title, body, tags, titleProp = "Name", tagProp } = {}) {
  const properties = { [titleProp]: { title: toRich(title || "Untitled") } };
  if (tagProp && cleanTags(tags).length) {
    properties[tagProp] = { multi_select: cleanTags(tags).map((name) => ({ name })) };
  }
  const page = await call(token, "/pages", {
    method: "POST",
    body: {
      parent: { database_id: databaseId },
      properties,
      // Notion caps children at 100 per request; the rest are appended after.
      children: markdownToBlocks(body).slice(0, 100),
    },
  });
  const rest = markdownToBlocks(body).slice(100);
  if (rest.length) await appendBlocks(token, page.id, rest);
  return pageToNote(page, { titleProp, tagProp });
}

async function appendBlocks(token, pageId, blocks) {
  for (let i = 0; i < blocks.length; i += 100) {
    await call(token, `/blocks/${pageId}/children`, {
      method: "PATCH",
      body: { children: blocks.slice(i, i + 100) },
    });
  }
}

export async function updatePage(token, pageId, patch, { titleProp, tagProp } = {}) {
  const properties = {};
  if (patch.title !== undefined) {
    const key = titleProp || (await titleKeyFor(token, pageId));
    properties[key] = { title: toRich(patch.title) };
  }
  if (patch.tags !== undefined && tagProp) {
    properties[tagProp] = { multi_select: cleanTags(patch.tags).map((name) => ({ name })) };
  }

  const payload = {};
  if (Object.keys(properties).length) payload.properties = properties;
  // Notion has no hard delete through the API: archiving IS deleting, and it
  // is reversible, which is strictly better than what it replaces.
  if (patch.archived !== undefined) payload.archived = !!patch.archived;
  if (Object.keys(payload).length) await call(token, `/pages/${pageId}`, { method: "PATCH", body: payload });

  if (patch.body !== undefined) {
    // Replacing a body means deleting every existing child and appending the
    // new ones: there is no "set children" call. Deleting first and appending
    // after is the only order Notion allows, so a failure mid-way leaves the
    // page short — which is why a lossy page is refused before we get here.
    const existing = await allChildren(token, pageId);
    for (const b of existing) await call(token, `/blocks/${b.id}`, { method: "DELETE" }).catch(() => {});
    await appendBlocks(token, pageId, markdownToBlocks(patch.body));
  }

  return getPage(token, pageId);
}

async function titleKeyFor(token, pageId) {
  const page = await call(token, `/pages/${pageId}`);
  return Object.entries(page.properties || {}).find(([, p]) => p.type === "title")?.[0] || "Name";
}

export async function searchPages(token, query) {
  const d = await call(token, "/search", {
    method: "POST",
    body: { query, filter: { property: "object", value: "page" }, page_size: 50 },
  });
  return (d.results || []).map((p) => pageToNote(p));
}

export function assertWritable(note) {
  if (note.readOnly) {
    throw new NoteError(note.warning || "That Notion page cannot be written from here.");
  }
}
