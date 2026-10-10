// Apps the agent started on the box, opened here without opening a port.
//
// The list is what is LISTENING on the box as the agent user, read from the
// box itself, not what anyone said they started. Opening one mints a
// short-lived grant over the authenticated socket and loads the app through
// agentd's proxy; when the grant runs out the frame says so instead of showing
// a login page from nowhere.
import React, { useEffect, useState } from "react";

export default function PreviewsView({ client = null, connected = false, ports = [], loading = false, now = 0, onRefresh = () => {}, initialOpen = null }) {
  const [open, setOpen] = useState(initialOpen); // { port, url, expiresAt }
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState("");
  const [manual, setManual] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (connected) onRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const go = async (port, { newWindow = false } = {}) => {
    const p = Number(port);
    if (!client || !Number.isInteger(p) || p < 1024 || p > 65535) {
      setErr("A preview port is a number between 1024 and 65535.");
      return;
    }
    setBusy(p);
    setErr("");
    // Opened before the await, or a popup blocker treats it as unrequested.
    const w = newWindow ? window.open("about:blank", "_blank") : null;
    try {
      const res = await client.previewOpen(p);
      if (!res?.url) throw new Error("The agent server sent no preview address.");
      if (w) {
        w.opener = null;
        w.location.href = res.url;
      } else setOpen({ port: p, url: res.url, expiresAt: res.expiresAt || 0 });
    } catch (e) {
      w?.close();
      setErr(e.message);
    } finally {
      setBusy(0);
    }
  };

  const left = open?.expiresAt && now ? open.expiresAt - now : null;
  const expired = left !== null && left <= 0;

  return (
    <div className="wb-prev">
      <div className="wb-desk-bar">
        <p className="wb-drive">
          {!connected
            ? "Not connected to the agent server."
            : loading
            ? "Reading what is listening on the box…"
            : `${ports.length} app${ports.length === 1 ? "" : "s"} listening on the box.`}
        </p>
        <div className="wb-desk-btns">
          <button type="button" className="ag-ghost" onClick={onRefresh} disabled={!connected || loading}>
            Refresh
          </button>
        </div>
      </div>
      {err ? (
        <p className="admin-err wb-err" role="alert">
          {err}
        </p>
      ) : null}

      <div className="wb-ports">
        {ports.map((p) => (
          <div key={p.port} className={`wb-port${open?.port === p.port ? " on" : ""}`} data-port={p.port}>
            <code className="wb-port-n">:{p.port}</code>
            <span className="wb-port-what">{p.process || p.command || p.name || "unknown process"}</span>
            <span className="wb-port-btns">
              <button type="button" className="ag-ghost" disabled={!connected || busy === p.port} onClick={() => go(p.port)}>
                {busy === p.port ? "Opening…" : "Open here"}
              </button>
              <button type="button" className="ag-ghost" disabled={!connected || busy === p.port} onClick={() => go(p.port, { newWindow: true })}>
                New window
              </button>
            </span>
          </div>
        ))}
        {connected && !loading && !ports.length ? (
          <p className="wb-empty">Nothing is listening yet. Ask a chat to start a dev server, then refresh.</p>
        ) : null}
        <form
          className="wb-clip"
          onSubmit={(e) => {
            e.preventDefault();
            go(manual);
          }}
        >
          <input
            className="admin-input"
            inputMode="numeric"
            placeholder="Another port, e.g. 5173"
            value={manual}
            onChange={(e) => setManual(e.target.value.replace(/\D/g, "").slice(0, 5))}
            disabled={!connected}
            aria-label="Port to open"
          />
          <button type="submit" className="ag-ghost" disabled={!connected || !manual}>
            Open port
          </button>
        </form>
      </div>

      {open ? (
        <section className="wb-pframe" aria-label={`Preview of port ${open.port}`}>
          <header>
            <code>:{open.port}</code>
            <span className={`wb-pexp${expired ? " bad" : ""}`}>
              {left === null ? "" : expired ? "Access expired. Open it again." : `Access for ${Math.ceil(left / 60000)} more min`}
            </span>
            <span className="wb-port-btns">
              <button type="button" className="ag-ghost" onClick={() => (expired ? go(open.port) : setNonce((n) => n + 1))}>
                {expired ? "Open again" : "Reload"}
              </button>
              <a className="ag-ghost wb-alink" href={open.url} target="_blank" rel="noreferrer noopener">
                New window
              </a>
              <button type="button" className="ag-ghost" onClick={() => setOpen(null)}>
                Close
              </button>
            </span>
          </header>
          <iframe
            key={nonce}
            title={`App on port ${open.port}`}
            src={open.url}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            referrerPolicy="no-referrer"
          />
        </section>
      ) : null}
    </div>
  );
}
