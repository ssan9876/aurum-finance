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
import { RULES_KEY, matchRule, parseRules } from '../src/lib/rules';
import type { Account, Category, Setting, Transaction } from '../src/shared/types';

const ACCESS_KEY = 'simplefin.accessUrl';
const MAP_KEY = 'simplefin.accountMap';
const LAST_SYNC_KEY = 'simplefin.lastSync';

const DAY = 24 * 60 * 60 * 1000;
const FIRST_SYNC_DAYS = 90;
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

export async function simplefinSync(service: DataService) {
  const accessUrl = await getSetting(service, ACCESS_KEY);
  if (!accessUrl) throw new Error('SimpleFIN is not connected.');

  const lastSync = await getSetting(service, LAST_SYNC_KEY);
  const startDate = lastSync
    ? new Date(new Date(lastSync).getTime() - RESYNC_OVERLAP_DAYS * DAY)
    : new Date(Date.now() - FIRST_SYNC_DAYS * DAY);

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

  const knownExternal = new Set(transactions.map((t) => t.externalId).filter(Boolean) as string[]);
  const fingerprint = (date: string, amount: number, merchant: string) =>
    `${date.slice(0, 10)}|${round2(Math.abs(amount)).toFixed(2)}|${merchant.trim().toLowerCase()}`;
  const knownRows = new Set(transactions.map((t) => fingerprint(t.date, t.amount, t.merchant)));

  const summary: { account: string; aurumAccount: string; newTransactions: number }[] = [];
  let created = 0;
  let duplicates = 0;
  let autoCategorized = 0;
  let mapChanged = false;

  for (const sfin of sfinAccounts) {
    // Resolve (or create) the matching Aurum account.
    let account = accountMap[sfin.id] ? accounts.find((a) => a.id === accountMap[sfin.id]) : undefined;
    if (!account) {
      account = accounts.find((a) => a.name.trim().toLowerCase() === sfin.name.trim().toLowerCase());
    }
    const rows = (sfin.transactions ?? []).filter((t) => !t.pending);
    if (!account) {
      // Back-compute startBalance so startBalance + imported rows = bank balance.
      const net = rows.reduce((sum, t) => sum + Number(t.amount), 0);
      account = (await service.handle('create', {
        entity: 'account',
        data: {
          name: sfin.name,
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

    const drafts: Partial<Transaction>[] = [];
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
      const type = amount < 0 ? 'expense' : 'income';
      let categoryId: string | null = null;
      let subcategoryId: string | null = null;
      const rule = matchRule(rules, merchant, categories);
      const ruleCat = rule ? categories.find((c) => c.id === rule.categoryId) : undefined;
      if (rule && ruleCat?.type === type) {
        categoryId = rule.categoryId;
        subcategoryId = rule.subcategoryId;
        autoCategorized++;
      }
      drafts.push({
        date,
        amount: round2(Math.abs(amount)),
        type,
        merchant,
        description: t.memo && t.memo !== t.description ? t.memo : t.description || null,
        categoryId,
        subcategoryId,
        accountId: account.id,
        externalId,
      });
      knownExternal.add(externalId);
      knownRows.add(fingerprint(date, amount, merchant));
    }
    if (drafts.length) {
      await service.handle('createMany', { entity: 'transaction', rows: drafts });
      created += drafts.length;
    }
    summary.push({ account: sfin.name, aurumAccount: account.name, newTransactions: drafts.length });
  }

  if (mapChanged) await setSetting(service, MAP_KEY, JSON.stringify(accountMap));
  const syncedAt = new Date().toISOString();
  await setSetting(service, LAST_SYNC_KEY, syncedAt);

  return {
    syncedAt,
    created,
    duplicatesSkipped: duplicates,
    autoCategorized,
    accounts: summary,
    errors: errors.length ? errors : undefined,
  };
}
