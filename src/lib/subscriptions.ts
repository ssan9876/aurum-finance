/**
 * Subscription detection: find merchants you're charged by on a regular
 * cadence, infer that cadence, normalize the cost to monthly/yearly, and spot
 * price hikes and upcoming renewals.
 *
 * A charge series only counts as a subscription when BOTH the timing and the
 * amount are consistent. Timing alone isn't enough — weekly grocery runs are
 * regular too — so amounts must cluster tightly (a modest price hike still
 * passes, wildly varying tickets don't).
 *
 * Pure — safe for renderer, server and tests.
 */
import { addDays, differenceInCalendarDays } from 'date-fns';
import { countsAsTransfer } from '@/lib/finance';
import { normalizeMerchant } from '@/lib/rules';
import { round2 } from '@/lib/utils';
import type { Transaction } from '@/shared/types';

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

interface CadenceSpec {
  cadence: Cadence;
  /** Accepted gap window in days between consecutive charges. */
  min: number;
  max: number;
  perYear: number;
}

const CADENCES: CadenceSpec[] = [
  { cadence: 'weekly', min: 5, max: 9, perYear: 52 },
  { cadence: 'biweekly', min: 12, max: 16, perYear: 26 },
  { cadence: 'monthly', min: 25, max: 35, perYear: 12 },
  { cadence: 'quarterly', min: 80, max: 100, perYear: 4 },
  { cadence: 'yearly', min: 330, max: 400, perYear: 1 },
];

/** Share of gaps that must land inside the cadence window. */
const GAP_AGREEMENT = 0.6;
/** Max (max−min)/median amount spread — allows a price hike, rejects groceries. */
const MAX_AMOUNT_SPREAD = 0.5;
/** A yearly plan can only ever show two charges in a couple of years of data. */
const MIN_CHARGES: Record<Cadence, number> = {
  weekly: 3,
  biweekly: 3,
  monthly: 3,
  quarterly: 3,
  yearly: 2,
};

export interface PriceChange {
  from: number;
  to: number;
  /** ISO date of the first charge at the new price. */
  at: string;
}

export interface Subscription {
  /** Normalized merchant — stable id for the series. */
  key: string;
  /** Display name, taken from the most recent charge. */
  merchant: string;
  cadence: Cadence;
  /** Most recent charge amount. */
  amount: number;
  monthlyCost: number;
  yearlyCost: number;
  count: number;
  firstDate: string;
  lastDate: string;
  /** Predicted next charge (last charge + the series' typical gap). */
  nextDate: string;
  priceChange: PriceChange | null;
  categoryId: string | null;
  txIds: string[];
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Same price, allowing for rounding noise. */
const samePrice = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.min(a, b) * 0.01);

/**
 * Group expense transactions by merchant and keep the series that look like
 * recurring subscriptions. Sorted by monthly cost, most expensive first.
 */
export function detectSubscriptions(txs: Transaction[]): Subscription[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.type !== 'expense' || countsAsTransfer(t)) continue;
    if (!(t.amount > 0)) continue;
    const key = normalizeMerchant(t.merchant ?? '');
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const out: Subscription[] = [];
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const g = differenceInCalendarDays(new Date(sorted[i].date), new Date(sorted[i - 1].date));
      if (g > 0) gaps.push(g);
    }
    if (!gaps.length) continue;

    const medGap = median(gaps);
    const spec = CADENCES.find((c) => medGap >= c.min && medGap <= c.max);
    if (!spec) continue;
    if (sorted.length < MIN_CHARGES[spec.cadence]) continue;

    const inWindow = gaps.filter((g) => g >= spec.min && g <= spec.max).length;
    if (inWindow / gaps.length < GAP_AGREEMENT) continue;

    const amounts = sorted.map((t) => t.amount);
    const medAmt = median(amounts);
    if (medAmt <= 0) continue;
    if ((Math.max(...amounts) - Math.min(...amounts)) / medAmt > MAX_AMOUNT_SPREAD) continue;

    // Walk back over the trailing run of the current price to find the hike.
    const last = sorted[sorted.length - 1];
    let i = sorted.length - 1;
    while (i > 0 && samePrice(sorted[i - 1].amount, last.amount)) i--;
    const priceChange: PriceChange | null =
      i > 0 ? { from: sorted[i - 1].amount, to: last.amount, at: sorted[i].date } : null;

    out.push({
      key,
      merchant: last.merchant,
      cadence: spec.cadence,
      amount: last.amount,
      monthlyCost: round2((last.amount * spec.perYear) / 12),
      yearlyCost: round2(last.amount * spec.perYear),
      count: sorted.length,
      firstDate: sorted[0].date,
      lastDate: last.date,
      nextDate: addDays(new Date(last.date), Math.round(medGap)).toISOString(),
      priceChange,
      categoryId: last.categoryId ?? null,
      txIds: sorted.map((t) => t.id),
    });
  }

  return out.sort((a, b) => b.monthlyCost - a.monthlyCost);
}

export interface SubscriptionSummary {
  monthlyTotal: number;
  yearlyTotal: number;
  count: number;
  /** Subscriptions whose next charge lands within `withinDays`. */
  renewingSoon: Subscription[];
  /** Subscriptions that got more expensive at their latest charge. */
  priceHikes: Subscription[];
  /** Categories carrying more than one subscription (possible overlap). */
  overlaps: { categoryId: string; subs: Subscription[] }[];
}

export function summarizeSubscriptions(
  subs: Subscription[],
  opts: { now?: Date; withinDays?: number } = {}
): SubscriptionSummary {
  const now = opts.now ?? new Date();
  const withinDays = opts.withinDays ?? 14;
  const horizon = addDays(now, withinDays);

  const byCategory = new Map<string, Subscription[]>();
  for (const s of subs) {
    if (!s.categoryId) continue;
    const list = byCategory.get(s.categoryId);
    if (list) list.push(s);
    else byCategory.set(s.categoryId, [s]);
  }

  return {
    monthlyTotal: round2(subs.reduce((sum, s) => sum + s.monthlyCost, 0)),
    yearlyTotal: round2(subs.reduce((sum, s) => sum + s.yearlyCost, 0)),
    count: subs.length,
    renewingSoon: subs
      .filter((s) => {
        const d = new Date(s.nextDate);
        return d >= now && d <= horizon;
      })
      .sort((a, b) => a.nextDate.localeCompare(b.nextDate)),
    priceHikes: subs.filter((s) => s.priceChange && s.priceChange.to > s.priceChange.from),
    overlaps: [...byCategory.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([categoryId, list]) => ({ categoryId, subs: list })),
  };
}
