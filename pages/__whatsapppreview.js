// Design reference for the WhatsApp section, rendered with the REAL panel.
//
// The live one needs an agent server holding a socket to a phone, which makes
// every state here impossible to look at or assert on. This renders the same
// component against fixed data, and `?state=` picks which of the four states
// to show — all of them matter:
//
//   ?state=warn        not installed on the server
//   ?state=connect     installed, not connected
//   ?state=qr          waiting for a QR scan
//   (default)          connected, with chats and a thread
//
// The warning is present in every one of them, which is the point: a warning
// you only see before connecting is a warning you see once.
//
// 404s in production: it is a design tool, not a page.
import React, { useState } from "react";
import { useRouter } from "next/router";
import WhatsappPanel from "../components/admin/WhatsappPanel";

const ME = { id: "918765432100:3@s.whatsapp.net", name: "Ravi Kishan" };

const CHATS = [
  {
    jid: "919999999999@s.whatsapp.net",
    name: "Asha Menon",
    isGroup: false,
    unread: 2,
    preview: "did the deploy go out?",
    lastAt: new Date(Date.now() - 4 * 60000).toISOString(),
  },
  {
    jid: "120363001234567890@g.us",
    name: "Rust meetup",
    isGroup: true,
    unread: 0,
    preview: "[image talk.png]",
    lastAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  },
  {
    jid: "918888888888@s.whatsapp.net",
    name: "918888888888",
    isGroup: false,
    unread: 0,
    preview: "—",
    lastAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
  },
];

const THREAD = {
  jid: "919999999999@s.whatsapp.net",
  name: "Asha Menon",
  isGroup: false,
  count: 4,
  messages: [
    { id: "1", fromMe: false, fromName: "Asha Menon", text: "did the deploy go out?", at: new Date(Date.now() - 9 * 60000).toISOString(), type: "conversation" },
    { id: "2", fromMe: true, fromName: "me", text: "running the tests now", at: new Date(Date.now() - 7 * 60000).toISOString(), type: "conversation" },
    { id: "3", fromMe: false, fromName: "Asha Menon", text: "", media: { kind: "image", mimetype: "image/png", bytes: 40321 }, at: new Date(Date.now() - 6 * 60000).toISOString(), type: "imageMessage" },
    { id: "4", fromMe: false, fromName: "Asha Menon", text: "this is the failure", at: new Date(Date.now() - 5 * 60000).toISOString(), type: "conversation" },
  ],
};

const STATES = {
  warn: { installed: false, hasSession: false, sessions: [] },
  connect: { installed: true, hasSession: true, sessions: [] },
  qr: {
    installed: true,
    hasSession: false,
    sessions: [{ profile: "personal", state: "pairing", connected: false, qr: "2@abcdef1234567890/EXAMPLEPAIRINGSTRING+for/preview==,xyz", chats: 0 }],
  },
  live: {
    installed: true,
    hasSession: true,
    sessions: [{ profile: "personal", state: "open", connected: true, me: ME, chats: 3, cachedMessages: 48, sentThisHour: 2, qr: "" }],
  },
};

export default function WhatsappPreview() {
  const router = useRouter();
  const which = STATES[router.query.state] ? router.query.state : "live";
  const [thread] = useState(THREAD);

  return (
    <main
      className="admin-main"
      style={{ background: "#08090d", minHeight: "100vh", padding: "88px 24px 24px", color: "#e7e8ee" }}
    >
      <div className="ops-head">
        <h3>Agent → WhatsApp</h3>
      </div>

      <div className="ag-tabs">
        {Object.keys(STATES).map((k) => (
          <button
            key={k}
            type="button"
            className={`ag-tab${which === k ? " on" : ""}`}
            onClick={() => router.push({ query: { ...router.query, state: k } }, undefined, { shallow: true })}
          >
            {k}
          </button>
        ))}
      </div>

      <WhatsappPanel
        client={null}
        status={STATES[which]}
        chats={which === "live" ? CHATS : []}
        thread={which === "live" ? thread : null}
        initialChat={which === "live" ? THREAD.jid : ""}
        onAction={async () => {}}
      />

      <style jsx global>{`
        .ops-head h3 {
          margin: 0 0 14px;
          font-size: 15px;
          font-family: "Space Grotesk", sans-serif;
          color: #e7e8ee;
        }
        .ag-tabs {
          display: flex;
          gap: 6px;
          margin-bottom: 16px;
        }
        .ag-tab {
          background: none;
          border: 1px solid #2b3040;
          border-radius: 999px;
          color: #8b90a0;
          padding: 6px 14px;
          font: inherit;
          font-size: 12.5px;
          cursor: pointer;
        }
        .ag-tab.on {
          border-color: #ffb020;
          color: #e7e8ee;
        }
        .admin-input {
          width: 100%;
          background: #0d0e13;
          border: 1px solid #2b3040;
          border-radius: 9px;
          color: #e7e8ee;
          padding: 10px 12px;
          font: inherit;
          font-size: 13px;
        }
        .admin-primary {
          background: #ffb020;
          color: #1a1300;
          border: none;
          border-radius: 9px;
          padding: 9px 14px;
          font: inherit;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
        }
        .admin-ghost {
          background: none;
          border: 1px solid #2b3040;
          border-radius: 9px;
          color: #e7e8ee;
          padding: 9px 14px;
          font: inherit;
          font-size: 13px;
          cursor: pointer;
        }
        .admin-err {
          color: #ff8a8a;
          font-size: 12.5px;
        }
        body {
          margin: 0;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
          background: #08090d;
        }
      `}</style>
    </main>
  );
}

export async function getStaticProps() {
  if (process.env.NODE_ENV === "production") return { notFound: true };
  return { props: {} };
}
