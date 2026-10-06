// GitHub, in the admin.
//
// DESIGN
//
// The obvious panel here is a list of 59 repositories. It is also the wrong
// one: a list sorted by name or by stars is something you SCAN, and the
// question you actually arrive with is never "what are my repositories" — it
// is "which of them are letting the profile down". A repo with no description
// is invisible in GitHub search; one with no topics cannot be found by subject;
// a well-starred one with no homepage wastes the only traffic it gets.
//
// So the audit IS the panel. It opens on what needs attention, each finding
// sits on the row that owns it, and the row expands into the fields that fix
// it — description, homepage, topics, README — with no navigation in between.
// "All repositories" is a filter you ask for, not the default you wade through.
//
// The profile sits at the top because the bio is the single most-read string in
// the whole account, and it is edited about once a year — which is exactly why
// it should be visible rather than filed behind a tab.
//
// Visual language is the admin console's, unchanged: one amber accent, used for
// the row being edited and nothing else; state on the left edge, the same
// vocabulary as ContentEditor and the blog's contents rail; hairlines rather
// than middots; counts graded red/amber the way AdminShell's badges are.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getProfile,
  updateProfile,
  listRepos,
  updateRepo,
  createRepo,
  getReadme,
  writeReadme,
  auditRepos,
  forgetToken,
} from "../../lib/github";
import { logAdminAction } from "../../lib/auditLog";

const GITHUB = "github";

/* ================= the panel ================= */

