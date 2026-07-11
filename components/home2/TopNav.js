import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

const links = [
  { label: "Systems", href: "/#systems" },
  { label: "About", href: "/about" },
  { label: "Projects", href: "/projects" },
  { label: "Skills", href: "/skills" },
  { label: "Résumé", href: "/resume" },
];

const TopNav = () => {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled
          ? "border-b border-edge bg-bg/80 backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/">
          <a className="group flex items-center gap-2 font-mono text-sm font-semibold text-fg">
            <span className="grid h-8 w-8 place-items-center rounded-md border border-edge bg-surface text-accentText transition-colors group-hover:border-amber/50">
              RK
            </span>
            <span className="hidden sm:inline">ravikishan</span>
            <span className="text-accentText">.me</span>
          </a>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link key={l.label} href={l.href}>
              <a className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-fg">
                {l.label}
              </a>
            </Link>
          ))}
          <Link href="/contact">
            <a className="ml-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accentFg transition-transform hover:-translate-y-0.5">
              Get in touch
            </a>
          </Link>
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
          className="rounded-md p-2 text-fg md:hidden"
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-edge bg-bg/95 px-6 py-4 backdrop-blur-md md:hidden">
          <div className="flex flex-col gap-1">
            {links.map((l) => (
              <Link key={l.label} href={l.href}>
                <a
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-3 text-sm text-muted transition-colors hover:bg-surface hover:text-fg"
                >
                  {l.label}
                </a>
              </Link>
            ))}
            <Link href="/contact">
              <a
                onClick={() => setOpen(false)}
                className="mt-2 rounded-lg bg-accent px-4 py-3 text-center text-sm font-semibold text-accentFg"
              >
                Get in touch
              </a>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};

export default TopNav;
