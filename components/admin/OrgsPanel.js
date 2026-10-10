// Organisations — the one place membership is seen whole and edited.
//
// DESIGN
//
// Every other panel in this console now acts INSIDE one org, silently, through
// the x-org-id header. That makes this the only page that looks across them,
// and it answers three questions in the order people arrive with them:
//
//   1. Which org am I in, and what does it hold?   the status line
//   2. What orgs are there, and what is each for?  one row per org
//   3. Which logins does each org get?             the roster of every login
//
// THE ONE BOLD THING is the amber left edge on the org you are acting in, with
// "Acting in" beside its name. Amber means "the selected one" everywhere in this
// admin (the rail marker, the expanded row, the default chip), and here the
// selected thing is the whole workspace. Each org's own colour is a thin bar
// beside its name, never a fill — it identifies, it does not shout.
//
// Membership is a set of chips on each login, one per org, because the honest
// model is "this login is used by these orgs", not "this login lives in one
// place". A chip that would leave a login in NO org is refused where it was
// clicked, with the reason, rather than disabled: a disabled chip implies a
// permission you could go and fix, and the fix here is a different action
// (disconnect it from Accounts).
//
// Deleting an org never deletes a credential, so the panel asks the server what
// deleting WOULD do first, shows that plan, and only then offers the button —
// or lists the logins in the way when the server refuses.
//
// Every part is exported so /__orgspreview renders THESE components against a
// deliberately unflattering seed instead of a copy of their markup.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { slugifyOrg, DEFAULT_ORG } from "../../lib/server/orgShape";
import {
  createOrg,
  deleteOrg,
  loadOrgs,
  migrateLogins,
  setAccountOrgs,
  updateOrg,
} from "../../lib/orgsClient";
import { currentOrgId, setOrg } from "../../lib/orgState";

// Provider ids to the names people use. The /api/orgs roster carries ids only.
export const PROVIDER_LABEL = {
  google: "Google",
  microsoft: "Microsoft",
  github: "GitHub",
  youtube: "YouTube",
  instagram: "Instagram",
  x: "X",
  analytics: "Google Analytics",
  notion: "Notion",
  linkedin: "LinkedIn",
  gmail: "Gmail",
  outlook: "Outlook",
  huggingface: "Hugging Face",
  kaggle: "Kaggle",
};
const providerName = (id) => PROVIDER_LABEL[id] || id;

// Colours that read on the dark console and are not amber — amber already
// means "the one you are in", and an org painted amber would claim that
// permanently. Purple is out for the reason it is out of the whole site.
export const ORG_SWATCHES = ["#5B8DEF", "#3FB8A9", "#7BC86C", "#E0564A", "#D9C9A3", "#8E96A8"];

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "Tasks, Mail and Code" — a list, said as a sentence.
const sayList = (items) =>
  items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

// What one org holds, by job, from the roster across every org.
export function holdingsOf(orgId, accounts, services) {
  const mine = accounts.filter((a) => (a.orgIds || [DEFAULT_ORG]).includes(orgId));
  const byService = services
    .map((s) => ({ ...s, count: mine.filter((a) => s.providers.includes(a.provider)).length }))
    .filter((s) => s.count);
  return { count: mine.length, byService };
}

/* ------------------------------------------------------------------ *
 * The status line                                                     *
 * ------------------------------------------------------------------ */

export function OrgHeadline({ org, orgs, accounts, services }) {
  if (!org) return null;
  const h = holdingsOf(org.id, accounts, services);
  const others = orgs.length - 1;
  return (
    <header className="og-top">
      <p className="og-state" style={{ "--og-c": org.color || "var(--og-line)" }}>
        <strong>Acting in {org.name}.</strong>{" "}
        {h.count
          ? `It holds ${plural(h.count, "login")} for ${sayList(h.byService.map((s) => s.label))}.`
          : "It holds no logins yet — connect one from Accounts while you are in it, or add an existing login below."}{" "}
        {others
          ? `${plural(others, "other org")} beside it. Every other section acts in ${org.name} until you switch.`
          : "It is the only org. Every other section acts in it."}
      </p>
    </header>
  );
}

/* ------------------------------------------------------------------ *
 * One org                                                             *
 * ------------------------------------------------------------------ */

