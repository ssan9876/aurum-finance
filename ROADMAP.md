# Aurum Roadmap

Feature plan agreed July 2026. Ordered into phases by dependency and
value-to-effort — each phase ships independently. Details (files, approach)
are starting points, not contracts.

## Phase 1 — Foundations that several features share

### 1a. Nightly bank sync at a set hour ✅ (v1.4.1)
Split SimpleFIN sync out of the anytime-daily job into its own nightly job
(default 11 PM local, configurable via setting `automation.syncHour`).
Scheduler tick tightened to 15 minutes. Catch-up run if the server was off
through the whole window.
- `server/scheduler.ts`, `src/components/settings/AutomationCard.tsx`

### 1b. Forecast engine (pure lib)
`src/lib/forecast.ts`: project balances forward 30–90 days from bills
(due dates + frequency), income sources (`nextPayDate` + frequency) and
recurring transactions. Returns a daily series + events (bill X on date Y).
Everything in Phase 2 consumes this.

### 1c. AI plumbing (server)
`server/ai.ts`: thin Claude API client (plain fetch, no SDK dep), API key in
setting `ai.apiKey`, model in `ai.model`. Settings card (server backend only).
Endpoint `POST /api/ai/*` guarded by `requireKey`. Unlocks features 4–6.

## Phase 2 — Money intelligence (no AI required)

### 2. Cash-flow forecast / "Safe to Spend"
Dashboard card + chart: projected balance line with a "dips below $0 on …"
warning and a safe-to-spend-today number. Consumes 1b.
- `src/lib/forecast.ts`, `Dashboard.tsx`, one new chart in `charts.tsx`

### 3. Subscription Detective
Detect recurring same-merchant charges (amount tolerance + period inference),
price hikes, duplicates/overlaps, upcoming annual renewals (surface on the
Calendar). New page `/subscriptions` + review-banner pattern from transfers.
- `src/lib/subscriptions.ts` (pure), `src/pages/Subscriptions.tsx`

### 8. Anomaly alerts
Per-merchant/category stats; flag outlier amounts, probable double-charges
(same merchant+amount within days), first-seen merchants over a threshold.
Banner on Transactions (reuse transfer-review UI), dismiss = reserved tag.
- `src/lib/anomalies.ts` (pure), `Transactions.tsx`

### 9. Merchant profiles
Click a merchant anywhere → `/merchants/:name`: lifetime spend, average
ticket, frequency, sparkline, category history. Pure memos over existing data.
- `src/pages/Merchant.tsx`, links from Transactions/Analytics

### 5. Debt payoff planner
Avalanche vs. snowball simulator over `loan`/`credit` accounts. Needs an APR
field per account (schema + both adapters + LOCAL_DEFAULTS parity!).
Slider for extra monthly payment → payoff dates + interest saved per strategy.
- `prisma/schema.prisma` (+ migration), `src/lib/debt.ts`, `src/pages/Debt.tsx`

### 6. What-if sandbox
Toggle subscriptions off / adjust contributions → live re-run of forecast,
savings projections and health score. Pure composition of 1b + existing
`savingsProjection`/`healthScore`.
- `src/pages/WhatIf.tsx` (or a Dashboard drawer)

## Phase 3 — AI features (need 1c)

### 1. "Ask Aurum" chat panel
In-app chat calling Claude with the existing MCP tools (`server/mcp.ts`
already defines get_overview, add_transactions, set_budgets, …). Server
proxies the Claude API and executes tool calls against DataService — the
renderer never sees the API key. Streaming optional in v1.
- `server/ai.ts`, `src/components/chat/`, entry in AppShell

### 4. Receipt scanning
Photo/upload → Claude vision extracts merchant/amount/date/line items →
prefills TransactionDialog (field `receiptImage` already exists).
- `server/ai.ts` (vision request), hook in `TransactionDialog.tsx`

### 7. Weekly digest push
Scheduler job (Sunday night): build a summary (top expenses, budget standing,
streaks, anomalies from 2/8), optional AI-written paragraph, delivered via
web push (PWA service worker exists) and/or ntfy webhook setting.
- `server/scheduler.ts`, `server/digest.ts`, `sw.js` push handler,
  Settings card for ntfy URL / push subscription

## Phase 4 — Delight

### 10. "Aurum Wrapped" year in review
Animated recap (framer-motion already a dep): top merchants, best month,
no-spend streaks, savings growth. Route `/wrapped`, teased from the
dashboard in December.

## Deliberately deferred
- Multi-user / partner mode (big auth + data-model lift)
- Local LLM (Ollama) backend for the AI features
- Plaid connector (SimpleFIN covers the need for now)
