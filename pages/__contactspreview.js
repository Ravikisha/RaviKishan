// Design reference for adding a contact, rendered with the REAL AddContact
// component so it cannot drift from the live panel.
//
// The panel needs Firebase auth and a live Firestore subscription, which makes
// the one interesting part — watching the parser read a pasted signature —
// impossible to look at or assert on. This renders that part alone, with the
// textarea pre-filled, against a fixed address book.
//
// The seed address book already contains someone sharing an address with the
// pasted text, so the duplicate warning is visible rather than theoretical.
//
// 404s in production: it is a design tool, not a page.
import React from "react";
import { AddContact } from "../components/admin/ContactsPanel";
import { shapeContact } from "../lib/server/contactShape";

const PEOPLE = [
  shapeContact(
    {
      name: "Asha Menon",
      company: "Northwind",
      position: "Staff Engineer",
      email: "asha.menon+work@northwind.co.in",
      url: "https://www.linkedin.com/in/ashamenon",
      connectedOn: "12 Mar 2024",
    },
    { id: "ashamenon" }
  ),
  shapeContact({ name: "Bob Stone", channels: [{ kind: "email", value: "bob@acme.io" }] }, { id: "bob-stone" }),
];

const SAMPLE = [
  "Asha Menon",
  "Staff Engineer, Northwind",
  "asha.menon+work@northwind.co.in | +91 98765 43210",
  "github.com/ashamenon  @asha_m",
  "Met at the Rust meetup in Bangalore.",
].join("\n");

export default function ContactsPreview() {
  return (
    <main
      className="admin-main"
      style={{ background: "#08090d", minHeight: "100vh", padding: "88px 24px 24px" }}
    >
      <div className="ops-head">
        <div>
          <h3>Contacts</h3>
          <p className="admin-sub">
            Paste anything. The ways of reaching someone are read out of it before you save.
          </p>
        </div>
      </div>

      <AddContact
        people={PEOPLE}
        user={null}
        initialText={SAMPLE}
        onDone={() => {}}
        onError={() => {}}
      />

      <style jsx global>{`
        .admin-main {
          color: #e7e8ee;
        }
        .ops-card {
          border: 1px solid #23262f;
          border-radius: 12px;
          background: #15171d;
          padding: 16px 18px;
          margin-bottom: 14px;
        }
        .ops-card h3 {
          margin: 0 0 6px;
          font-family: "Space Grotesk", sans-serif;
          font-size: 15px;
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
        .admin-input:focus {
          outline: none;
          border-color: #ffb020;
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
        .admin-sub {
          color: #8b90a0;
          font-size: 12.5px;
          font-weight: 400;
          line-height: 1.5;
        }
        .ops-head {
          margin-bottom: 16px;
        }
        .ops-head h3 {
          margin: 0;
          font-size: 15px;
          color: #e7e8ee;
          font-family: "Space Grotesk", sans-serif;
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
