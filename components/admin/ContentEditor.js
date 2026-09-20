// The content editor.
//
// It used to be a raw recursive tree: every section expanded into label+input
// rows, and an array of 30 projects became 240 stacked inputs numbered #1 #2
// #3. You could not find anything, could not see what a row WAS, and the
// numbers meant nothing because projects are ordered by `rank`.
//
// Design idea: THE ROW IS THE THING. Each array item collapses to a single row
// that looks like what it represents — its poster, its name, and the one or
// two facts that identify it — and expands to edit. So "Projects" reads as a
// scannable list of your projects rather than a wall of form fields.
//
// A generic JSON editor cannot do that. One that can read an item's identity
// can, which is the whole reason this is not `<Field>` with nicer CSS.
import React, { useMemo, useState } from "react";
import ImageField from "./ImageField";

/* ---------- identity: what IS this row? ---------- */

const TITLE_KEYS = ["name", "title", "company", "label", "role", "slug", "cmd"];
const SUB_KEYS = ["organization", "role", "category", "type", "period", "out", "issuer"];
const IMG_KEYS = ["image", "logo", "cover", "icon", "photo", "thumbnail"];

const firstOf = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return { key: k, value: v.trim() };
  }
  return null;
};

export const titleCase = (k) =>
  k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

/* ---------- leaf inputs ---------- */

function TextInput({ value, onChange, long }) {
  return long ? (
    <textarea
      className="admin-input ce-area"
      rows={Math.min(10, Math.max(3, Math.ceil(value.length / 70)))}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ) : (
    <input className="admin-input" value={value} onChange={(e) => onChange(e.target.value)} />
  );
}

