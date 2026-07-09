/**
 * Transfer detection: find expense/income row pairs that are really one
 * account-to-account move (same amount, opposite direction, different
 * accounts, close dates, transfer-looking text) and describe how to merge
 * them into a single `type: 'transfer'` transaction.
 *
 * Used in two places:
 *  - SimpleFIN sync (server): pairs are collapsed before rows are created,
 *    so moving money between synced accounts never lands as expense+income.
 *  - "Detect transfers" cleanup (Transactions page): pairs already in the
 *    database are merged in place (outflow row becomes the transfer, inflow
 *    row is deleted). Balance math is unchanged either way: a transfer
 *    subtracts from `accountId` and adds to `toAccountId` (see finance.ts).
 *
 * Pure — safe for renderer, server and tests.
 */

export interface TransferSide {
  id?: string;
  date: string;
  amount: number;
  type: string;
  merchant: string;
  description?: string | null;
  accountId?: string | null;
  externalId?: string | null;
}

export interface TransferPair<T extends TransferSide> {
  /** The expense side — money leaving `out.accountId`. */
  out: T;
  /** The income side — money arriving in `in.accountId`. */
  in: T;
}

/** How far apart the two sides may post (banks often settle a day or two apart). */
export const MAX_PAIR_GAP_DAYS = 3;

const TRANSFER_TEXT =
  /(transfer|\bxfer\b|\bxfr\b|to share|from share|share \d|to (checking|savings|chk|sav)\b|from (checking|savings|chk|sav)\b|payment thank you|thank you payment|auto ?pay|card ?(payment|pmt)|crcardpmt|\bepay\b|e-payment|online (payment|pmt)|ach pmt|internal|move money|moved? to|withdrawal to|deposit from)/i;

/** Does this row's text look like an account-to-account move? */
export function looksLikeTransfer(t: Pick<TransferSide, 'merchant' | 'description'>): boolean {
  return TRANSFER_TEXT.test(`${t.merchant ?? ''} ${t.description ?? ''}`);
}

const dayDiff = (a: string, b: string) =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;

const cents = (n: number) => Math.round(Math.abs(n) * 100);

/**
 * Greedily pair expense rows with matching income rows. Each row is used at
 * most once; for a given expense the closest-dated income wins. When
 * `requireText` (default) at least one side must look like a transfer —
 * without it a $50 dinner and a $50 Venmo from a friend would pair up.
 */
export function detectTransferPairs<T extends TransferSide>(
  rows: T[],
  opts: { maxDays?: number; requireText?: boolean } = {}
): TransferPair<T>[] {
  const maxDays = opts.maxDays ?? MAX_PAIR_GAP_DAYS;
  const requireText = opts.requireText ?? true;

  const usable = (t: T) => (t.type === 'expense' || t.type === 'income') && !!t.accountId;
  const incomeByAmount = new Map<number, T[]>();
  for (const t of rows) {
    if (!usable(t) || t.type !== 'income') continue;
    const key = cents(t.amount);
    if (!incomeByAmount.has(key)) incomeByAmount.set(key, []);
    incomeByAmount.get(key)!.push(t);
  }

  const used = new Set<T>();
  const pairs: TransferPair<T>[] = [];
  for (const out of rows) {
    if (!usable(out) || out.type !== 'expense') continue;
    const candidates = incomeByAmount.get(cents(out.amount));
    if (!candidates) continue;
    let best: T | null = null;
    let bestGap = Infinity;
    for (const inn of candidates) {
      if (used.has(inn) || inn.accountId === out.accountId) continue;
      const gap = dayDiff(out.date, inn.date);
      if (gap > maxDays || gap >= bestGap) continue;
      if (requireText && !looksLikeTransfer(out) && !looksLikeTransfer(inn)) continue;
      best = inn;
      bestGap = gap;
    }
    if (best) {
      used.add(best);
      pairs.push({ out, in: best });
    }
  }
  return pairs;
}

/**
 * Both sides' bank ids survive on the merged row so a later re-import of
 * either side still dedupes. Split with `splitExternalIds` when building
 * known-id sets.
 */
export function joinExternalIds(a?: string | null, b?: string | null): string | null {
  const ids = [a, b].filter(Boolean) as string[];
  return ids.length ? ids.join('+') : null;
}

export function splitExternalIds(v?: string | null): string[] {
  return v ? v.split('+').filter(Boolean) : [];
}

/** Field changes that turn the pair into one transfer row (applied to `out`). */
export function mergedTransferFields<T extends TransferSide>(pair: TransferPair<T>) {
  const label = looksLikeTransfer(pair.out) || !looksLikeTransfer(pair.in)
    ? pair.out.merchant
    : pair.in.merchant;
  const descriptions = [pair.out.description, pair.in.description].filter(
    (d, i, arr) => d && arr.indexOf(d) === i
  );
  return {
    type: 'transfer' as const,
    merchant: label || 'Transfer',
    description: descriptions.join(' / ') || null,
    accountId: pair.out.accountId,
    toAccountId: pair.in.accountId,
    categoryId: null,
    subcategoryId: null,
    paymentMethod: 'Bank Transfer',
    externalId: joinExternalIds(pair.out.externalId, pair.in.externalId),
  };
}
