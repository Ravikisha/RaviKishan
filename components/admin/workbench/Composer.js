// Where you talk to the agent.
//
// The settings that decide what a chat CAN do — which account, which tool,
// where on the box, which org's tools and memory, and what it must ask first —
// sit as one row of chips directly above the words, because they are part of
// the sentence: "as personal, in kontainer, ask before writes: fix the test".
// Once a chat is running they cannot change, so the chips turn into plain
// labels rather than controls that would quietly do nothing.
//
// The send button becomes Interrupt while the agent works. Interrupt stops the
// current turn and keeps the conversation; it is not Close.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { currentOrgId } from "../../../lib/orgState";

export const MODELS = {
  claude: ["", "sonnet", "opus", "haiku"],
  codex: ["", "gpt-5-codex", "gpt-5"],
};
const TOOL_LABEL = { claude: "Claude Code", codex: "Codex" };
const POLICY_LABEL = { manual: "before everything", allowlist: "before writes and pushes" };
const WHERE_LABEL = { scratch: "Scratch folder", repo: "Repository", cwd: "Folder on the box" };

// Commands a chat understands without a skill behind them. Skills from the
// profile are added to these, so the hint list is what THIS account has.
const BUILTIN = [
  { name: "compact", description: "Summarise the conversation so far to free up context." },
  { name: "review", description: "Review the changes in the working folder." },
];

function Chip({ label, value, children, disabled }) {
  return (
    <label className={`wb-chip${disabled ? " fixed" : ""}`}>
      <span className="wb-chip-k">{label}</span>
      {disabled ? <span className="wb-chip-v">{value}</span> : children}
    </label>
  );
}

