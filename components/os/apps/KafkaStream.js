import React, { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";

// Kafka event stream — topics + a live scrolling event feed. Grounded in real
// work (RelaxTube runs a Kafka transcoding pipeline). Deterministic-free live
// generation; SSR-safe because the feed starts empty.
const TOPICS = {
  "user-events": { color: "#818CF8", events: ["UserSignedUp", "UserLoggedIn", "ProfileUpdated", "SessionStarted"] },
  payments: { color: "#34D399", events: ["PaymentReceived", "InvoicePaid", "RefundIssued"] },
  notifications: { color: "#FBBF24", events: ["EmailSent", "PushDelivered", "SmsQueued"] },
  "video-transcode": { color: "#F472B6", events: ["SegmentTranscoded", "ThumbnailGenerated", "StreamStarted", "HlsPacked"] },
};
const NAMES = Object.keys(TOPICS);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export default function KafkaStream() {
  const [feed, setFeed] = useState([]);
  const [count, setCount] = useState(0);
  const [rate, setRate] = useState(0);
  const offsets = useRef({});
  const idRef = useRef(0);
  const win = useRef([]);

  useEffect(() => {
    const id = setInterval(() => {
      const topic = pick(NAMES);
      offsets.current[topic] = (offsets.current[topic] || 1000) + 1;
      const ev = {
        id: ++idRef.current,
        topic,
        color: TOPICS[topic].color,
        type: pick(TOPICS[topic].events),
        partition: Math.floor(Math.random() * 3),
        offset: offsets.current[topic],
        key: "usr_" + (1000 + Math.floor(Math.random() * 8999)),
      };
      setFeed((f) => [ev, ...f].slice(0, 16));
      setCount((c) => c + 1);
      const now = Date.now ? 0 : 0; // no Date.now in some sandboxes; use tick count
      win.current.push(idRef.current);
      if (win.current.length > 20) win.current.shift();
      setRate(Math.round(1000 / 550)); // ~1 msg per 550ms → ~1.8/s baseline shown live below
    }, 550);
    const rid = setInterval(() => setRate(2 + Math.floor(Math.random() * 4)), 900);
    return () => { clearInterval(id); clearInterval(rid); };
  }, []);

  return (
    <div className="kf">
      <div className="kf-head">
        <span className="kf-brand"><Radio className="h-3.5 w-3.5" /> kafka <span className="kf-dim">· broker-0:9092</span></span>
        <span className="kf-metrics">
          <b style={{ color: "#4ED0C0" }}>{rate}</b> msg/s · <b>{count}</b> total · 4 topics · 3 partitions
        </span>
      </div>

      <div className="kf-body">
        <div className="kf-topics">
          {NAMES.map((t) => (
            <div className="kf-topic" key={t}>
              <span className="kf-tdot" style={{ background: TOPICS[t].color }} />
              <span className="kf-tname">{t}</span>
              <span className="kf-toff">@{offsets.current[t] || 1000}</span>
            </div>
          ))}
        </div>

        <div className="kf-feed">
          {feed.length === 0 && <div className="kf-empty">waiting for events…</div>}
          {feed.map((e, i) => (
            <div className="kf-ev" key={e.id} style={{ opacity: Math.max(0.25, 1 - i * 0.05) }}>
              <span className="kf-topic-tag" style={{ color: e.color, borderColor: e.color + "55" }}>{e.topic}</span>
              <span className="kf-type">{e.type}</span>
              <span className="kf-meta">p{e.partition} · off {e.offset}</span>
              <span className="kf-key">{e.key}</span>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .kf { height: 100%; display: flex; flex-direction: column; background: #0a0b0f; color: #c4c7d2; font-family: "JetBrains Mono", monospace; font-size: 12px; }
        .kf-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid #1a1d26; }
        .kf-brand { display: flex; align-items: center; gap: 7px; color: #e7e8ee; }
        .kf-dim { color: #5b6070; }
        .kf-metrics { color: #7a8090; font-size: 11px; }
        .kf-metrics b { color: #e7e8ee; }
        .kf-body { flex: 1; display: grid; grid-template-columns: 180px 1fr; min-height: 0; }
        .kf-topics { border-right: 1px solid #1a1d26; padding: 10px; display: flex; flex-direction: column; gap: 4px; }
        .kf-topic { display: flex; align-items: center; gap: 7px; padding: 5px 6px; border-radius: 5px; }
        .kf-topic:hover { background: #14161c; }
        .kf-tdot { height: 8px; width: 8px; border-radius: 2px; }
        .kf-tname { color: #c4c7d2; font-size: 11px; }
        .kf-toff { margin-left: auto; color: #5b6070; font-size: 10px; }
        .kf-feed { overflow-y: auto; padding: 8px 12px; display: flex; flex-direction: column; gap: 3px; }
        .kf-empty { color: #5b6070; padding: 20px 0; text-align: center; }
        .kf-ev { display: grid; grid-template-columns: 130px 1fr auto auto; align-items: center; gap: 10px; padding: 4px 0; font-size: 11px; animation: kfin .3s ease; }
        @keyframes kfin { from { opacity: 0; transform: translateY(-4px); } }
        .kf-topic-tag { border: 1px solid; border-radius: 4px; padding: 1px 6px; font-size: 10px; }
        .kf-type { color: #e7e8ee; }
        .kf-meta { color: #5b6070; font-size: 10px; }
        .kf-key { color: #7a8090; font-size: 10px; }
        @media (max-width: 620px) { .kf-body { grid-template-columns: 1fr; } .kf-topics { flex-direction: row; flex-wrap: wrap; border-right: none; border-bottom: 1px solid #1a1d26; } }
      `}</style>
    </div>
  );
}
