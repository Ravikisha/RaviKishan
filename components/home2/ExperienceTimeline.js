import React, { useState } from "react";
import { motion } from "framer-motion";
import { GraduationCap, GitCommit } from "lucide-react";
import { useSiteContent } from "../../lib/useSiteContent";

const shortHash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(7, "0").slice(0, 7);
};

// Experience rendered as a git log.
const GitLog = ({ experience }) => (
  <div className="overflow-hidden rounded-xl border border-edge bg-[#0D0E13]">
    <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 font-mono text-[11px] text-mist">
      <GitCommit className="h-3.5 w-3.5 text-amber" />
      {'git log --oneline --author="Ravi Kishan"'}
    </div>
    <div className="space-y-5 p-4 font-mono text-[12px] leading-relaxed sm:text-[13px]">
      {experience.map((job, i) => (
        <div key={job.org}>
          <div>
            <span className="text-amber">commit {shortHash(job.org + job.title)}</span>
            {i === 0 && <span className="text-teal"> (HEAD → main)</span>}
          </div>
          <div className="text-mist">Author: Ravi Kishan &lt;ravikishan63392@gmail.com&gt;</div>
          <div className="text-mist">Date:   {job.period} · {job.place}</div>
          <div className="mt-2 text-chalk">
            <span className="text-teal">{job.title}</span> @ {job.org}
          </div>
          <div className="mt-1.5 space-y-1 pl-3">
            {job.points.map((p, j) => (
              <div key={j} className="text-mist">
                <span className="text-teal">+</span> {p}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center text-chalk">
        <span className="mr-2 text-amber">$</span>
        <span className="h-3.5 w-2 animate-blink bg-amber" />
      </div>
    </div>
  </div>
);

const ExperienceTimeline = () => {
  const { experience, credentials, education } = useSiteContent();
  const [view, setView] = useState("timeline");
  return (
    <section className="relative border-t border-edge bg-bg py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-1 gap-14 lg:grid-cols-[0.9fr_1.1fr]">
          {/* left rail */}
          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-accentText">
              The track record
            </p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
              Where it shipped.
            </h2>

            {/* education */}
            <div className="mt-8">
              <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                <GraduationCap className="h-3.5 w-3.5" />
                Education
              </p>
              <div className="mt-4 space-y-4">
                {education.map((e) => (
                  <div
                    key={e.degree}
                    className="flex items-start gap-3 rounded-lg border border-edge bg-surface p-4"
                  >
                    <span
                      className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-edge"
                      style={{ background: e.logoBg }}
                    >
                      <img
                        src={e.logo}
                        alt={e.school}
                        className="h-8 w-8 object-contain"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="font-display text-sm font-bold text-fg">
                          {e.school}
                        </h3>
                        <span className="shrink-0 font-mono text-[11px] text-muted">
                          {e.period}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted">{e.degree}</p>
                      {e.gpa && (
                        <p className="mt-2 font-mono text-xs text-accentText">
                          {e.gpa.includes("%") ? e.gpa : `GPA ${e.gpa}`}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* highlights */}
            <div className="mt-8">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                Highlights
              </p>
              <ul className="mt-4 space-y-2.5">
                {credentials.map((c) => (
                  <li
                    key={c}
                    className="flex items-start gap-2.5 text-sm text-muted"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* right column: timeline | git log */}
          <div>
            <div className="mb-6 flex justify-end gap-2">
              {[
                { k: "timeline", label: "timeline" },
                { k: "gitlog", label: "git log" },
              ].map((v) => (
                <button
                  key={v.k}
                  onClick={() => setView(v.k)}
                  className={`rounded-full border px-3 py-1 font-mono text-[11px] transition-colors ${
                    view === v.k
                      ? "border-accent bg-accent text-accentFg"
                      : "border-edge bg-surface text-muted hover:text-fg"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {view === "gitlog" ? (
              <GitLog experience={experience} />
            ) : (
          <div className="relative border-l border-edge pl-8">
            {experience.map((job, i) => (
              <motion.div
                key={job.org}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ delay: i * 0.08, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                className="relative pb-12 last:pb-0"
              >
                <span
                  className={`absolute -left-[38px] top-3 h-3 w-3 rounded-full border-2 ${
                    job.current
                      ? "border-amber bg-accent shadow-[0_0_10px_#FFB020]"
                      : "border-edge bg-bg"
                  }`}
                />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span
                    className="flex h-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-edge px-2.5"
                    style={{ background: job.logoBg }}
                  >
                    <img
                      src={job.logo}
                      alt={job.org}
                      className="h-5 w-auto max-w-[96px] object-contain"
                    />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-display text-lg font-bold leading-tight text-fg">
                      {job.title}
                    </h3>
                    <span className="font-mono text-xs text-accentText">
                      {job.org}
                    </span>
                  </div>
                  <span className="ml-auto shrink-0 text-right font-mono text-xs text-muted">
                    {job.period}
                    <br />
                    <span className="opacity-70">{job.place}</span>
                  </span>
                </div>
                <ul className="mt-4 space-y-2.5">
                  {job.points.map((p, j) => (
                    <li
                      key={j}
                      className="flex gap-2.5 text-sm leading-relaxed text-muted"
                    >
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-live" />
                      {p}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default ExperienceTimeline;
