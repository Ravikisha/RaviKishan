import React, { useState } from "react";
import Seo from "../components/Seo";
import { motion } from "framer-motion";
import { collection, addDoc } from "firebase/firestore";
import { Mail, Github, Linkedin, MapPin, Send, Check } from "lucide-react";
import Database from "../components/utils/database";
import { useSiteContent } from "../lib/useSiteContent";
import PageHeader from "../components/home2/PageHeader";

const Field = ({ label, ...props }) => (
  <label className="block">
    <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
      {label}
    </span>
    <input
      {...props}
      className="w-full rounded-lg border border-edge bg-bg px-3 py-2.5 text-sm text-fg outline-none transition-colors placeholder:text-muted/60 focus:border-accent"
    />
  </label>
);

const Contact = () => {
  const { identity } = useSiteContent();
  const [form, setForm] = useState({
    fName: "",
    lName: "",
    email: "",
    phone: "",
    message: "",
  });
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error

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
    } catch (err) {
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
    <>
      <Seo
        title="Contact — Ravi Kishan"
        description="Get in touch with Ravi Kishan — open to hard problems in distributed systems, AI and performance."
        path="/contact"
      />

      <main className="bg-bg font-sans text-fg antialiased">
        <PageHeader
          eyebrow="Contact"
          title="Let's build"
          accent="something."
          subtitle="Distributed backends, AI agents, or performance work that needs to go fast — tell me what you're building."
        />

        <section className="bg-bg py-20">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-6 lg:grid-cols-[0.85fr_1.15fr]">
            {/* channels */}
            <div>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-edge bg-surface px-3 py-1.5 font-mono text-xs text-live">
                <span className="h-1.5 w-1.5 rounded-full bg-live shadow-[0_0_8px_var(--c-live)]" />
                Open to work
              </div>
              <div className="space-y-3">
                {channels.map((c) => {
                  const Icon = c.icon;
                  const inner = (
                    <div className="flex items-center gap-4 rounded-xl border border-edge bg-surface p-4 transition-colors hover:border-amber/40">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-edge bg-bg text-accentText">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                          {c.label}
                        </p>
                        <p className="truncate text-sm text-fg">{c.value}</p>
                      </div>
                    </div>
                  );
                  return c.href ? (
                    <a
                      key={c.label}
                      href={c.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      {inner}
                    </a>
                  ) : (
                    <div key={c.label}>{inner}</div>
                  );
                })}
              </div>
            </div>

            {/* form */}
            <motion.form
              onSubmit={submit}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-2xl border border-edge bg-surface p-6 sm:p-8"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="First name" value={form.fName} onChange={set("fName")} placeholder="Ada" required />
                <Field label="Last name" value={form.lName} onChange={set("lName")} placeholder="Lovelace" />
                <Field label="Email" type="email" value={form.email} onChange={set("email")} placeholder="you@company.com" required />
                <Field label="Phone" value={form.phone} onChange={set("phone")} placeholder="Optional" />
              </div>
              <label className="mt-4 block">
                <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                  Message
                </span>
                <textarea
                  value={form.message}
                  onChange={set("message")}
                  required
                  rows={5}
                  placeholder="What are you building?"
                  className="w-full resize-none rounded-lg border border-edge bg-bg px-3 py-2.5 text-sm text-fg outline-none transition-colors placeholder:text-muted/60 focus:border-accent"
                />
              </label>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <button
                  type="submit"
                  disabled={status === "sending" || status === "sent"}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-accentFg transition-transform hover:-translate-y-0.5 disabled:opacity-60"
                >
                  {status === "sent" ? (
                    <>
                      <Check className="h-4 w-4" /> Sent
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      {status === "sending" ? "Sending…" : "Send message"}
                    </>
                  )}
                </button>
                {status === "sent" && (
                  <span className="font-mono text-xs text-live">
                    Thanks — I&apos;ll get back to you soon.
                  </span>
                )}
                {status === "error" && (
                  <span className="font-mono text-xs text-red-500">
                    Something went wrong. Email me directly instead.
                  </span>
                )}
              </div>
            </motion.form>
          </div>
        </section>
      </main>
    </>
  );
};

export default Contact;
