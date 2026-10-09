// The Mail panel's stylesheet, kept out of the panel so /__mailpreview can
// mount the REAL components against a fixed seed. Same reason EditorStyles.js
// and PostBodyStyles.js are separate files: a design reference that keeps its
// own copy of the markup stops referencing anything the first time the panel
// changes.
//
// DESIGN IDEA: the panel is only as loud as the inbox is.
// Amber is this console's "this wants you" mark, and here it appears in
// exactly two places, both driven by the same fact: the left edge of an unread
// row, and the unread count in the headline. A mailbox with nothing waiting
// renders almost monochrome. Nothing else on the page is saturated, so the
// page cannot shout about a quiet morning.
//
// The one saturated, display-size thing in the whole panel is the address a
// message would go out as, and it lives in the composer -- see Outbound.
export default function MailStyles() {
  return (
    <style jsx global>{`
      /* AdminShell's .ad-content has no horizontal padding -- every other
         panel opens with a bordered card, which carries its own, so nothing
         noticed. This one opens with bare text, and at zero gutter the "1" of
         "18 unread" was clipped in half by the rail. 20px matches .ad-top, so
         the headline lines up with the section title above it. */
      .mbx-panel {
        padding: 0 20px;
      }
      @media (max-width: 720px) {
        .mbx-panel {
          padding: 0 14px;
        }
      }
      .mbx-wrap {
        display: grid;
        grid-template-columns: minmax(290px, 380px) 1fr;
        gap: 14px;
        align-items: start;
      }
      /* Below this the two panes cannot both be useful, so reading a message
         replaces the stream the way every mail client on a phone does. */
      @media (max-width: 980px) {
        .mbx-wrap {
          grid-template-columns: 1fr;
        }
        .mbx-wrap.mbx-reading .mbx-stream {
          display: none;
        }
      }

      /* ---------------- the head ---------------- */
      .mbx-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      .mbx-count {
        font-family: "Space Grotesk", "Inter", sans-serif;
        font-size: 19px;
        font-weight: 600;
        color: #e7e8ee;
        margin: 0;
        letter-spacing: -0.01em;
      }
      .mbx-count b {
        color: #ffb020;
        font-weight: 600;
      }
      /* Said out loud because every figure here describes the messages that
         were FETCHED. A page of fifty cannot speak for a mailbox of forty
         thousand, and a panel that implies it can is lying quietly. */
      .mbx-scope {
        color: #6b7080;
        font-size: 12px;
        margin: 3px 0 0;
        max-width: 46ch;
      }

      /* ---------------- mailboxes ---------------- */
      .mbx-boxes {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
        margin-bottom: 10px;
      }
      .mbx-box-chip {
        position: relative;
        display: inline-flex;
        align-items: stretch;
      }
      .mbx-box-chip .mbx-chip {
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
        border-right: 0;
      }
      .mbx-more {
        background: #101219;
        border: 1px solid #262a35;
        border-left: 0;
        border-radius: 0 8px 8px 0;
        color: #6b7080;
        font-family: inherit;
        font-size: 13px;
        line-height: 1;
        padding: 0 9px;
        cursor: pointer;
      }
      .mbx-more:hover {
        border-color: #3a4052;
        color: #c4c7d2;
      }
      /* Dashed, because it is an invitation rather than a state. Same
         vocabulary as the dashed roster entry on the Social desk. */
      .mbx-chip.mbx-add {
        border-style: dashed;
        border-left-style: dashed;
        color: #8b90a0;
      }
      .mbx-chip.mbx-add::before {
        content: "+";
        color: #6b7080;
      }
      .mbx-menu {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        z-index: 30;
        min-width: 232px;
        background: #15171e;
        border: 1px solid #2b3040;
        border-radius: 10px;
        padding: 5px;
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .mbx-menu button {
        text-align: left;
        background: transparent;
        border: 0;
        border-radius: 7px;
        color: #c4c7d2;
        font-family: inherit;
        font-size: 12.5px;
        padding: 8px 10px;
        cursor: pointer;
      }
      .mbx-menu button:hover:not(:disabled) {
        background: #1c1f29;
        color: #e7e8ee;
      }
      /* The destructive item is red INSIDE the menu rather than being a third
         equal-weight ghost button in the row -- the shape that gets
         misclicked. Same call as the Tasks shelf menu. */
      .mbx-menu button.mbx-danger {
        color: #ff6b6b;
      }
      .mbx-menu button.mbx-danger:hover:not(:disabled) {
        background: #2a1417;
        color: #ff8f8f;
      }
      /* The Add chip is the last thing in the row, so a left-anchored menu
         hangs off the right edge of the panel. Measured at 1440px: it reached
         past the container. */
      .mbx-box-chip:last-child .mbx-menu {
        left: auto;
        right: 0;
      }
      .mbx-menu-note {
        margin: 2px 0;
        padding: 6px 10px;
        font-size: 11.5px;
        line-height: 1.5;
        color: #6b7080;
      }

      /* ---------------- lens ---------------- */
      .mbx-lens {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
        margin-bottom: 12px;
      }
      .mbx-find {
        flex: 1;
        min-width: 180px;
      }
      .mbx-chip {
        background: #101219;
        border: 1px solid #262a35;
        border-left: 3px solid #262a35;
        border-radius: 8px;
        color: #c4c7d2;
        padding: 7px 11px;
        font-size: 12.5px;
        font-family: inherit;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .mbx-chip:hover {
        border-color: #3a4052;
        border-left-color: #3a4052;
      }
      .mbx-chip.on {
        border-left-color: #ffb020;
        color: #e7e8ee;
      }
      .mbx-chip.mbx-gone {
        border-left-color: #ff6b6b;
        color: #ff6b6b;
      }
      .mbx-chip em {
        font-style: normal;
        color: #6b7080;
        font-size: 11px;
      }
      .mbx-chip.on em {
        color: #8b90a0;
      }

      /* ---------------- the stream ---------------- */
      .mbx-stream {
        border: 1px solid #262a35;
        border-radius: 10px;
        background: #0f1117;
        overflow: hidden;
        max-height: 70vh;
        overflow-y: auto;
      }
      .mbx-row {
        display: block;
        width: 100%;
        text-align: left;
        background: transparent;
        border: 0;
        border-left: 3px solid transparent;
        border-bottom: 1px solid #1a1d27;
        padding: 11px 13px;
        cursor: pointer;
        font-family: inherit;
        color: #c4c7d2;
      }
      .mbx-row:last-child {
        border-bottom: 0;
      }
      .mbx-row:hover {
        background: #12141c;
      }
      .mbx-row:focus-visible {
        outline: 2px solid #ffb020;
        outline-offset: -2px;
      }
      .mbx-row.unread {
        border-left-color: #ffb020;
      }
      .mbx-row.open {
        background: #161a24;
      }
      .mbx-row-top {
        display: flex;
        align-items: baseline;
        gap: 10px;
      }
      /* These are spans inside a block button, so they are inline until told
         otherwise -- which ran the mailbox address straight into the subject
         on one line. */
      .mbx-box,
      .mbx-subj {
        display: block;
      }
      .mbx-who {
        font-size: 13.5px;
        color: #c4c7d2;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .mbx-row.unread .mbx-who {
        color: #e7e8ee;
        font-weight: 600;
      }
      .mbx-ago {
        font-size: 11px;
        color: #6b7080;
        flex: none;
      }
      /* Mono is this admin's mark for an identifier you would copy, and an
         e-mail address is the purest one in the whole product. It is also how
         a MERGED stream says which mailbox a message landed in — the Tasks
         board can spend position on that, a merged list has no position to
         spend. */
      .mbx-box {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 10.5px;
        color: #6b7080;
        margin-top: 2px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .mbx-subj {
        font-size: 12.5px;
        margin-top: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .mbx-row.unread .mbx-subj {
        color: #e7e8ee;
      }
      .mbx-subj span {
        color: #6b7080;
        margin-left: 4px;
      }
      .mbx-clip {
        color: #8b90a0;
        font-size: 10px;
      }

      /* ---------------- the desk ---------------- */
      .mbx-desk {
        border: 1px solid #262a35;
        border-radius: 10px;
        background: #0f1117;
        padding: 18px;
        min-height: 300px;
      }
      .mbx-back {
        display: none;
      }
      @media (max-width: 980px) {
        .mbx-back {
          display: inline-block;
          margin-bottom: 12px;
        }
      }
      .mbx-subject {
        font-family: "Space Grotesk", "Inter", sans-serif;
        font-size: 20px;
        font-weight: 600;
        color: #e7e8ee;
        margin: 0 0 10px;
        line-height: 1.3;
        letter-spacing: -0.01em;
      }
      .mbx-meta {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        align-items: baseline;
        font-size: 12.5px;
        color: #8b90a0;
        padding-bottom: 12px;
        border-bottom: 1px solid #262a35;
      }
      .mbx-meta .mbx-addr {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11px;
        color: #6b7080;
      }
      .mbx-meta .mbx-at {
        margin-left: auto;
      }
      .mbx-body {
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 13.5px;
        line-height: 1.65;
        color: #c4c7d2;
        max-width: 68ch;
        padding: 14px 0;
      }
      .mbx-acts {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        padding-top: 12px;
        border-top: 1px solid #262a35;
      }

      /* ---------------- writing ---------------- */
      .mbx-form {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      /* A flex child in a column stretches, so the disclosure button was as
         wide as the message field. */
      .mbx-form > button.admin-ghost {
        align-self: flex-start;
      }
      .mbx-field label {
        display: block;
        font-size: 12px;
        color: #8b90a0;
        margin-bottom: 4px;
      }
      .mbx-field input.admin-input,
      .mbx-field select.admin-input {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12.5px;
      }
      .mbx-field.mbx-plain input.admin-input {
        font-family: inherit;
        font-size: 14px;
      }
      .mbx-two {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      @media (max-width: 720px) {
        .mbx-two {
          grid-template-columns: 1fr;
        }
      }
      textarea.mbx-write {
        font-family: inherit;
        font-size: 14px;
        line-height: 1.6;
        min-height: 180px;
      }

      /* THE ONE BOLD ELEMENT.
         The unrecoverable mistake in a multi-account mailbox is not the
         service, it is the ADDRESS — a reply sent from the wrong one cannot be
         taken back and arrives wearing the owner's name. So the sending
         address is the largest thing on the composer, it is set in mono
         because it is an identifier, and it is the only thing on this panel
         that animates: it moves when, and only when, who you are about to be
         has changed. */
      .mbx-outbound {
        border-top: 1px solid #262a35;
        padding-top: 14px;
        margin-top: 4px;
      }
      .mbx-as {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 19px;
        color: #e7e8ee;
        letter-spacing: -0.02em;
        display: block;
        word-break: break-all;
      }
      .mbx-as-lede {
        font-size: 12px;
        color: #8b90a0;
        display: block;
        margin-bottom: 2px;
      }
      /* Written AFTER the base rule and at the same specificity, because
         .so-handle.so-addr once beat a media query written against
         .so-handle alone and an address stayed at its desktop size on a
         390px screen. A 50-character address at 17px is most of a phone. */
      /* 17px and not less: below 720px every .admin-input is 16px so iOS does
         not zoom the page on focus, and an element that is the same size as a
         form field is not the boldest thing on the form. Measured at 390px --
         at 15px the address lost to the Subject box. A long address wraps on
         break-all instead, which is the right trade: the address is the point.
      */
      @media (max-width: 720px) {
        .mbx-as {
          font-size: 17px;
        }
      }
      .mbx-as.mbx-swap {
        animation: mbx-swap 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      @keyframes mbx-swap {
        from {
          opacity: 0;
          transform: translateX(-10px);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .mbx-as.mbx-swap {
          animation: none;
        }
      }
      .mbx-go {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
        margin-top: 12px;
      }
      /* The review is not a dialog, it is the step that MAKES the send button
         exist. Until the exact bytes have been on screen there is nothing to
         press, and editing anything afterwards takes the button away again. */
      .mbx-review {
        margin-top: 12px;
        border: 1px dashed #4a5065;
        border-radius: 10px;
        background: #0d0e13;
        padding: 13px;
      }
      .mbx-review h4 {
        margin: 0 0 8px;
        font-size: 12px;
        color: #8b90a0;
        font-weight: 500;
      }
      .mbx-review dl {
        margin: 0 0 10px;
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 3px 12px;
        font-size: 12px;
      }
      .mbx-review dt {
        color: #6b7080;
      }
      .mbx-review dd {
        margin: 0;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11.5px;
        color: #c4c7d2;
        word-break: break-all;
      }
      .mbx-review pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 12px;
        line-height: 1.6;
        color: #c4c7d2;
        max-height: 220px;
        overflow: auto;
      }

      /* ---------------- states ---------------- */
      .mbx-note {
        border: 1px solid #262a35;
        border-left: 3px solid #ff6b6b;
        border-radius: 8px;
        background: #101219;
        padding: 10px 12px;
        font-size: 12.5px;
        color: #c4c7d2;
        margin-bottom: 12px;
      }
      .mbx-note b {
        color: #e7e8ee;
      }
      .mbx-empty {
        padding: 34px 18px;
        text-align: left;
        color: #8b90a0;
        font-size: 13px;
        line-height: 1.6;
      }
      .mbx-empty h3 {
        font-family: "Space Grotesk", "Inter", sans-serif;
        font-size: 17px;
        color: #e7e8ee;
        margin: 0 0 6px;
      }
      .mbx-empty p {
        margin: 0 0 14px;
        max-width: 54ch;
      }
      .mbx-connect {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      /* A service with no credentials on this deployment is not a button.
         There is nothing there to press, and a disabled button implies a
         permission you could go and fix. */
      .mbx-unset {
        border: 1px dashed #3a4052;
        border-radius: 8px;
        padding: 9px 13px;
        font-size: 12px;
        color: #6b7080;
      }
      .mbx-unset code {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        color: #8b90a0;
      }
      .mbx-sending {
        color: #ffb020;
        font-size: 12.5px;
      }
      .mbx-done {
        color: #4ed0c0;
        font-size: 12.5px;
      }
    `}</style>
  );
}
