import Head from "next/head";
import { useRouter } from "next/router";
import { identity } from "../lib/facts";

// One place for every page's SEO: title, description, canonical, Open Graph,
// Twitter card, and Person structured data. Each tag carries a stable `key` so
// Next dedupes — a page renders <Seo/> once and gets the full, correct head.
const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://ravikishan.me";
const OG_IMAGE = `${SITE}/pagepreview.png`;
const TWITTER = "@RaviKishan_";

const person = {
  "@context": "https://schema.org",
  "@type": "Person",
  name: identity.name,
  url: SITE,
  image: OG_IMAGE,
  jobTitle: "Software Engineer",
  description: identity.intro,
  worksFor: { "@type": "Organization", name: "Zimyo" },
  address: { "@type": "PostalAddress", addressLocality: "Bihar", addressCountry: "IN" },
  knowsAbout: [
    "Distributed Systems",
    "Systems Programming",
    "Applied AI",
    "Go",
    "Rust",
    "TypeScript",
    "LangChain",
    "RAG",
  ],
  sameAs: [identity.github, identity.linkedin, identity.twitter].filter(Boolean),
};

export default function Seo({
  title,
  description,
  path,
  image,
  type = "website",
  noindex = false,
  jsonLd = true,
}) {
  const router = useRouter();
  const rel = (path || (router && router.asPath) || "/").split("?")[0];
  const url = SITE + (rel === "/" ? "" : rel);
  const img = image ? (image.startsWith("http") ? image : SITE + image) : OG_IMAGE;
  const fullTitle = title || `${identity.name} — ${identity.role}`;

  return (
    <Head>
      <title key="title">{fullTitle}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" key="viewport" />
      {description && <meta name="description" content={description} key="description" />}
      <meta name="author" content={identity.name} key="author" />
      <meta
        name="robots"
        content={noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large"}
        key="robots"
      />
      <link rel="canonical" href={url} key="canonical" />

      {/* Open Graph */}
      <meta property="og:type" content={type} key="og:type" />
      <meta property="og:site_name" content={identity.name} key="og:site_name" />
      <meta property="og:title" content={fullTitle} key="og:title" />
      {description && <meta property="og:description" content={description} key="og:description" />}
      <meta property="og:url" content={url} key="og:url" />
      <meta property="og:image" content={img} key="og:image" />
      <meta property="og:image:alt" content={`${identity.name} — ${identity.role}`} key="og:image:alt" />
      <meta property="og:locale" content="en_US" key="og:locale" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" key="twitter:card" />
      <meta name="twitter:site" content={TWITTER} key="twitter:site" />
      <meta name="twitter:creator" content={TWITTER} key="twitter:creator" />
      <meta name="twitter:title" content={fullTitle} key="twitter:title" />
      {description && <meta name="twitter:description" content={description} key="twitter:description" />}
      <meta name="twitter:image" content={img} key="twitter:image" />

      {jsonLd && !noindex && (
        <script
          type="application/ld+json"
          key="ld-person"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(person) }}
        />
      )}
    </Head>
  );
}
