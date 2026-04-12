# TAOS Elite Ops — Live Dashboard

A full-stack live web dashboard for Meta Ads, rebuilt from your Google Apps Script.

## What it does

| Section | Description |
|---|---|
| **Study Manual** | ← Only input section. Enter Meta API token + ad accounts here. Manual ad labels (collection, offer type, etc.) also live here. |
| Overview | Live KPIs, funnel, decision distribution, account breakdown |
| Decision Queue | Every ad ranked: Scale Hard / Defend / Fix / Kill — auto-classified |
| Scale Board | Top performers ready for more budget |
| Fix Board | Potential ads needing creative/offer/targeting fixes |
| Defend Board | Winning ads showing fatigue or worsening trend |
| Kill Board | Budget drains with no path to recovery |
| Pattern Analysis | ROAS by creative type, audience family, offer type, scatter plot |
| Scorecard | Radar charts per account + collection-level performance table |
| Raw Flat Data | Every enriched ad row with all 40+ computed columns, sortable/searchable |

## Quick Start

### 1. Install Node.js (if not installed)

```bash
# macOS with Homebrew
brew install node

# Or using nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install --lts
```

### 2. Install dependencies and run

```bash
cd taos-dashboard
chmod +x setup.sh && ./setup.sh   # installs everything

npm run dev                        # starts both backend + frontend
```

Open **http://localhost:5173**

### 3. Configure in Study Manual

1. Go to **Study Manual** → **API Credentials**
2. Paste your Meta long-lived access token
3. Add your ad account(s):
   - Key = short label (e.g. `MAIN`, `BRAND2`)
   - ID  = your account ID (numeric, with or without `act_`)
4. Click **Verify Token** → then **Pull Meta + Refresh All**

### 4. Label ads (optional but powerful)

Under **Study Manual → Manual Labels**, assign Collection / Campaign Type / Offer Type / Status Override to any ad. These labels power the Pattern Analysis and audience family charts.

## Architecture

```
taos-dashboard/
├── server.js          ← Express proxy (avoids CORS when calling Meta API)
├── client/
│   └── src/
│       ├── lib/
│       │   ├── analytics.js   ← all processing logic (ported from GAS)
│       │   └── api.js         ← Meta API fetch functions
│       ├── store/index.js     ← Zustand state + localStorage persistence
│       └── pages/             ← one file per dashboard section
```

## Persistence

- Config (token, accounts) and manual labels are saved to **localStorage** — they persist across browser refreshes.
- Fetched Meta data lives in session memory only — re-pull as needed.

## Deploy

```bash
npm run build          # builds React into client/dist/
NODE_ENV=production npm start   # serves everything on :3001
```

Works on Railway, Render, Fly.io, or any Node host.
