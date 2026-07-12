import React, { useState } from "react";
import { collection, addDoc } from "firebase/firestore";
import { Mail, Github, Linkedin, MapPin, Send, Check } from "lucide-react";
import Database from "../../utils/database";
import { useSiteContent } from "../../../lib/useSiteContent";

// Contact as a windowed app — same Firebase submit as the /contact page,
// laid out to fit an OS window. Theme-aware.
const Field = ({ label, ...props }) => (
  <label className="block">
    <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
      {label}
    </span>
    <input
      {...props}
      className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-muted/60 focus:border-accent"
    />
  </label>
);

export default function Contact() {
  const { identity } = useSiteContent();
  const [form, setForm] = useState({ fName: "", lName: "", email: "", phone: "", message: "" });
  const [status, setStatus] = useState("idle");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setStatus("sending");
    try {
      await addDoc(collection(Database, "myportifilio"), {
        first_name: form.fName,
        last_name: form.lName,
        email: form.email,
        phone: form.phone,
        message: form.message,
        date: new Date().toLocaleString(),
      });
      setStatus("sent");
      setForm({ fName: "", lName: "", email: "", phone: "", message: "" });
    } catch {
      setStatus("error");
    }
  };

  const channels = [
    { icon: Mail, label: "Email", value: identity.email, href: `mailto:${identity.email}` },
    { icon: Github, label: "GitHub", value: "@Ravikisha", href: identity.github },
    { icon: Linkedin, label: "LinkedIn", value: "in/ravikisha", href: identity.linkedin },
    { icon: MapPin, label: "Based in", value: identity.location, href: null },
  ];

  return (
    <div className="h-full overflow-y-auto bg-bg font-sans text-fg">
      <div className="mx-auto max-w-2xl px-6 py-7">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-edge bg-surface px-3 py-1.5 font-mono text-xs text-live">
          <span className="h-1.5 w-1.5 rounded-full bg-live shadow-[0_0_8px_var(--c-live)]" />
          Open to work
        </div>
        <h2 className="font-display text-2xl font-bold tracking-tight text-fg">
          Let&apos;s build <span className="text-accentText">something.</span>
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Distributed backends, AI agents, or performance work that needs to go fast — tell me what you&apos;re building.
        </p>

        {/* channels */}
        <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {channels.map((c) => {
            const Icon = c.icon;
            const inner = (
              <div className="flex items-center gap-3 rounded-xl border border-edge bg-surface p-3 transition-colors hover:border-amber/40">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-edge bg-bg text-accentText">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{c.label}</p>
                  <p className="truncate text-sm text-fg">{c.value}</p>
                </div>
              </div>
            );
            return c.href ? (
              <a key={c.label} href={c.href} target="_blank" rel="noopener noreferrer" className="block">
                {inner}
              </a>
            ) : (
              <div key={c.label}>{inner}</div>
            );
          })}
        </div>

        {/* form */}
        <form onSubmit={submit} className="mt-5 rounded-2xl border border-edge bg-surface p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="First name" value={form.fName} onChange={set("fName")} placeholder="Ada" required />
            <Field label="Last name" value={form.lName} onChange={set("lName")} placeholder="Lovelace" />
            <Field label="Email" type="email" value={form.email} onChange={set("email")} placeholder="you@company.com" required />
            <Field label="Phone" value={form.phone} onChange={set("phone")} placeholder="Optional" />
          </div>
          <label className="mt-3 block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Message</span>
            <textarea
              value={form.message}
              onChange={set("message")}
              required
              rows={4}
              placeholder="What are you building?"
              className="w-full resize-none rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-muted/60 focus:border-accent"
            />
          </label>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={status === "sending" || status === "sent"}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accentFg transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              {status === "sent" ? (
                <><Check className="h-4 w-4" /> Sent</>
              ) : (
                <><Send className="h-4 w-4" /> {status === "sending" ? "Sending…" : "Send message"}</>
              )}
            </button>
            {status === "sent" && (
              <span className="font-mono text-xs text-live">Thanks — I&apos;ll get back to you soon.</span>
            )}
            {status === "error" && (
              <span className="font-mono text-xs text-red-500">Something went wrong. Email me directly.</span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
