# Tryvio public status page — deploy bundle

Independent uptime page for **status.tryvio.ai**, hosted on **GitHub Pages** and checked by
**GitHub Actions** — deliberately in a *separate failure domain* from Vercel, so it stays up and keeps
reporting even if all of Tryvio's own infrastructure is down.

It must live in its **own public repo** (GitHub Pages on a private repo needs a paid plan; a public
status repo is free and exposes nothing — the checker only hits public endpoints).

## What's here
- `check.mjs` — pings the monitors (marketing, app `/api/health`, deep `/api/health/deep`, docs),
  appends to `history.json`, regenerates `index.html`. No secrets.
- `.github/workflows/status-check.yml` — runs every 10 min, commits the refreshed page.
- `index.html` / `history.json` — generated output (committed so Pages always has something to serve).

## One-time setup (owner — ~5 min)
```bash
# 1. Create a public repo and push this bundle to its ROOT
gh repo create tryvio-status --public --disable-issues
cd 05_tasks/status-page
git init && git add . && git commit -m "init status page"
git branch -M main
git remote add origin https://github.com/mishogv/tryvio-status.git
git push -u origin main
```
2. **Enable Pages**: repo → Settings → Pages → *Deploy from a branch* → `main` / `(root)` → Save.
   The page goes live at `https://mishogv.github.io/tryvio-status/` within a minute.
3. **Enable Actions**: the scheduled `Status Check` starts within ~10 min (or run it once now via
   Actions → Status Check → *Run workflow*). Each run commits the refreshed page.
4. **Custom domain** (optional): Settings → Pages → Custom domain → `status.tryvio.ai`; then add a
   DNS `CNAME status → mishogv.github.io` at the tryvio.ai registrar. GitHub adds a `CNAME` file +
   provisions HTTPS.

## Tuning
- Monitors / thresholds: edit the `MONITORS` array in `check.mjs`.
- Cadence: the `cron` in `.github/workflows/status-check.yml` (GitHub's scheduler can lag a few min).
