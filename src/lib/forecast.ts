/**
 * Cash-flow forecast: project the liquid balance forward from money that's
 * already scheduled — bills (next due date + frequency), income sources (next
 * pay date + frequency) and recurring-flagged transactions. Pure and
 * dependency-light so it runs in the renderer and in tests.
 *
 * "Safe to spend" = the lowest the balance is projected to reach over the near
 * horizon, floored at zero. Spend that much today and you still won't dip below
 * zero before then, because spending today lowers every later point equally.
 *
 * Double-counting guards:
 *  - Start balance is computed from transactions dated on/before today, so
 *    scheduled events only ever add money that hasn't posted yet.
 *  - Bills store the NEXT due date (advanced when marked paid), so a due-today
 *    bill is genuinely unpaid — safe to project.
 *  - Recurring-transaction projections skip any merchant that matches a bill or
 *    income-source name (that flow is already modeled by the schedule).
 */
import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  endOfDay,
  format,
  startOfDay,
} from 'date-fns';
import { accountBalance, countsAsTransfer } from '@/lib/finance';
import { round2 } from '@/lib/utils';
import type { Account, AccountType, Bill, IncomeSource, Transaction } from '@/shared/types';

/** Account types kept out of the liquid pool (mirrors the dashboard's Account Balance). */
const NON_LIQUID = new Set<AccountType>(['savings', 'credit', 'loan']);

export interface ForecastEvent {
  /** yyyy-MM-dd of the projected occurrence. */
  date: string;
  label: string;
  /** Signed: positive = money in, negative = money out. */
  amount: number;
  kind: 'bill' | 'income' | 'recurring';
  sourceId: string;
}

export interface ForecastPoint {
  key: string; // yyyy-MM-dd
  label: string; // short axis label, e.g. "Jul 12"
  balance: number;
  inflow: number;
  outflow: number;
}

export interface Forecast {
  points: ForecastPoint[];
  events: ForecastEvent[];
  startBalance: number;
  endBalance: number;
  /** Lowest projected day over the whole horizon. */
  low: { key: string; label: string; balance: number };
  /** Label of the first day the balance is projected below zero, or null. */
  warnLabel: string | null;
  safeToSpend: number;
  totalIn: number;
  totalOut: number;
}

/** One step of a frequency; null for non-recurring ('once'/'onetime'). */
const STEP: Record<string, ((d: Date) => Date) | null> = {
  weekly: (d) => addWeeks(d, 1),
  biweekly: (d) => addWeeks(d, 2),
  twicemonthly: (d) => addDays(d, 15), // matches the server's income stepper
  monthly: (d) => addMonths(d, 1),
  quarterly: (d) => addQuarters(d, 1),
  yearly: (d) => addYears(d, 1),
  once: null,
  onetime: null,
};

/**
 * Occurrence dates of a schedule that fall within [from, to] (both midnight).
 * When `clampOverdue`, an anchor already in the past (an overdue bill) yields a
 * single occurrence at `from`; otherwise past occurrences are skipped and only
 * genuinely future ones are returned.
 */
function occurrenceDates(
  anchorISO: string,
  frequency: string,
  from: Date,
  to: Date,
  clampOverdue: boolean
): Date[] {
  const anchor = startOfDay(new Date(anchorISO));
  if (Number.isNaN(anchor.getTime())) return [];
  const step = STEP[frequency];
  const dates: Date[] = [];
  const push = (d: Date) => {
    if (!dates.some((x) => +x === +d)) dates.push(d);
  };

  if (!step) {
    // One-time: a single occurrence, clamped forward if overdue.
    if (anchor > to) return dates;
    if (anchor >= from) push(anchor);
    else if (clampOverdue) push(from);
    return dates;
  }

  let d = anchor;
  let guard = 0;
  if (d < from) {
    if (clampOverdue) push(from);
    while (d < from && guard++ < 800) d = step(d);
  }
  while (d <= to && guard++ < 800) {
    if (d >= from) push(d);
    d = step(d);
  }
  return dates;
}

/**
 * Project recurring-flagged transactions forward as monthly flows. Each
 * distinct recent recurrer (by merchant + type + amount) is anchored on its
 * most recent occurrence and stepped monthly. Merchants that match a bill or
 * income-source name are skipped — that money is already on the schedule.
 */
