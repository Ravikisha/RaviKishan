import Head from "next/head";
import { useRouter } from "next/router";
import { identity } from "../lib/facts";
import { useSiteContent } from "../lib/useSiteContent";

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
  canonical,
  type = "website",
  noindex = false,
  jsonLd = true,
}) {
  const router = useRouter();
  const rel = (path || (router && router.asPath) || "/").split("?")[0];

  // Per-route overrides set in the admin (content.seo) beat the props a page
  // passes, so title/description/preview image can be retuned without a
  // redeploy. A blank field means "keep whatever the page already supplies".
  const content = useSiteContent();
  const override = (content && content.seo && content.seo[rel]) || {};
  const pick = (a, b) => (typeof a === "string" && a.trim() ? a.trim() : b);

  const finalTitle = pick(override.title, title);
  const finalDescription = pick(override.description, description);
  const finalImage = pick(override.image, image);

  const url = SITE + (rel === "/" ? "" : rel);
  // An article imported from dev.to was published there first, so its canonical
  // points back at dev.to. Without this, the same text on two domains splits
  // its search ranking between them.
  const canonicalUrl = canonical || url;
  const img = finalImage
    ? finalImage.startsWith("http")
      ? finalImage
      : SITE + finalImage
    : OG_IMAGE;
  const fullTitle = finalTitle || `${identity.name} — ${identity.role}`;

  return (
    <Head>
      <title key="title">{fullTitle}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" key="viewport" />
      {finalDescription && (
        <meta name="description" content={finalDescription} key="description" />
      )}
      <meta name="author" content={identity.name} key="author" />
      <meta
        name="robots"
        content={noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large"}
        key="robots"
      />
      <link rel="canonical" href={canonicalUrl} key="canonical" />

      {/* Open Graph */}
      <meta property="og:type" content={type} key="og:type" />
      <meta property="og:site_name" content={identity.name} key="og:site_name" />
      <meta property="og:title" content={fullTitle} key="og:title" />
      {finalDescription && (
        <meta property="og:description" content={finalDescription} key="og:description" />
      )}
      <meta property="og:url" content={url} key="og:url" />
      <meta property="og:image" content={img} key="og:image" />
      <meta property="og:image:alt" content={`${identity.name} — ${identity.role}`} key="og:image:alt" />
      <meta property="og:locale" content="en_US" key="og:locale" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" key="twitter:card" />
      <meta name="twitter:site" content={TWITTER} key="twitter:site" />
      <meta name="twitter:creator" content={TWITTER} key="twitter:creator" />
      <meta name="twitter:title" content={fullTitle} key="twitter:title" />
      {finalDescription && (
        <meta name="twitter:description" content={finalDescription} key="twitter:description" />
      )}
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
