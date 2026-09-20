import { Html, Head, Main, NextScript } from "next/document";
import Script from "next/script";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link
          rel="stylesheet"
          href="https://unicons.iconscout.com/release/v4.0.0/css/line.css"
        />

        <link
          href="https://unpkg.com/boxicons@2.1.2/css/boxicons.min.css"
          rel="stylesheet"
        />
        <link
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.13.0/css/all.min.css"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css?family=Carter+One"
          rel="stylesheet"
          type="text/css"
        />
        {/* The manifest, theme-color and touch icon are NOT set here: the site
            and /admin install as two separate PWAs with different manifests and
            icons, and _document renders on every route. pages/_app.js picks the
            right set per route. */}
      </Head>
      
      <Script
        id="box-icons"
        src="https://unpkg.com/boxicons@2.1.2/dist/boxicons.js"
      />
      <Script
        src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"
        integrity="sha512-GsLlZN/3F2ErC5ifS5QtgpiJtWd43JWSuIgh7mbzZ8zBps+dvLusV+eNQATqgA/HdeKFVgA5v3S/cIrLF7QnIg=="
        crossorigin="anonymous"
        referrerpolicy="no-referrer"
      ></Script>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
