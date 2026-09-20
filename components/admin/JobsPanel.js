// Job application tracker.
//
// Private (`jobs/` is admin-only in firestore.rules). Each application records
// which résumé variant was sent, so "what did I actually send them?" has an
// answer at interview time — that is the reason this lives next to the résumé
// store rather than in a spreadsheet.
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { logAdminAction } from "../../lib/auditLog";
import { VARIANT_LABELS, variantLabel, DEFAULT_VARIANT } from "../../lib/resumeStore";

const STAGES = [
  { id: "saved", label: "Saved", tone: "dim" },
  { id: "applied", label: "Applied", tone: "live" },
  { id: "screen", label: "Screen", tone: "live" },
  { id: "interview", label: "Interview", tone: "warn" },
  { id: "offer", label: "Offer", tone: "good" },
  { id: "rejected", label: "Rejected", tone: "bad" },
  { id: "withdrawn", label: "Withdrawn", tone: "dim" },
];
const OPEN_STAGES = new Set(["saved", "applied", "screen", "interview", "offer"]);
const stageOf = (id) => STAGES.find((s) => s.id === id) || STAGES[0];

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysSince = (iso) =>
  iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : null;

export default function JobsPanel({ user }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("open");
  const [open, setOpen] = useState(false);

  const blank = {
    company: "",
    role: "",
    url: "",
    location: "",
    salary: "",
    variant: DEFAULT_VARIANT,
    stage: "applied",
    appliedAt: todayISO(),
    nextFollowUp: "",
    jdText: "",
    notes: "",
  };
  const [form, setForm] = useState(blank);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "jobs"),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        arr.sort((a, b) => (b.appliedAt || "").localeCompare(a.appliedAt || ""));
        setRows(arr);
      },
      (e) => setErr(e?.code || "read failed")
    );
    return () => unsub();
  }, []);

  const add = async () => {
    setErr("");
    setMsg("");
    if (!form.company.trim() || !form.role.trim())
      return setErr("Company and role are both required.");
    try {
      await addDoc(collection(db, "jobs"), {
        ...form,
        company: form.company.trim(),
        role: form.role.trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ts: serverTimestamp(),
      });
      await logAdminAction({
        action: "job.create",
        target: `${form.company} — ${form.role}`,
        detail: `${form.stage} · résumé: ${variantLabel(form.variant)}`,
        user,
      });
      setMsg(`✓ Tracking ${form.role} at ${form.company}.`);
      setForm(blank);
      setOpen(false);
    } catch (e) {
      setErr(e?.message || "Could not save.");
    }
  };

  const setStage = (r) => async (e) => {
    const stage = e.target.value;
    try {
      await updateDoc(doc(db, "jobs", r.id), {
        stage,
        updatedAt: new Date().toISOString(),
      });
      await logAdminAction({
        action: "job.stage",
        target: `${r.company} — ${r.role}`,
        detail: `${r.stage} → ${stage}`,
        user,
      });
    } catch (e2) {
      setErr(e2?.message || "Update failed.");
    }
  };

  const setFollowUp = (r) => async (e) => {
    try {
      await updateDoc(doc(db, "jobs", r.id), {
        nextFollowUp: e.target.value || "",
        updatedAt: new Date().toISOString(),
      });
    } catch (e2) {
      setErr(e2?.message || "Update failed.");
    }
  };

  const remove = (r) => async () => {
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete ${r.role} at ${r.company}?`)) return;
    try {
      await deleteDoc(doc(db, "jobs", r.id));
      await logAdminAction({
        action: "job.delete",
        target: `${r.company} — ${r.role}`,
        user,
      });
    } catch (e) {
      setErr(e?.message || "Delete failed.");
    }
  };

  const counts = useMemo(() => {
    const c = {};
    for (const r of rows || []) c[r.stage] = (c[r.stage] || 0) + 1;
    return c;
  }, [rows]);

  const due = (rows || []).filter(
    (r) =>
      OPEN_STAGES.has(r.stage) &&
      r.nextFollowUp &&
      Date.parse(r.nextFollowUp) <= Date.now()
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (stageFilter === "open" && !OPEN_STAGES.has(r.stage)) return false;
      if (stageFilter !== "open" && stageFilter !== "all" && r.stage !== stageFilter)
        return false;
      if (!q) return true;
      return [r.company, r.role, r.location, r.notes, r.jdText]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query, stageFilter]);

  return (
    <main className="admin-main">
      {due.length > 0 && (
        <div className="vt-alert">
          {due.length} follow-up{due.length > 1 ? "s" : ""} due:{" "}
          {due.map((r) => `${r.company} (${r.nextFollowUp})`).join(", ")}
        </div>
      )}

      <section className="ops-card">
        <div className="ops-head">
          <h3>
            Applications{" "}
            <span className="admin-sub">
              {STAGES.filter((s) => counts[s.id]).map((s) => `${counts[s.id]} ${s.label.toLowerCase()}`).join(" · ") ||
                "none yet"}
            </span>
          </h3>
          <button className="admin-primary" type="button" onClick={() => setOpen((v) => !v)}>
            {open ? "Cancel" : "+ Track an application"}
          </button>
        </div>

        {open && (
          <div className="jb-form">
            <input className="admin-input" placeholder="Company *" value={form.company} onChange={set("company")} />
            <input className="admin-input" placeholder="Role *" value={form.role} onChange={set("role")} />
            <input className="admin-input" placeholder="Posting URL" value={form.url} onChange={set("url")} />
            <input className="admin-input" placeholder="Location" value={form.location} onChange={set("location")} />
            <input className="admin-input" placeholder="Comp / band" value={form.salary} onChange={set("salary")} />
            <select className="admin-input" value={form.variant} onChange={set("variant")}>
              {Object.entries(VARIANT_LABELS).map(([id, label]) => (
                <option key={id} value={id}>Résumé sent: {label}</option>
              ))}
            </select>
            <select className="admin-input" value={form.stage} onChange={set("stage")}>
              {STAGES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <label className="jb-date">
              <span className="admin-sub">Applied</span>
              <input className="admin-input" type="date" value={form.appliedAt} onChange={set("appliedAt")} />
            </label>
            <label className="jb-date">
              <span className="admin-sub">Follow up</span>
              <input className="admin-input" type="date" value={form.nextFollowUp} onChange={set("nextFollowUp")} />
            </label>
            <textarea
              className="admin-input jb-wide"
              rows={3}
              placeholder="Job description — paste it here so /resume-tailor has the real text"
              value={form.jdText}
              onChange={set("jdText")}
            />
            <textarea
              className="admin-input jb-wide"
              rows={2}
              placeholder="Notes — recruiter name, referral, interview feedback…"
              value={form.notes}
              onChange={set("notes")}
            />
            <div className="jb-wide jb-submit">
              <button className="admin-primary" type="button" onClick={add}>Save</button>
            </div>
          </div>
        )}
      </section>

      {err && <div className="admin-err">{err}</div>}
      {msg && !err && <div className="rm-ok">{msg}</div>}

      <div className="vt-toolbar">
        <input
          className="admin-search"
          placeholder="Search company, role, JD…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="admin-input vt-catfilter"
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
        >
          <option value="open">Open only</option>
          <option value="all">All stages</option>
          {STAGES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      {rows == null ? (
        <p className="admin-sub" style={{ padding: "20px 2px" }}>Loading…</p>
      ) : visible.length === 0 ? (
        <div className="inbox-empty">
          <p>Nothing tracked here yet.</p>
          <span>Add an application to start the pipeline.</span>
        </div>
      ) : (
        <div className="vt-list">
          {visible.map((r) => {
            const age = daysSince(r.appliedAt);
            const overdue =
              OPEN_STAGES.has(r.stage) &&
              r.nextFollowUp &&
              Date.parse(r.nextFollowUp) <= Date.now();
            return (
              <div key={r.id} className={`vt-item jb-item${overdue ? " overdue" : ""}`}>
                <div className="vt-main">
                  <span className="vt-name">
                    {r.role} <span className="jb-at">at</span> {r.company}
                  </span>
                  <span className={`jb-stage ${stageOf(r.stage).tone}`}>
                    {stageOf(r.stage).label}
                  </span>
                  {r.variant && r.variant !== DEFAULT_VARIANT && (
                    <a className="vt-cat" href={`/resume?v=${r.variant}`} target="_blank" rel="noreferrer">
                      {variantLabel(r.variant)} résumé
                    </a>
                  )}
                  {overdue && <span className="vt-exp bad">follow up</span>}
                </div>
                <div className="vt-meta">
                  {r.appliedAt ? `applied ${r.appliedAt}${age != null ? ` · ${age}d ago` : ""}` : "not applied"}
                  {r.location ? ` · ${r.location}` : ""}
                  {r.salary ? ` · ${r.salary}` : ""}
                  {r.url ? (
                    <>
                      {" · "}
                      <a className="rm-file" href={r.url} target="_blank" rel="noreferrer">posting</a>
                    </>
                  ) : null}
                  {r.notes ? ` · ${r.notes}` : ""}
                </div>
                <div className="vt-btns jb-btns">
                  <select className="admin-input jb-stagesel" value={r.stage} onChange={setStage(r)}>
                    {STAGES.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                  <input
                    className="admin-input jb-fu"
                    type="date"
                    title="Next follow-up"
                    value={r.nextFollowUp || ""}
                    onChange={setFollowUp(r)}
                  />
                  <button className="admin-del" type="button" onClick={remove(r)}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style jsx global>{`
        .jb-form {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin-top: 12px;
        }
        @media (max-width: 900px) {
          .jb-form {
            grid-template-columns: 1fr;
          }
        }
        .jb-wide {
          grid-column: 1 / -1;
        }
        .jb-submit {
          display: flex;
          justify-content: flex-end;
        }
        .jb-date {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .jb-date .admin-input {
          flex: 1;
        }
        .jb-at {
          color: #8b90a0;
          font-weight: 400;
        }
        .jb-stage {
          font-size: 10.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          border-radius: 999px;
          padding: 2px 9px;
        }
        .jb-stage.dim {
          color: #8b90a0;
          background: #1a1d26;
        }
        .jb-stage.live {
          color: #4ed0c0;
          background: #0c2724;
        }
        .jb-stage.warn {
          color: #ffcd7a;
          background: #2a1e07;
        }
        .jb-stage.good {
          color: #0a1a05;
          background: #7ad17a;
        }
        .jb-stage.bad {
          color: #ff9a9a;
          background: #2b1214;
        }
        .jb-item.overdue {
          border-color: #7a4a12;
        }
        .jb-btns {
          gap: 6px;
        }
        .jb-stagesel {
          width: 120px;
          padding: 5px 8px;
          font-size: 11.5px;
        }
        .jb-fu {
          width: 140px;
          padding: 5px 8px;
          font-size: 11.5px;
        }
      `}</style>
    </main>
  );
}
