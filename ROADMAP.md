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

### 1b. Forecast engine (pure lib) ✅ (v1.4.2)
`src/lib/forecast.ts` — `cashFlowForecast(accounts, txs, bills, incomeSources,
opts)` projects the liquid balance forward (default 60 days) from bills
(next due + frequency), income sources (`nextPayDate` + frequency) and
recurring-flagged transactions (monthly). Returns a daily point series +
events + `safeToSpend` (near-horizon trough, floored at 0) + `warnLabel`
(first sub-zero day). Double-count guards: start balance from txs ≤ today,
bills clamp overdue to today, income never clamps, recurring-tx projections
skip merchants that match a bill/income name.

### 1c. AI plumbing (server) ✅ (v1.7.0)
`server/ai.ts` — uses the official `@anthropic-ai/sdk` (not raw fetch: typed
errors, and the tool runner that "Ask Aurum" will need). Key in setting
`ai.apiKey`, model in `ai.model` (default `claude-opus-4-8`).
`aiConnect()` verifies a key with a 16-token request BEFORE storing it.
Exports `client()`, `complete()`, `textOf()`, `friendlyError()` for features
1/4/7 to build on.
**The key never leaves the server**: `/api/data` redacts `SENSITIVE_SETTING_KEYS`
(`ai.apiKey`, `simplefin.accessUrl`) to `'__set__'` — the renderer learns only
that a key is set. Endpoints `GET|POST /api/ai/{status,connect,disconnect,test}`
behind `requireKey`. Settings → Claude card (server backend only).

## Phase 2 — Money intelligence (no AI required)

### 2. Cash-flow forecast / "Safe to Spend" ✅ (v1.4.2)
Dashboard "Cash Flow Forecast" card: `ForecastChart` (area, dashed zero line,
"Below $0" marker, red when it dips negative) + a headline safe-to-spend
number and a "Below $0 by <date>" / "Low: <amount>" readout. Consumes 1b.
- `src/lib/forecast.ts`, `Dashboard.tsx`, `ForecastChart` in `charts.tsx`

### 3. Subscription Detective ✅ (v1.5.0)
`detectSubscriptions(txs)` groups expenses by normalized merchant and keeps
series where BOTH timing (median gap → cadence window, ≥60% of gaps agree)
and amount (spread ≤50% of median) are consistent — so weekly groceries
don't register. Infers cadence, monthly/yearly cost, next charge, and price
hikes (walk back over the trailing run of the current price).
`summarizeSubscriptions()` adds renewing-soon, price hikes and per-category
overlap. Page `/subscriptions` (nav: Money).
- `src/lib/subscriptions.ts` (pure), `src/pages/Subscriptions.tsx`

### 8. Anomaly alerts ✅ (v1.5.1)
`detectAnomalies(txs, {lookbackDays=30})` — three signals, one per tx
(duplicate > outlier > new-merchant): same merchant+amount ≤2 days apart
(≥$10); a charge ≥2.5× and ≥$25 over the median of that merchant's own
history (≥4 prior charges); a first-ever charge ≥$100. Warning banner +
checkbox review dialog on Transactions; "Mark reviewed" writes the reserved
`Reviewed` tag, which the detector skips — so dismissals persist.
- `src/lib/anomalies.ts` (pure), `Transactions.tsx`

### 9. Merchant profiles ✅ (v1.5.2)
`merchantProfile(txs, key)` — lifetime spend, average/min/max ticket, median
gap between visits, 12-month spend series, category history, full charge
list. Merchants aren't an entity; the key is the normalized merchant string
(same one the rules use), so lookup is case-insensitive. Route
`/merchants/:key`. Drill in from Analytics → Top Merchants (BarList gained an
optional `onSelect`) and from Subscriptions service names.
- `src/lib/merchants.ts` (pure), `src/pages/Merchant.tsx`

### 5. Debt payoff planner ✅ (v1.6.0)
`simulatePayoff(debts, strategy, {extraMonthly})` + `comparePayoff()`.
Avalanche (highest APR) vs snowball (smallest balance) over the SAME fixed
budget (sum of minimums + extra); a cleared debt's minimum rolls into the
next target. Interest accrues before payments land. Bails out with
`months: null` when the budget can't outpace the interest.
Schema: `Account.apr` + `Account.minPayment` (both nullable) — mirrored in
`shared/types`, `LOCAL_DEFAULTS`, and BOTH `MONEY_FIELDS` sets (minPayment
only; apr is a rate). Missing minimum falls back to 2% of balance, min $25.
- `prisma/schema.prisma`, `src/lib/debt.ts` (pure), `src/pages/Debt.tsx`