// A list of plain strings — tags, skills, focus areas. As numbered inputs with
// their own move/remove buttons this was the single worst part of the old
// editor; as chips it is one line.
function Chips({ value, onChange }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...value, v]);
    setDraft("");
  };
  return (
    <div className="ce-chips">
      {value.map((v, i) => (
        <span key={`${v}-${i}`} className="ce-chip">
          {v}
          <button
            type="button"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            aria-label={`Remove ${v}`}
          >
            ✕
          </button>
        </span>
      ))}
      <input
        className="ce-chip-add"
        value={draft}
        placeholder="Add…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

/* ---------- one object's fields ---------- */

const isLong = (k, v) => v.length > 70 || v.includes("\n") || /description|intro|note|abstract|summary|body/i.test(k);

function ObjectFields({ value, path, onChange, imageSpecFor }) {
  const keys = Object.keys(value);
  return (
    <div className="ce-fields">
      {keys.map((k) => {
        const v = value[k];
        const p = [...path, k];
        const img = imageSpecFor(p);

        if (typeof v === "string" || v == null) {
          const str = v == null ? "" : v;
          if (img)
            return (
              <div key={k} className="ce-field wide">
                <label className="ce-label">{titleCase(k)}</label>
                <ImageField
                  value={str}
                  onChange={(nv) => onChange(p, nv)}
                  folder={img.folder}
                  resolve={img.resolve}
                  fit={img.fit}
                  placeholder={img.placeholder}
                  choices={img.choices || []}
                />
              </div>
            );
          const long = isLong(k, str);
          return (
            <div key={k} className={`ce-field${long ? " wide" : ""}`}>
              <label className="ce-label">{titleCase(k)}</label>
              <TextInput value={str} long={long} onChange={(nv) => onChange(p, nv)} />
            </div>
          );
        }

        if (typeof v === "number")
          return (
            <div key={k} className="ce-field">
              <label className="ce-label">{titleCase(k)}</label>
              <input
                className="admin-input"
                type="number"
                step="any"
                value={v}
                onChange={(e) => onChange(p, e.target.value === "" ? 0 : Number(e.target.value))}
              />
            </div>
          );

        if (typeof v === "boolean") {
          const star = k === "featured";
          return (
            <div key={k} className="ce-field">
              <label className="ce-label">{titleCase(k)}</label>
              <button
                type="button"
                className={`ce-toggle${v ? " on" : ""}`}
                onClick={() => onChange(p, !v)}
              >
                <span className="ce-knob" />
                {star ? (v ? "On the homepage" : "Not featured") : v ? "Yes" : "No"}
              </button>
            </div>
          );
        }

        if (Array.isArray(v) && v.every((x) => typeof x === "string"))
          return (
            <div key={k} className="ce-field wide">
              <label className="ce-label">{titleCase(k)}</label>
              <Chips value={v} onChange={(nv) => onChange(p, nv)} />
            </div>
          );

        if (Array.isArray(v))
          return (
            <div key={k} className="ce-field wide">
              <ArrayEditor label={titleCase(k)} value={v} path={p} onChange={onChange} imageSpecFor={imageSpecFor} />
            </div>
          );

        return (
          <div key={k} className="ce-field wide">
            <label className="ce-label">{titleCase(k)}</label>
            <div className="ce-nested">
              <ObjectFields value={v} path={p} onChange={onChange} imageSpecFor={imageSpecFor} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- an array of objects, as rows ---------- */

function blankLike(sample) {
  if (Array.isArray(sample)) return [];
  if (sample && typeof sample === "object") {
    const o = {};
    for (const k of Object.keys(sample)) o[k] = blankLike(sample[k]);
    return o;
  }
  if (typeof sample === "number") return 0;
  if (typeof sample === "boolean") return false;
  return "";
}

function ArrayEditor({ label, value, path, onChange, imageSpecFor, query = "" }) {
  const [open, setOpen] = useState(() => new Set());
  const noun = label.replace(/s$/, "").toLowerCase();

  const toggle = (i) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });

  const move = (from, to) => {
    if (to < 0 || to >= value.length) return;
    const arr = [...value];
    const [it] = arr.splice(from, 1);
    arr.splice(to, 0, it);
    onChange(path, arr);
    setOpen(new Set());
  };

  const add = () => {
    const template = value.length ? blankLike(value[value.length - 1]) : "";
    onChange(path, [...value, template]);
    setOpen((s) => new Set([...s, value.length]));
  };

  const q = query.trim().toLowerCase();
  const rows = value.map((item, i) => ({ item, i })).filter(({ item }) => {
    if (!q) return true;
    return JSON.stringify(item).toLowerCase().includes(q);
  });

  return (
    <div className="ce-array">
      <div className="ce-array-head">
        <span className="ce-array-label">
          {label} <i>{value.length}</i>
        </span>
        <button type="button" className="admin-ghost sm" onClick={add}>
          Add {noun}
        </button>
      </div>

      {value.length === 0 ? (
        <p className="ce-empty">Nothing here yet. Add the first {noun}.</p>
      ) : rows.length === 0 ? (
        <p className="ce-empty">No {label.toLowerCase()} match the filter.</p>
      ) : (
        <div className="ce-rows">
          {rows.map(({ item, i }) => {
            const isOpen = open.has(i);
            const obj = item && typeof item === "object" && !Array.isArray(item) ? item : null;
            const t = obj ? firstOf(obj, TITLE_KEYS) : null;
            const sub = obj ? firstOf(obj, SUB_KEYS.filter((k) => k !== t?.key)) : null;
            const imgKey = obj ? firstOf(obj, IMG_KEYS) : null;
            const imgSpec = imgKey ? imageSpecFor([...path, i, imgKey.key]) : null;
            const thumb = imgKey && imgSpec?.resolve ? imgSpec.resolve(imgKey.value) : imgKey?.value;

            return (
              <div key={i} className={`ce-row${isOpen ? " open" : ""}`}>
                <div className="ce-row-head">
                  <button
                    type="button"
                    className="ce-row-main"
                    onClick={() => toggle(i)}
                    aria-expanded={isOpen}
                  >
                    <span className={`ce-caret${isOpen ? " on" : ""}`} aria-hidden="true" />
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="ce-thumb" src={thumb} alt="" loading="lazy" />
                    ) : (
                      <span className="ce-thumb ce-thumb-none" aria-hidden="true" />
                    )}
                    <span className="ce-row-text">
                      <span className="ce-row-title">
                        {t?.value || (typeof item === "string" ? item : `Item ${i + 1}`)}
                      </span>
                      {sub?.value && <span className="ce-row-sub">{sub.value}</span>}
                    </span>
                  </button>

                  <span className="ce-row-btns">
                    <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} title="Move up">↑</button>
                    <button type="button" onClick={() => move(i, i + 1)} disabled={i === value.length - 1} title="Move down">↓</button>
                    <button
                      type="button"
                      className="admin-del"
                      title={`Remove this ${noun}`}
                      onClick={() => {
                        // eslint-disable-next-line no-alert
                        if (!confirm(`Remove "${t?.value || `item ${i + 1}`}"?`)) return;
                        onChange(path, value.filter((_, j) => j !== i));
                        setOpen(new Set());
                      }}
                    >
                      ✕
                    </button>
                  </span>
                </div>

                {isOpen && (
                  <div className="ce-row-body">
                    {obj ? (
                      <ObjectFields value={obj} path={[...path, i]} onChange={onChange} imageSpecFor={imageSpecFor} />
                    ) : (
                      <TextInput
                        value={String(item ?? "")}
                        long={String(item ?? "").length > 70}
                        onChange={(nv) => onChange([...path, i], nv)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- a top-level section ---------- */

export default function ContentSection({ label, k, value, onChange, imageSpecFor, defaultOpen, query }) {
  const [open, setOpen] = useState(!!defaultOpen);

  const count = Array.isArray(value)
    ? value.length
    : value && typeof value === "object"
    ? Object.keys(value).length
    : null;

  // A one-line sense of what is inside, so a collapsed section still says
  // something.
  const summary = useMemo(() => {
    if (Array.isArray(value)) {
      const names = value
        .map((v) => (v && typeof v === "object" ? firstOf(v, TITLE_KEYS)?.value : typeof v === "string" ? v : null))
        .filter(Boolean)
        .slice(0, 3);
      return names.join(", ");
    }
    if (value && typeof value === "object") return Object.keys(value).slice(0, 4).map(titleCase).join(", ");
    return String(value ?? "");
  }, [value]);

  return (
    <section className={`ce-section${open ? " open" : ""}`}>
      <button type="button" className="ce-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`ce-caret${open ? " on" : ""}`} aria-hidden="true" />
        <span className="ce-head-text">
          <span className="ce-head-title">
            {label}
            {count != null && <i>{count}</i>}
          </span>
          {summary && <span className="ce-head-sub">{summary}</span>}
        </span>
      </button>

      {open && (
        <div className="ce-body">
          {Array.isArray(value) && value.every((x) => typeof x === "string") ? (
            <Chips value={value} onChange={(nv) => onChange([k], nv)} />
          ) : Array.isArray(value) ? (
            <ArrayEditor label={label} value={value} path={[k]} onChange={onChange} imageSpecFor={imageSpecFor} query={query} />
          ) : value && typeof value === "object" ? (
            <ObjectFields value={value} path={[k]} onChange={onChange} imageSpecFor={imageSpecFor} />
          ) : (
            <TextInput
              value={String(value ?? "")}
              long={String(value ?? "").length > 70}
              onChange={(nv) => onChange([k], nv)}
            />
          )}
        </div>
      )}
    </section>
  );
}
