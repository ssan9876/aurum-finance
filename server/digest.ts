/**
 * Weekly digest: a short, plain-text summary of the week's money, delivered to
 * a webhook of the user's choosing (ntfy, Discord, Slack, Home Assistant —
 * anything that accepts a POST).
 *
 * The numbers are computed from the same pure libs the UI uses, so the digest
 * can never disagree with the app. Claude, if connected, only writes a single
 * opening sentence over those numbers — it is never asked to do the arithmetic.
 *
 * Delivery is OUTWARD-FACING, so it is opt-in: the `weeklyDigest` automation
 * flag defaults off, and nothing is sent without a configured webhook URL.
 */
import { subDays } from 'date-fns';
import type { DataService } from './data-service';
import { aiConfigured, complete } from './ai';
import {
  billState,
  budgetStatuses,
  expensesIn,
  incomeIn,
  savingsStreak,
} from '../src/lib/finance';
import { cashFlowForecast } from '../src/lib/forecast';
import { detectAnomalies } from '../src/lib/anomalies';
import { detectSubscriptions, summarizeSubscriptions } from '../src/lib/subscriptions';
import { round2, sum } from '../src/lib/utils';
import type {
  Account,
  Bill,
  Budget,
  Category,
  IncomeSource,
  Setting,
  Transaction,
} from '../src/shared/types';

export const WEBHOOK_SETTING = 'digest.webhookUrl';
export const LAST_SENT_SETTING = 'digest.lastSentWeek';

export interface DigestData {
  from: Date;
  to: Date;
  currency: string;
  spent: number;
  received: number;
  net: number;
  topExpenses: { merchant: string; amount: number }[];
  overBudget: { category: string; spent: number; budget: number }[];
  renewingSoon: { merchant: string; amount: number }[];
  anomalyCount: number;
  overdueBills: number;
  streak: number;
  safeToSpend: number;
  /** Label of the first day the balance is projected below zero, or null. */
  warnLabel: string | null;
}

/** ISO-ish week key (`2026-W28`) — the once-a-week guard. */
export function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function money(currency: string) {
  const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
  const exact = new Intl.NumberFormat('en-US', { style: 'currency', currency });
  return { round: (n: number) => fmt.format(n), exact: (n: number) => exact.format(n) };
}

export async function buildDigestData(service: DataService, now = new Date()): Promise<DigestData> {
  const [accounts, categories, txs, budgets, bills, incomeSources, settings] = (await Promise.all([
    service.handle('list', { entity: 'account' }),
    service.handle('list', { entity: 'category' }),
    service.handle('list', { entity: 'transaction' }),
    service.handle('list', { entity: 'budget' }),
    service.handle('list', { entity: 'bill' }),
    service.handle('list', { entity: 'incomeSource' }),
    service.handle('list', { entity: 'setting' }),
  ])) as [Account[], Category[], Transaction[], Budget[], Bill[], IncomeSource[], Setting[]];

  let currency = 'USD';
  try {
    const row = settings.find((s) => s.key === 'currency');
    if (row) currency = JSON.parse(row.value);
  } catch {
    /* keep default */
  }

  const from = subDays(now, 7);
  const weekExpenses = expensesIn(txs, from, now);
  const weekIncome = incomeIn(txs, from, now);
  const spent = round2(sum(weekExpenses.map((t) => t.amount)));
  const received = round2(sum(weekIncome.map((t) => t.amount)));

  const forecast = cashFlowForecast(accounts, txs, bills, incomeSources, { now });
  const subs = summarizeSubscriptions(detectSubscriptions(txs), { now, withinDays: 7 });

  return {
    from,
    to: now,
    currency,
    spent,
    received,
    net: round2(received - spent),
    topExpenses: [...weekExpenses]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3)
      .map((t) => ({ merchant: t.merchant || '(no merchant)', amount: t.amount })),
    overBudget: budgetStatuses(budgets, categories, txs, now)
      .filter((b) => b.pct > 1)
      .map((b) => ({ category: b.category.name, spent: b.spent, budget: b.budget })),
    renewingSoon: subs.renewingSoon.map((s) => ({ merchant: s.merchant, amount: s.amount })),
    anomalyCount: detectAnomalies(txs, { now, lookbackDays: 7 }).length,
    overdueBills: bills.filter((b) => billState(b, now) === 'overdue').length,
    streak: savingsStreak(txs, now),
    safeToSpend: forecast.safeToSpend,
    warnLabel: forecast.warnLabel,
  };
}

