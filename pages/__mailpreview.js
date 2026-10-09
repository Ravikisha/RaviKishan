// Design reference for the Mail desk, rendered with the REAL components.
//
// The live panel needs a connected Gmail or Outlook mailbox, so without this
// the desk cannot be looked at or asserted on at all.
//
// The seed is deliberately unflattering, because a preview full of tidy rows
// shows none of the states these components exist for: a mailbox that could
// not be read beside two that could, an expired account, a message with no
// subject, a sender with no display name, a long address that must clip rather
// than push the row sideways, and a quiet day in the middle of the strip.
//
// 404s in production: it is a design tool, not a page.
import React, { useEffect, useState } from "react";
import {
  Composer,
  Headline,
  Mailboxes,
  NotConnected,
  Outbound,
  Reader,
  Row,
  Unreadable,
} from "../components/admin/MailPanel";
import MailStyles from "../components/admin/MailStyles";

const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

const MESSAGES = [
  {
    id: "m1",
    provider: "gmail",
    account: "ravikishan63392@gmail.com",
    accountId: "1",
    from: { name: "Ada Lovelace", email: "ada@analytical-engine.example" },
    to: [{ email: "ravikishan63392@gmail.com" }],
    subject: "Re: the note-taking thing",
    preview: "Yes — the bit I could not get past was that a vault is just files, so there is nothing to call.",
    at: ago(2),
    unread: true,
    hasAttachment: false,
  },
  {
    id: "m2",
    provider: "outlook",
    account: "ravi.kishan.a.very.long.address@outlook-example.co.uk",
    accountId: "2",
    from: { name: "", email: "no-reply@billing.example" },
    to: [],
    subject: "",
    preview: "Your invoice for September is attached.",
    at: ago(7),
    unread: true,
    hasAttachment: true,
  },
  {
    id: "m3",
    provider: "gmail",
    account: "godasap7@gmail.com",
    accountId: "3",
    from: { name: "GitHub", email: "noreply@github.example" },
    to: [],
    subject: "[Ravikisha/portifilio] Run failed: health",
    preview: "The health workflow failed on main — asserts pages RENDERED, not merely 200.",
    at: ago(30),
    unread: false,
    hasAttachment: false,
  },
  {
    id: "m4",
    provider: "gmail",
    account: "ravikishan63392@gmail.com",
    accountId: "1",
    from: { name: "Grace Hopper", email: "grace@navy.example" },
    to: [],
    subject: "A nanosecond, for scale",
    preview: "Eleven point eight inches of wire. Keep one on the desk and nobody asks twice.",
    at: ago(96),
    unread: false,
    hasAttachment: true,
  },
];

const FULL = {
  ...MESSAGES[0],
  body:
    "Yes — the bit I could not get past was that a vault is just files, so there is nothing to call.\n\n" +
    "Backing it with a repository means the sync you already have IS the API, and it costs no new credential. " +
    "The only thing to be careful about is that a note's identity is its path, so renaming the title renames the file.\n\n" +
    "Ada",
};

const ACCOUNTS = [
  // One default, one plain, one expired -- a row of three healthy mailboxes
  // shows none of the states the chip exists to carry.
  { key: "gmail__1", accountId: "1", provider: "gmail", account: "ravikishan63392@gmail.com", isDefault: true },
  { key: "gmail__3", accountId: "3", provider: "gmail", account: "godasap7@gmail.com" },
  {
    key: "outlook__2",
    accountId: "2",
    provider: "outlook",
    account: "ravi.kishan.a.very.long.address@outlook-example.co.uk",
    needsReconnect: true,
  },
];

const REVIEWED = {
  dryRun: true,
  wouldSendAs: "ravikishan63392@gmail.com",
  to: ["Ada Lovelace <ada@analytical-engine.example>"],
  cc: [],
  bcc: [],
  subject: "Re: the note-taking thing",
  body:
    "That is the conclusion I landed on too — the repository is the API.\n\n" +
    "On 9 Oct 2026, Ada Lovelace wrote:\n" +
    "> Yes — the bit I could not get past was that a vault is just files,\n" +
    "> so there is nothing to call.",
};

function Case({ title, note, children }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ font: "600 13px Inter, sans-serif", color: "#8b90a0", margin: "0 0 4px" }}>{title}</h2>
      {note && <p style={{ font: "12px Inter, sans-serif", color: "#4a5065", margin: "0 0 10px" }}>{note}</p>}
      {children}
    </section>
  );
}

