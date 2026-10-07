import React from "react";
import LegalPage from "../components/legal/LegalPage";

// The second link Google's Branding page asks for. Short on purpose: this is a
// personal site, and terms longer than the thing they govern are noise.
const UPDATED = "7 October 2026";

const Terms = () => (
  <LegalPage
    title="Terms of"
    accent="service."
    path="/terms"
    updated={UPDATED}
    subtitle="What you may do with what is published here, and what is promised about it."
    description="Terms of service for ravikishan.me — use of the site, its writing and its source code."
  >
    <h2>What this is</h2>
    <p>
      <strong>ravikishan.me</strong> is the personal portfolio, writing and project archive of Ravi
      Kishan. Using it means accepting what follows. If you do not, the remedy is to close the tab.
    </p>

    <h2>Using the site</h2>
    <p>You are welcome to read, link to, quote with attribution, and share anything published here. Please do not:</p>
    <ul>
      <li>Republish an article in full as your own, or without a link back to the original.</li>
      <li>Attempt to reach the admin area, any API endpoint, or any account connected to them.</li>
      <li>Scrape the site at a rate that degrades it for anyone else.</li>
      <li>Use the site to break the law.</li>
    </ul>

    <h2>Who may connect an account</h2>
    <p>
      The admin area is restricted to the site owner. Connecting a Google, Microsoft, GitHub or
      other third-party account is possible only for that one account. Nothing here invites or
      permits anyone else to attach their account, and any attempt to do so is covered by the clause
      above.
    </p>

    <h2>Ownership</h2>
    <p>
      Articles, designs and images on this site remain the author&apos;s. Source code published to{" "}
      <a href="https://github.com/Ravikisha" target="_blank" rel="noopener noreferrer">
        GitHub
      </a>{" "}
      is governed by whatever licence that repository carries, which overrides this page for that
      code.
    </p>

    <h2>No warranty</h2>
    <p>
      The site and everything on it is provided <strong>as is</strong>. Articles describe what
      worked at the time of writing; nothing here is professional advice, and running code found on
      this site is your decision and your risk. No liability is accepted for any loss arising from
      using it.
    </p>

    <h2>Availability</h2>
    <p>
      This is a personal site. It may change, move or go offline without notice, and no uptime is
      promised.
    </p>

    <h2>Third-party services</h2>
    <p>
      Links lead to sites that are not under this site&apos;s control and carry their own terms.
      Connected services — Google, Microsoft, GitHub, LinkedIn, dev.to and others — are governed by
      their own agreements with their own users.
    </p>

    <h2>Changes</h2>
    <p>
      These terms may change; the date at the top says when they last did. Continuing to use the
      site after that is acceptance of the current version.
    </p>

    <h2>Contact</h2>
    <p>
      <a href="mailto:ravikishan63392@gmail.com">ravikishan63392@gmail.com</a>
    </p>
  </LegalPage>
);

export default Terms;
