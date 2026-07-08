/**
 * Storage client. Picks the right backend at startup:
 *  - Desktop (Electron): typed wrapper over the IPC bridge → Prisma/SQLite.
 *  - Browser (`npm run dev:web` / static deploy): a localStorage adapter with
 *    identical semantics, so the whole app works offline in a plain browser.
 * A future cloud-sync backend only needs to implement `DataApi`.
 */
import {
  normalizeDates,
  type BackupPayload,
  type DataApi,
  type EntityMap,
  type EntityName,
} from '@/shared/types';
import { buildSeedRows, uid } from '@/shared/defaults';

declare global {
  interface Window {
    aurum?: {
      isDesktop: boolean;
      invoke: (method: string, payload?: unknown) => Promise<unknown>;
    };
  }
}

export const isDesktop = typeof window !== 'undefined' && !!window.aurum?.isDesktop;

/* ------------------------------ IPC backend ------------------------------ */

class IpcApi implements DataApi {
  private invoke<T>(method: string, payload?: unknown): Promise<T> {
    return window.aurum!.invoke(method, payload) as Promise<T>;
  }
  list<E extends EntityName>(entity: E) {
    return this.invoke<EntityMap[E][]>('list', { entity });
  }
  create<E extends EntityName>(entity: E, data: Partial<EntityMap[E]>) {
    return this.invoke<EntityMap[E]>('create', { entity, data });
  }
  createMany<E extends EntityName>(entity: E, rows: Partial<EntityMap[E]>[]) {
    return this.invoke<EntityMap[E][]>('createMany', { entity, rows });
  }
  update<E extends EntityName>(entity: E, id: string, data: Partial<EntityMap[E]>) {
    return this.invoke<EntityMap[E]>('update', { entity, id, data });
  }
  async remove(entity: EntityName, id: string) {
    await this.invoke('remove', { entity, id });
  }
  async removeMany(entity: EntityName, ids: string[]) {
    await this.invoke('removeMany', { entity, ids });
  }
  async setSetting(key: string, value: string) {
    await this.invoke('setSetting', { key, value });
  }
  exportAll() {
    return this.invoke<BackupPayload>('exportAll');
  }
  async restore(payload: BackupPayload) {
    await this.invoke('restore', { payload });
  }
}

/* --------------------------- localStorage backend ------------------------ */

type Store = { [K in EntityName]: Record<string, unknown>[] };

const STORE_KEY = 'aurum.web.db';

const EMPTY_STORE: Store = {
  account: [],
  incomeSource: [],
  category: [],
  transaction: [],
  savingsAccount: [],
  savingsSnapshot: [],
  budget: [],
  bill: [],
  goal: [],
  tag: [],
  setting: [],
};

/** Column defaults, mirroring the Prisma schema for adapter parity. */
const LOCAL_DEFAULTS: Partial<Record<EntityName, Record<string, unknown>>> = {
  account: { type: 'checking', startBalance: 0, color: null, icon: null, archived: false, sortOrder: 0 },
  incomeSource: { frequency: 'monthly', active: true, nextPayDate: null, color: null, notes: null },
  category: { type: 'expense', color: '#6366f1', icon: 'circle', parentId: null, sortOrder: 0, isDefault: false },
  transaction: {
    type: 'expense',
    merchant: '',
    description: null,
    categoryId: null,
    subcategoryId: null,
    paymentMethod: null,
    accountId: null,
    toAccountId: null,
    tags: '[]',
    recurring: false,
    receiptImage: null,
    notes: null,
    externalId: null,
  },
  savingsAccount: { balance: 0, goal: null, goalDate: null, monthlyContribution: 0, interestRate: 0, color: null, icon: null, sortOrder: 0 },
  budget: { period: 'monthly', month: null, year: null },
  bill: { frequency: 'monthly', autoPay: false, reminderDays: 3, categoryId: null, accountId: null, notes: null, lastPaidDate: null },
  goal: { type: 'savings', currentAmount: 0, targetDate: null, savingsAccountId: null, color: null, icon: null, notes: null, completedAt: null },
  tag: { color: null },
};

const MONEY_FIELDS = new Set([
  'amount', 'balance', 'startBalance', 'goal', 'monthlyContribution', 'targetAmount', 'currentAmount',
]);

