// Design reference for organisations, rendered with the REAL components.
//
// The live Orgs tab needs signed-in Firestore and real logins, so without this
// the org switcher and the membership roster could not be looked at or
// asserted on at all. It renders the shell's own `OrgSwitcher` (inside the
// real AdminShell) and the panel's exported parts — `OrgHeadline`, `OrgRow`,
// `OrgForm`, `LoginRoster`, `MigrateControl` — never a copy of their markup,
// which is how a design reference quietly stops referencing anything.
//
// The seed is deliberately unflattering:
//   - an org with zero logins, so the empty holdings line and "Switch" show;
//   - a login shared by two orgs, so a filled chip sits beside another;
//   - a login whose ONLY org is Relax, so removing it is refused in place;
//   - a legacy row that cannot be reassigned at all;
//   - an org name long enough to wrap and to be truncated in the rail;
//   - a delete that is blocked, and one waiting on confirmation.
//
// Nothing here calls an API. 404s in production: it is a design tool.
import React, { useState } from "react";
import AdminShell from "../components/admin/AdminShell";
import {
  LoginRoster,
  MigrateControl,
  OrgForm,
  OrgHeadline,
  OrgRow,
  OrgsStyles,
  holdingsOf,
} from "../components/admin/OrgsPanel";

const SERVICES = [
  { id: "tasks", label: "Tasks", providers: ["google", "microsoft"] },
  { id: "notes", label: "Notes", providers: ["notion", "github"] },
  { id: "code", label: "Code", providers: ["github"] },
  { id: "video", label: "Video", providers: ["youtube"] },
  { id: "photos", label: "Photos & reels", providers: ["instagram"] },
  { id: "mail", label: "Mail", providers: ["gmail", "outlook"] },
  { id: "siteAnalytics", label: "Site analytics", providers: ["analytics"] },
];

const ORGS = [
  {
    id: "relax",
    name: "Relax",
    description: "The default org. Every login made before orgs existed belongs here.",
    color: "",
    website: "",
    isDefault: true,
    accountCount: 5,
  },
  {
    id: "acme-labs",
    name: "Acme Labs",
    description: "Client work for Acme — their channel, their mailbox, their repos.",
    color: "#5B8DEF",
    website: "https://acme.example",
    isDefault: false,
    accountCount: 2,
  },
  {
    id: "northwind-community-open-source-collective",
    name: "Northwind Community Open-Source Collective and Friends of the Archive",
    description: "",
    color: "#3FB8A9",
    website: "",
    isDefault: false,
    accountCount: 0,
  },
];

const ACCOUNTS = [
  {
    key: "google__1043",
    provider: "google",
    accountId: "1043",
    label: "ravikishan63392@gmail.com",
    email: "ravikishan63392@gmail.com",
    orgIds: ["relax"],
  },
  {
    key: "youtube__UC1",
    provider: "youtube",
    accountId: "UC1",
    label: "Ravi Kishan",
    email: "",
    // Shared: one credential, two orgs.
    orgIds: ["relax", "acme-labs"],
  },
  {
    key: "gmail__2210",
    provider: "gmail",
    accountId: "2210",
    label: "ops@acme.example",
    email: "ops@acme.example",
    orgIds: ["acme-labs"],
  },
  {
    key: "github__Ravikisha",
    provider: "github",
    accountId: "Ravikisha",
    label: "Ravikisha",
    email: "",
    orgIds: ["relax"],
  },
  {
    key: "microsoft__legacy",
    provider: "microsoft",
    accountId: "ravi@outlook.example",
    label: "ravi@outlook.example",
    email: "",
    legacy: true,
    orgIds: ["relax"],
  },
];

const DRY_RUN = {
  dryRun: true,
  org: "relax",
  orgCreated: true,
  accountsStamped: ["google__1043", "github__Ravikisha", "youtube__UC1"],
  identitiesStamped: 2,
  secretsStamped: 4,
};

