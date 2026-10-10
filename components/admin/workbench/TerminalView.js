// A shell on the box, in the browser.
//
// Opening one is a deliberate act — a button, not something that happens when
// the view is shown — and it needs a sign-in from the last 30 minutes, the same
// step-up as opening a vault document: a shell is the widest door there is.
// When the server refuses for that reason the view says so and offers the
// sign-in where the shell would have been, rather than reporting an error.
//
// What the shell prints comes back to THIS socket only; the server never
// broadcasts a terminal. Every command line you enter is written to the
// review timeline.
//
// xterm.js is loaded on demand, in the browser only.
import React, { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { reauthenticate } from "../../../lib/reauth";

export const needsFreshSignIn = (e) =>
  !!e && (e.status === 401 || e.status === 403 || /fresh|recent sign|sign in again|step.?up|auth_time/i.test(`${e.code} ${e.message}`));

const THEME = {
  background: "#08090d",
  foreground: "#e9ebf2",
  cursor: "#ffb020",
  cursorAccent: "#08090d",
  selectionBackground: "rgba(255, 176, 32, 0.28)",
  black: "#171a22",
  brightBlack: "#5c6377",
};

export default function TerminalView({ client = null, connected = false, subscribe = () => () => {} }) {
  const host = useRef(null);
  const term = useRef(null);
  const fit = useRef(null);
  const id = useRef("");
  const off = useRef(() => {});
  const [state, setState] = useState("idle"); // idle | opening | open | auth | closed | failed
  const [why, setWhy] = useState("");
  const [cwd, setCwd] = useState("");

  const teardown = () => {
    off.current();
    off.current = () => {};
    if (id.current && client) {
      try {
        client.termClose(id.current);
      } catch (_) {}
    }
    id.current = "";
    term.current?.dispose();
    term.current = null;
  };

  useEffect(() => teardown, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The socket dropping ends the shell on the server's side too.
  useEffect(() => {
    if (!connected && id.current) {
      off.current();
      id.current = "";
      setState("closed");
      setWhy("The connection to the agent server dropped, so the shell ended.");
    }
  }, [connected]);

  const open = async () => {
    if (!client || !connected) return;
    setState("opening");
    setWhy("");
    try {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      term.current?.dispose();
      const t = new Terminal({
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 13,
        cursorBlink: true,
        convertEol: false,
        scrollback: 5000,
        theme: THEME,
      });
      const f = new FitAddon();
      t.loadAddon(f);
      t.open(host.current);
      f.fit();
      term.current = t;
      fit.current = f;

      const res = await client.termOpen({ cols: t.cols, rows: t.rows, cwd: cwd.trim() || undefined });
      id.current = res.termId;
      off.current = subscribe(res.termId, (m) => {
        if (m.type === "term.output") t.write(m.data);
        if (m.type === "term.exit" || m.type === "term.closed") {
          setState("closed");
          setWhy(m.code != null ? `The shell exited with code ${m.code}.` : "The shell ended.");
          id.current = "";
        }
      });
      t.onData((d) => {
        try {
          if (id.current) client.termInput(id.current, d);
        } catch (_) {}
      });
      t.onResize(({ cols, rows }) => {
        try {
          if (id.current) client.termResize(id.current, cols, rows);
        } catch (_) {}
      });
      setState("open");
      t.focus();
    } catch (e) {
      term.current?.dispose();
      term.current = null;
      if (needsFreshSignIn(e)) {
        setState("auth");
        setWhy("A shell needs a sign-in from the last 30 minutes. Confirm it is you, then open it again.");
      } else {
        setState("failed");
        setWhy(e.message);
      }
    }
  };

  const stepUp = async () => {
    try {
      await reauthenticate();
      await client.reauth();
      await open();
    } catch (e) {
      setState("auth");
      setWhy(`Not confirmed: ${e.message}`);
    }
  };

  // Keep the grid matched to the box it sits in.
  useEffect(() => {
    if (state !== "open" || !host.current || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => {
      try {
        fit.current?.fit();
      } catch (_) {}
    });
    ro.observe(host.current);
    return () => ro.disconnect();
  }, [state]);

  const close = () => {
    teardown();
    setState("closed");
    setWhy("You closed the shell.");
  };

  const word = !connected
    ? "Not connected to the agent server."
    : state === "open"
    ? "Shell open. Output reaches only this window."
    : state === "opening"
    ? "Opening a shell…"
    : why || "No shell open.";

  return (
    <div className={`wb-term is-${state}`}>
      <div className="wb-desk-bar">
        <p className={`wb-drive${state === "auth" ? " ask" : ""}`} role="status" aria-live="polite">
          {word}
        </p>
        <div className="wb-desk-btns">
          {state === "open" ? (
            <button type="button" className="ag-stop" onClick={close}>
              Close shell
            </button>
          ) : state === "auth" ? (
            <button type="button" className="admin-primary" onClick={stepUp} disabled={!connected}>
              Confirm it is you
            </button>
          ) : (
            <>
              <input
                className="admin-input wb-cwd"
                placeholder="Start in (optional) e.g. ~/work"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                disabled={!connected || state === "opening"}
                aria-label="Folder to start the shell in"
                spellCheck={false}
                autoComplete="off"
              />
              <button type="button" className="admin-primary" onClick={open} disabled={!connected || state === "opening"}>
                {state === "opening" ? "Opening…" : "Open a shell"}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="wb-term-frame">
        <div ref={host} className="wb-term-host" />
        {state !== "open" && state !== "opening" ? (
          <div className="wb-screen-empty">
            <p>
              {!connected
                ? "The shell appears here once the agent server is connected."
                : "A login shell as the agent user. Every command line you enter is recorded in Review."}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
