# Aurum — Personal Finance

Local-first personal finance for desktop, web and self-hosted servers. Track
spending, income, budgets, bills, savings goals and net worth — beautifully, and
entirely on your own hardware.

Built with **React 18 + TypeScript + Vite + TailwindCSS + shadcn-style components +
Recharts**, with **Prisma + SQLite** behind an adapter-based storage layer
(Electron IPC on desktop, an Express API when self-hosted, localStorage as the
zero-setup browser fallback).

## Self-host it (recommended — one command)

On a Debian/Ubuntu box or Proxmox LXC container, as root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/ssan9876/aurum-finance/main/install.sh)"
```

The installer sets up Node 22, builds the app into `/opt/aurum`, creates the
SQLite database at `/var/lib/aurum/aurum.db`, asks for an optional access
password, and starts a hardened `systemd` service on port **5533**.
Logs: `journalctl -u aurum -f`.

**Updating:** just type `update` in the container's console. It pulls the
latest version, rebuilds and restarts the service — your data
(`/var/lib/aurum`) and settings (`/etc/aurum/aurum.env`) are always kept.

> The server binds to your LAN over plain HTTP. Set a password during install,
> and put a TLS reverse proxy (Caddy/NPM/Traefik) in front if you expose it
> beyond a trusted network.

## Running it locally

```bash
npm install

# Desktop app (Electron + SQLite via Prisma)
npm run dev

# Browser-only mode (same app, localStorage adapter — no Electron needed)
npm run dev:web

# Self-hosted server from source
npm run build:web && npm run build:server && npm start
```

First launch offers demo data (~8 months of realistic activity) or a fresh start.
Default categories and a checking account are seeded automatically.

### Production builds

```bash
npm run build       # typecheck + renderer + electron main/preload
npm run dist        # package the desktop app with electron-builder
npm run build:web   # static web build (dist/)
```

> Packaging note: `dist` expects `prisma/template.db` (an empty pushed database) as
> the first-run template. Create it with:
> `DATABASE_URL="file:./template.db" npx prisma db push` (run inside `prisma/`).

## Architecture

```
electron/            Main process: window + IPC bridge
server/              Shared Prisma data service + Express server (self-hosted mode)
install.sh           One-command Debian/LXC installer (systemd service)
prisma/schema.prisma Relational model (SQLite): accounts, transactions, categories
                     (self-referencing subcategories), income sources, savings +
                     snapshots, budgets, bills, goals, tags, settings, attachments
src/
  shared/            Entity types, wire protocol (DataApi), seed data, option lists
  data/              Storage clients: IPC (desktop) + localStorage (web) + React
                     Query hooks (undo-able deletes, bulk updates)
  lib/               Pure finance math (finance.ts), CSV/XLSX/backup, demo data,
                     icon registry
  state/             Settings context (theme/accent/currency/date format), UI state
  components/ui/     shadcn-style primitives
  components/        Charts (theme-reactive, CVD-safe palette), forms, app shell,
                     command palette, onboarding
  pages/             Dashboard, Transactions, Income, Budgets, Bills, Savings,
                     Goals, Accounts, Categories, Calendar, Analytics, Settings
```

**Local-first by design.** The renderer only talks to the `DataApi` interface.
At startup it picks a backend: Electron IPC (desktop), the Aurum server's HTTP
API (self-hosted — everything in SQLite), or localStorage (static web). Cloud
sync or aggregator integrations (Plaid/SimpleFIN) can be added later as another
adapter without touching the UI.

## Feature highlights

- **Dashboard** — 8 stat cards (balance, savings, income, expenses, net, salary,
  savings rate, month spend + forecast), income vs expenses, category donut,
  savings growth, cash flow, income sources, budget progress, recent activity,
  upcoming bills, financial health score, savings streak.
- **Transactions** — search, filters (type/category/account/method/tag/date),
  sorting, pagination, bulk edit/delete with **Undo**, inline editing
  (double-click merchant/amount), receipts, duplicates, CSV/Excel export.
- **Bank imports** — drop in **OFX/QFX (Quicken) downloads** from Chase, Amex
  and most banks: transactions dedupe automatically via the bank's `FITID`, so
  re-importing overlapping date ranges is safe. CSV import has column mapping,
  **saved presets** per institution, and fuzzy duplicate skipping.
- **Income** — unlimited sources, any pay frequency, live monthly/annual math.
- **Budgets** — recurring templates + per-month overrides, month navigator,
  alerts at 90% and over-budget.
- **Bills** — due dates, auto-pay, reminder windows, one-click *mark paid* (logs
  the expense and advances the due date).
- **Savings** — goals, contributions, APY compounding, projected completion,
  historical snapshots and growth charts.
- **Accounts** — checking/savings/credit/cash/investment, running balances,
  transfers, archiving, net worth.
- **Analytics** — period reports, category breakdown, top merchants, largest
  expenses, budget performance, net worth trend, expense heatmap, Excel/CSV
  report export.
- **Calendar** — income, spending, bill due dates and paydays per day.
- **UX** — command palette (**Ctrl K**), keyboard shortcuts (`?` to view), quick
  add (**N** / **I**), dark/light/system themes, six accent colors, per-user
  currency + date format, toasts, confirm dialogs, loading skeletons, empty
  states, drag-to-reorder categories, JSON backup/restore.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl K` | Command palette / global search |
| `N` / `I` | Quick add transaction / income |
| `G` then `D T I B S O C A` | Go to Dashboard, Transactions, Income, Budgets, Savings, Goals, Calendar, Analytics |
| `?` | Shortcut help |

## Data

- Self-hosted: `/var/lib/aurum/aurum.db` (SQLite) — config in `/etc/aurum/aurum.env`.
- Desktop: `prisma/dev.db` in development, `%APPDATA%/aurum/aurum.db` when packaged.
- Browser fallback: `localStorage` under `aurum.web.db`.
- Settings → Data: JSON backup/restore, CSV/Excel export, demo data, full erase.

## Server environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5533` | Listen port |
| `AURUM_DB` | `./prisma/dev.db` | SQLite file path (wins over `DATABASE_URL`) |
| `AURUM_PASSWORD` | *(unset)* | When set, the web UI requires this password |