export default function GithubPanel({ user }) {
  const [status, setStatus] = useState(null);
  const [profile, setProfile] = useState(null);
  const [repos, setRepos] = useState([]);
  const [readmes, setReadmes] = useState({});
  const [filter, setFilter] = useState("attention");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const connected = !!status?.connected;

  /* ---------------- loading ---------------- */

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/integrations/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: "{}",
    });
    const json = await res.json().catch(() => ({}));
    const gh = (json.providers || []).find((p) => p.provider === GITHUB) || {
      connected: false,
      detail: json.error || "GitHub is not set up on this deployment.",
    };
    setStatus(gh);
    return gh;
  }, [user]);

  const load = useCallback(async () => {
    setBusy("Reading your repositories…");
    setErr("");
    try {
      const [p, rs] = await Promise.all([getProfile(), listRepos()]);
      setProfile(p);
      setRepos(rs);
    } catch (e) {
      setErr(e.message || "GitHub could not be read.");
    } finally {
      setBusy("");
    }
  }, []);

  useEffect(() => {
    (async () => {
      const gh = await loadStatus().catch((e) => {
        setErr(e.message);
        return null;
      });
      if (gh?.connected) await load();
    })();
    // Page-load sequence, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // READMEs are one request each, so they are fetched on demand rather than up
  // front: 59 extra calls to open a panel is a quarter of the hourly rate limit
  // spent before you have touched anything.
  const loadReadmes = async () => {
    setBusy("Checking every README…");
    try {
      const next = {};
      for (const r of repos) {
        const f = await getReadme(r.owner || profile.login, r.name);
        next[r.name] = f.missing ? null : f.content;
      }
      setReadmes(next);
      setMsg("READMEs checked.");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };

  /* ---------------- derived ---------------- */

  const audit = useMemo(() => auditRepos(repos, { readmes }), [repos, readmes]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = repos;
    if (filter === "attention") list = list.filter((r) => audit.byRepo[r.name]?.length);
    if (filter === "archived") list = list.filter((r) => r.archived);
    if (term) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(term) ||
          r.description.toLowerCase().includes(term) ||
          r.topics.some((t) => t.includes(term))
      );
    }
    // Most-starred first: if something has to be fixed by hand, fix the one
    // most people see.
    return [...list].sort((a, b) => b.stars - a.stars);
  }, [repos, filter, q, audit]);

  /* ---------------- writes ---------------- */

  const run = async (label, fn) => {
    setBusy(label);
    setErr("");
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setErr(e.message || "That did not work.");
    } finally {
      setBusy("");
    }
  };

  const saveRepo = (repo, patch) =>
    run("Saving…", async () => {
      const owner = repo.owner || profile.login;
      await updateRepo(owner, repo.name, patch);
      // Re-read rather than patching state by hand: GitHub normalises topics
      // and trims descriptions, and a row that disagrees with the server is
      // how you end up "fixing" the same repo twice.
      const fresh = await listRepos();
      setRepos(fresh);
      setMsg(`${repo.name} updated.`);
      logAdminAction({
        action: "github.repo",
        target: `${owner}/${repo.name}`,
        detail: Object.keys(patch).join(", "),
        user,
      });
    });

  const saveReadme = (repo, file, content, message) =>
    run("Committing…", async () => {
      const owner = repo.owner || profile.login;
      await writeReadme(owner, repo.name, { ...file, content, message });
      const fresh = await getReadme(owner, repo.name);
      setReadmes((m) => ({ ...m, [repo.name]: fresh.content }));
      setMsg(`README committed to ${repo.name}.`);
      logAdminAction({
        action: "github.readme",
        target: `${owner}/${repo.name}`,
        detail: message || "Update README.md",
        user,
      });
    });

  const saveProfile = (patch) =>
    run("Saving…", async () => {
      setProfile(await updateProfile(patch));
      setMsg("Profile updated.");
      logAdminAction({ action: "github.profile", target: profile.login, detail: Object.keys(patch).join(", "), user });
    });

  const makeRepo = () => {
    const name = window.prompt("New repository name:");
    if (!name?.trim()) return;
    run("Creating…", async () => {
      const made = await createRepo({ name: name.trim() });
      setRepos(await listRepos());
      setMsg(`Created ${made.fullName}.`);
    });
  };

  const connect = () =>
    run("Opening GitHub…", async () => {
      const res = await fetch(`/api/integrations/${GITHUB}/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await user.getIdToken()}`,
        },
        body: "{}",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not start the connection.");
      window.location.assign(json.url);
    });

  const disconnect = () =>
    run("Disconnecting…", async () => {
      const { disconnect: drop } = await import("../../lib/taskProviders");
      await drop(GITHUB);
      forgetToken();
      setRepos([]);
      setProfile(null);
      await loadStatus();
      setMsg("GitHub disconnected.");
    });

  /* ---------------- render ---------------- */

  if (status === null) {
    return (
      <div className="gh-main">
        <p className="gh-busy">Checking the GitHub connection…</p>
        <GithubStyles />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="gh-main">
        <div className="ops-head">
          <div>
            <h3>GitHub</h3>
            <p className="admin-sub gh-sub">
              Edit repository descriptions, topics, homepages and READMEs without leaving the
              admin — and see which repositories are letting the profile down.
            </p>
          </div>
        </div>
        <div className="gh-connect">
          <p>{status.detail}</p>
          {status.configured === false ? null : (
            <button className="admin-primary" type="button" onClick={connect} disabled={!!busy}>
              Connect GitHub
            </button>
          )}
          {err ? <p className="admin-err">{err}</p> : null}
        </div>
        <GithubStyles />
      </div>
    );
  }

  return (
    <div className="gh-main">
      <div className="ops-head gh-head">
        <div>
          <h3>GitHub</h3>
          <p className="admin-sub gh-sub">
            Everything here saves straight to GitHub. A README change is a real commit.
          </p>
        </div>
        <span className="gh-actions">
          <button className="admin-ghost" type="button" onClick={makeRepo} disabled={!!busy}>
            New repository
          </button>
          <button className="admin-ghost" type="button" onClick={load} disabled={!!busy}>
            Refresh
          </button>
          <button className="admin-ghost" type="button" onClick={disconnect}>
            Disconnect
          </button>
        </span>
      </div>

      {busy ? <p className="gh-busy">{busy}</p> : null}
      {err ? <p className="admin-err">{err}</p> : null}
      {msg ? <p className="gh-ok">{msg}</p> : null}

      {profile ? <ProfileCard profile={profile} onSave={saveProfile} busy={!!busy} /> : null}

      <AuditLine audit={audit} repos={repos} hasReadmes={Object.keys(readmes).length > 0} onCheck={loadReadmes} busy={!!busy} />

      <div className="gh-filters">
        <div className="gh-chips" role="group" aria-label="Which repositories to show">
          {[
            ["attention", `Needs attention (${audit.repos})`],
            ["all", `All (${repos.length})`],
            ["archived", `Archived (${repos.filter((r) => r.archived).length})`],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`gh-chip${filter === k ? " on" : ""}`}
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className="admin-input gh-search"
          placeholder="Search name, description or topic"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search repositories"
        />
      </div>

      <div className="gh-list">
        {rows.length === 0 ? (
          <p className="gh-none">
            {filter === "attention"
              ? "Nothing needs attention. Every repository has a description and topics."
              : "No repository matches that."}
          </p>
        ) : (
          rows.map((r) => (
            <RepoRow
              key={r.name}
              repo={r}
              findings={audit.byRepo[r.name] || []}
              expanded={open === r.name}
              busy={!!busy}
              owner={r.owner || profile?.login}
              onToggle={() => setOpen(open === r.name ? null : r.name)}
              onSave={(patch) => saveRepo(r, patch)}
              onSaveReadme={(file, content, message) => saveReadme(r, file, content, message)}
            />
          ))
        )}
      </div>

      <GithubStyles />
    </div>
  );
}

