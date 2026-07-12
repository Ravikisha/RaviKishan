import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X, Sun, Moon } from "lucide-react";
import { useTheme } from "../utils/ThemeProvider";

const ThemeToggle = ({ className = "" }) => {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <button
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className={`grid h-9 w-9 place-items-center rounded-lg border border-edge bg-surface text-muted transition-colors hover:text-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
    >
      {mounted && theme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </button>
  );
};

const links = [
  { label: "Systems", href: "/#systems" },
  // About, Projects, Blog & Résumé are routed pages only in recruiter mode; in
  // dev mode they open as desktop-OS apps, so their nav links are hidden.
  // `recruiterOnly` gates visibility via the global `.rm-only` CSS.
  { label: "About", href: "/about", recruiterOnly: true },
  { label: "Projects", href: "/projects", recruiterOnly: true },
  { label: "Blogs", href: "/blog", recruiterOnly: true },
  { label: "Skills", href: "/skills" },
  { label: "Résumé", href: "/resume", recruiterOnly: true },
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
      className={`rm-nav fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled
          ? "border-b border-edge bg-bg/80 backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/">
          <a className="group flex items-center gap-2 font-mono text-sm font-semibold text-fg">
            <span className="h-8 w-8 overflow-hidden rounded-md border border-edge bg-surface transition-colors group-hover:border-amber/50">
              <img
                src="/assets/banner-image.png"
                alt="Ravi Kishan"
                className="h-full w-full object-cover"
                style={{ objectPosition: "52% 12%" }}
              />
            </span>
            <span>Ravi Kishan</span>
          </a>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link key={l.label} href={l.href}>
              <a
                className={`rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-fg${
                  l.recruiterOnly ? " rm-only" : ""
                }`}
              >
                {l.label}
              </a>
            </Link>
          ))}
          <ThemeToggle className="ml-2" />
          <Link href="/contact">
            <a className="rm-only ml-1 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accentFg transition-transform hover:-translate-y-0.5">
              Get in touch
            </a>
          </Link>
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
            className="rounded-md p-2 text-fg"
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-edge bg-bg/95 px-6 py-4 backdrop-blur-md md:hidden">
          <div className="flex flex-col gap-1">
            {links.map((l) => (
              <Link key={l.label} href={l.href}>
                <a
                  onClick={() => setOpen(false)}
                  className={`rounded-md px-3 py-3 text-sm text-muted transition-colors hover:bg-surface hover:text-fg${
                    l.recruiterOnly ? " rm-only" : ""
                  }`}
                >
                  {l.label}
                </a>
              </Link>
            ))}
            <Link href="/contact">
              <a
                onClick={() => setOpen(false)}
                className="rm-only mt-2 rounded-lg bg-accent px-4 py-3 text-center text-sm font-semibold text-accentFg"
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
