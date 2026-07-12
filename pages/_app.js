import "../styles/globals.scss";
import Head from "next/head";
import Header from "../components/Header";
import Footer from "../components/footer";
import { useEffect } from "react";
import { useRouter } from "next/router";
import Loader from "../components/Loader";
import { useState } from "react";
import Script from "next/script";

import { Progress } from "../components/progress";
import { useProgressStore } from "../components/useProgessStore.js";
import AOS from "aos";
import "aos/dist/aos.css";
import { ThemeProvider } from "../components/utils/ThemeProvider";
import { SiteContentProvider } from "../lib/useSiteContent";
import Easter from "../components/eggs/Easter";
import DesktopOS from "../components/os/DesktopOS";
import RecruiterMode from "../components/RecruiterMode";
import dynamic from "next/dynamic";
const BootScreen = dynamic(() => import("../components/os/BootScreen"), { ssr: false });

function MyApp({ Component, pageProps }) {
  const [loaderFinished, setLoaderFinished] = useState(false);
  const setIsAnimating = useProgressStore((state) => state.setIsAnimating);
  const isAnimating = useProgressStore((state) => state.isAnimating);
  const router = useRouter();

  useEffect(() => {
    const q = window.location.search;
    // Dev-mode desktop has its own boot sequence + wallpaper, so the word-cloud
    // loader is skipped there (it otherwise covers the desktop for ~2s). The
    // loader stays for recruiter mode — the clean, routed portfolio.
    let mode = "recruiter";
    try { mode = localStorage.getItem("mode") || "recruiter"; } catch (_) {}
    if (q.includes("noload") || mode !== "recruiter") setLoaderFinished(true);
    if (q.includes("dark")) document.documentElement.classList.add("dark");
  }, []);
  useEffect(() => {
    const handleStart = () => {
      setIsAnimating(true);
    };
    const handleStop = () => {
      setIsAnimating(false);
    };

    router.events.on("routeChangeStart", handleStart);
    router.events.on("routeChangeComplete", handleStop);
    router.events.on("routeChangeError", handleStop);

    return () => {
      router.events.off("routeChangeStart", handleStart);
      router.events.off("routeChangeComplete", handleStop);
      router.events.off("routeChangeError", handleStop);
    };
  }, [router, setIsAnimating]);
  useEffect(() => {
    AOS.init();
  }, []);

  // Hidden admin CMS: render bare — no nav, footer, loader, analytics or the
  // public SEO/meta. It manages its own Firebase state and must stay unindexed.
  // (Placed after all hooks so hook order stays constant across renders.)
  if (router.pathname === "/admin") {
    return (
      <ThemeProvider>
        <Head>
          <meta name="robots" content="noindex, nofollow" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Admin</title>
        </Head>
        <Component {...pageProps} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <SiteContentProvider>
        {/* Site-wide SEO defaults. Every routed page also renders <Seo/> which
            overrides these via matching `key`s; these cover anything that doesn't
            (and keep the positioning correct: Software Engineer, not Full Stack). */}
        <Head>
          <meta charSet="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" key="viewport" />
          <title key="title">Ravi Kishan — Software Engineer · Distributed Systems &amp; Applied AI</title>
          <meta
            name="description"
            key="description"
            content="Ravi Kishan — software engineer in distributed systems, systems programming and applied AI. Builds infrastructure from first principles; patent-holding open-source author."
          />
          <meta
            name="keywords"
            content="Ravi Kishan, software engineer, distributed systems, systems programming, applied AI, agentic AI, Go, Rust, TypeScript, LangChain, LangGraph, RAG, container runtime, language interpreter, backtesting, SIMD, open source, patent"
          />
          <meta name="author" content="Ravi Kishan" key="author" />
          <meta name="robots" content="index, follow, max-image-preview:large" key="robots" />
          <meta name="language" content="English" />
          <link rel="canonical" href="https://ravikishan.me/" key="canonical" />

          <meta property="og:type" content="website" key="og:type" />
          <meta property="og:site_name" content="Ravi Kishan" key="og:site_name" />
          <meta property="og:url" content="https://ravikishan.me/" key="og:url" />
          <meta
            property="og:title"
            key="og:title"
            content="Ravi Kishan — Software Engineer · Distributed Systems & Applied AI"
          />
          <meta
            property="og:description"
            key="og:description"
            content="Ravi Kishan — software engineer in distributed systems, systems programming and applied AI. Patent-holding open-source author."
          />
          <meta property="og:image" content="https://ravikishan.me/pagepreview.png" key="og:image" />

          <meta name="twitter:card" content="summary_large_image" key="twitter:card" />
          <meta name="twitter:site" content="@RaviKishan_" key="twitter:site" />
          <meta name="twitter:creator" content="@RaviKishan_" key="twitter:creator" />
          <meta
            name="twitter:title"
            key="twitter:title"
            content="Ravi Kishan — Software Engineer · Distributed Systems & Applied AI"
          />
          <meta
            name="twitter:description"
            key="twitter:description"
            content="Ravi Kishan — software engineer in distributed systems, systems programming and applied AI. Patent-holding open-source author."
          />
          <meta name="twitter:image" content="https://ravikishan.me/pagepreview.png" key="twitter:image" />
          <meta name="twitter:image:alt" content="Ravi Kishan — Software Engineer" key="twitter:image:alt" />
        </Head>
        {/* Google Analytics (GA4). Two scripts need DISTINCT ids — next/script
            dedups by id, so sharing one would silently drop the config. */}
        <Script
          id="ga4-lib"
          strategy="afterInteractive"
          src="https://www.googletagmanager.com/gtag/js?id=G-7RHZZRFLT9"
        />
        <Script
          id="ga4-init"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              window.gtag = function(){ window.dataLayer.push(arguments); };
              gtag('js', new Date());
              gtag('config', 'G-7RHZZRFLT9');
            `,
          }}
        />
        <Header />
        <Progress isAnimating={isAnimating} />
        <Component {...pageProps} />
        {loaderFinished ? (
          <Footer />
        ) : (
          <Loader onComplete={() => setLoaderFinished(true)} />
        )}
        <Easter />
        <DesktopOS />
        <RecruiterMode />
        <BootScreen />
      </SiteContentProvider>
    </ThemeProvider>
  );
}

export default MyApp;
