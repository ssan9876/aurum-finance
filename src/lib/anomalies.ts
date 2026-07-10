/**
 * Anomaly detection over recent spending. Three cheap, high-trust signals:
 *
 *  - `duplicate`     the same merchant charged the same amount twice within a
 *                    couple of days — the classic double-charge signature.
 *  - `outlier`       a charge far above what this merchant normally costs,
 *                    judged against the median of its own history.
 *  - `new-merchant`  a large first-ever charge from a merchant you've never
 *                    paid before.
 *
 * Each transaction yields at most one anomaly (duplicate beats outlier beats
 * new-merchant). Rows carrying the reserved `Reviewed` tag are skipped, so
 * dismissing an alert is a tag write and needs no schema change — the same
 * trick the "Paid Bill" and "Transfer" flags use.
 *
 * Pure — safe for renderer, server and tests.
 */
import { differenceInCalendarDays } from 'date-fns';
import { countsAsTransfer } from '@/lib/finance';
import { normalizeMerchant } from '@/lib/rules';
import { parseTags, type Transaction } from '@/shared/types';

/** Reserved tag marking an anomaly as seen (no schema change). */
export const REVIEWED_TAG = 'Reviewed';

export type AnomalyKind = 'duplicate' | 'outlier' | 'new-merchant';

export interface Anomaly {
  /** Stable across recomputes — good for React keys and selection sets. */
  id: string;
  kind: AnomalyKind;
  severity: 'high' | 'medium';
  txId: string;
  date: string;
  merchant: string;
  amount: number;
  /** outlier: this merchant's typical charge, and how many times over it. */
  typical?: number;
  ratio?: number;
  /** duplicate: the earlier charge this one appears to repeat. */
  otherId?: string;
  daysApart?: number;
}

/** Below this, a repeated charge is more likely a habit than a double-charge. */
const DUPLICATE_MIN_AMOUNT = 10;
const DUPLICATE_MAX_DAYS = 2;
/** A merchant needs some history before "unusually expensive" means anything. */
const OUTLIER_MIN_HISTORY = 4;
const OUTLIER_RATIO = 2.5;
const OUTLIER_MIN_EXCESS = 25;
/** A first-ever charge is only worth surfacing when it's substantial. */
const NEW_MERCHANT_MIN_AMOUNT = 100;

const cents = (n: number) => Math.round(n * 100);

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function detectAnomalies(
  txs: Transaction[],
  opts: { now?: Date; lookbackDays?: number } = {}
): Anomaly[] {
  const now = opts.now ?? new Date();
  const lookbackDays = opts.lookbackDays ?? 30;

  const byMerchant = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.type !== 'expense' || countsAsTransfer(t)) continue;
    if (!(t.amount > 0)) continue;
    const key = normalizeMerchant(t.merchant ?? '');
    if (!key) continue;
    const list = byMerchant.get(key);
    if (list) list.push(t);
    else byMerchant.set(key, [t]);
  }

  const out: Anomaly[] = [];
  for (const rows of byMerchant.values()) {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      const age = differenceInCalendarDays(now, new Date(t.date));
      if (age < 0 || age > lookbackDays) continue;
      if (parseTags(t.tags).includes(REVIEWED_TAG)) continue;

      // Only charges strictly earlier in this merchant's series count as history.
      const history = sorted.slice(0, i);

      const twin =
        t.amount >= DUPLICATE_MIN_AMOUNT
          ? history.find(
              (h) =>
                cents(h.amount) === cents(t.amount) &&
                differenceInCalendarDays(new Date(t.date), new Date(h.date)) <= DUPLICATE_MAX_DAYS
            )
          : undefined;
      if (twin) {
        out.push({
          id: `duplicate:${t.id}`,
          kind: 'duplicate',
          severity: 'high',
          txId: t.id,
          date: t.date,
          merchant: t.merchant,
          amount: t.amount,
          otherId: twin.id,
          daysApart: differenceInCalendarDays(new Date(t.date), new Date(twin.date)),
        });
        continue;
      }

      if (history.length >= OUTLIER_MIN_HISTORY) {
        const typical = median(history.map((h) => h.amount));
        if (typical > 0 && t.amount >= typical * OUTLIER_RATIO && t.amount - typical >= OUTLIER_MIN_EXCESS) {
          const ratio = t.amount / typical;
          out.push({
            id: `outlier:${t.id}`,
            kind: 'outlier',
            severity: ratio >= 4 ? 'high' : 'medium',
            txId: t.id,
            date: t.date,
            merchant: t.merchant,
            amount: t.amount,
            typical,
            ratio,
          });
          continue;
        }
      }

      if (history.length === 0 && t.amount >= NEW_MERCHANT_MIN_AMOUNT) {
        out.push({
          id: `new-merchant:${t.id}`,
          kind: 'new-merchant',
          severity: 'medium',
          txId: t.id,
          date: t.date,
          merchant: t.merchant,
          amount: t.amount,
        });
      }
    }
  }

  return out.sort((a, b) => b.date.localeCompare(a.date));
}
