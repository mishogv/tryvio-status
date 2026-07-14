// Independent status checker for status.tryvio.ai. Runs on GitHub Actions (a SEPARATE failure
// domain from Vercel): if all of Tryvio's own infra is down, this still runs and reports it.
// Pings each monitor, appends to history.json (capped), and regenerates index.html. No secrets —
// it only hits public endpoints.
import { readFile, writeFile } from "node:fs/promises";

const MONITORS = [
  { id: "marketing", name: "Marketing site (tryvio.ai)", url: "https://tryvio.ai", expect: 200 },
  { id: "app", name: "App (app.tryvio.ai)", url: "https://app.tryvio.ai/api/health", expect: 200 },
  { id: "deep", name: "App deep health", url: "https://app.tryvio.ai/api/health/deep", expect: 200, degradedOn: 503 },
  { id: "docs", name: "Docs (docs.tryvio.ai)", url: "https://docs.tryvio.ai", expect: 200 },
];

const HISTORY_FILE = new URL("./history.json", import.meta.url);
const INDEX_FILE = new URL("./index.html", import.meta.url);
const MAX_POINTS = 288; // ~2 days at 10-min cadence

async function probe(m) {
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(m.url, { redirect: "follow", signal: ctrl.signal, headers: { "user-agent": "tryvio-status/1" } });
    clearTimeout(t);
    const ms = Date.now() - started;
    const status = m.degradedOn && res.status === m.degradedOn ? "degraded" : res.ok || res.status === m.expect ? "up" : "down";
    return { ts: new Date().toISOString(), status, code: res.status, ms };
  } catch (err) {
    return { ts: new Date().toISOString(), status: "down", code: 0, ms: Date.now() - started, error: String(err?.message || err) };
  }
}

async function loadHistory() {
  try {
    return JSON.parse(await readFile(HISTORY_FILE, "utf8"));
  } catch {
    return {};
  }
}

function uptimePct(points) {
  if (!points.length) return null;
  const good = points.filter((p) => p.status !== "down").length;
  return Math.round((good / points.length) * 1000) / 10;
}

function overall(latest) {
  if (Object.values(latest).some((p) => p.status === "down")) return "down";
  if (Object.values(latest).some((p) => p.status === "degraded")) return "degraded";
  return "up";
}

function badge(status) {
  const map = { up: ["#059669", "Operational"], degraded: ["#D97706", "Degraded"], down: ["#DC2626", "Down"] };
  const [color, label] = map[status] || map.down;
  return `<span style="display:inline-flex;align-items:center;gap:8px;font-weight:700;color:${color}">
    <span style="width:11px;height:11px;border-radius:50%;background:${color};display:inline-block"></span>${label}</span>`;
}

function render(history, latest) {
  const o = overall(latest);
  const headline = { up: "All systems operational", degraded: "Partial degradation", down: "Major outage" }[o];
  const rows = MONITORS.map((m) => {
    const pts = history[m.id] || [];
    const cur = latest[m.id];
    const spark = pts.slice(-60).map((p) => {
      const c = p.status === "up" ? "#059669" : p.status === "degraded" ? "#D97706" : "#DC2626";
      return `<span title="${p.ts} · ${p.code}" style="width:4px;height:22px;background:${c};border-radius:1px;display:inline-block"></span>`;
    }).join("");
    return `<tr style="border-top:1px solid #E5E7EB">
      <td style="padding:14px 8px;font-weight:600">${m.name}</td>
      <td style="padding:14px 8px">${badge(cur.status)}</td>
      <td style="padding:14px 8px;color:#6B7280;font-variant-numeric:tabular-nums">${uptimePct(pts) ?? "—"}%</td>
      <td style="padding:14px 8px;color:#6B7280;font-variant-numeric:tabular-nums">${cur.ms} ms</td>
      <td style="padding:14px 8px;display:flex;gap:2px;align-items:flex-end">${spark}</td>
    </tr>`;
  }).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tryvio Status</title>
<style>@media (prefers-color-scheme: dark){body{background:#0B0B14;color:#E5E7EB}table{background:#15151F!important}}</style>
</head><body style="margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#F9F8FF;color:#1E1B4B">
<div style="max-width:760px;margin:0 auto;padding:40px 20px">
  <div style="display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px;margin-bottom:28px">
    <span style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#7C3AED,#C026D3);color:#fff;text-align:center;line-height:28px">T</span>
    Tryvio Status
  </div>
  <div style="font-size:26px;font-weight:800;margin-bottom:6px">${headline}</div>
  <div style="color:#6B7280;margin-bottom:24px">Last checked ${new Date().toISOString().replace("T"," ").slice(0,16)} UTC · refreshes every 10 min</div>
  <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
    <thead><tr style="text-align:left;color:#9CA3AF;font-size:12px;text-transform:uppercase">
      <th style="padding:12px 8px">Service</th><th style="padding:12px 8px">Status</th><th style="padding:12px 8px">Uptime</th><th style="padding:12px 8px">Latency</th><th style="padding:12px 8px">Recent</th>
    </tr></thead><tbody>${rows}</tbody>
  </table>
  <div style="color:#9CA3AF;font-size:12px;margin-top:20px">Hosted on GitHub Pages — independent of Tryvio's own infrastructure, so it stays up during an outage.</div>
</div></body></html>`;
}

const history = await loadHistory();
const latest = {};
for (const m of MONITORS) {
  const point = await probe(m);
  latest[m.id] = point;
  history[m.id] = [...(history[m.id] || []), point].slice(-MAX_POINTS);
  console.log(`${m.id}: ${point.status} (${point.code}, ${point.ms}ms)`);
}
await writeFile(HISTORY_FILE, JSON.stringify(history));
await writeFile(INDEX_FILE, render(history, latest));
console.log(`overall: ${overall(latest)}`);