/* ================= profile ================= */

export function ProfileCard({ profile, onSave, busy }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(profile);

  useEffect(() => setForm(profile), [profile]);

  const bioLeft = 160 - (form.bio || "").length;

  return (
    <section className={`gh-profile${editing ? " is-editing" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="gh-avatar" src={profile.avatar} alt="" width={52} height={52} />
      <div className="gh-who">
        <h4>
          {profile.name || profile.login}
          <span className="gh-handle">@{profile.login}</span>
        </h4>
        {editing ? (
          <div className="gh-fields">
            <label className="gh-field gh-wide">
              <span>
                Bio
                <i className={bioLeft < 0 ? "over" : ""}>{bioLeft} left</i>
              </span>
              <textarea
                className="admin-input gh-area"
                rows={2}
                value={form.bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
              />
            </label>
            {[
              ["name", "Name"],
              ["blog", "Website"],
              ["company", "Company"],
              ["location", "Location"],
            ].map(([k, label]) => (
              <label className="gh-field" key={k}>
                <span>{label}</span>
                <input
                  className="admin-input"
                  value={form[k] || ""}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              </label>
            ))}
            <div className="gh-row-actions gh-wide">
              <button className="admin-ghost" type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                className="admin-primary"
                type="button"
                disabled={busy || bioLeft < 0}
                title={bioLeft < 0 ? "GitHub caps the bio at 160 characters" : undefined}
                onClick={() => {
                  onSave({
                    name: form.name,
                    bio: form.bio,
                    blog: form.blog,
                    company: form.company,
                    location: form.location,
                  });
                  setEditing(false);
                }}
              >
                Save profile
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="gh-bio">{profile.bio || "No bio. This is the most-read line on the account."}</p>
            <p className="gh-meta">
              <span>{profile.publicRepos} public repos</span>
              <span className="gh-hair" aria-hidden="true" />
              <span>{profile.followers} followers</span>
              {profile.blog ? (
                <>
                  <span className="gh-hair" aria-hidden="true" />
                  <a href={profile.blog} target="_blank" rel="noreferrer noopener">
                    {profile.blog.replace(/^https?:\/\//, "")}
                  </a>
                </>
              ) : null}
            </p>
          </>
        )}
      </div>
      {!editing ? (
        <button className="admin-ghost" type="button" onClick={() => setEditing(true)}>
          Edit profile
        </button>
      ) : null}
    </section>
  );
}

/* ================= the audit line ================= */

export function AuditLine({ audit, repos, hasReadmes, onCheck, busy }) {
  const tone = audit.count === 0 ? "clear" : audit.byIssue["no description"] ? "bad" : "warn";
  const parts = Object.entries(audit.byIssue).map(([k, n]) => `${n} ${k}`);
  return (
    <section className={`gh-audit ${tone}`} role="status">
      <div>
        <strong>
          {audit.count === 0
            ? "Nothing to fix"
            : `${audit.repos} of ${repos.length} repositories need attention`}
        </strong>
        <span>
          {parts.length ? parts.join(", ") : "Every repository has a description and topics."}
        </span>
      </div>
      {!hasReadmes ? (
        <button className="admin-ghost" type="button" onClick={onCheck} disabled={busy}>
          Check READMEs too
        </button>
      ) : null}
    </section>
  );
}

/* ================= one repository ================= */

export function RepoRow({ repo, findings, expanded, busy, owner, onToggle, onSave, onSaveReadme }) {
  const [form, setForm] = useState(null);
  const [topicDraft, setTopicDraft] = useState("");
  const [readme, setReadme] = useState(null);
  const [readmeBody, setReadmeBody] = useState("");
  const [commitMsg, setCommitMsg] = useState("");
  const [loadingReadme, setLoadingReadme] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    setForm({
      description: repo.description,
      homepage: repo.homepage,
      topics: [...repo.topics],
    });
    setReadme(null);
    setReadmeBody("");
  }, [expanded, repo]);

  const openReadme = async () => {
    setLoadingReadme(true);
    try {
      const f = await getReadme(owner, repo.name);
      setReadme(f);
      setReadmeBody(f.content);
    } finally {
      setLoadingReadme(false);
    }
  };

  const addTopic = (raw) => {
    const t = String(raw).trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
    if (!t || form.topics.includes(t)) return;
    setForm({ ...form, topics: [...form.topics, t] });
  };

  return (
    <article className={`gh-repo${expanded ? " is-open" : ""}${findings.length ? " has-findings" : ""}`} data-repo={repo.name}>
      <button className="gh-repo-head" type="button" onClick={onToggle} aria-expanded={expanded}>
        <span className="gh-name">
          {repo.name}
          {repo.archived ? <i className="gh-flag">archived</i> : null}
          {repo.private ? <i className="gh-flag">private</i> : null}
        </span>
        <span className="gh-desc">
          {repo.description || <em className="gh-missing">No description</em>}
        </span>
        <span className="gh-stars" title={`${repo.stars} stars`}>
          {repo.stars}★
        </span>
      </button>

      {findings.length && !expanded ? (
        <p className="gh-findings">
          {findings.map((f) => (
            <span className="gh-finding" key={f.issue}>
              {f.issue}
            </span>
          ))}
        </p>
      ) : null}

      {expanded && form ? (
        <div className="gh-edit">
          <label className="gh-field gh-wide">
            <span>Description</span>
            <textarea
              className="admin-input gh-area"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What this is, in one line. GitHub search ranks on it."
            />
          </label>

          <label className="gh-field gh-wide">
            <span>Homepage</span>
            <input
              className="admin-input"
              value={form.homepage}
              onChange={(e) => setForm({ ...form, homepage: e.target.value })}
              placeholder="https://ravikishan.me/…"
            />
          </label>

          <div className="gh-field gh-wide">
            <span>Topics</span>
            <div className="gh-topics">
              {form.topics.map((t) => (
                <span className="gh-topic" key={t}>
                  {t}
                  <button
                    type="button"
                    aria-label={`Remove ${t}`}
                    onClick={() => setForm({ ...form, topics: form.topics.filter((x) => x !== t) })}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                className="gh-topic-input"
                value={topicDraft}
                placeholder="Add a topic"
                onChange={(e) => setTopicDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTopic(topicDraft);
                    setTopicDraft("");
                  } else if (e.key === "Backspace" && !topicDraft && form.topics.length) {
                    setForm({ ...form, topics: form.topics.slice(0, -1) });
                  }
                }}
              />
            </div>
          </div>

          <div className="gh-row-actions gh-wide">
            <a className="gh-link" href={repo.url} target="_blank" rel="noreferrer noopener">
              Open on GitHub
            </a>
            <button
              className="admin-primary"
              type="button"
              disabled={busy}
              onClick={() =>
                onSave({
                  description: form.description,
                  homepage: form.homepage,
                  topics: form.topics,
                })
              }
            >
              Save changes
            </button>
          </div>

          <div className="gh-readme gh-wide">
            {readme === null ? (
              <button className="admin-ghost" type="button" onClick={openReadme} disabled={loadingReadme}>
                {loadingReadme ? "Opening README…" : "Edit README"}
              </button>
            ) : (
              <>
                <label className="gh-field">
                  <span>
                    {readme.missing ? "New README.md" : readme.path}
                    <i>committed to {repo.defaultBranch}</i>
                  </span>
                  <textarea
                    className="admin-input gh-readme-area"
                    rows={14}
                    value={readmeBody}
                    onChange={(e) => setReadmeBody(e.target.value)}
                  />
                </label>
                <div className="gh-row-actions">
                  <input
                    className="admin-input"
                    value={commitMsg}
                    placeholder={readme.missing ? "Add README.md" : "Update README.md"}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    aria-label="Commit message"
                  />
                  <button
                    className="admin-primary"
                    type="button"
                    disabled={busy || !readmeBody.trim()}
                    onClick={() => onSaveReadme(readme, readmeBody, commitMsg)}
                  >
                    Commit README
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

/* ================= styles ================= */

export function GithubStyles() {
  return (
    <style jsx global>{`
      .gh-main {
        max-width: none;
      }
      .gh-sub {
        margin: 6px 0 0;
        max-width: 64ch;
        line-height: 1.5;
      }
      .gh-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .gh-busy {
        margin: 10px 0;
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
      }
      .gh-ok {
        margin: 10px 0;
        font-size: 12.5px;
        color: var(--a-amber, #ffb020);
      }
      .gh-connect {
        max-width: 56ch;
        margin: 32px 0;
        display: grid;
        gap: 12px;
        justify-items: start;
      }
      .gh-connect p {
        margin: 0;
        font-size: 13px;
        line-height: 1.55;
        color: var(--a-dim, #8b90a0);
      }

      /* ---- profile ---- */
      .gh-profile {
        display: flex;
        gap: 14px;
        align-items: flex-start;
        padding: 14px 16px;
        border: 1px solid var(--a-line, #23262f);
        border-radius: 12px;
        background: var(--a-raise, #15171d);
        margin: 18px 0;
      }
      .gh-profile.is-editing {
        border-left: 3px solid var(--a-amber, #ffb020);
      }
      .gh-avatar {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        flex: none;
      }
      .gh-who {
        flex: 1;
        min-width: 0;
      }
      .gh-who h4 {
        margin: 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: 15.5px;
        color: var(--a-text, #e7e8ee);
        display: flex;
        gap: 8px;
        align-items: baseline;
        flex-wrap: wrap;
      }
      .gh-handle {
        font-family: Inter, sans-serif;
        font-size: 12px;
        font-weight: 400;
        color: var(--a-dim, #7d8496);
      }
      .gh-bio {
        margin: 5px 0 0;
        font-size: 13px;
        line-height: 1.5;
        color: var(--a-text, #e7e8ee);
        max-width: 72ch;
      }
      .gh-meta {
        margin: 7px 0 0;
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .gh-meta a {
        color: var(--a-dim, #7d8496);
      }
      /* Hairlines, not middots. */
      .gh-hair {
        width: 14px;
        height: 1px;
        background: var(--a-line, #2a2e38);
        flex: none;
      }

      /* ---- audit ---- */
      .gh-audit {
        display: flex;
        align-items: center;
        gap: 14px;
        justify-content: space-between;
        flex-wrap: wrap;
        padding: 12px 14px;
        border-radius: 10px;
        border: 1px solid var(--a-line, #23262f);
        border-left-width: 3px;
        background: rgba(255, 255, 255, 0.015);
        margin: 0 0 16px;
      }
      .gh-audit > div {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .gh-audit strong {
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
      }
      .gh-audit span {
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
      }
      /* Graded like the rail badges in AdminShell. */
      .gh-audit.clear {
        border-left-color: var(--a-line, #23262f);
      }
      .gh-audit.warn {
        border-left-color: var(--a-amber, #ffb020);
      }
      .gh-audit.bad {
        border-left-color: #a33b45;
      }

      /* ---- filters ---- */
      .gh-filters {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      .gh-chips {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .gh-chip {
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        color: var(--a-dim, #8b90a0);
        border-radius: 999px;
        padding: 6px 12px;
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      .gh-chip.on {
        border-color: var(--a-amber, #ffb020);
        color: var(--a-text, #e7e8ee);
      }
      .gh-search {
        flex: 1;
        min-width: 220px;
      }

      /* ---- the list ---- */
      .gh-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .gh-none {
        font-size: 13px;
        color: var(--a-dim, #8b90a0);
        padding: 18px 2px;
      }
      .gh-repo {
        border: 1px solid var(--a-line, #23262f);
        border-radius: 10px;
        background: var(--a-raise, #15171d);
        border-left: 3px solid transparent;
        overflow: hidden;
      }
      /* The one amber thing: the row you are editing — the same left-edge
         language as ContentEditor and the blog's contents rail. */
      .gh-repo.is-open {
        border-left-color: var(--a-amber, #ffb020);
      }
      .gh-repo.has-findings:not(.is-open) {
        border-left-color: #5a4a22;
      }
      .gh-repo-head {
        width: 100%;
        display: flex;
        align-items: baseline;
        gap: 12px;
        padding: 11px 14px;
        background: none;
        border: 0;
        text-align: left;
        font: inherit;
        color: inherit;
        cursor: pointer;
      }
      .gh-repo-head:hover {
        background: rgba(255, 255, 255, 0.025);
      }
      .gh-name {
        font-family: "Space Grotesk", sans-serif;
        font-weight: 600;
        font-size: 13.5px;
        color: var(--a-text, #e7e8ee);
        flex: none;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .gh-flag {
        font-style: normal;
        font-size: 10px;
        color: var(--a-dim, #7d8496);
        border: 1px solid var(--a-line, #2a2e38);
        border-radius: 4px;
        padding: 1px 5px;
      }
      .gh-desc {
        flex: 1;
        min-width: 0;
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .gh-missing {
        color: #d8757f;
        font-style: normal;
      }
      .gh-stars {
        flex: none;
        font-size: 12px;
        color: var(--a-dim, #7d8496);
      }
      .gh-findings {
        margin: 0;
        padding: 0 14px 10px;
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .gh-finding {
        font-size: 10.5px;
        color: var(--a-amber, #ffb020);
        border: 1px solid rgba(255, 176, 32, 0.35);
        border-radius: 999px;
        padding: 2px 8px;
      }

      /* ---- the editor ---- */
      .gh-edit {
        padding: 4px 14px 16px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        border-top: 1px solid var(--a-line, #23262f);
      }
      .gh-wide {
        grid-column: 1 / -1;
      }
      .gh-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
      }
      .gh-field > span {
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }
      .gh-field > span i {
        font-style: normal;
        color: #5c6377;
      }
      .gh-field > span i.over {
        color: #ff8a8a;
      }
      /* textarea.admin-input is monospace — right for a README, wrong for a
         one-line description. */
      .gh-area {
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        font-size: 13px;
      }
      .gh-readme-area {
        font-size: 12.5px;
        line-height: 1.5;
      }
      .gh-topics {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 9px;
        padding: 7px 8px;
        background: var(--a-void, #0d0e13);
      }
      .gh-topic {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 11.5px;
        color: var(--a-text, #e7e8ee);
        background: rgba(255, 255, 255, 0.05);
        border-radius: 999px;
        padding: 3px 4px 3px 9px;
      }
      .gh-topic button {
        background: none;
        border: 0;
        color: var(--a-dim, #7d8496);
        cursor: pointer;
        font-size: 13px;
        line-height: 1;
        padding: 0 4px;
      }
      .gh-topic button:hover {
        color: #ff8a8a;
      }
      .gh-topic-input {
        flex: 1;
        min-width: 120px;
        background: none;
        border: 0;
        outline: none;
        color: var(--a-text, #e7e8ee);
        font: inherit;
        font-size: 12.5px;
      }
      .gh-row-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        justify-content: flex-end;
        flex-wrap: wrap;
      }
      .gh-row-actions .admin-input {
        flex: 1;
        min-width: 180px;
      }
      .gh-link {
        margin-right: auto;
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
      }
      .gh-readme {
        display: flex;
        flex-direction: column;
        gap: 10px;
        border-top: 1px solid var(--a-line, #23262f);
        padding-top: 12px;
      }

      @media (max-width: 820px) {
        .gh-edit {
          grid-template-columns: 1fr;
        }
        .gh-repo-head {
          flex-wrap: wrap;
        }
        .gh-desc {
          white-space: normal;
          flex-basis: 100%;
        }
      }
    `}</style>
  );
}