const TABS = [
  ["accounts", "Accounts", "Access"],
  ["orgs", "Orgs", "Access"],
];

const labelFor = (key) => {
  const a = ACCOUNTS.find((x) => x.key === key);
  return a ? a.label : key;
};

export default function OrgsPreview() {
  const [accounts, setAccounts] = useState(ACCOUNTS);
  const [view, setView] = useState("orgs");
  const [form, setForm] = useState("");
  const here = ORGS[0];

  return (
    <AdminShell
      tabs={TABS}
      view={view}
      onView={setView}
      email="ravikishan63392@gmail.com"
      org={here}
      orgId={here.id}
      orgs={ORGS}
      onOrg={() => {}}
      onSignOut={() => {}}
    >
      <main className="admin-main og">
        <OrgHeadline org={here} orgs={ORGS} accounts={accounts} services={SERVICES} />

        <section className="og-band">
          <div className="og-band-head">
            <h3>Orgs</h3>
            <span className="og-band-sub">{ORGS.length} orgs</span>
          </div>
          <ul className="og-orgs" data-preview="orgs">
            <OrgRow
              org={ORGS[0]}
              current
              holdings={holdingsOf("relax", accounts, SERVICES)}
              labelFor={labelFor}
              onSwitch={() => {}}
              onEdit={() => setForm("relax")}
            />
            {form === "acme-labs" ? (
              <li className="og-org editing">
                <OrgForm initial={ORGS[1]} onSave={() => setForm("")} onCancel={() => setForm("")} />
              </li>
            ) : (
              <OrgRow
                org={ORGS[1]}
                current={false}
                holdings={holdingsOf("acme-labs", accounts, SERVICES)}
                labelFor={labelFor}
                deleting={{ phase: "blocked", accounts: ["gmail__2210"], secrets: ["login-gmail-2210"] }}
                onSwitch={() => {}}
                onEdit={() => setForm("acme-labs")}
                onDelete={() => {}}
                onCancelDelete={() => {}}
              />
            )}
            <OrgRow
              org={ORGS[2]}
              current={false}
              holdings={holdingsOf(ORGS[2].id, accounts, SERVICES)}
              labelFor={labelFor}
              deleting={{
                phase: "plan",
                plan: { unassigned: [], identitiesRemoved: ["p1"], defaultsRemoved: "config/accountDefaults__northwind" },
              }}
              onSwitch={() => {}}
              onEdit={() => {}}
              onDelete={() => {}}
              onConfirmDelete={() => {}}
              onCancelDelete={() => {}}
            />
          </ul>
          <div className="og-new">
            <OrgForm
              initial={{ name: "Acme Labs", description: "", website: "acme.example", color: "#5B8DE" }}
              existingIds={ORGS.map((o) => o.id)}
              onSave={() => {}}
              onCancel={() => {}}
            />
          </div>
        </section>

        <LoginRoster
          accounts={accounts}
          orgs={ORGS}
          onSet={(account, orgIds) =>
            setAccounts((all) => all.map((a) => (a.key === account.key ? { ...a, orgIds } : a)))
          }
        />

        <MigrateControl initial={DRY_RUN} onCheck={async () => DRY_RUN} onApply={async () => ({ ...DRY_RUN, dryRun: false })} />

        <OrgsStyles />
        <style jsx global>{`
          body {
            margin: 0;
            background: #08090d;
          }
          .admin-main {
            max-width: 980px;
            margin: 0 auto;
            padding: 20px 20px 24px;
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .admin-input {
            width: 100%;
            box-sizing: border-box;
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
          }
          @media (max-width: 720px) {
            .admin-main {
              padding: 14px 14px 20px;
            }
            .admin-input {
              font-size: 16px;
            }
          }
        `}</style>
      </main>
    </AdminShell>
  );
}

// Dev-only: a design tool, not a page.
export async function getStaticProps() {
  if (process.env.NODE_ENV === "production") return { notFound: true };
  return { props: {} };
}
