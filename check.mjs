// Independent status checker for status.tryvio.ai. Runs on GitHub Actions (a SEPARATE failure
// domain from Vercel): if all of Tryvio's own infra is down, this still runs and reports it.
// Pings each monitor, appends to history.json (capped), and regenerates index.html. No secrets —
// it only hits public endpoints.
import { readFile, writeFile } from "node:fs/promises";

const MONITORS = [
  { id: "marketing", name: "Marketing site", host: "tryvio.ai", url: "https://tryvio.ai", expect: 200 },
  { id: "app", name: "App", host: "app.tryvio.ai", url: "https://app.tryvio.ai/api/health", expect: 200 },
  { id: "deep", name: "App deep health", host: "app.tryvio.ai/api/health/deep", url: "https://app.tryvio.ai/api/health/deep", expect: 200, degradedOn: 503 },
  { id: "docs", name: "Docs", host: "docs.tryvio.ai", url: "https://docs.tryvio.ai", expect: 200 },
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

// ── Theme tokens (light + dark). Neutrals carry a slight violet bias to match the brand. ──
const LIGHT = "--bg:#FBFAFF;--surface:#FFFFFF;--border:#ECE9F6;--text:#18152B;--muted:#6C6784;--faint:#CFCADE;" +
  "--up:#0E9F6E;--up-soft:rgba(14,159,110,.12);--degraded:#D97706;--degraded-soft:rgba(217,119,6,.13);" +
  "--down:#DC2626;--down-soft:rgba(220,38,38,.12);--track:#ECE9F6;--shadow:0 8px 30px rgba(88,58,170,.09);--ring:rgba(124,58,237,.28)";
const DARK = "--bg:#09080F;--surface:#141122;--border:#272238;--text:#ECEAF7;--muted:#9A95B5;--faint:#453F5C;" +
  "--up:#34D399;--up-soft:rgba(52,211,153,.15);--degraded:#FBBF24;--degraded-soft:rgba(251,191,36,.16);" +
  "--down:#F87171;--down-soft:rgba(248,113,113,.15);--track:#272238;--shadow:0 10px 36px rgba(0,0,0,.5);--ring:rgba(168,85,247,.4)";

const SEM = {
  up: ["var(--up)", "var(--up-soft)", "Operational"],
  degraded: ["var(--degraded)", "var(--degraded-soft)", "Degraded"],
  down: ["var(--down)", "var(--down-soft)", "Down"],
};

function render(history, latest) {
  const o = overall(latest);
  const headline = { up: "All systems operational", degraded: "Partial degradation", down: "Major outage" }[o];
  const [heroColor, heroSoft] = SEM[o];

  const rows = MONITORS.map((m) => {
    const pts = history[m.id] || [];
    const cur = latest[m.id];
    const [c, soft, label] = SEM[cur.status] || SEM.down;
    const spark = pts.slice(-40).map((p) => {
      const pc = p.status === "up" ? "var(--up)" : p.status === "degraded" ? "var(--degraded)" : "var(--down)";
      return `<i title="${p.ts} · ${p.code} · ${p.ms}ms" style="height:22px;background:${pc}"></i>`;
    }).join("") || `<i style="height:8px;background:var(--track)"></i>`;
    const up = uptimePct(pts);
    return `<div class="svc" style="--sc:${c};--scs:${soft}">
      <div class="svc-l"><span class="dot"></span><span class="name">${m.name}</span><span class="host">${m.host}</span><span class="pill">${label}</span></div>
      <div class="svc-r">
        <span class="spark" aria-hidden="true">${spark}</span>
        <span class="stat"><b>${up ?? "—"}%</b><i>uptime</i></span>
        <span class="stat"><b>${cur.ms}<small> ms</small></b><i>latency</i></span>
      </div>
    </div>`;
  }).join("");

  const checkedAt = new Date().toISOString().replace("T", " ").slice(0, 16);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Tryvio Status</title>
<script>try{var t=localStorage.getItem('tvth');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
<style>
*{box-sizing:border-box}
:root{${LIGHT};color-scheme:light}
@media(prefers-color-scheme:dark){:root{${DARK};color-scheme:dark}}
:root[data-theme=light]{${LIGHT};color-scheme:light}
:root[data-theme=dark]{${DARK};color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;transition:background .3s ease,color .3s ease}
.wrap{max-width:720px;margin:0 auto;padding:46px 20px 64px}
.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:30px}
.brand{display:flex;align-items:center;gap:11px;font-weight:800;font-size:18px;letter-spacing:-.015em}
.logo{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#7C3AED,#C026D3);color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;box-shadow:0 5px 16px var(--ring)}
.toggle{appearance:none;border:1px solid var(--border);background:var(--surface);color:var(--text);width:38px;height:38px;border-radius:11px;cursor:pointer;font-size:15px;line-height:1;display:flex;align-items:center;justify-content:center;transition:border-color .2s,transform .2s}
.toggle:hover{border-color:var(--faint);transform:translateY(-1px)}
.toggle .sun{display:none}.toggle .moon{display:inline}
@media(prefers-color-scheme:dark){.toggle .moon{display:none}.toggle .sun{display:inline}}
:root[data-theme=light] .toggle .moon{display:inline}:root[data-theme=light] .toggle .sun{display:none}
:root[data-theme=dark] .toggle .moon{display:none}:root[data-theme=dark] .toggle .sun{display:inline}
.hero{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:24px 26px;box-shadow:var(--shadow);margin-bottom:20px}
.hero-row{display:flex;align-items:center;gap:16px}
.beacon{position:relative;width:15px;height:15px;flex:none}
.beacon b{position:absolute;inset:0;border-radius:50%;background:var(--hc)}
.beacon::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--hc);opacity:.5;animation:pulse 2.4s ease-out infinite}
@keyframes pulse{0%{transform:scale(1);opacity:.5}70%{transform:scale(2.8);opacity:0}100%{opacity:0}}
@media(prefers-reduced-motion:reduce){.beacon::after{animation:none}}
.headline{font-size:23px;font-weight:800;letter-spacing:-.02em}
.sub{color:var(--muted);font-size:13px;margin-top:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sub .badge{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;background:var(--hcs);color:var(--hc);font-weight:700;font-size:11.5px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:18px;box-shadow:var(--shadow);overflow:hidden}
.svc{display:flex;align-items:center;gap:14px;padding:16px 22px;flex-wrap:wrap}
.svc+.svc{border-top:1px solid var(--border)}
.svc-l{display:flex;align-items:center;gap:11px;min-width:0}
.dot{width:9px;height:9px;border-radius:50%;flex:none;background:var(--sc);box-shadow:0 0 0 4px var(--scs)}
.name{font-weight:650;font-size:14.5px}
.host{color:var(--faint);font-size:12px;font-variant-numeric:tabular-nums}
.pill{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;color:var(--sc);background:var(--scs)}
.svc-r{display:flex;align-items:center;gap:22px;margin-left:auto}
.stat{text-align:right;line-height:1.15}
.stat b{font-size:14.5px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.stat small{font-size:11px;font-weight:600;color:var(--muted)}
.stat i{display:block;font-style:normal;font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin-top:3px}
.spark{display:inline-flex;gap:2px;align-items:flex-end;height:24px}
.spark i{width:4px;border-radius:2px;display:block}
.foot{color:var(--muted);font-size:12px;margin-top:22px;line-height:1.65;text-align:center}
.foot a{color:var(--text);text-decoration:none;border-bottom:1px solid var(--border)}
@media(max-width:540px){.host{display:none}.svc-r{width:100%;margin-left:0;justify-content:space-between;gap:14px}.spark{order:3;flex:1;justify-content:flex-end}}
</style></head>
<body>
<div class="wrap">
  <div class="top">
    <div class="brand"><span class="logo">T</span>Tryvio Status</div>
    <button class="toggle" onclick="tvT()" aria-label="Toggle light/dark theme" title="Toggle theme"><span class="moon">🌙</span><span class="sun">☀️</span></button>
  </div>
  <div class="hero" style="--hc:${heroColor};--hcs:${heroSoft}">
    <div class="hero-row">
      <span class="beacon"><b></b></span>
      <span class="headline">${headline}</span>
    </div>
    <div class="sub"><span class="badge">${SEM[o][2]}</span><span>Last checked ${checkedAt} UTC · auto-refreshes every 10 min</span></div>
  </div>
  <div class="card">${rows}</div>
  <div class="foot">Hosted on GitHub Pages — a separate failure domain from Tryvio's own infrastructure, so this page stays up during an outage.<br>Live health: <a href="https://app.tryvio.ai/api/health/deep">/api/health/deep</a></div>
</div>
<script>function tvT(){var r=document.documentElement,c=r.dataset.theme,d=c?c==='dark':matchMedia('(prefers-color-scheme:dark)').matches;r.dataset.theme=d?'light':'dark';try{localStorage.setItem('tvth',r.dataset.theme)}catch(e){}}</script>
</body></html>`;
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
