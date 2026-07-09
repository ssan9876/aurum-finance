/**
 * SimpleFIN Bridge bank sync (https://bridge.simplefin.org).
 *
 * The user pastes a one-time SETUP TOKEN (a base64-encoded claim URL) from
 * the Bridge; we claim it once, which yields a permanent ACCESS URL with
 * embedded basic-auth credentials. That URL is stored in the `setting` table
 * and polled for `/accounts` (with transactions) on demand and by the daily
 * scheduler.
 *
 * Import semantics match the rest of Aurum:
 *  - amounts are positive, direction comes from `type` (SimpleFIN negatives
 *    are outflows → expenses)
 *  - `externalId` = `sfin:<tx id>` for exact dedup, plus a
 *    date+amount+merchant fingerprint so statements already imported via
 *    OFX/CSV aren't duplicated
 *  - uncategorized rows go through the learned auto-categorization rules
 *  - SimpleFIN accounts map to Aurum accounts by stored mapping, then name,
 *    and are auto-created otherwise (startBalance back-computed so the
 *    running balance lands exactly on the bank's reported balance)
 */
import type { DataService } from './data-service';
import { RULES_KEY, applyRulesToDrafts, parseRules } from '../src/lib/rules';
import { applyKeywordsToDrafts } from '../src/lib/keywords';
import {
  detectTransferPairs,
  mergedTransferFields,
  splitExternalIds,
} from '../src/lib/transfers';
import { SAVINGS_CATEGORY, applySavingsCategory } from '../src/lib/savings-category';
import type { Account, Category, Setting, Transaction } from '../src/shared/types';

const ACCESS_KEY = 'simplefin.accessUrl';
const MAP_KEY = 'simplefin.accountMap';
const LAST_SYNC_KEY = 'simplefin.lastSync';

const DAY = 24 * 60 * 60 * 1000;
const FIRST_SYNC_DAYS = 90;
/** A "full" re-sync reaches back this far to backfill history in one pass. */
const FULL_SYNC_DAYS = 730;
const RESYNC_OVERLAP_DAYS = 7;

interface SfinTransaction {
  id: string;
  posted: number; // unix seconds
  amount: string; // "-4.50"
  description?: string;
  payee?: string;
  memo?: string;
  pending?: boolean;
}

interface SfinAccount {
  id: string;
  name: string;
  currency?: string;
  balance: string;
  org?: { name?: string; domain?: string };
  transactions?: SfinTransaction[];
}

