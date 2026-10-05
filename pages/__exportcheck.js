// Does the cross-post renderer actually produce usable files?
//
// The pure half of cross-posting (what the Markdown should say) is covered by
// npm run test:markdown. This is the half that can only be checked in a
// browser: mermaid laid out and rasterised to WebP, and a p5 sketch recorded
// to WebM through a sandboxed frame that hands its own pixels back.
//
// It renders but never uploads and never publishes, so running it costs
// nothing and touches neither storage nor dev.to.
//
// 404s in production: it is a test harness, not a page.
import React, { useEffect, useState } from "react";
import { listPortableBlocks, toPortableMarkdown } from "../lib/server/portableMarkdown";

const SAMPLE = [
  "Inline $E = mc^2$ and a display line:",
  "",
  "$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$",
  "",
  "```mermaid",
  "flowchart LR",
  "  A[Write] --> B{Cross-post?}",
  "  B -->|yes| C[Render WebP]",
  "  B -->|no| D[Nothing stored]",
  "```",
  "",
  "```d3 height=240",
  'const svg = d3.select(el).append("svg").attr("width", 400).attr("height", 200);',
  'svg.selectAll("rect").data([30, 70, 45, 90]).join("rect")',
  '  .attr("x", (d, i) => i * 90 + 10).attr("y", d => 180 - d)',
  '  .attr("width", 70).attr("height", d => d).attr("fill", "#FFB020");',
  "```",
  "",
  "```p5 height=200",
  "let t = 0;",
  "function setup(){ createCanvas(400, 200); noStroke(); }",
  "function draw(){ background(255); t += 0.05; fill(255,176,32);",
  "  circle(200 + Math.cos(t) * 90, 100, 40); }",
  "```",
].join("\n");

// Fraction of pixels that are not the white background.
async function inkOf(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = Math.min(240, bmp.width);
  c.height = Math.min(240, bmp.height);
  const cx = c.getContext("2d");
  cx.drawImage(bmp, 0, 0, c.width, c.height);
  const { data } = cx.getImageData(0, 0, c.width, c.height);
  let marked = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) marked++;
  }
  return marked / (data.length / 4);
}

export default function ExportCheck() {
  const [rows, setRows] = useState([]);
  const [done, setDone] = useState(false);
  const [markdown, setMarkdown] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Imported lazily: this page is the only thing that needs the renderer.
      const { renderBlockForExport } = await import("../lib/devtoAssets");
      const blocks = listPortableBlocks(SAMPLE);
      const out = [];
      const assets = {};
      for (const b of blocks) {
        try {
          const file = await renderBlockForExport(b);
          // Count the non-white pixels: a canvas that encodes to a valid WebP
          // and is entirely blank is the failure this check exists to catch.
          const ink = await inkOf(file.blob);
          out.push({
            kind: b.kind,
            id: b.id,
            type: file.contentType,
            ext: file.ext,
            bytes: file.blob.size,
            ink,
            preview: URL.createObjectURL(file.blob),
            videoBytes: file.video ? file.video.blob.size : 0,
            videoType: file.video ? file.video.contentType : "",
            ok: file.blob.size > 500 && ink > 0.002,
          });
          assets[b.id] = file.video
            ? {
                image: `https://ravikishan.me/api/media/devto/${b.id}.${file.ext}`,
                video: `https://ravikishan.me/api/media/devto/${b.id}-motion.${file.video.ext}`,
              }
            : `https://ravikishan.me/api/media/devto/${b.id}.${file.ext}`;
        } catch (e) {
          out.push({ kind: b.kind, id: b.id, error: e?.message || "failed", ok: false });
        }
        if (cancelled) return;
        setRows([...out]);
      }
      const portable = toPortableMarkdown(SAMPLE, {
        assets,
        canonicalUrl: "https://ravikishan.me/blog/sample",
      });
      if (cancelled) return;
      setMarkdown(portable.markdown);
      setDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ padding: 28, fontFamily: "Inter, system-ui, sans-serif", maxWidth: 900 }}>
      <h1 style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Cross-post export check</h1>
      <p style={{ color: "#5b6472" }}>
        Renders every block this site can draw but dev.to cannot, and shows what each one weighs.
        Nothing is uploaded and nothing is published.
      </p>

      <ul id="export-rows" style={{ listStyle: "none", padding: 0 }}>
        {rows.map((r) => (
          <li
            key={r.id}
            data-kind={r.kind}
            data-ok={r.ok ? "1" : "0"}
            data-type={r.type || ""}
            data-bytes={r.bytes || 0}
            data-ink={r.ink ? r.ink.toFixed(4) : "0"}
            data-video-bytes={r.videoBytes || 0}
            style={{
              border: "1px solid #e4e7ec",
              borderLeft: `3px solid ${r.ok ? "#FFB020" : "#d23"}`,
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 8,
              fontSize: 14,
            }}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {r.preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.preview}
                  alt=""
                  style={{ width: 120, height: 70, objectFit: "contain", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6 }}
                />
              )}
              <div>
                <strong>{r.kind}</strong>{" "}
                {r.ok ? (
                  <span style={{ color: "#5b6472" }}>
                    {r.type} · {Math.round(r.bytes / 1024)} KB · {(r.ink * 100).toFixed(1)}% ink
                    {r.videoBytes
                      ? ` · video ${Math.round(r.videoBytes / 1024)} KB`
                      : r.kind === "p5"
                      ? " · no video recorded"
                      : ""}
                  </span>
                ) : (
                  <span style={{ color: "#d23" }}>{r.error || "blank or empty output"}</span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <p id="export-done" data-done={done ? "1" : "0"} style={{ color: "#5b6472", fontSize: 13 }}>
        {done ? "Finished." : "Rendering…"}
      </p>

      {markdown && (
        <>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18 }}>
            What dev.to would receive
          </h2>
          <pre
            id="export-markdown"
            style={{
              background: "#0a0b0f",
              color: "#eceef3",
              padding: 16,
              borderRadius: 10,
              overflowX: "auto",
              fontSize: 12.5,
              lineHeight: 1.6,
            }}
          >
            {markdown}
          </pre>
        </>
      )}
    </main>
  );
}

export async function getStaticProps() {
  if (process.env.NODE_ENV === "production") return { notFound: true };
  return { props: {} };
}
