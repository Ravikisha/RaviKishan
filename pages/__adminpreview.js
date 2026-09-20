// Design reference for the admin shell, rendered with the real AdminShell and
// the real stylesheets so it cannot drift from the signed-in interface.
// Open /__adminpreview in dev.
//
// 404s in production: it is a design tool, not a page.
import React, { useState } from "react";
import AdminShell from "../components/admin/AdminShell";
import PostBodyStyles from "../components/blog/PostBodyStyles";
import EditorStyles from "../components/admin/EditorStyles";
import { Styles } from "./admin";
import ImageField from "../components/admin/ImageField";
import ContentSection from "../components/admin/ContentEditor";
import ContentEditorStyles from "../components/admin/ContentEditorStyles";
import { projectImage, orgLogo, BUNDLED_LOGOS } from "../lib/assetUrl";
import { renderMarkdown } from "../lib/markdown";

const TABS = [
  ["search", "Search"],
  ["content", "Content"],
  ["vault", "Vault"],
  ["gallery", "Gallery"],
  ["assets", "Assets"],
  ["links", "Short links"],
  ["jobs", "Jobs"],
  ["tasks", "Tasks"],
  ["posts", "Writing"],
  ["drift", "Drift"],
  ["contacts", "Contacts"],
  ["mcp", "MCP"],
  ["analytics", "Analytics"],
  ["ops", "Backup & log"],
  ["inbox", "Inbox"],
];

// Written as lines and joined, so the sample survives every tool that has
// opinions about backslashes.
const SAMPLE = [
  "## What a container actually is",
  "",
  "There is no container object anywhere in Linux. When you start one, **three**",
  "separate kernel features get composed:",
  "",
  "- `namespaces` decide what the process can see",
  "- `cgroups` decide what it can use",
  "",
  "> The kernel has no idea your container exists.",
  "",
  "```go",
  "cmd.SysProcAttr = &syscall.SysProcAttr{",
  "    Cloneflags: syscall.CLONE_NEWUTS | syscall.CLONE_NEWPID,",
  "}",
  "```",
  "",
  "Read more in [the notes](https://ravikishan.me).",
].join("\n");

export default function AdminPreview() {
  const [view, setView] = useState("posts");
  const [poster, setPoster] = useState("gitasaar.jpg");
  const [org, setOrg] = useState("microsoft");
  const [projects, setProjects] = useState([
    { name: "Python Central Hub", description: "A platform for Python enthusiasts to learn, share and collaborate.", image: "pythoncentralhub.png", tags: ["personal", "open-source", "live"], skills: ["Astro", "Python"], featured: true, rank: 2 },
    { name: "GitaSaar", description: "Machine learning over the Bhagavad Gita, answering daily-life questions from its slokas.", image: "gitasaar.jpg", tags: ["nlp", "machine learning"], skills: ["Python", "FastAPI", "LangChain"], featured: true, rank: 1 },
    { name: "ExpressCraft", description: "An npx-based generator for Express apps.", image: "expresscraft.png", tags: ["cli", "open-source"], skills: ["Node.js"], featured: false, rank: 5 },
    { name: "DistributedKV", description: "A fault-tolerant key-value store with replication and leader election.", image: "distributedkv.png", tags: ["systems", "distributed"], skills: ["Go"], featured: true, rank: 3 },
  ]);
  const setAt = (path, value) => {
    setProjects((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      if (path.length === 1) return value;
      let cur = next;
      for (let i = 1; i < path.length - 1; i++) cur = cur[path[i]];
      cur[path[path.length - 1]] = value;
      return next;
    });
  };
  const [body, setBody] = useState(SAMPLE);

  return (
    <AdminShell
      tabs={TABS}
      view={view}
      onView={setView}
      email="ravikishan63392@gmail.com"
      badges={{ jobs: 2, vault: 1, inbox: 4 }}
      onSignOut={() => {}}
      actions={
        <>
          <button className="admin-ghost" type="button">Save draft</button>
          <button className="admin-primary" type="button">Publish</button>
        </>
      }
    >
      <main className="admin-main">
        <section className="ops-card">
          <div className="ops-head">
            <h3>New post</h3>
            <span className="admin-sub">3 published · 1 draft</span>
          </div>

          <div className="po-form">
            <input
              className="admin-input"
              placeholder="Title"
              defaultValue="Building a container runtime from scratch"
            />
            <div className="po-slug">
              <span className="lk-prefix">/blog/</span>
              <input className="admin-input" defaultValue="container-runtime-from-scratch" />
            </div>
            <input className="admin-input" placeholder="Tags" defaultValue="go, linux, systems" />
            <div className="po-cover">
              <input className="admin-input" placeholder="Cover image — paste a URL or upload" />
              <label className="admin-ghost po-img">Upload</label>
            </div>

            <div className="po-wide po-editor">
              <div className="po-tabs">
                <button type="button">Write</button>
                <button type="button">Preview</button>
                <button type="button" className="on">Side by side</button>
                <label className="admin-ghost po-img po-tabs-img">Insert image</label>
              </div>
              <div className="po-panes split">
                <textarea
                  className="admin-input po-body"
                  rows={16}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                <div
                  className="po-preview post-body"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(body, { mangle: false, headerIds: false }),
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        <ContentSection
          k="projects"
          label="Projects"
          value={projects}
          onChange={setAt}
          imageSpecFor={(path) =>
            String(path[path.length - 1]) === "image"
              ? { folder: "projects", resolve: projectImage, placeholder: "Poster — filename, URL, or upload" }
              : null
          }
          defaultOpen
          query=""
        />

        <section className="ops-card">
          <div className="ops-head">
            <h3>Project poster &amp; organisation logo</h3>
            <span className="admin-sub">image fields in the content editor</span>
          </div>
          <div className="admin-row complex" style={{ marginTop: 12 }}>
            <label className="admin-label">Poster</label>
            <ImageField
              value={poster}
              onChange={setPoster}
              folder="projects"
              resolve={projectImage}
              placeholder="Poster — filename, URL, or upload"
            />
          </div>
          <div className="admin-row complex" style={{ marginTop: 12 }}>
            <label className="admin-label">Organisation</label>
            <ImageField
              value={org}
              onChange={setOrg}
              folder="logos"
              resolve={orgLogo}
              fit="contain"
              placeholder="Slug, URL, or upload"
              choices={BUNDLED_LOGOS.map((v) => ({ value: v, src: orgLogo(v), label: v }))}
            />
          </div>
        </section>

        <section className="ops-card">
          <div className="ops-head">
            <h3>
              On dev.to <span className="admin-sub">27 articles · 1 already here</span>
            </h3>
            <button className="admin-primary" type="button">Import all</button>
          </div>
          <div className="ops-list">
            {[
              ["How RelaxCSS Works: Building a TailwindCSS-Like Utility Engine", "Imported", "live"],
              ["Building a Container Runtime from Scratch with Go (MyDocker)", "Not here yet", "dim"],
              ["Introducing RelaxLang: A Beginner-Friendly Programming Language", "Not here yet", "dim"],
            ].map(([t, state, tone]) => (
              <div key={t} className="ops-row">
                <span className="vt-name">{t}</span>
                <span className={`jb-stage ${tone}`}>{state}</span>
                <span className="ops-btns">
                  <button className="admin-ghost sm" type="button">dev.to</button>
                  <button className="admin-ghost sm" type="button">Import</button>
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <Styles />
      <PostBodyStyles />
      <EditorStyles />
      <ContentEditorStyles />
    </AdminShell>
  );
}

export async function getStaticProps() {
  if (process.env.NODE_ENV === "production") return { notFound: true };
  return { props: {} };
}
