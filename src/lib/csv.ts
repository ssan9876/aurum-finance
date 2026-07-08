/**
 * Import/export: CSV (papaparse), Excel (SheetJS, lazy-loaded), and full
 * JSON backup/restore through the storage client.
 */
import Papa from 'papaparse';
import { format } from 'date-fns';
import { api } from '@/data/api';
import { downloadFile, readFileAsText } from '@/lib/files';
import { round2 } from '@/lib/utils';
import { parseTags, type Account, type BackupPayload, type Category, type Transaction } from '@/shared/types';

export interface TxExportRow {
  Date: string;
  Type: string;
  Amount: number;
  Merchant: string;
  Description: string;
  Category: string;
  Subcategory: string;
  'Payment Method': string;
  Account: string;
  Tags: string;
  Recurring: string;
  Notes: string;
}

export function buildTxRows(
  txs: Transaction[],
  categories: Category[],
  accounts: Account[]
): TxExportRow[] {
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  return txs.map((t) => ({
    Date: format(new Date(t.date), 'yyyy-MM-dd'),
    Type: t.type,
    Amount: t.amount,
    Merchant: t.merchant,
    Description: t.description ?? '',
    Category: (t.categoryId && catName.get(t.categoryId)) || '',
    Subcategory: (t.subcategoryId && catName.get(t.subcategoryId)) || '',
    'Payment Method': t.paymentMethod ?? '',
    Account: (t.accountId && accName.get(t.accountId)) || '',
    Tags: parseTags(t.tags).join(', '),
    Recurring: t.recurring ? 'yes' : 'no',
    Notes: t.notes ?? '',
  }));
}

export function exportTransactionsCsv(txs: Transaction[], categories: Category[], accounts: Account[]) {
  const csv = Papa.unparse(buildTxRows(txs, categories, accounts));
  downloadFile(`aurum-transactions-${format(new Date(), 'yyyy-MM-dd')}.csv`, csv, 'text/csv');
}

export async function exportTransactionsXlsx(
  txs: Transaction[],
  categories: Category[],
  accounts: Account[]
) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(buildTxRows(txs, categories, accounts));
  XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
  XLSX.writeFile(wb, `aurum-transactions-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
}

/** Multi-sheet report export used by Analytics. */
export async function exportReportXlsx(
  name: string,
  sheets: { name: string; rows: Record<string, string | number>[] }[]
) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    if (!sheet.rows.length) continue;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet.rows), sheet.name.slice(0, 31));
  }
  XLSX.writeFile(wb, `${name}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
}

export function exportReportCsv(name: string, rows: Record<string, string | number>[]) {
  downloadFile(`${name}-${format(new Date(), 'yyyy-MM-dd')}.csv`, Papa.unparse(rows), 'text/csv');
}

/* --------------------------------- import -------------------------------- */

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsvFile(file: File): Promise<CsvParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        resolve({ headers: res.meta.fields ?? [], rows: res.data });
      },
      error: (err) => reject(err),
    });
  });
}

export interface CsvMapping {
  date: string;
  amount: string;
  merchant: string;
  description?: string;
  category?: string;
  notes?: string;
}

/** Convert mapped CSV rows into transaction drafts. Skips unparseable rows. */
export function rowsToTransactions(
  rows: Record<string, string>[],
  mapping: CsvMapping,
  categories: Category[],
  accountId: string | null
): { drafts: Partial<Transaction>[]; skipped: number } {
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const drafts: Partial<Transaction>[] = [];
  let skipped = 0;
  for (const row of rows) {
    const rawDate = row[mapping.date]?.trim();
    const rawAmount = row[mapping.amount]?.replace(/[$,\s]/g, '');
    const date = rawDate ? new Date(rawDate) : null;
    const amount = rawAmount ? Number(rawAmount) : NaN;
    if (!date || Number.isNaN(date.getTime()) || Number.isNaN(amount) || amount === 0) {
      skipped++;
      continue;
    }
    const catRaw = mapping.category ? row[mapping.category]?.trim().toLowerCase() : '';
    const category = catRaw ? catByName.get(catRaw) : undefined;
    drafts.push({
      date: date.toISOString(),
      amount: round2(Math.abs(amount)),
      type: amount < 0 ? 'expense' : 'income',
      merchant: row[mapping.merchant]?.trim() || '(imported)',
      description: mapping.description ? row[mapping.description]?.trim() || null : null,
      categoryId: category ? (category.parentId ?? category.id) : null,
      subcategoryId: category?.parentId ? category.id : null,
      notes: mapping.notes ? row[mapping.notes]?.trim() || null : null,
      accountId,
    });
  }
  return { drafts, skipped };
}

/* --------------------------------- backup -------------------------------- */

export async function downloadBackup() {
  const payload = await api.exportAll();
  downloadFile(
    `aurum-backup-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`,
    JSON.stringify(payload, null, 2),
    'application/json'
  );
}

export async function restoreBackupFromFile(file: File) {
  const text = await readFileAsText(file);
  let payload: BackupPayload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  await api.restore(payload);
}