export default function MailPreview() {
  // The seed is dated RELATIVE to now so the arrival strip keeps meaning
  // something next month, and the reader prints a local timestamp. Both differ
  // between the server render and the client one, which React reports as a
  // hydration mismatch and an overlay that covers the design. Rendering after
  // mount is the honest fix: a design tool has no SSR to protect.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [draft, setDraft] = useState({
    to: "ada@analytical-engine.example",
    subject: "Re: the note-taking thing",
    body: "That is the conclusion I landed on too — the repository is the API.",
  });
  // The LONG address by default, deliberately: it is the one that can break a
  // row, overflow a phone, or lose a size contest with a form field.
  const [from, setFrom] = useState("outlook__2");
  const [open, setOpen] = useState("m1");
  const sender = ACCOUNTS.find((a) => a.key === from);

  if (!ready) return <main style={{ background: "#0d0e13", minHeight: "100vh" }} />;

  return (
    <main style={{ background: "#0d0e13", minHeight: "100vh", padding: 28, color: "#e7e8ee" }}>
      <MailStyles />

      <Case title="The head" note="The headline is the state of the inbox, never the word 'Mail' — the rail already says that.">
        <div className="mbx-head">
          <Headline unread={2} counted={4} mailboxes={3} />
        </div>
      </Case>

      <Case
        title="A mailbox that did not answer"
        note="Stated above the stream, with the rest still shown. One expired connection says nothing about the two beside it."
      >
        <Unreadable
          rows={[
            {
              provider: "outlook",
              account: "ravi.kishan.a.very.long.address@outlook-example.co.uk",
              error: "The connection expired. Reconnect to read this mailbox.",
            },
          ]}
        />
      </Case>

      <Case
        title="Mailboxes"
        note="Always rendered, including with one connected -- otherwise the panel goes from 'set this up' to 'here is your mail' and drops the setup it still has to offer. The ··· holds the default and the disconnect; Add is dashed because it is an invitation, not a state."
      >
        <Mailboxes
          accounts={ACCOUNTS}
          configured={{
            gmail: true,
            outlook: false,
            outlookMissing: ["MS_TASKS_CLIENT_ID", "MS_TASKS_CLIENT_SECRET"],
          }}
          selected={"gmail__1"}
          busy={false}
          onSelect={() => {}}
          onAdd={() => {}}
          onMakeDefault={() => {}}
          onDisconnect={() => {}}
        />
      </Case>

      <Case
        title="The stream and the desk"
        note="Merged across mailboxes, so each row carries the address it landed in. Amber left edge = unread."
      >
        <div className="mbx-wrap">
          <div className="mbx-stream">
            {MESSAGES.map((m) => (
              <Row key={m.id} m={m} open={open === m.id} onOpen={(x) => setOpen(x.id)} />
            ))}
          </div>
          <div className="mbx-desk">
            <Reader message={FULL} busy={false} onBack={() => {}} onAct={() => {}} onReply={() => {}} />
          </div>
        </div>
      </Case>

      <Case
        title="Writing — before the message has been seen"
        note="There is no send button yet. Looking at the exact message is what makes one exist."
      >
        <div className="mbx-desk">
          <Composer accounts={ACCOUNTS} from={from} setFrom={setFrom} draft={draft} setDraft={setDraft}>
            <Outbound
              from={sender?.account || ""}
              reviewed={null}
              busy={false}
              onReview={() => {}}
              onSend={() => {}}
              onEdit={() => {}}
            />
          </Composer>
        </div>
      </Case>

      <Case
        title="Writing — after review"
        note="The button says the address, because the mistake that happens with three mailboxes is the account, not the service. Change the sender above and watch this line, the only thing on the panel that moves."
      >
        <div className="mbx-desk">
          <Outbound
            from={sender?.account || ""}
            reviewed={REVIEWED}
            busy={false}
            label="Reply"
            onReview={() => {}}
            onSend={() => {}}
            onEdit={() => {}}
          />
        </div>
      </Case>

      <Case title="Nothing connected" note="An empty screen is an invitation. Outlook here has no client on this deployment, so it is a note, not a disabled button.">
        <div className="mbx-desk">
          <NotConnected
            configured={{ gmail: true, outlook: false, outlookMissing: ["MS_TASKS_CLIENT_ID", "MS_TASKS_CLIENT_SECRET"] }}
            busy={false}
            onConnect={() => {}}
          />
        </div>
      </Case>

      <style jsx global>{`
        body {
          margin: 0;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        }
        .admin-input {
          width: 100%;
          background: #0d0e13;
          border: 1px solid #2b3040;
          border-radius: 10px;
          color: #e7e8ee;
          padding: 11px 12px;
          font-size: 14px;
          font-family: inherit;
          outline: none;
        }
        .admin-input:focus {
          border-color: #ffb020;
          box-shadow: 0 0 0 3px rgba(255, 176, 32, 0.14);
        }
        .admin-primary {
          background: #ffb020;
          color: #1a1300;
          border: none;
          border-radius: 10px;
          padding: 10px 18px;
          font: inherit;
          font-weight: 600;
          font-size: 13.5px;
          cursor: pointer;
        }
        .admin-primary.big {
          padding: 12px 22px;
          font-size: 14px;
        }
        .admin-ghost {
          background: transparent;
          color: #c4c7d2;
          border: 1px solid #2b3040;
          border-radius: 8px;
          padding: 8px 14px;
          font-size: 13px;
          font-family: inherit;
          cursor: pointer;
        }
        .admin-err {
          color: #ff6b6b;
          font-size: 12px;
        }
      `}</style>
    </main>
  );
}

// Dev-only: a design tool, not a page.
export async function getStaticProps() {
  if (process.env.NODE_ENV === "production") return { notFound: true };
  return { props: {} };
}
