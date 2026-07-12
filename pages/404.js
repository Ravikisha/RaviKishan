import React from "react";
import Seo from "../components/Seo";
import Link from "next/link";
import { ArrowLeft, Coffee } from "lucide-react";

// 418 > 404. A teapot-themed not-found page in the home2 style.
export default function NotFound() {
  return (
    <>
      <Seo
        title="418 — I'm a teapot · Ravi Kishan"
        description="This page brewed away. Head back to ravikishan.me."
        path="/404"
        noindex
      />

      <main className="grid min-h-screen place-items-center bg-bg px-6 font-sans text-fg antialiased">
        <div className="w-full max-w-lg">
          <div className="overflow-hidden rounded-xl border border-edge bg-surface">
            <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-[#2A2D36]" />
              <span className="h-3 w-3 rounded-full bg-[#2A2D36]" />
              <span className="h-3 w-3 rounded-full bg-[#2A2D36]" />
              <span className="ml-2 font-mono text-xs text-muted">
                ravi@portfolio — GET {typeof window !== "undefined" ? window.location.pathname : "/…"}
              </span>
            </div>
            <div className="space-y-2 p-6 font-mono text-sm leading-relaxed">
              <p className="text-[#ff6b6b]">HTTP 418 — I&apos;m a teapot.</p>
              <p className="text-muted">
                <span className="text-accentText">$</span> curl this route
              </p>
              <p className="text-muted">→ brewed nothing. This page doesn&apos;t exist.</p>
              <p className="text-dim text-muted">
                likely cause: I was busy training LLMs and never shipped it.
              </p>
              <p className="flex items-center gap-2 pt-2 text-live">
                <Coffee className="h-4 w-4" />
                status: steeping ☕
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/">
              <a className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accentFg transition-transform hover:-translate-y-0.5">
                <ArrowLeft className="h-4 w-4" />
                Back to safety
              </a>
            </Link>
            <span className="font-mono text-xs text-muted">
              or press <span className="text-accentText">`</span> for the console
            </span>
          </div>
        </div>
      </main>
    </>
  );
}