const SORTERS: Partial<Record<EntityName, (a: any, b: any) => number>> = {
  transaction: (a, b) => String(b.date).localeCompare(String(a.date)),
  category: (a, b) => a.sortOrder - b.sortOrder || String(a.createdAt).localeCompare(String(b.createdAt)),
  account: (a, b) => a.sortOrder - b.sortOrder || String(a.createdAt).localeCompare(String(b.createdAt)),
  savingsAccount: (a, b) => a.sortOrder - b.sortOrder || String(a.createdAt).localeCompare(String(b.createdAt)),
  savingsSnapshot: (a, b) => String(a.date).localeCompare(String(b.date)),
  bill: (a, b) => String(a.dueDate).localeCompare(String(b.dueDate)),
};

function roundMoney(data: Record<string, unknown>) {
  for (const k of Object.keys(data)) {
    const v = data[k];
    if (typeof v === 'number' && MONEY_FIELDS.has(k)) data[k] = Math.round(v * 100) / 100;
  }
  return data;
}

class LocalApi implements DataApi {
  private store: Store;

  constructor() {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      this.store = { ...structuredClone(EMPTY_STORE), ...JSON.parse(raw) };
    } else {
      this.store = structuredClone(EMPTY_STORE);
      const seed = buildSeedRows();
      this.store.category = seed.categories;
      this.store.account = seed.accounts;
      this.save();
    }
  }

  private save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(this.store));
  }

  private rows(entity: EntityName) {
    return this.store[entity] ?? (this.store[entity] = []);
  }

  async list<E extends EntityName>(entity: E): Promise<EntityMap[E][]> {
    const sorter =
      SORTERS[entity] ?? ((a: any, b: any) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
    return [...this.rows(entity)].sort(sorter) as unknown as EntityMap[E][];
  }

  async create<E extends EntityName>(entity: E, data: Partial<EntityMap[E]>): Promise<EntityMap[E]> {
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      ...(LOCAL_DEFAULTS[entity] ?? {}),
      createdAt: now,
      ...(entity === 'transaction' ? { updatedAt: now } : {}),
      ...normalizeDates(entity, roundMoney({ ...data } as Record<string, unknown>)),
    };
    if (!row.id) row.id = uid();
    this.rows(entity).push(row);
    this.save();
    return row as unknown as EntityMap[E];
  }

  async createMany<E extends EntityName>(entity: E, rows: Partial<EntityMap[E]>[]): Promise<EntityMap[E][]> {
    const out: EntityMap[E][] = [];
    for (const r of rows) out.push(await this.create(entity, r));
    return out;
  }

  async update<E extends EntityName>(entity: E, id: string, data: Partial<EntityMap[E]>): Promise<EntityMap[E]> {
    const list = this.rows(entity);
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error(`${entity} ${id} not found`);
    const patch = normalizeDates(entity, roundMoney({ ...data } as Record<string, unknown>));
    delete patch.id;
    list[idx] = {
      ...list[idx],
      ...patch,
      ...(entity === 'transaction' ? { updatedAt: new Date().toISOString() } : {}),
    };
    this.save();
    return list[idx] as unknown as EntityMap[E];
  }

  async remove(entity: EntityName, id: string) {
    await this.removeMany(entity, [id]);
  }

  async removeMany(entity: EntityName, ids: string[]) {
    const set = new Set(ids);
    this.store[entity] = this.rows(entity).filter((r) => !set.has(r.id as string));
    // Mirror the schema's cascade rules.
    if (entity === 'category') {
      this.store.category = this.rows('category').filter((c) => !set.has(c.parentId as string));
      this.store.budget = this.rows('budget').filter((b) => !set.has(b.categoryId as string));
      for (const t of this.rows('transaction')) {
        if (set.has(t.categoryId as string)) t.categoryId = null;
        if (set.has(t.subcategoryId as string)) t.subcategoryId = null;
      }
      for (const b of this.rows('bill')) if (set.has(b.categoryId as string)) b.categoryId = null;
    }
    if (entity === 'account') {
      for (const t of this.rows('transaction')) {
        if (set.has(t.accountId as string)) t.accountId = null;
        if (set.has(t.toAccountId as string)) t.toAccountId = null;
      }
      for (const b of this.rows('bill')) if (set.has(b.accountId as string)) b.accountId = null;
    }
    if (entity === 'savingsAccount') {
      this.store.savingsSnapshot = this.rows('savingsSnapshot').filter(
        (s) => !set.has(s.savingsAccountId as string)
      );
      for (const g of this.rows('goal')) if (set.has(g.savingsAccountId as string)) g.savingsAccountId = null;
    }
    this.save();
  }

  async setSetting(key: string, value: string) {
    const list = this.rows('setting');
    const existing = list.find((s) => s.key === key);
    if (existing) existing.value = value;
    else list.push({ id: uid(), key, value });
    this.save();
  }

  async exportAll(): Promise<BackupPayload> {
    return {
      app: 'aurum',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: structuredClone(this.store) as unknown as BackupPayload['data'],
    };
  }

  async restore(payload: BackupPayload) {
    if (!payload || payload.app !== 'aurum' || !payload.data) {
      throw new Error('Not a valid Aurum backup file.');
    }
    this.store = { ...structuredClone(EMPTY_STORE), ...structuredClone(payload.data) } as Store;
    this.save();
  }
}

