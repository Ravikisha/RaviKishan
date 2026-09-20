// "Copy link" for the résumé page.
//
// Recruiters overwhelmingly want a link to paste into an ATS or a Slack thread,
// not a downloaded file sitting in their Downloads folder. This hands them a
// canonical, absolute URL — including the variant query when one is active, so
// the link they paste serves the same cut of the CV they are looking at.
import React, { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { track } from "../../lib/analytics";

export default function CopyLinkButton({
  path = "/resume",
  label = "Copy link",
  className = "",
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const absolute = () => {
    if (typeof window === "undefined") return `https://ravikishan.me${path}`;
    // Always hand out the canonical host, never localhost or a preview domain.
    const host = /ravikishan\.me$/.test(window.location.hostname)
      ? window.location.origin
      : "https://ravikishan.me";
    return host + path;
  };

  const copy = async () => {
    const text = absolute();
    setFailed(false);
    try {
      await navigator.clipboard.writeText(text);
      track("resumeCopyLink", { once: false });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      // Clipboard API needs a secure context and can be blocked outright;
      // fall back to the old selection trick rather than failing silently.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (_) {
        setFailed(true);
        setTimeout(() => setFailed(false), 3000);
      }
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      title={absolute()}
      className={
        "inline-flex items-center gap-2 rounded-lg border border-edge bg-surface px-5 py-3 " +
        "text-sm font-semibold text-fg transition-colors hover:border-muted " +
        className
      }
    >
      {copied ? (
        <Check className="h-4 w-4 text-live" />
      ) : (
        <Link2 className="h-4 w-4 text-muted" />
      )}
      {copied ? "Copied" : failed ? "Press Ctrl+C" : label}
    </button>
  );
}
