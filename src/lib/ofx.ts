/**
 * OFX / QFX statement parser (Chase, Amex, most US banks).
 *
 * Handles both OFX 1.x (SGML — leaf tags have no closing tag) and OFX 2.x
 * (XML) by regex-scanning <STMTTRN> containers rather than a strict parse.
 * Each transaction carries a bank-issued FITID, which we store as
 * `externalId` so re-importing overlapping date ranges never duplicates.
 */
import { round2 } from '@/lib/utils';
import type { Transaction } from '@/shared/types';

export interface OfxStatementTransaction {
  fitId: string;
  /** ISO date (noon local to avoid timezone day-shifts) */
  date: string;
  /** Signed amount as reported: negative = money out */
  amount: number;
  name: string;
  memo?: string;
  trnType?: string;
}

export interface OfxParseResult {
  transactions: OfxStatementTransaction[];
  /** Bank/card account id from the file, when present */
  accountId?: string;
  org?: string;
  currency?: string;
}

/** Value of a leaf tag inside a block: `<TAG>value` (SGML) or `<TAG>value</TAG>`. */
function leaf(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, 'i'));
  const v = m?.[1]?.trim();
  return v ? v : undefined;
}

/** OFX dates: YYYYMMDD[HHMMSS[.sss]][ [gmt offset:tz] ] */
function parseOfxDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(`${y}-${mo}-${d}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  // Some European exports use a comma decimal separator.
  const normalized = raw.includes(',') && !raw.includes('.') ? raw.replace(',', '.') : raw;
  const n = Number(normalized.replace(/[^0-9.+-]/g, ''));
  return Number.isNaN(n) ? null : n;
}

export function looksLikeOfx(text: string): boolean {
  return /<OFX>/i.test(text) || /OFXHEADER/i.test(text);
}

export function parseOfx(text: string): OfxParseResult {
  const transactions: OfxStatementTransaction[] = [];
  const seen = new Set<string>();

  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  // Rare SGML files omit </STMTTRN>; fall back to splitting on the open tag.
  const rawBlocks =
    blocks.length > 0
      ? blocks
      : text
          .split(/<STMTTRN>/i)
          .slice(1)
          .map((chunk) => chunk.split(/<\/?(?:BANKTRANLIST|STMTRS|CCSTMTRS|LEDGERBAL)>/i)[0]);

  for (const block of rawBlocks) {
    const amount = parseAmount(leaf(block, 'TRNAMT'));
    const date = parseOfxDate(leaf(block, 'DTPOSTED'));
    if (amount == null || amount === 0 || !date) continue;
    const fitId = leaf(block, 'FITID') ?? `${date}:${amount}:${leaf(block, 'NAME') ?? ''}`;
    if (seen.has(fitId)) continue;
    seen.add(fitId);
    transactions.push({
      fitId,
      date,
      amount,
      name: leaf(block, 'NAME') ?? leaf(block, 'PAYEE') ?? leaf(block, 'MEMO') ?? '(imported)',
      memo: leaf(block, 'MEMO'),
      trnType: leaf(block, 'TRNTYPE'),
    });
  }

  return {
    transactions,
    accountId: leaf(text, 'ACCTID'),
    org: leaf(text, 'ORG'),
    currency: leaf(text, 'CURDEF'),
  };
}

/**
 * Convert parsed OFX rows to transaction drafts, skipping any FITID that
 * already exists in the ledger. Sign convention: negative = expense.
 */
export function ofxToTransactions(
  parsed: OfxParseResult,
  existing: Transaction[],
  accountId: string | null
): { drafts: Partial<Transaction>[]; duplicates: number } {
  const known = new Set(existing.map((t) => t.externalId).filter(Boolean) as string[]);
  const drafts: Partial<Transaction>[] = [];
  let duplicates = 0;
  for (const t of parsed.transactions) {
    if (known.has(t.fitId)) {
      duplicates++;
      continue;
    }
    drafts.push({
      date: t.date,
      amount: round2(Math.abs(t.amount)),
      type: t.amount < 0 ? 'expense' : 'income',
      merchant: cleanName(t.name),
      description: t.memo && t.memo !== t.name ? t.memo : null,
      accountId,
      externalId: t.fitId,
    });
  }
  return { drafts, duplicates };
}

/** Bank NAME fields tend to be shouty and padded. */
function cleanName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (trimmed === trimmed.toUpperCase() && trimmed.length > 3) {
    return trimmed
      .toLowerCase()
      .replace(/(^|[\s.-])([a-z])/g, (m) => m.toUpperCase());
  }
  return trimmed;
}