/* ------------------------------ HTTP backend ------------------------------ */

const SERVER_KEY_STORAGE = 'aurum.serverKey';

export function getServerKey(): string {
  return localStorage.getItem(SERVER_KEY_STORAGE) ?? '';
}

export function setServerKey(key: string) {
  localStorage.setItem(SERVER_KEY_STORAGE, key);
}

/** Talks to the self-hosted Aurum server (server/index.ts). */
class HttpApi implements DataApi {
  private async invoke<T>(method: string, payload?: unknown): Promise<T> {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-aurum-key': getServerKey() },
      body: JSON.stringify({ method, payload }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        res.status === 401 ? 'Not authorized — reload and enter the server password.' : (body.error ?? `Request failed (${res.status})`)
      );
    }
    return body.result as T;
  }
  list<E extends EntityName>(entity: E) {
    return this.invoke<EntityMap[E][]>('list', { entity });
  }
  create<E extends EntityName>(entity: E, data: Partial<EntityMap[E]>) {
    return this.invoke<EntityMap[E]>('create', { entity, data });
  }
  createMany<E extends EntityName>(entity: E, rows: Partial<EntityMap[E]>[]) {
    return this.invoke<EntityMap[E][]>('createMany', { entity, rows });
  }
  update<E extends EntityName>(entity: E, id: string, data: Partial<EntityMap[E]>) {
    return this.invoke<EntityMap[E]>('update', { entity, id, data });
  }
  async remove(entity: EntityName, id: string) {
    await this.invoke('remove', { entity, id });
  }
  async removeMany(entity: EntityName, ids: string[]) {
    await this.invoke('removeMany', { entity, ids });
  }
  async setSetting(key: string, value: string) {
    await this.invoke('setSetting', { key, value });
  }
  exportAll() {
    return this.invoke<BackupPayload>('exportAll');
  }
  async restore(payload: BackupPayload) {
    await this.invoke('restore', { payload });
  }
}

/* ---------------------------- backend selection --------------------------- */

export type BackendMode = 'desktop' | 'server' | 'browser';

export let backendMode: BackendMode = 'browser';

// Assigned by initApi() before the React tree renders; every consumer uses
// the live module binding, so the indirection is invisible to callers.
export let api: DataApi;

export interface BackendStatus {
  mode: BackendMode;
  needsAuth: boolean;
}

/**
 * Pick the storage backend:
 *  1. Electron preload present → IPC/SQLite.
 *  2. An Aurum server answering /api/health → HTTP/SQLite (self-hosted).
 *  3. Otherwise → localStorage (static web / dev).
 */
export async function initApi(): Promise<BackendStatus> {
  if (isDesktop) {
    api = new IpcApi();
    backendMode = 'desktop';
    return { mode: backendMode, needsAuth: false };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch('/api/health', {
      headers: { 'x-aurum-key': getServerKey() },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const health = await res.json();
      if (health?.app === 'aurum') {
        api = new HttpApi();
        backendMode = 'server';
        return { mode: backendMode, needsAuth: health.authRequired && !health.authOk };
      }
    }
  } catch {
    /* no server — fall through to browser storage */
  }
  api = new LocalApi();
  backendMode = 'browser';
  return { mode: backendMode, needsAuth: false };
}
