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

function MyApp({ Component, pageProps }) {
  const [loaderFinished, setLoaderFinished] = useState(false);
  const setIsAnimating = useProgressStore((state) => state.setIsAnimating);
  const isAnimating = useProgressStore((state) => state.isAnimating);
  const router = useRouter();
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
  return (
    <>
      <Head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta
          name="title"
          content="Ravi Kishan | Full Stack Developer Portfolio"
        />
        <meta
          name="description"
          content="Explore Ravi Kishan's portfolio – a full stack developer skilled in building scalable web, cloud, and software systems."
        />
        <meta
          name="keywords"
          content="Ravi Kishan, full stack developer, software developer, web developer, cloud developer, backend engineer, frontend developer, JavaScript developer, React developer, Node.js developer, TypeScript developer, Next.js, Express.js, MongoDB, Firebase, DevOps engineer, scalable systems, distributed systems, database engineer, portfolio website, open source contributor, REST API developer, GraphQL, Docker, Kubernetes, microservices, CI/CD pipelines, GitHub portfolio, Git, serverless architecture, AWS developer, GCP developer, cloud engineering, responsive design, Tailwind CSS, ShadCN UI, performance optimization, software architect, code quality, scalable web apps, React projects, cloud-native apps, modern web development, frontend frameworks, backend frameworks, agile development, web performance, SEO developer, JAMstack, Progressive Web Apps, full stack portfolio, developer tools, software innovation, web engineering"
        />
        <meta name="author" content="Ravi Kishan" />
        <meta name="robots" content="index, follow" />
        <meta name="language" content="English" />
        <link rel="canonical" href="https://ravikishan.me/" />

        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://ravikishan.me/" />
        <meta
          property="og:title"
          content="Ravi Kishan | Full Stack Developer Portfolio"
        />
        <meta
          property="og:description"
          content="Explore Ravi Kishan's portfolio – a full stack developer skilled in building scalable web, cloud, and software systems."
        />
        <meta
          property="og:image"
          content="https://ravikishan.me/pagepreview.png"
        />
        <meta property="og:site_name" content="Ravi Kishan" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:url" content="https://ravikishan.me/" />
        <meta
          name="twitter:title"
          content="Ravi Kishan | Full Stack Developer Portfolio"
        />
        <meta
          name="twitter:description"
          content="Explore Ravi Kishan's portfolio – a full stack developer skilled in building scalable web, cloud, and software systems."
        />
        <meta
          name="twitter:image"
          content="https://ravikishan.me/pagepreview.png"
        />
        <meta
          name="twitter:image:alt"
          content="Preview image of Ravi Kishan's Portfolio"
        />
      </Head>
      <Script
        id="next"
        strategy="afterInteractive"
        async
        src={`https://www.googletagmanager.com/gtag/js?id=G-7RHZZRFLT9`}
      ></Script>
      <Script id="next" strategy="afterInteractive">
        {`
                      window.dataLayer = window.dataLayer || [];
                      function gtag(){dataLayer.push(arguments);}
                      gtag('js', new Date());
                      gtag('config', 'G-7RHZZRFLT9', {
                      page_path: window.location.pathname,
                      });
                  `}
      </Script>
      <Header />
      <Progress isAnimating={isAnimating} />
      <Component {...pageProps} />
      {loaderFinished ? (
        <>
          <Footer />
        </>
      ) : (
        <Loader onComplete={() => setLoaderFinished(true)} />
      )}
    </>
  );
}

export default MyApp;