export default function Composer({
  chat = null,
  profiles = [],
  orgs = [],
  skills = [],
  repos = [],
  disabled = false,
  busy = false,
  onStart = () => {},
  onSend = () => {},
  onInterrupt = () => {},
  onClose = () => {},
  onNeedSkills = () => {},
}) {
  const [text, setText] = useState("");
  const [profile, setProfile] = useState("");
  const [tool, setTool] = useState("claude");
  const [model, setModel] = useState("");
  const [where, setWhere] = useState("scratch");
  const [place, setPlace] = useState("");
  const [orgId, setOrgId] = useState("");
  const [policy, setPolicy] = useState("allowlist");
  const [hint, setHint] = useState(0);
  const area = useRef(null);

  useEffect(() => setOrgId((o) => o || currentOrgId()), []);
  const chosen = profile || profiles[0]?.name || "";
  useEffect(() => {
    if (chosen) onNeedSkills(chosen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);

  const live = !!chat && chat.state !== "closed";
  const working = live && (chat.state === "thinking" || chat.state === "waiting");

  const orgChoices = useMemo(() => {
    const list = orgs.map((o) => ({ id: o.id, name: o.name || o.id }));
    if (orgId && !list.some((o) => o.id === orgId)) list.unshift({ id: orgId, name: orgId });
    return list;
  }, [orgs, orgId]);

  // Slash hints: shown while the message is a single "/word" being typed.
  const slash = /^\/([\w:-]*)$/.exec(text.trim());
  const hints = useMemo(() => {
    if (!slash) return [];
    const q = slash[1].toLowerCase();
    const all = [...BUILTIN, ...skills.map((s) => ({ name: s.name, description: s.description || "" }))];
    const seen = new Set();
    return all.filter((h) => h.name && !seen.has(h.name) && seen.add(h.name) && h.name.toLowerCase().includes(q)).slice(0, 8);
  }, [slash, skills]);

  const submit = (e) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || disabled) return;
    if (live) onSend(t);
    else {
      onStart({
        profile: chosen,
        tool,
        model: model || undefined,
        orgId: orgId || currentOrgId(),
        policy,
        ...(where === "repo" && place.trim() ? { repo: place.trim() } : {}),
        ...(where === "cwd" && place.trim() ? { cwd: place.trim() } : {}),
        prompt: t,
      });
    }
    setText("");
  };

  const pick = (h) => {
    setText(`/${h.name} `);
    setHint(0);
    area.current?.focus();
  };

  const onKey = (e) => {
    if (hints.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setHint((i) => (i + (e.key === "ArrowDown" ? 1 : hints.length - 1)) % hints.length);
      return;
    }
    if (hints.length && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
      e.preventDefault();
      pick(hints[Math.min(hint, hints.length - 1)]);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!working) submit();
    }
  };

  const orgName = (id) => orgChoices.find((o) => o.id === id)?.name || id || "this org";
  const c = chat || {};

  return (
    <form className={`wb-composer${working ? " is-working" : ""}`} onSubmit={submit}>
      <div className="wb-chips" role="group" aria-label="Chat settings">
        <Chip label="As" value={c.profile || "default"} disabled={!!chat}>
          <select value={profile} onChange={(e) => setProfile(e.target.value)} disabled={disabled} aria-label="Profile">
            {profiles.length ? null : <option value="">default</option>}
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </Chip>
        <Chip label="Tool" value={TOOL_LABEL[c.tool] || c.tool || "Claude Code"} disabled={!!chat}>
          <select
            value={tool}
            onChange={(e) => {
              setTool(e.target.value);
              setModel("");
            }}
            disabled={disabled}
            aria-label="Tool"
          >
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
        </Chip>
        <Chip label="Model" value={c.model || "default"} disabled={!!chat}>
          <select value={model} onChange={(e) => setModel(e.target.value)} disabled={disabled} aria-label="Model">
            {MODELS[tool].map((m) => (
              <option key={m || "default"} value={m}>
                {m || "default"}
              </option>
            ))}
          </select>
        </Chip>
        <Chip label="In" value={c.repo || c.cwd || "scratch folder"} disabled={!!chat}>
          <select value={where} onChange={(e) => setWhere(e.target.value)} disabled={disabled} aria-label="Where it works">
            {Object.entries(WHERE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Chip>
        <Chip label="Org" value={orgName(c.orgId)} disabled={!!chat}>
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)} disabled={disabled} aria-label="Org">
            {orgChoices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Chip>
        <Chip label="Asks" value={POLICY_LABEL[c.policy] || c.policy || "before writes and pushes"} disabled={!!chat}>
          <select value={policy} onChange={(e) => setPolicy(e.target.value)} disabled={disabled} aria-label="What it asks before doing">
            <option value="manual">before everything</option>
            <option value="allowlist">before writes and pushes</option>
          </select>
        </Chip>
      </div>

      {!chat && where !== "scratch" ? (
        <input
          className="admin-input wb-place"
          list={where === "repo" ? "wb-repos" : undefined}
          placeholder={where === "repo" ? "owner/name or https:// git URL" : "/home/agent/work/…"}
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          disabled={disabled}
          aria-label={where === "repo" ? "Repository to clone" : "Folder on the box"}
          spellCheck={false}
          autoComplete="off"
        />
      ) : null}
      <datalist id="wb-repos">
        {repos.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      {hints.length ? (
        <ul className="wb-hints" role="listbox" aria-label="Commands and skills">
          {hints.map((h, i) => (
            <li key={h.name} role="option" aria-selected={i === hint}>
              <button
                type="button"
                className={i === hint ? "on" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
              >
                <code>/{h.name}</code>
                <span>{h.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="wb-write">
        <textarea
          ref={area}
          className="admin-input wb-text"
          rows={2}
          placeholder={
            disabled
              ? "Not connected to the agent server."
              : live
              ? working
                ? "It is working. Interrupt to stop this turn, or wait."
                : "Reply, or type / for commands and skills"
              : `Start a chat in ${orgName(orgId)}. Type / for commands and skills.`
          }
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHint(0);
          }}
          onKeyDown={onKey}
          disabled={disabled}
          aria-label="Message"
        />
        <div className="wb-write-btns">
          {working ? (
            <button type="button" className="ag-stop wb-interrupt" onClick={onInterrupt}>
              Interrupt
            </button>
          ) : (
            <button type="submit" className="admin-primary wb-send" disabled={disabled || busy || !text.trim()}>
              {busy ? "Starting…" : live ? "Send" : "Start chat"}
            </button>
          )}
          {live ? (
            <button type="button" className="ag-ghost wb-close" onClick={onClose} title="End the process. The conversation stays in history and can be resumed.">
              Close
            </button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