function recurringTxEvents(
  txs: Transaction[],
  known: Set<string>,
  from: Date,
  to: Date,
  now: Date
): ForecastEvent[] {
  const anchorCutoff = startOfDay(addDays(now, -45));
  const todayEnd = endOfDay(now);
  const latest = new Map<string, Transaction>();
  for (const t of txs) {
    if (!t.recurring || countsAsTransfer(t)) continue;
    if (t.type !== 'expense' && t.type !== 'income') continue;
    const d = new Date(t.date);
    if (d < anchorCutoff || d > todayEnd) continue;
    const name = (t.merchant ?? '').trim().toLowerCase();
    if (!name || known.has(name)) continue;
    const key = `${name}|${t.type}|${round2(t.amount)}`;
    const prev = latest.get(key);
    if (!prev || new Date(prev.date) < d) latest.set(key, t);
  }

  const events: ForecastEvent[] = [];
  for (const t of latest.values()) {
    for (const d of occurrenceDates(t.date, 'monthly', from, to, false)) {
      events.push({
        date: format(d, 'yyyy-MM-dd'),
        label: t.merchant || 'Recurring',
        amount: t.type === 'income' ? t.amount : -t.amount,
        kind: 'recurring',
        sourceId: t.id,
      });
    }
  }
  return events;
}

export function cashFlowForecast(
  accounts: Account[],
  txs: Transaction[],
  bills: Bill[],
  incomeSources: IncomeSource[],
  opts: {
    horizonDays?: number;
    safeDays?: number;
    includeRecurringTx?: boolean;
    now?: Date;
  } = {}
): Forecast {
  const now = opts.now ?? new Date();
  const horizon = Math.max(1, opts.horizonDays ?? 60);
  const safeDays = Math.max(1, opts.safeDays ?? 30);
  const includeRecurring = opts.includeRecurringTx ?? true;
  const from = startOfDay(now);
  const to = startOfDay(addDays(now, horizon));

  // Start balance = liquid accounts as of the end of today (nothing future).
  const todayEnd = endOfDay(now);
  const pastTxs = txs.filter((t) => new Date(t.date) <= todayEnd);
  const liquid = accounts.filter((a) => !a.archived && !NON_LIQUID.has(a.type));
  const startBalance = round2(liquid.reduce((s, a) => s + accountBalance(a, pastTxs), 0));

  const events: ForecastEvent[] = [];
  for (const b of bills) {
    for (const d of occurrenceDates(b.dueDate, b.frequency, from, to, true)) {
      events.push({
        date: format(d, 'yyyy-MM-dd'),
        label: b.name,
        amount: -Math.abs(b.amount),
        kind: 'bill',
        sourceId: b.id,
      });
    }
  }
  for (const s of incomeSources) {
    if (!s.active || !s.nextPayDate) continue;
    // Don't clamp income: a stale past pay date walks forward to the real next
    // paycheck instead of dumping (possibly already-received) money on today.
    for (const d of occurrenceDates(s.nextPayDate, s.frequency, from, to, false)) {
      events.push({
        date: format(d, 'yyyy-MM-dd'),
        label: s.name,
        amount: Math.abs(s.amount),
        kind: 'income',
        sourceId: s.id,
      });
    }
  }
  if (includeRecurring) {
    const known = new Set<string>();
    for (const b of bills) known.add(b.name.trim().toLowerCase());
    for (const s of incomeSources) known.add(s.name.trim().toLowerCase());
    events.push(...recurringTxEvents(txs, known, from, to, now));
  }

  // Fold events into per-day in/out totals.
  const byDay = new Map<string, { inflow: number; outflow: number }>();
  for (const e of events) {
    const cur = byDay.get(e.date) ?? { inflow: 0, outflow: 0 };
    if (e.amount >= 0) cur.inflow += e.amount;
    else cur.outflow += -e.amount;
    byDay.set(e.date, cur);
  }

  const points: ForecastPoint[] = [];
  let balance = startBalance;
  let totalIn = 0;
  let totalOut = 0;
  for (let i = 0; i <= horizon; i++) {
    const d = addDays(from, i);
    const key = format(d, 'yyyy-MM-dd');
    const day = byDay.get(key) ?? { inflow: 0, outflow: 0 };
    balance = round2(balance + day.inflow - day.outflow);
    totalIn += day.inflow;
    totalOut += day.outflow;
    points.push({ key, label: format(d, 'MMM d'), balance, inflow: round2(day.inflow), outflow: round2(day.outflow) });
  }

  let low = { key: points[0].key, label: points[0].label, balance: points[0].balance };
  let warnLabel: string | null = null;
  const safeCut = format(startOfDay(addDays(now, safeDays)), 'yyyy-MM-dd');
  let trough = Infinity;
  for (const p of points) {
    if (p.balance < low.balance) low = { key: p.key, label: p.label, balance: p.balance };
    if (warnLabel === null && p.balance < 0) warnLabel = p.label;
    if (p.key <= safeCut) trough = Math.min(trough, p.balance);
  }
  const safeToSpend = round2(Math.max(0, trough === Infinity ? startBalance : trough));

  return {
    points,
    events: events.sort((a, b) => a.date.localeCompare(b.date)),
    startBalance,
    endBalance: points[points.length - 1].balance,
    low,
    warnLabel,
    safeToSpend,
    totalIn: round2(totalIn),
    totalOut: round2(totalOut),
  };
}