interface SfinAccountSet {
  errors?: string[];
  accounts?: SfinAccount[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function getSetting(service: DataService, key: string): Promise<string | null> {
  const rows = (await service.handle('list', { entity: 'setting' })) as Setting[];
  return rows.find((s) => s.key === key)?.value ?? null;
}

async function setSetting(service: DataService, key: string, value: string) {
  await service.handle('setSetting', { key, value });
}

/** Split an access URL's embedded credentials into a fetchable base + header. */
function accessParts(accessUrl: string): { base: string; headers: Record<string, string> } {
  const u = new URL(accessUrl);
  const auth = Buffer.from(
    `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`
  ).toString('base64');
  u.username = '';
  u.password = '';
  return { base: u.href.replace(/\/$/, ''), headers: { Authorization: `Basic ${auth}` } };
}

async function fetchAccounts(accessUrl: string, startDate: Date): Promise<SfinAccountSet> {
  const { base, headers } = accessParts(accessUrl);
  const res = await fetch(`${base}/accounts?start-date=${Math.floor(startDate.getTime() / 1000)}`, {
    headers,
  });
  if (!res.ok) {
    throw new Error(`SimpleFIN responded ${res.status} — reconnect with a fresh setup token if this persists.`);
  }
  return (await res.json()) as SfinAccountSet;
}

export async function simplefinConfigured(service: DataService): Promise<boolean> {
  return !!(await getSetting(service, ACCESS_KEY));
}

export async function simplefinStatus(service: DataService) {
  const [accessUrl, lastSync] = await Promise.all([
    getSetting(service, ACCESS_KEY),
    getSetting(service, LAST_SYNC_KEY),
  ]);
  return { connected: !!accessUrl, lastSync: lastSync || null };
}

/**
 * Accepts either a SimpleFIN setup token (base64 claim URL — claimed once
 * with an empty POST) or a ready access URL, verifies it, and stores it.
 */
export async function simplefinConnect(service: DataService, token: string) {
  const input = token.trim();
  if (!input) throw new Error('Paste your SimpleFIN setup token first.');
  let accessUrl: string;
  if (/^https?:\/\//i.test(input)) {
    accessUrl = input;
  } else {
    let claimUrl: string;
    try {
      claimUrl = Buffer.from(input, 'base64').toString('utf8').trim();
    } catch {
      throw new Error('That does not look like a SimpleFIN setup token.');
    }
    if (!/^https?:\/\//i.test(claimUrl)) {
      throw new Error('That does not look like a SimpleFIN setup token.');
    }
    const res = await fetch(claimUrl, { method: 'POST', headers: { 'Content-Length': '0' } });
    if (!res.ok) {
      throw new Error(`Could not claim the setup token (HTTP ${res.status}) — tokens are single-use, generate a new one.`);
    }
    accessUrl = (await res.text()).trim();
  }
  // Verify before storing — a cheap 1-day window request.
  const check = await fetchAccounts(accessUrl, new Date(Date.now() - DAY));
  await setSetting(service, ACCESS_KEY, accessUrl);
  return { connected: true, accounts: (check.accounts ?? []).map((a) => a.name) };
}

export async function simplefinDisconnect(service: DataService) {
  await setSetting(service, ACCESS_KEY, '');
  await setSetting(service, LAST_SYNC_KEY, '');
  return { connected: false };
}

function guessAccountType(name: string): Account['type'] {
  const n = name.toLowerCase();
  if (/credit|card/.test(n)) return 'credit';
  if (/loan|mortgage|heloc|student|auto ?loan/.test(n)) return 'loan';
  if (/sav/.test(n)) return 'savings';
  if (/invest|broker|401|ira/.test(n)) return 'investment';
  return 'checking';
}

/** Bank descriptions tend to be shouty; mirror the OFX importer's cleanup. */
function cleanName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (trimmed === trimmed.toUpperCase() && trimmed.length > 3) {
    return trimmed.toLowerCase().replace(/(^|[\s.-])([a-z])/g, (m) => m.toUpperCase());
  }
  return trimmed;
}

export async function simplefinSync(service: DataService, opts: { full?: boolean } = {}) {
  const accessUrl = await getSetting(service, ACCESS_KEY);
  if (!accessUrl) throw new Error('SimpleFIN is not connected.');

  const lastSync = await getSetting(service, LAST_SYNC_KEY);
  const startDate =
    !opts.full && lastSync
      ? new Date(new Date(lastSync).getTime() - RESYNC_OVERLAP_DAYS * DAY)
      : new Date(Date.now() - (opts.full ? FULL_SYNC_DAYS : FIRST_SYNC_DAYS) * DAY);

  const data = await fetchAccounts(accessUrl, startDate);
  const errors = data.errors ?? [];
  const sfinAccounts = data.accounts ?? [];

  const [accounts, categories, transactions, settings] = (await Promise.all([
    service.handle('list', { entity: 'account' }),
    service.handle('list', { entity: 'category' }),
    service.handle('list', { entity: 'transaction' }),
    service.handle('list', { entity: 'setting' }),
  ])) as [Account[], Category[], Transaction[], Setting[]];

  const rules = parseRules(settings.find((s) => s.key === RULES_KEY)?.value);
  let accountMap: Record<string, string> = {};
  try {
    accountMap = JSON.parse(settings.find((s) => s.key === MAP_KEY)?.value ?? '{}');
  } catch {
    /* rebuild below */
  }

  const createCategory = (d: Partial<Category>) =>
    service.handle('create', { entity: 'category', data: d }) as Promise<Category>;

  // A stored transfer keeps BOTH sides' bank ids joined with "+"; split them so
  // re-syncing either leg dedupes against the merged row.
  const knownExternal = new Set(transactions.flatMap((t) => splitExternalIds(t.externalId)));
  const fingerprint = (date: string, amount: number, merchant: string) =>
    `${date.slice(0, 10)}|${round2(Math.abs(amount)).toFixed(2)}|${merchant.trim().toLowerCase()}`;
  const knownRows = new Set(transactions.map((t) => fingerprint(t.date, t.amount, t.merchant)));

  // Account ids already bound to a SimpleFIN account — never let a fresh
  // SimpleFIN account name-match onto one another id already owns, which is
  // what collapsed multiple banks into a single Aurum account before.
  const boundAurumIds = new Set(Object.values(accountMap));
  let mapChanged = false;

  interface SyncDraft extends Partial<Transaction> {
    accountId: string;
  }
  const drafts: SyncDraft[] = [];
  const perAccount = new Map<string, { sfinName: string; aurumName: string; count: number }>();
  let duplicates = 0;

  // Phase 1 — resolve each SimpleFIN account to an Aurum account (by stored
  // mapping, then unclaimed name match, else auto-create) and stage its rows.
  for (const sfin of sfinAccounts) {
    let account = accountMap[sfin.id] ? accounts.find((a) => a.id === accountMap[sfin.id]) : undefined;
    if (!account) {
      account = accounts.find(
        (a) => !boundAurumIds.has(a.id) && a.name.trim().toLowerCase() === sfin.name.trim().toLowerCase()
      );
    }
    const rows = (sfin.transactions ?? []).filter((t) => !t.pending);
    if (!account) {
      // Back-compute startBalance so startBalance + imported rows = bank balance.
      const net = rows.reduce((sum, t) => sum + Number(t.amount), 0);
      account = (await service.handle('create', {
        entity: 'account',
        data: {
          name: cleanName(sfin.name),
          type: guessAccountType(sfin.name),
          startBalance: round2(Number(sfin.balance) - net),
        },
      })) as Account;
      accounts.push(account);
    }
    if (accountMap[sfin.id] !== account.id) {
      accountMap[sfin.id] = account.id;
      mapChanged = true;
    }
    boundAurumIds.add(account.id);
    perAccount.set(sfin.id, { sfinName: sfin.name, aurumName: account.name, count: 0 });

    for (const t of rows) {
      const externalId = `sfin:${t.id}`;
      const amount = Number(t.amount);
      if (Number.isNaN(amount) || amount === 0) continue;
      const date = new Date(t.posted * 1000).toISOString();
      const merchant = cleanName(t.payee || t.description || '(bank transaction)');
      if (knownExternal.has(externalId) || knownRows.has(fingerprint(date, amount, merchant))) {
        duplicates++;
        continue;
      }
      knownExternal.add(externalId);
      knownRows.add(fingerprint(date, amount, merchant));
      drafts.push({
        date,
        amount: round2(Math.abs(amount)),
        type: amount < 0 ? 'expense' : 'income',
        merchant,
        description: t.memo && t.memo !== t.description ? t.memo : t.description || null,
        categoryId: null,
        subcategoryId: null,
        accountId: account.id,
        externalId,
      });
    }
  }

  // Phase 2 — collapse expense/income pairs that are really one move between
  // two synced accounts into a single transfer (fixes the "duplicate when I
  // move money around" problem). Both bank ids ride along on the kept row.
  const pairs = detectTransferPairs(
    drafts.map((d) => ({
      date: d.date!,
      amount: d.amount!,
      type: d.type!,
      merchant: d.merchant!,
      description: d.description,
      accountId: d.accountId,
      externalId: d.externalId,
      _ref: d,
    }))
  );
  const dropped = new Set<SyncDraft>();
  let transfersMerged = 0;
  for (const pair of pairs) {
    const outRef = (pair.out as unknown as { _ref: SyncDraft })._ref;
    const inRef = (pair.in as unknown as { _ref: SyncDraft })._ref;
    Object.assign(outRef, mergedTransferFields(pair));
    dropped.add(inRef);
    transfersMerged++;
  }
  const finalDrafts = drafts.filter((d) => !dropped.has(d));

  // Phase 3 — categorize the non-transfer rows: learned rules first, then the
  // built-in keyword library, then the Savings category for savings accounts.
  const autoCategorized =
    applyRulesToDrafts(finalDrafts, rules, categories) +
    (await applyKeywordsToDrafts(finalDrafts, categories, createCategory)) +
    (await applySavingsCategory(finalDrafts, accounts, categories, createCategory));

  // Phase 4 — persist, tallying per-account so the summary still reports counts.
  const countByAccount = new Map<string, number>();
  for (const d of finalDrafts) countByAccount.set(d.accountId, (countByAccount.get(d.accountId) ?? 0) + 1);
  for (const [sfinId, entry] of perAccount) {
    const aurumId = accountMap[sfinId];
    entry.count = aurumId ? countByAccount.get(aurumId) ?? 0 : 0;
  }
  if (finalDrafts.length) {
    await service.handle('createMany', { entity: 'transaction', rows: finalDrafts });
  }

  if (mapChanged) await setSetting(service, MAP_KEY, JSON.stringify(accountMap));
  const syncedAt = new Date().toISOString();
  await setSetting(service, LAST_SYNC_KEY, syncedAt);

  return {
    syncedAt,
    created: finalDrafts.length,
    duplicatesSkipped: duplicates,
    autoCategorized,
    transfersMerged,
    accounts: [...perAccount.values()].map((e) => ({
      account: e.sfinName,
      aurumAccount: e.aurumName,
      newTransactions: e.count,
    })),
    errors: errors.length ? errors : undefined,
  };
}
