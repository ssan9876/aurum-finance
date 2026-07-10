/**
 * What-if simulation: take today's monthly income, spending and savings, apply
 * a few levers, and project savings forward.
 *
 * The levers are deliberately the only three that move the monthly net:
 * cancelling subscriptions removes their cost, a spending change scales what's
 * left, and an income change scales what comes in. Savings then grows by the
 * net each month — no interest is assumed, so the projection never flatters
 * itself with returns the user hasn't earned.
 *
 * Pure — safe for renderer, server and tests.
 */
import { addMonths, format } from 'date-fns';
import { round2 } from '@/lib/utils';

export interface WhatIfInput {
  monthlyIncome: number;
  monthlyExpense: number;
  savingsTotal: number;
  /** Monthly cost removed by cancelling subscriptions. */
  cancelledMonthly: number;
  /** Percent change applied to spending after cancellations, e.g. -10. */
  spendingDeltaPct: number;
  /** Percent change applied to income, e.g. +5 for a raise. */
  incomeDeltaPct: number;
}

export interface WhatIfResult {
  monthlyIncome: number;
  monthlyExpense: number;
  /** Income minus expenses — what lands in savings each month. */
  monthlyNet: number;
  /** Share of income kept, 0..1 (negative when overspending). */
  savingsRate: number;
  yearlySaved: number;
  projection: { label: string; balance: number }[];
}

export function simulateWhatIf(
  input: WhatIfInput,
  opts: { months?: number; now?: Date } = {}
): WhatIfResult {
  const months = opts.months ?? 12;
  const now = opts.now ?? new Date();

  const income = Math.max(0, input.monthlyIncome * (1 + input.incomeDeltaPct / 100));
  const afterCancellations = Math.max(0, input.monthlyExpense - input.cancelledMonthly);
  const expense = Math.max(0, afterCancellations * (1 + input.spendingDeltaPct / 100));
  const net = income - expense;

  const projection: { label: string; balance: number }[] = [];
  for (let m = 0; m <= months; m++) {
    projection.push({
      label: format(addMonths(now, m), 'MMM yy'),
      balance: round2(input.savingsTotal + net * m),
    });
  }

  return {
    monthlyIncome: round2(income),
    monthlyExpense: round2(expense),
    monthlyNet: round2(net),
    savingsRate: income > 0 ? net / income : 0,
    yearlySaved: round2(net * 12),
    projection,
  };
}
