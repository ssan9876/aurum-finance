/**
 * Merchant profiles: everything the ledger knows about one payee — lifetime
 * spend, how often you go back, what it typically costs, which categories it
 * lands in, and a monthly spend series.
 *
 * Merchants have no entity of their own; they're just a normalized string on
 * transactions (same key the auto-categorization rules use), so a profile is
 * derived on demand.
 *
 * Pure — safe for renderer, server and tests.
 */
import { differenceInCalendarDays, format, startOfMonth, subMonths } from 'date-fns';
import { countsAsTransfer } from '@/lib/finance';
import { normalizeMerchant } from '@/lib/rules';
import { round2 } from '@/lib/utils';
import type { Transaction } from '@/shared/types';

export interface MerchantMonth {
  key: string;
  label: string;
  amount: number;
}

export interface MerchantCategorySlice {
  categoryId: string | null;
  amount: number;
  count: number;
}

export interface MerchantProfile {
  key: string;
  /** Display spelling, taken from the most recent charge. */
  merchant: string;
  total: number;
  count: number;
  average: number;
  min: number;
  max: number;
  firstDate: string;
  lastDate: string;
  /** Median days between visits; null with fewer than two charges. */
  cadenceDays: number | null;
  monthly: MerchantMonth[];
  categories: MerchantCategorySlice[];
  /** Newest first. */
  transactions: Transaction[];
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Expense charges for one normalized merchant key. */
export function merchantTransactions(txs: Transaction[], key: string): Transaction[] {
  const want = normalizeMerchant(key);
  return txs.filter(
    (t) => t.type === 'expense' && !countsAsTransfer(t) && normalizeMerchant(t.merchant ?? '') === want
  );
}

export function merchantProfile(
  txs: Transaction[],
  key: string,
  opts: { months?: number; now?: Date } = {}
): MerchantProfile | null {
  const months = opts.months ?? 12;
  const now = opts.now ?? new Date();

  const rows = merchantTransactions(txs, key);
  if (rows.length === 0) return null;

  const asc = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const amounts = asc.map((t) => t.amount);
  const total = amounts.reduce((s, a) => s + a, 0);

  const gaps: number[] = [];
  for (let i = 1; i < asc.length; i++) {
    const g = differenceInCalendarDays(new Date(asc[i].date), new Date(asc[i - 1].date));
    if (g > 0) gaps.push(g);
  }

  const monthly: MerchantMonth[] = [];
  const index = new Map<string, MerchantMonth>();
  for (let i = months - 1; i >= 0; i--) {
    const date = startOfMonth(subMonths(now, i));
    const mk = format(date, 'yyyy-MM');
    const point = { key: mk, label: format(date, 'MMM'), amount: 0 };
    monthly.push(point);
    index.set(mk, point);
  }
  for (const t of asc) {
    const point = index.get(format(new Date(t.date), 'yyyy-MM'));
    if (point) point.amount += t.amount;
  }
  for (const p of monthly) p.amount = round2(p.amount);

  const catTotals = new Map<string, { amount: number; count: number }>();
  for (const t of asc) {
    const id = t.categoryId ?? '__none__';
    const cur = catTotals.get(id) ?? { amount: 0, count: 0 };
    cur.amount += t.amount;
    cur.count += 1;
    catTotals.set(id, cur);
  }

  const last = asc[asc.length - 1];
  return {
    key: normalizeMerchant(key),
    merchant: last.merchant,
    total: round2(total),
    count: asc.length,
    average: round2(total / asc.length),
    min: round2(Math.min(...amounts)),
    max: round2(Math.max(...amounts)),
    firstDate: asc[0].date,
    lastDate: last.date,
    cadenceDays: gaps.length ? Math.round(median(gaps)) : null,
    monthly,
    categories: [...catTotals.entries()]
      .map(([id, v]) => ({
        categoryId: id === '__none__' ? null : id,
        amount: round2(v.amount),
        count: v.count,
      }))
      .sort((a, b) => b.amount - a.amount),
    transactions: [...asc].reverse(),
  };
}