/** The deterministic body. Every number here comes from the shared finance libs. */
export function renderDigest(d: DigestData, opening?: string): string {
  const m = money(d.currency);
  const lines: string[] = [];
  if (opening) lines.push(opening, '');

  lines.push(`Spent ${m.round(d.spent)} · Received ${m.round(d.received)} · Net ${m.round(d.net)}`);

  if (d.topExpenses.length) {
    lines.push('', 'Biggest:');
    for (const e of d.topExpenses) lines.push(`  • ${e.merchant} — ${m.exact(e.amount)}`);
  }
  if (d.overBudget.length) {
    lines.push('', 'Over budget:');
    for (const b of d.overBudget) {
      lines.push(`  • ${b.category} — ${m.exact(b.spent)} of ${m.exact(b.budget)}`);
    }
  }
  if (d.renewingSoon.length) {
    lines.push('', 'Renewing this week:');
    for (const s of d.renewingSoon) lines.push(`  • ${s.merchant} — ${m.exact(s.amount)}`);
  }

  const notes: string[] = [];
  if (d.overdueBills) notes.push(`${d.overdueBills} overdue bill${d.overdueBills === 1 ? '' : 's'}`);
  if (d.anomalyCount) notes.push(`${d.anomalyCount} unusual charge${d.anomalyCount === 1 ? '' : 's'}`);
  if (d.warnLabel) notes.push(`balance dips below zero by ${d.warnLabel}`);
  if (notes.length) lines.push('', `Heads up: ${notes.join(', ')}.`);

  lines.push('', `Safe to spend: ${m.round(d.safeToSpend)}`);
  if (d.streak > 0) lines.push(`${d.streak}-month savings streak 🔥`);
  return lines.join('\n');
}

/**
 * One sentence of colour over numbers that are already fixed. Claude never
 * sees a blank cheque here: it's told not to compute or invent figures, and a
 * failure just drops the sentence rather than the digest.
 */
async function narrate(service: DataService, d: DigestData): Promise<string | undefined> {
  if (!(await aiConfigured(service))) return undefined;
  const facts = JSON.stringify({
    spent: d.spent,
    received: d.received,
    net: d.net,
    topExpenses: d.topExpenses,
    overBudget: d.overBudget.map((b) => b.category),
    overdueBills: d.overdueBills,
    streak: d.streak,
  });
  try {
    const line = await complete(
      service,
      `Here is a user's week of spending as JSON:\n${facts}\n\nWrite ONE sentence (max 25 words) opening their weekly summary. Be warm and specific, mention at most one number, and never state a figure that is not in the JSON. No greeting, no sign-off.`,
      { maxTokens: 120 }
    );
    const clean = line.split('\n')[0].trim();
    return clean.length > 200 ? undefined : clean || undefined;
  } catch {
    return undefined; // the digest is useful without it
  }
}

async function webhookUrl(service: DataService): Promise<string> {
  const rows = (await service.handle('list', { entity: 'setting' })) as Setting[];
  return rows.find((s) => s.key === WEBHOOK_SETTING)?.value ?? '';
}

/** POST the digest as plain text — the shape ntfy and most webhooks accept. */
async function deliver(url: string, text: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8', Title: 'Aurum weekly digest' },
    body: text,
  });
  if (!res.ok) throw new Error(`Webhook responded ${res.status}.`);
}

export interface DigestResult {
  text: string;
  sent: boolean;
}

/** Build the digest; send it only when asked AND a webhook is configured. */
export async function weeklyDigest(
  service: DataService,
  opts: { send?: boolean; now?: Date } = {}
): Promise<DigestResult> {
  const now = opts.now ?? new Date();
  const data = await buildDigestData(service, now);
  const text = renderDigest(data, await narrate(service, data));
  if (!opts.send) return { text, sent: false };

  const url = await webhookUrl(service);
  if (!url) throw new Error('Add a webhook URL first — that is where the digest gets sent.');
  await deliver(url, text);
  return { text, sent: true };
}

export async function digestConfigured(service: DataService): Promise<boolean> {
  return !!(await webhookUrl(service));
}

export async function digestStatus(service: DataService) {
  const rows = (await service.handle('list', { entity: 'setting' })) as Setting[];
  return {
    webhookUrl: rows.find((s) => s.key === WEBHOOK_SETTING)?.value ?? '',
    lastSentWeek: rows.find((s) => s.key === LAST_SENT_SETTING)?.value ?? null,
    aiNarration: await aiConfigured(service),
  };
}
