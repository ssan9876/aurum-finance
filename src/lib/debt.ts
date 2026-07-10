/**
 * Debt payoff simulation: avalanche (highest APR first) vs snowball (smallest
 * balance first).
 *
 * Both strategies spend the same fixed monthly budget — the sum of every
 * minimum payment, plus whatever extra the user throws at it. When a debt is
 * cleared its minimum doesn't disappear; it rolls into the next target. That
 * rollover is what makes either strategy accelerate, and keeping the budget
 * constant is what makes the two comparable.
 *
 * Interest accrues monthly at apr/12 before payments land, which is the
 * conservative order (you're charged before you pay).
 *
 * Pure — safe for renderer, server and tests.
 */
import { addMonths, format } from 'date-fns';
import { round2 } from '@/lib/utils';

export type Strategy = 'avalanche' | 'snowball';

export interface DebtInput {
  id: string;
  name: string;
  /** Amount owed today, a positive number. */
  balance: number;
  /** Annual interest rate percent, e.g. 24.99. */
  apr: number;
  /** Minimum monthly payment. */
  minPayment: number;
}

export interface DebtPayoff {
  id: string;
  name: string;
  /** Months until this debt hits zero, or null if it never does. */
  months: number | null;
  label: string | null;
  interestPaid: number;
}

export interface DebtPlan {
  strategy: Strategy;
  /** Months until every debt is clear; null when the budget can't keep up. */
  months: number | null;
  payoffLabel: string | null;
  totalInterest: number;
  totalPaid: number;
  /** Total balance remaining at the end of each month. */
  series: { label: string; balance: number }[];
  perDebt: DebtPayoff[];
}

const MAX_MONTHS = 600; // 50 years — past this it's "never" for our purposes

/** A card with no stated minimum: the usual 2% of balance, floored at $25. */
export const defaultMinPayment = (balance: number) => round2(Math.max(25, balance * 0.02));

function order(debts: DebtInput[], strategy: Strategy): DebtInput[] {
  const copy = [...debts];
  return strategy === 'avalanche'
    ? copy.sort((a, b) => b.apr - a.apr || a.balance - b.balance)
    : copy.sort((a, b) => a.balance - b.balance || b.apr - a.apr);
}

export function simulatePayoff(
  debts: DebtInput[],
  strategy: Strategy,
  opts: { extraMonthly?: number; now?: Date } = {}
): DebtPlan {
  const extra = Math.max(0, opts.extraMonthly ?? 0);
  const now = opts.now ?? new Date();

  const live = order(debts, strategy)
    .filter((d) => d.balance > 0)
    .map((d) => ({ ...d, remaining: d.balance, interestPaid: 0, clearedAt: null as number | null }));

  const budget = live.reduce((s, d) => s + d.minPayment, 0) + extra;
  const series: { label: string; balance: number }[] = [
    { label: format(now, 'MMM yy'), balance: round2(live.reduce((s, d) => s + d.remaining, 0)) },
  ];

  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;

  while (live.some((d) => d.remaining > 0) && month < MAX_MONTHS) {
    month++;
    const before = live.reduce((s, d) => s + d.remaining, 0);

    // 1. Interest accrues first.
    for (const d of live) {
      if (d.remaining <= 0) continue;
      const interest = d.remaining * (d.apr / 100 / 12);
      d.remaining += interest;
      d.interestPaid += interest;
      totalInterest += interest;
    }

    // 2. Minimums on everything still owing.
    let spent = 0;
    for (const d of live) {
      if (d.remaining <= 0) continue;
      const pay = Math.min(d.minPayment, d.remaining);
      d.remaining -= pay;
      spent += pay;
    }

    // 3. Whatever's left of the budget attacks the target, cascading as debts clear.
    let left = budget - spent;
    for (const d of live) {
      if (left <= 0) break;
      if (d.remaining <= 0) continue;
      const pay = Math.min(left, d.remaining);
      d.remaining -= pay;
      left -= pay;
      spent += pay;
    }
    totalPaid += spent;

    for (const d of live) {
      if (d.remaining <= 0.005 && d.clearedAt == null) {
        d.remaining = 0;
        d.clearedAt = month;
      }
    }

    const after = live.reduce((s, d) => s + d.remaining, 0);
    series.push({ label: format(addMonths(now, month), 'MMM yy'), balance: round2(after) });

    // The budget can't even cover the interest — this never pays off.
    if (after >= before - 0.005) {
      return {
        strategy,
        months: null,
        payoffLabel: null,
        totalInterest: round2(totalInterest),
        totalPaid: round2(totalPaid),
        series,
        perDebt: live.map((d) => ({
          id: d.id,
          name: d.name,
          months: d.clearedAt,
          label: d.clearedAt == null ? null : format(addMonths(now, d.clearedAt), 'MMM yyyy'),
          interestPaid: round2(d.interestPaid),
        })),
      };
    }
  }

  const cleared = live.every((d) => d.remaining <= 0);
  return {
    strategy,
    months: cleared ? month : null,
    payoffLabel: cleared ? format(addMonths(now, month), 'MMM yyyy') : null,
    totalInterest: round2(totalInterest),
    totalPaid: round2(totalPaid),
    series,
    perDebt: live.map((d) => ({
      id: d.id,
      name: d.name,
      months: d.clearedAt,
      label: d.clearedAt == null ? null : format(addMonths(now, d.clearedAt), 'MMM yyyy'),
      interestPaid: round2(d.interestPaid),
    })),
  };
}

/** Both strategies side by side, plus what avalanche saves over snowball. */
export function comparePayoff(
  debts: DebtInput[],
  opts: { extraMonthly?: number; now?: Date } = {}
) {
  const avalanche = simulatePayoff(debts, 'avalanche', opts);
  const snowball = simulatePayoff(debts, 'snowball', opts);
  return {
    avalanche,
    snowball,
    interestSaved: round2(snowball.totalInterest - avalanche.totalInterest),
    monthsSaved:
      avalanche.months != null && snowball.months != null ? snowball.months - avalanche.months : null,
  };
}