**Phase 2 complete.**

### 6. What-if sandbox ✅ (v1.5.3)
`simulateWhatIf()` — three levers that move the monthly net: cancel detected
subscriptions, scale spending, scale income. Savings grows by the net each
month (no interest assumed, so the projection never flatters itself). Page
`/what-if` (nav: Planning) shows scenario-vs-baseline stat cards, a
two-line projection chart and a before/after health score. Nothing is saved.
Slider is a native range input — no new dependency.
- `src/lib/whatif.ts` (pure), `src/pages/WhatIf.tsx`

## Phase 3 — AI features (need 1c)

### 1. "Ask Aurum" chat panel ✅ (v1.8.0)
`server/chat.ts` drives the EXISTING MCP server in-process over
`InMemoryTransport` — one tool definition, two consumers (external MCP
clients via POST /mcp, and this chat). **READ-ONLY**: only tools the MCP
server annotates `readOnlyHint` are offered to the model (`get_overview`,
`list_transactions`); the 11 mutating tools are withheld, so a stray tool
call can't touch the user's records. Hand-written agentic loop capped at
`MAX_STEPS = 8` (then one tools-free "answer now" call), history bounded to
20 turns; returns `toolsUsed` for UI provenance badges.
`POST /api/ai/chat` behind `requireKey`. Sheet panel in the topbar, hidden
unless backend is `server` AND a key is configured.
- `server/chat.ts`, `src/components/chat/AskAurum.tsx`

**Next:** writes need their own confirmation flow before the mutating tools
can be exposed here.

### 4. Receipt scanning ✅ (v1.9.0)
`server/receipt.ts` — vision + **structured outputs** (`output_config.format`
json_schema), so the model can't return prose-wrapped JSON. Validates the
data URL server-side (media type allowlist, 2 MB cap mirroring the dialog),
then sanitizes: absolutizes amounts, drops any date not matching yyyy-MM-dd
(no guessed dates), rejects unreadable images. `POST /api/ai/receipt` —
nothing is persisted, it returns a draft.
TransactionDialog auto-scans on attach (new transactions only) and shows a
rescan button; the scan only ever fills BLANK fields, never overwrites typing.
- `server/receipt.ts`, `TransactionDialog.tsx`

### 7. Weekly digest ✅ (v1.10.0)
`server/digest.ts` — week's spend/income/net, top expenses, over-budget
categories, subscriptions renewing, anomaly + overdue-bill counts, safe-to-
spend and the forecast warning. Every number comes from the SAME pure libs
the UI uses, so the digest can't disagree with the app; Claude (if connected)
only writes ONE opening sentence over those fixed numbers and is told never
to state a figure not in the JSON. A narration failure drops the sentence,
not the digest.
Delivered as plain text POST to any webhook (ntfy/Discord/Slack/HA).
Scheduler job runs Sunday at the same nightly hour as bank sync (so the
week's transactions are in first), once per ISO week, claimed up front.
**Outward-facing, so opt-in**: `automation.weeklyDigest` defaults OFF and
nothing sends without a webhook URL.
- `server/digest.ts`, `server/scheduler.ts`, `DigestCard.tsx`
- Chose a webhook over web push: no VAPID keys, works with what people run.

## Phase 4 — Delight

### 10. "Aurum Wrapped" year in review ✅ (v1.11.0)
`yearInReview(txs, categories, year)` (src/lib/wrapped.ts, pure) — spend,
income, net, top merchants, top category, priciest/leanest month, biggest
purchase, no-spend days + longest streak, months in the black. Excludes
transfers, clamps an in-progress year to today, returns `null` for a year
with no activity (a deck of zeroes reads as a bug). `yearsWithData()` drives
the year picker. Route `/wrapped` (nav: Overview), framer-motion slide deck
with keyboard arrows and progress dots.
- `src/lib/wrapped.ts`, `src/pages/Wrapped.tsx`

---

**Phases 1–4 complete.** Remaining ideas: a confirmation flow so Ask Aurum can
use the mutating MCP tools; web push as a digest channel alongside webhooks.

## Deliberately deferred
- Multi-user / partner mode (big auth + data-model lift)
- Local LLM (Ollama) backend for the AI features
- Plaid connector (SimpleFIN covers the need for now)
