/**
 * "Aurum Wrapped" — the year in review, computed from the ledger.
 *
 * Everything here is derived from transactions the user already has; nothing
 * is estimated or projected. When a year has no data the caller gets `null`
 * rather than a deck of zeroes.
 *
 * Pure — safe for renderer, server and tests.
 */
import {
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfYear,
  format,
  startOfYear,
} from 'date-fns';
import { countsAsTransfer, monthlySeries, spendByCategory, topMerchants } from '@/lib/finance';
import { round2, sum } from '@/lib/utils';
import type { Category, Transaction } from '@/shared/types';

export interface WrappedMonth {
  label: string;
  amount: number;
}

export interface WrappedStats {
  year: number;
  /** True when the year is still running, so totals are partial. */
  inProgress: boolean;
  totalSpent: number;
  totalIncome: number;
  net: number;
  transactionCount: number;
  topMerchants: { merchant: string; amount: number; count: number }[];
  topCategory: { name: string; amount: number; color: string; share: number } | null;
  biggestMonth: WrappedMonth | null;
  leanestMonth: WrappedMonth | null;
  biggestPurchase: { merchant: string; amount: number; date: string } | null;
  /** Days in the covered window with no expense at all. */
  noSpendDays: number;
  longestNoSpendStreak: number;
  /** Months whose net was positive. */
  savingMonths: number;
  averageDailySpend: number;
}

/**
 * Build the year's story. Returns null when the year holds no non-transfer
 * activity — there's nothing to celebrate and a deck of zeroes reads as a bug.
 */
export function yearInReview(
  txs: Transaction[],
  categories: Category[],
  year: number,
  now = new Date()
): WrappedStats | null {
  const from = startOfYear(new Date(year, 0, 1));
  const yearEnd = endOfYear(from);
  // A year still in progress only counts up to today.
  const to = now < yearEnd ? now : yearEnd;
  const inProgress = now < yearEnd;

  const inYear = txs.filter((t) => {
    const d = new Date(t.date);
    return d >= from && d <= to && !countsAsTransfer(t);
  });
  if (inYear.length === 0) return null;

  const expenses = inYear.filter((t) => t.type === 'expense');
  const income = inYear.filter((t) => t.type === 'income');
  const totalSpent = round2(sum(expenses.map((t) => t.amount)));
  const totalIncome = round2(sum(income.map((t) => t.amount)));

  // Twelve months of this year, sliced out of the trailing series ending at `to`.
  const months = monthlySeries(txs, 24, to)
    .filter((p) => p.date >= from && p.date <= to)
    .map((p) => ({ label: format(p.date, 'MMMM'), amount: p.expense, net: p.net }));
  const spent = months.filter((m) => m.amount > 0);

  const breakdown = spendByCategory(txs, categories, from, to);
  const top = breakdown[0];

  const biggest = [...expenses].sort((a, b) => b.amount - a.amount)[0];

  // No-spend days across the covered window.
  const spendDays = new Set(expenses.map((t) => format(new Date(t.date), 'yyyy-MM-dd')));
  const days = eachDayOfInterval({ start: from, end: to });
  let noSpendDays = 0;
  let streak = 0;
  let longest = 0;
  for (const day of days) {
    if (spendDays.has(format(day, 'yyyy-MM-dd'))) {
      streak = 0;
    } else {
      noSpendDays++;
      streak++;
      if (streak > longest) longest = streak;
    }
  }

  const spanDays = Math.max(1, differenceInCalendarDays(to, from) + 1);

  return {
    year,
    inProgress,
    totalSpent,
    totalIncome,
    net: round2(totalIncome - totalSpent),
    transactionCount: inYear.length,
    topMerchants: topMerchants(txs, from, to, 5),
    topCategory: top
      ? {
          name: top.category.name,
          amount: top.amount,
          color: top.category.color,
          share: top.pct,
        }
      : null,
    biggestMonth: spent.length
      ? [...spent].sort((a, b) => b.amount - a.amount).map((m) => ({ label: m.label, amount: m.amount }))[0]
      : null,
    leanestMonth: spent.length
      ? [...spent].sort((a, b) => a.amount - b.amount).map((m) => ({ label: m.label, amount: m.amount }))[0]
      : null,
    biggestPurchase: biggest
      ? { merchant: biggest.merchant || '(no merchant)', amount: biggest.amount, date: biggest.date }
      : null,
    noSpendDays,
    longestNoSpendStreak: longest,
    savingMonths: months.filter((m) => m.net > 0).length,
    averageDailySpend: round2(totalSpent / spanDays),
  };
}

/** Years that actually contain activity, newest first — drives the year picker. */
export function yearsWithData(txs: Transaction[]): number[] {
  const years = new Set<number>();
  for (const t of txs) {
    if (countsAsTransfer(t)) continue;
    years.add(new Date(t.date).getFullYear());
  }
  return [...years].sort((a, b) => b - a);
}
