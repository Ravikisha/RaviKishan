import React from "react";
import Link from "next/link";
import LegalPage from "../components/legal/LegalPage";

// This page exists because Google's OAuth consent screen requires one before
// an app can leave "Testing" — and an app stuck in Testing has its refresh
// token expired every seven days, which is exactly the hourly-reconnect
// failure the connected-accounts design was rebuilt to remove.
//
// It is also READ by a reviewer, so it describes what the code actually does:
// which scopes are requested, where the token is sealed, who can connect, and
// what is never done with the data. Keep it true to lib/server/integrations.js.
const UPDATED = "7 October 2026";

const Privacy = () => (
  <LegalPage
    title="Privacy"
    accent="policy."
    path="/privacy"
    updated={UPDATED}
    subtitle="What this site collects, what the admin tools connect to, and what is never done with any of it."
    description="Privacy policy for ravikishan.me — site analytics, the contact form, and how connected Google and Microsoft accounts are handled."
  >
    <h2>In short</h2>
    <p>
      <strong>ravikishan.me</strong> is the personal portfolio and writing site of Ravi Kishan. It
      sets no advertising cookies, runs no third-party tracker, and sells nothing to anyone.
    </p>
    <p>
      The site has a private admin area which can connect to third-party accounts — Google Tasks,
      Microsoft To&nbsp;Do, GitHub, LinkedIn and others. <strong>Only the site owner can connect an
      account.</strong> Those connections exist so that one person can manage their own data from
      one place. If you are reading this as a visitor, none of that section applies to you.
    </p>

    <h2>What the site collects from visitors</h2>

    <h3>Page analytics</h3>
    <p>
      Visits are counted first-party, in aggregate, and <strong>without cookies</strong>. What is
      stored is a daily tally — a date and a counter. No IP address, no device fingerprint, no
      identifier of any kind is written, so one visit cannot be told from another or traced back to
      a person. The numbers are indicative, not exact.
    </p>

    <h3>The contact form</h3>
    <p>
      If you send a message through{" "}
      <Link href="/contact">
        <a>the contact page</a>
      </Link>
      , what you typed is
      stored: name, email address, optional phone number, message and the time it arrived. It is
      used to reply to you and nothing else. It is never added to a mailing list, never sold, and
      never shared. Ask at the address below and it will be deleted.
    </p>

    <h3>Hosting</h3>
    <p>
      The site runs on Vercel and stores data in Google Firebase. Both keep standard server logs of
      requests, as any web host does.
    </p>

    <h2>Connected accounts — Google user data</h2>
    <p>
      The admin area can connect the owner&apos;s own Google account so that tasks can be read and
      written from one console rather than several apps. This section describes that, in the detail
      Google&apos;s API Services User Data Policy asks for.
    </p>

    <h3>What is requested, and why</h3>
    <ul>
      <li>
        <code>https://www.googleapis.com/auth/tasks</code> — to list, create, update, move and
        complete the owner&apos;s own Google Tasks from the admin task board.
      </li>
      <li>
        <code>openid</code> and <code>email</code> — to confirm which account was connected, so a
        different account cannot be attached by mistake.
      </li>
    </ul>
    <p>No other Google scope is requested. No Gmail, Drive, Calendar or Contacts access is asked for or held.</p>

    <h3>How it is stored</h3>
    <p>
      The refresh token is <strong>encrypted with AES-256-GCM</strong> before it is written
      anywhere. The encryption key lives only in the deployment environment and is never stored
      alongside the data, so the stored record is ciphertext on its own. Tasks themselves are{" "}
      <strong>not copied or cached</strong> — they are read from Google when a page is opened and
      written straight back.
    </p>

    <h3>What is never done with it</h3>
    <ul>
      <li>It is never sold, rented or transferred to anyone.</li>
      <li>It is never used for advertising, profiling or market research.</li>
      <li>It is never used to train, fine-tune or improve any AI or machine-learning model.</li>
      <li>No human other than the account owner reads it.</li>
    </ul>

    <div className="legal-callout">
      <p>
        <strong>Limited Use.</strong> This application&apos;s use and transfer of information
        received from Google APIs adheres to the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>
    </div>

    <h3>Revoking it</h3>
    <p>
      Disconnecting the account in the admin area deletes the stored record. Access can also be
      withdrawn at any time from{" "}
      <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
        your Google account permissions
      </a>
      , which takes effect immediately and independently of this site.
    </p>

    <h2>Other connected services</h2>
    <p>
      Microsoft To&nbsp;Do, GitHub, LinkedIn and the other optional connections are handled the same
      way: the owner&apos;s own account, the narrowest scope that does the job, the credential
      encrypted at rest, nothing copied that does not need to be, and disconnection available both
      here and in the provider&apos;s own settings.
    </p>

    <h2>Children</h2>
    <p>This site is not directed at children and does not knowingly collect data from anyone under 13.</p>

    <h2>Changes</h2>
    <p>
      If this policy changes, the date at the top of the page changes with it. There is no archive
      of earlier versions — the page above is the policy in force.
    </p>

    <h2>Contact</h2>
    <p>
      Questions, corrections, or a request to delete something you sent:{" "}
      <a href="mailto:ravikishan63392@gmail.com">ravikishan63392@gmail.com</a>.
    </p>
  </LegalPage>
);

export default Privacy;