export function OrgRow({
  org,
  current,
  holdings,
  deleting,
  onSwitch,
  onEdit,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  labelFor = (k) => k,
}) {
  const d = deleting || null;
  return (
    <li className={`og-org${current ? " on" : ""}`}>
      <div className="og-org-main">
        <span className="og-swatch" style={{ background: org.color || "transparent" }} aria-hidden="true" />
        <div className="og-org-text">
          <p className="og-org-name">
            <span>{org.name}</span>
            {current ? <em className="og-acting">Acting in</em> : null}
          </p>
          <p className="og-org-id mono" title="The org id. It is stamped on every login and cannot change.">
            {org.id}
          </p>
          {org.description ? <p className="og-org-desc">{org.description}</p> : null}
          <p className="og-holds">
            {holdings.count ? (
              holdings.byService.map((s) => (
                <span key={s.id}>
                  {s.label} {s.count}
                </span>
              ))
            ) : (
              <span className="og-holds-none">No logins yet</span>
            )}
          </p>
          {org.website ? (
            <a className="og-site" href={org.website} target="_blank" rel="noreferrer">
              {org.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>
          ) : null}
        </div>
        <div className="og-org-ctl">
          {current ? null : (
            // The name sits right beside it; repeating a long one in the
            // button pushed the controls off a narrow screen.
            <button type="button" className="og-btn" onClick={onSwitch} aria-label={`Switch to ${org.name}`}>
              Switch
            </button>
          )}
          <button type="button" className="og-btn og-quiet" onClick={onEdit}>
            Edit
          </button>
          {org.isDefault ? null : (
            <button type="button" className="og-btn og-quiet og-del" onClick={onDelete} disabled={!!d}>
              Delete
            </button>
          )}
        </div>
      </div>

      {org.isDefault ? (
        <p className="og-note">
          The default org, so it cannot be deleted.
        </p>
      ) : null}

      {d ? (
        <div className={`og-verdict ${d.phase}`} role="status">
          {d.phase === "checking" ? <p>Checking what deleting {org.name} would touch…</p> : null}
          {d.phase === "blocked" ? (
            <>
              <p>
                {org.name} cannot be deleted yet: these logins belong to no other org, and deleting the
                org must never delete a credential. Add each to another org below, or disconnect it from
                Accounts while you are in {org.name}.
              </p>
              <ul className="og-blockers">
                {(d.accounts || []).map((k) => (
                  <li key={k}>{labelFor(k)}</li>
                ))}
                {(d.secrets || []).map((k) => (
                  <li key={k}>
                    Saved sign-in <span className="mono">{k}</span>
                  </li>
                ))}
              </ul>
              <button type="button" className="og-btn og-quiet" onClick={onCancelDelete}>
                Close
              </button>
            </>
          ) : null}
          {d.phase === "plan" ? (
            <>
              <p>
                Deleting {org.name} removes it from{" "}
                {d.plan?.unassigned?.length
                  ? `${plural(d.plan.unassigned.length, "shared login")} (${d.plan.unassigned
                      .map(labelFor)
                      .join(", ")}), which stay in their other orgs`
                  : "no logins"}
                , drops {plural(d.plan?.identitiesRemoved?.length || 0, "person", "people")} filed under it and
                its saved defaults. No credential is deleted.
              </p>
              <div className="og-row-btns">
                <button
                  type="button"
                  className="og-btn og-danger"
                  onClick={onConfirmDelete}
                  aria-label={`Delete ${org.name}`}
                >
                  Delete this org
                </button>
                <button type="button" className="og-btn og-quiet" onClick={onCancelDelete}>
                  Keep it
                </button>
              </div>
            </>
          ) : null}
          {d.phase === "error" ? (
            <>
              <p className="og-err">{d.message}</p>
              <button type="button" className="og-btn og-quiet" onClick={onCancelDelete}>
                Close
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * Creating and editing                                                *
 * ------------------------------------------------------------------ */

const BLANK = { name: "", description: "", website: "", color: "", note: "" };

export function OrgForm({ initial, existingIds = [], busy = false, error = "", onSave, onCancel }) {
  const editing = !!initial?.id;
  const [f, setF] = useState(() => ({ ...BLANK, ...(initial || {}) }));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  // The id is derived, shown, and — once the org exists — fixed. It is stamped
  // on every login filed under the org, so renaming changes the NAME only.
  const slug = editing ? initial.id : slugifyOrg(f.name);
  const taken = !editing && slug && existingIds.includes(slug);
  const hexOk = !f.color || /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(f.color);
  const siteOk = !f.website || /^https?:\/\/\S+$/i.test(f.website);
  const ready = f.name.trim() && slug && !taken && hexOk && siteOk && !busy;

  const submit = (e) => {
    e.preventDefault();
    if (!ready) return;
    const out = {
      name: f.name.trim(),
      description: f.description,
      website: f.website.trim(),
      color: f.color.trim(),
      note: f.note,
    };
    onSave(editing ? out : { id: slug, ...out });
  };

  return (
    <form className="og-form" onSubmit={submit}>
      <label className="og-field og-wide">
        <span>Name</span>
        <input
          className="admin-input og-name-in"
          autoFocus
          placeholder="Acme Labs"
          value={f.name}
          onChange={set("name")}
          maxLength={120}
        />
        <span className="og-hint">
          {editing ? (
            <>
              Id <span className="mono">{slug}</span> — fixed, because every login filed here carries it.
            </>
          ) : !f.name.trim() ? (
            "The id is made from the name and cannot change later."
          ) : !slug ? (
            "Needs at least two letters or digits to make an id from."
          ) : taken ? (
            <>
              <span className="mono">{slug}</span> is already an org. Choose another name.
            </>
          ) : (
            <>
              Id <span className="mono">{slug}</span> — cannot change later.
            </>
          )}
        </span>
      </label>

      <label className="og-field og-wide">
        <span>What it is for</span>
        <textarea
          className="admin-input og-area"
          rows={2}
          placeholder="Client work for Acme — their channel, their mailbox, their repos."
          value={f.description}
          onChange={set("description")}
        />
      </label>

      <label className="og-field">
        <span>Website</span>
        <input
          className="admin-input"
          inputMode="url"
          placeholder="https://acme.example"
          value={f.website}
          onChange={set("website")}
        />
        {!siteOk ? <span className="og-hint bad">Starts with http:// or https://</span> : null}
      </label>

      <div className="og-field">
        <span>Colour</span>
        <div className="og-swatches" role="radiogroup" aria-label="Colour">
          <button
            type="button"
            role="radio"
            aria-checked={!f.color}
            className={`og-sw none${!f.color ? " on" : ""}`}
            onClick={() => setF((x) => ({ ...x, color: "" }))}
            title="No colour"
          />
          {ORG_SWATCHES.map((c) => (
            <button
              type="button"
              role="radio"
              key={c}
              aria-checked={f.color.toLowerCase() === c.toLowerCase()}
              aria-label={c}
              className={`og-sw${f.color.toLowerCase() === c.toLowerCase() ? " on" : ""}`}
              style={{ background: c }}
              onClick={() => setF((x) => ({ ...x, color: c }))}
            />
          ))}
          <input
            className="admin-input og-hex mono"
            placeholder="#hex"
            value={f.color}
            onChange={set("color")}
            aria-label="Colour as a hex value"
            maxLength={7}
          />
        </div>
        {!hexOk ? <span className="og-hint bad">A hex value such as #5B8DEF</span> : null}
      </div>

      <label className="og-field og-wide">
        <span>Note</span>
        <textarea
          className="admin-input og-area"
          rows={2}
          placeholder="Anything worth remembering — who to ask, when the contract ends."
          value={f.note}
          onChange={set("note")}
        />
      </label>

      {error ? <p className="og-err og-wide">{error}</p> : null}

      <div className="og-row-btns og-wide">
        <button className="og-btn og-primary" type="submit" disabled={!ready}>
          {busy ? "Saving…" : editing ? `Save ${f.name.trim() || "org"}` : "Create org"}
        </button>
        <button className="og-btn og-quiet" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Every login, across every org                                       *
 * ------------------------------------------------------------------ */

export function LoginRow({ account, orgs, pending = false, onSet }) {
  const [note, setNote] = useState("");
  const member = account.orgIds?.length ? account.orgIds : [DEFAULT_ORG];

  const toggle = (orgId) => {
    setNote("");
    const has = member.includes(orgId);
    if (has && member.length === 1) {
      const name = orgs.find((o) => o.id === orgId)?.name || orgId;
      setNote(
        `${name} is the only org using this login. A login has to belong to at least one org, or nothing could see it, use it or disconnect it — add it to another org first, or disconnect it from Accounts.`
      );
      return;
    }
    onSet(has ? member.filter((x) => x !== orgId) : [...member, orgId]);
  };

  return (
    <li className={`og-login${account.legacy ? " old" : ""}${pending ? " busy" : ""}`}>
      <div className="og-login-main">
        <span className="og-login-prov">{providerName(account.provider)}</span>
        <span className="og-login-who">
          {account.label}
          {account.email && account.email !== account.label ? (
            <span className="og-login-mail">{account.email}</span>
          ) : null}
        </span>
        <span className="og-chips" aria-label={`Orgs using ${account.label}`}>
          {orgs.map((o) => {
            const on = member.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                className={`og-chip${on ? " on" : ""}`}
                aria-pressed={on}
                disabled={account.legacy || pending}
                onClick={() => toggle(o.id)}
                title={on ? `Remove from ${o.name}` : `Add to ${o.name}`}
              >
                {o.color ? <i style={{ background: o.color }} aria-hidden="true" /> : null}
                <span>{o.name}</span>
              </button>
            );
          })}
        </span>
      </div>
      {account.legacy ? (
        <p className="og-note">
          Still in the old single-account store, which has no record of its own to file under an org — it
          belongs to Relax only. Reconnect it from Accounts to share it.
        </p>
      ) : null}
      {note ? (
        <p className="og-refuse" role="alert">
          {note}
        </p>
      ) : null}
    </li>
  );
}

export function LoginRoster({ accounts, orgs, pendingKey = "", onSet }) {
  const rows = useMemo(
    () =>
      [...accounts].sort(
        (a, b) =>
          providerName(a.provider).localeCompare(providerName(b.provider)) ||
          String(a.label).localeCompare(String(b.label))
      ),
    [accounts]
  );
  const shared = rows.filter((a) => (a.orgIds || []).length > 1).length;
  return (
    <section className="og-band">
      <div className="og-band-head">
        <h3>All logins</h3>
        <span className="og-band-sub">
          {rows.length
            ? `${plural(rows.length, "login")} across every org${shared ? `, ${shared} shared` : ""}`
            : "Nothing connected in any org"}
        </span>
      </div>
      <p className="og-lede">
        One login is one credential, whichever orgs use it — sharing a channel with a second org does not
        copy it. Each chip is an org; a filled one uses this login.
      </p>
      {rows.length ? (
        <ul className="og-logins">
          {rows.map((a) => (
            <LoginRow
              key={a.key}
              account={a}
              orgs={orgs}
              pending={pendingKey === a.key}
              onSet={(ids) => onSet(a, ids)}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Filing what predates orgs under Relax                               *
 * ------------------------------------------------------------------ */

const migrateSummary = (r, done) => {
  const parts = [];
  if (r.accountsStamped?.length) parts.push(plural(r.accountsStamped.length, "login"));
  if (r.identitiesStamped) parts.push(plural(r.identitiesStamped, "person", "people"));
  if (r.secretsStamped) parts.push(plural(r.secretsStamped, "saved sign-in"));
  if (!parts.length && !r.orgCreated) return "";
  const what = parts.length ? sayList(parts) : "nothing else";
  return done
    ? `Filed ${what} under Relax${r.orgCreated ? " and wrote Relax's own record" : ""}.`
    : `Would file ${what} under Relax${r.orgCreated ? ", and write Relax's own record" : ""}. Nothing changes until you apply it.`;
};

export function MigrateControl({ initial = null, onCheck = () => migrateLogins(), onApply = () => migrateLogins({ apply: true }), onDone }) {
  const [state, setState] = useState(() => (initial ? { phase: "checked", result: initial } : { phase: "idle" }));

  const check = async () => {
    setState({ phase: "busy" });
    try {
      setState({ phase: "checked", result: await onCheck() });
    } catch (e) {
      setState({ phase: "error", message: e.message });
    }
  };
  const apply = async () => {
    setState((s) => ({ ...s, phase: "applying" }));
    try {
      const result = await onApply();
      setState({ phase: "done", result });
      onDone?.();
    } catch (e) {
      setState({ phase: "error", message: e.message });
    }
  };

  const r = state.result;
  const pending = r ? migrateSummary(r, false) : "";

  return (
    <section className="og-band og-migrate">
      <div className="og-band-head">
        <h3>Bring existing logins into Relax</h3>
      </div>
      <p className="og-lede">
        Anything made before orgs existed already counts as Relax&apos;s. This writes that down on each record,
        so an export or a later filter does not have to assume it. It only adds the org where none is set — a
        login already filed under an org is left alone. Check first; nothing is written until you apply.
      </p>
      <div className="og-row-btns">
        {state.phase === "checked" && pending ? (
          <button type="button" className="og-btn og-primary" onClick={apply}>
            File them under Relax
          </button>
        ) : null}
        {state.phase !== "done" ? (
          <button
            type="button"
            className="og-btn"
            onClick={check}
            disabled={state.phase === "busy" || state.phase === "applying"}
          >
            {state.phase === "busy" ? "Checking…" : state.phase === "checked" ? "Check again" : "Check what would move"}
          </button>
        ) : null}
      </div>
      {state.phase === "checked" ? (
        <p className={`og-verdict-line${pending ? " todo" : ""}`}>
          {pending || "Everything is already filed under an org. Nothing to do."}
        </p>
      ) : null}
      {state.phase === "applying" ? <p className="og-verdict-line">Filing…</p> : null}
      {state.phase === "done" ? (
        <p className="og-verdict-line">{migrateSummary(state.result, true) || "Nothing needed filing."}</p>
      ) : null}
      {state.phase === "error" ? <p className="og-err">{state.message}</p> : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The panel                                                           *
 * ------------------------------------------------------------------ */

export default function OrgsPanel({ onOrgsChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState(null); // null | { initial }
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState({});
  const [pendingKey, setPendingKey] = useState("");
  const here = currentOrgId();

  const refresh = useCallback(async () => {
    try {
      setData(await loadOrgs());
      setErr("");
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const orgs = useMemo(() => data?.orgs || [], [data]);
  const accounts = useMemo(() => data?.accounts || [], [data]);
  const services = useMemo(() => data?.services || [], [data]);
  const current = orgs.find((o) => o.id === here) || null;

  const labelFor = useCallback(
    (key) => {
      const a = accounts.find((x) => x.key === key);
      return a ? `${a.label} (${providerName(a.provider)})` : key;
    },
    [accounts]
  );

  const changed = async () => {
    await refresh();
    onOrgsChanged?.();
  };

  const save = async (values) => {
    setSaving(true);
    setFormErr("");
    try {
      const editing = form?.initial?.id;
      const org = editing ? await updateOrg(editing, values) : await createOrg(values);
      setMsg(editing ? `${org.name} saved.` : `${org.name} created. Switch to it to connect its logins.`);
      setForm(null);
      await changed();
    } catch (e) {
      setFormErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const askDelete = async (org) => {
    setDeleting((d) => ({ ...d, [org.id]: { phase: "checking" } }));
    try {
      // Without confirm the server refuses and states its plan — that refusal
      // IS the answer to "what would this do".
      await deleteOrg(org.id);
      setDeleting((d) => ({ ...d, [org.id]: undefined }));
      await changed();
    } catch (e) {
      const data = e.data || {};
      const next =
        e.code === "org/needs-confirm"
          ? { phase: "plan", plan: data.plan }
          : e.code === "org/not-empty"
          ? { phase: "blocked", accounts: data.accounts || [], secrets: data.secrets || [] }
          : { phase: "error", message: e.message };
      setDeleting((d) => ({ ...d, [org.id]: next }));
    }
  };

  const confirmDelete = async (org) => {
    setDeleting((d) => ({ ...d, [org.id]: { phase: "checking" } }));
    try {
      await deleteOrg(org.id, { confirm: true });
      setDeleting((d) => ({ ...d, [org.id]: undefined }));
      // Deleting the org you are in leaves nothing to act in — go home.
      if (org.id === here) return setOrg(DEFAULT_ORG);
      setMsg(`${org.name} deleted. No credential was removed.`);
      await changed();
    } catch (e) {
      setDeleting((d) => ({ ...d, [org.id]: { phase: "error", message: e.message } }));
    }
  };

  const setMembership = async (account, orgIds) => {
    setPendingKey(account.key);
    setErr("");
    try {
      await setAccountOrgs(account.provider, account.accountId, orgIds);
      await changed();
    } catch (e) {
      setErr(e.message);
    } finally {
      setPendingKey("");
    }
  };

  if (!data) {
    return (
      <main className="admin-main og">
        {err ? <p className="og-err">{err}</p> : <p className="og-wait">Reading your orgs…</p>}
        <OrgsStyles />
      </main>
    );
  }

  return (
    <main className="admin-main og">
      <OrgHeadline org={current || orgs[0]} orgs={orgs} accounts={accounts} services={services} />
      {err ? <p className="og-err">{err}</p> : null}
      {msg ? <p className="og-ok">{msg}</p> : null}

      <section className="og-band">
        <div className="og-band-head">
          <h3>Orgs</h3>
          <span className="og-band-sub">{plural(orgs.length, "org")}</span>
        </div>
        <ul className="og-orgs">
          {orgs.map((o) =>
            form?.initial?.id === o.id ? (
              <li key={o.id} className="og-org editing">
                <OrgForm
                  initial={o}
                  busy={saving}
                  error={formErr}
                  onSave={save}
                  onCancel={() => setForm(null)}
                />
              </li>
            ) : (
              <OrgRow
                key={o.id}
                org={o}
                current={o.id === here}
                holdings={holdingsOf(o.id, accounts, services)}
                deleting={deleting[o.id]}
                labelFor={labelFor}
                onSwitch={() => setOrg(o.id)}
                onEdit={() => {
                  setFormErr("");
                  setForm({ initial: o });
                }}
                onDelete={() => askDelete(o)}
                onConfirmDelete={() => confirmDelete(o)}
                onCancelDelete={() => setDeleting((d) => ({ ...d, [o.id]: undefined }))}
              />
            )
          )}
        </ul>
        {form && !form.initial ? (
          <div className="og-new">
            <OrgForm
              existingIds={orgs.map((o) => o.id)}
              busy={saving}
              error={formErr}
              onSave={save}
              onCancel={() => setForm(null)}
            />
          </div>
        ) : (
          <button
            type="button"
            className="og-add"
            onClick={() => {
              setFormErr("");
              setForm({ initial: null });
            }}
          >
            New org
          </button>
        )}
      </section>

      <LoginRoster accounts={accounts} orgs={orgs} pendingKey={pendingKey} onSet={setMembership} />

      <MigrateControl onDone={changed} />

      <OrgsStyles />
    </main>
  );
}

/* ------------------------------------------------------------------ */

export function OrgsStyles() {
  return (
    <style jsx global>{`
      .og {
        --og-line: var(--a-line, #1e222c);
        --og-dim: var(--a-dim, #7d8496);
        --og-text: var(--a-text, #e9ebf2);
        --og-amber: var(--a-amber, #ffb020);
        --og-raise: var(--a-raise, #171a22);
      }
      .og .mono {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11.5px;
      }
      .og-wait {
        color: var(--og-dim);
        font-size: 12.5px;
      }
      .og-err {
        color: #ff6b6b;
        font-size: 12.5px;
        margin: 0;
      }
      .og-ok {
        color: var(--og-text);
        font-size: 12.5px;
        margin: 0;
        padding-left: 10px;
        border-left: 2px solid var(--og-amber);
      }

      /* ---- status line: the org's own colour on its edge ---- */
      .og-top {
        padding: 2px 0 6px;
      }
      .og-state {
        margin: 0;
        max-width: 74ch;
        font-size: 13px;
        line-height: 1.6;
        color: var(--og-dim);
        padding-left: 12px;
        border-left: 3px solid var(--og-c, var(--og-line));
      }
      .og-state strong {
        color: var(--og-text);
        font-weight: 600;
      }

      /* ---- bands ---- */
      .og-band {
        margin: 8px 0 18px;
      }
      .og-band-head {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 4px 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--og-line);
      }
      .og-band-head h3 {
        margin: 0;
        font-family: "Space Grotesk", system-ui, sans-serif;
        font-size: 15.5px;
        font-weight: 600;
        color: var(--og-text);
      }
      .og-band-sub {
        font-size: 12px;
        color: var(--og-dim);
      }
      .og-lede,
      .og-note {
        margin: 10px 0 0;
        max-width: 74ch;
        font-size: 12px;
        line-height: 1.6;
        color: var(--og-dim);
      }

      /* ---- org rows ---- */
      .og-orgs,
      .og-logins,
      .og-blockers {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .og-org {
        border-bottom: 1px solid var(--og-line);
        border-left: 3px solid transparent;
        padding: 14px 12px 14px 14px;
      }
      /* THE bold element: the org every other section is acting in. */
      .og-org.on {
        border-left-color: var(--og-amber);
        background: rgba(255, 176, 32, 0.035);
      }
      .og-org.editing {
        border-left-color: var(--og-amber);
      }
      .og-org-main {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      .og-swatch {
        flex: none;
        width: 4px;
        align-self: stretch;
        min-height: 22px;
        border-radius: 2px;
        box-shadow: inset 0 0 0 1px var(--og-line);
      }
      .og-org-text {
        flex: 1;
        min-width: 0;
      }
      .og-org-name {
        margin: 0;
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 4px 10px;
        font-family: "Space Grotesk", system-ui, sans-serif;
        font-size: 18px;
        font-weight: 600;
        letter-spacing: -0.015em;
        color: var(--og-text);
        overflow-wrap: anywhere;
      }
      .og-acting {
        font-family: Inter, system-ui, sans-serif;
        font-style: normal;
        font-size: 11px;
        font-weight: 600;
        color: #1a1300;
        background: var(--og-amber);
        border-radius: 999px;
        padding: 2px 8px;
        letter-spacing: 0;
        transform-origin: left center;
        animation: og-in 0.24s cubic-bezier(0.2, 0.9, 0.3, 1);
      }
      @keyframes og-in {
        from {
          transform: scaleX(0.2);
          opacity: 0;
        }
      }
      .og-org-id {
        margin: 2px 0 0;
        color: var(--og-dim);
      }
      .og-org-desc {
        margin: 6px 0 0;
        font-size: 13px;
        line-height: 1.55;
        color: var(--og-text);
        max-width: 68ch;
        overflow-wrap: anywhere;
      }
      /* Accounts per job, separated by hairlines rather than middots. */
      .og-holds {
        margin: 8px 0 0;
        display: flex;
        flex-wrap: wrap;
        gap: 4px 0;
        font-size: 12px;
        color: var(--og-dim);
      }
      .og-holds span {
        padding: 0 10px;
        border-left: 1px solid var(--og-line);
      }
      .og-holds span:first-child {
        padding-left: 0;
        border-left: 0;
      }
      .og-holds-none {
        font-style: italic;
      }
      .og-site {
        display: inline-block;
        margin-top: 6px;
        font-size: 12px;
        color: var(--og-dim);
        text-decoration: underline;
        text-decoration-color: var(--og-line);
        text-underline-offset: 3px;
        overflow-wrap: anywhere;
      }
      .og-site:hover {
        color: var(--og-text);
      }
      .og-org-ctl {
        flex: none;
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 6px;
      }

      /* ---- buttons ---- */
      .og-btn {
        background: none;
        border: 1px solid var(--og-line);
        border-radius: 8px;
        color: var(--og-text);
        font: inherit;
        font-size: 12.5px;
        padding: 7px 13px;
        cursor: pointer;
        /* Names are the owner's own and can be long; a button naming one has
           to wrap rather than push the page sideways on a phone. */
        max-width: 100%;
        text-align: left;
        overflow-wrap: anywhere;
      }
      .og-btn:hover:not(:disabled) {
        border-color: #4a5065;
      }
      .og-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .og-quiet {
        color: var(--og-dim);
        border-color: transparent;
      }
      .og-quiet:hover:not(:disabled) {
        color: var(--og-text);
        border-color: var(--og-line);
      }
      .og-del:hover:not(:disabled),
      .og-danger {
        color: #ff8a8a;
        border-color: #6d2a31;
      }
      .og-danger:hover:not(:disabled) {
        background: #43171c;
      }
      .og-primary {
        background: var(--og-amber);
        border-color: var(--og-amber);
        color: #1a1300;
        font-weight: 600;
      }
      .og-primary:hover:not(:disabled) {
        border-color: var(--og-amber);
        filter: brightness(1.06);
      }
      .og-row-btns {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }
      .og-add {
        margin-top: 12px;
        background: none;
        border: 1px dashed #3a4154;
        border-radius: 10px;
        color: var(--og-dim);
        font: inherit;
        font-size: 13px;
        padding: 10px 16px;
        cursor: pointer;
      }
      .og-add:hover {
        color: var(--og-text);
        border-color: var(--og-dim);
      }

      /* ---- delete verdicts ---- */
      .og-verdict {
        margin: 12px 0 0 16px;
        padding: 10px 12px;
        border-left: 2px solid var(--og-line);
        font-size: 12.5px;
        line-height: 1.6;
        color: var(--og-text);
        max-width: 74ch;
      }
      .og-verdict p {
        margin: 0;
      }
      .og-verdict.plan {
        border-left-color: #a33b45;
      }
      .og-verdict.blocked {
        border-left-color: #a33b45;
        border-left-style: dashed;
      }
      .og-verdict.checking {
        color: var(--og-dim);
      }
      .og-blockers {
        margin: 8px 0 4px;
      }
      .og-blockers li {
        padding: 4px 0;
        border-bottom: 1px solid var(--og-line);
        font-size: 12.5px;
      }

      /* ---- the form ---- */
      .og-new {
        margin-top: 12px;
        padding: 14px;
        border: 1px solid var(--og-line);
        border-left: 3px solid var(--og-amber);
        border-radius: 0 10px 10px 0;
      }
      .og-form {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px 18px;
      }
      .og-wide {
        grid-column: 1 / -1;
      }
      .og-field {
        display: flex;
        flex-direction: column;
        gap: 5px;
        min-width: 0;
        font-size: 11.5px;
        color: var(--og-dim);
      }
      .og .og-name-in {
        font-family: "Space Grotesk", system-ui, sans-serif;
        font-size: 18px;
        font-weight: 600;
      }
      .og .og-area {
        font-family: Inter, system-ui, sans-serif;
        resize: vertical;
      }
      .og-hint {
        font-size: 11.5px;
        color: var(--og-dim);
      }
      .og-hint.bad {
        color: #ff8a8a;
      }
      .og-swatches {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .og-sw {
        width: 26px;
        height: 26px;
        border-radius: 7px;
        border: 1px solid var(--og-line);
        cursor: pointer;
        padding: 0;
      }
      .og-sw.none {
        background: repeating-linear-gradient(135deg, transparent 0 5px, var(--og-line) 5px 6px);
      }
      .og-sw.on {
        outline: 2px solid var(--og-text);
        outline-offset: 2px;
      }
      .og .og-hex {
        width: 104px;
        flex: none;
        padding: 6px 10px;
      }

      /* ---- the roster of every login ---- */
      .og-login {
        border-bottom: 1px solid var(--og-line);
        border-left: 2px solid #3a4154;
        padding: 10px 12px;
        transition: opacity 0.15s ease;
      }
      .og-login.old {
        border-left-style: dashed;
        border-left-color: #5c5330;
      }
      .og-login.busy {
        opacity: 0.55;
      }
      .og-login-main {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .og-login-prov {
        flex: none;
        width: 128px;
        font-size: 12.5px;
        color: var(--og-dim);
      }
      .og-login-who {
        min-width: 0;
        font-size: 13.5px;
        color: var(--og-text);
        overflow-wrap: anywhere;
        display: flex;
        flex-direction: column;
      }
      .og-login-mail {
        font-size: 11.5px;
        color: var(--og-dim);
      }
      .og-chips {
        margin-left: auto;
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 6px;
      }
      .og-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 220px;
        font: inherit;
        font-size: 11.5px;
        padding: 4px 10px 4px 7px;
        border-radius: 999px;
        border: 1px dashed #3a4154;
        background: none;
        color: var(--og-dim);
        cursor: pointer;
        white-space: nowrap;
      }
      .og-chip span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .og-chip i {
        flex: none;
        width: 3px;
        height: 12px;
        border-radius: 2px;
        box-shadow: inset 0 0 0 1px var(--og-line);
      }
      .og-chip.on {
        border-style: solid;
        border-color: #4a5065;
        background: var(--og-raise);
        color: var(--og-text);
      }
      .og-chip:hover:not(:disabled) {
        border-color: var(--og-dim);
      }
      .og-chip:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }
      .og-refuse {
        margin: 8px 0 0;
        max-width: 74ch;
        font-size: 12px;
        line-height: 1.6;
        color: var(--og-text);
        padding-left: 10px;
        border-left: 2px dashed #a33b45;
      }

      .og-migrate .og-verdict-line {
        margin: 10px 0 0;
        font-size: 12.5px;
        color: var(--og-dim);
        max-width: 74ch;
      }
      .og-migrate .og-verdict-line.todo {
        color: var(--og-text);
        padding-left: 10px;
        border-left: 2px solid var(--og-line);
      }

      .og :focus-visible {
        outline: 2px solid var(--og-amber);
        outline-offset: 2px;
      }

      @media (max-width: 720px) {
        .og-org-main {
          flex-wrap: wrap;
        }
        .og-org-ctl {
          width: 100%;
          justify-content: flex-start;
          padding-left: 16px;
        }
        .og-form {
          grid-template-columns: 1fr;
        }
        .og-login-main {
          flex-wrap: wrap;
          gap: 6px 12px;
        }
        .og-login-prov {
          width: auto;
        }
        .og-chips {
          width: 100%;
          margin-left: 0;
          justify-content: flex-start;
        }
        .og .admin-input {
          font-size: 16px;
        }
        .og-verdict {
          margin-left: 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .og-acting {
          animation: none;
        }
        .og-login {
          transition: none;
        }
      }
    `}</style>
  );
}
