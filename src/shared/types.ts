/**
 * Renderer-side entity types. These mirror the Prisma schema, but every
 * DateTime crosses the IPC boundary as an ISO string, so dates are strings
 * here. The same shapes are used by the browser (localStorage) adapter, which
 * keeps the whole UI backend-agnostic — a future cloud-sync adapter only has
 * to implement `DataApi`.
 */

export type AccountType = 'checking' | 'savings' | 'credit' | 'cash' | 'investment' | 'loan';
export type Frequency =
  | 'weekly'
  | 'biweekly'
  | 'twicemonthly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'onetime';
export type TransactionType = 'expense' | 'income' | 'transfer';
export type CategoryType = 'expense' | 'income';
export type BudgetPeriod = 'monthly' | 'yearly';
export type GoalType = 'savings' | 'debt' | 'purchase' | 'custom';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  startBalance: number;
  /** Annual interest rate %, for credit cards and loans. */
  apr?: number | null;
  /** Minimum monthly payment, for credit cards and loans. */
  minPayment?: number | null;
  color?: string | null;
  icon?: string | null;
  archived: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface IncomeSource {
  id: string;
  name: string;
  /** Net (take-home) per pay period — all income math uses this. */
  amount: number;
  /** Gross per pay period; deduction % is derived from gross vs net. */
  grossAmount?: number | null;
  frequency: Frequency;
  active: boolean;
  nextPayDate?: string | null;
  color?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  color: string;
  icon: string;
  parentId?: string | null;
  sortOrder: number;
  isDefault: boolean;
  createdAt: string;
}

export interface Transaction {
  id: string;
  date: string;
  amount: number;
  type: TransactionType;
  merchant: string;
  description?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  paymentMethod?: string | null;
  accountId?: string | null;
  toAccountId?: string | null;
  /** JSON-encoded string[] — use parseTags/serializeTags */
  tags: string;
  recurring: boolean;
  receiptImage?: string | null;
  notes?: string | null;
  /** Provider/bank transaction id (OFX FITID) used to dedupe imports. */
  externalId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavingsAccount {
  id: string;
  name: string;
  balance: number;
  goal?: number | null;
  goalDate?: string | null;
  monthlyContribution: number;
  interestRate: number;
  color?: string | null;
  icon?: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface SavingsSnapshot {
  id: string;
  savingsAccountId: string;
  date: string;
  balance: number;
}

export interface Budget {
  id: string;
  categoryId: string;
  amount: number;
  period: BudgetPeriod;
  month?: number | null;
  year?: number | null;
  createdAt: string;
}

export interface Bill {
  id: string;
  name: string;
  amount: number;
  /** Next due date; advanced by `frequency` when marked paid. */
  dueDate: string;
  frequency: Frequency | 'once';
  autoPay: boolean;
  reminderDays: number;
  categoryId?: string | null;
  accountId?: string | null;
  notes?: string | null;
  lastPaidDate?: string | null;
  createdAt: string;
}

export interface Goal {
  id: string;
  name: string;
  type: GoalType;
  targetAmount: number;
  currentAmount: number;
  targetDate?: string | null;
  savingsAccountId?: string | null;
  color?: string | null;
  icon?: string | null;
  notes?: string | null;
  completedAt?: string | null;
  createdAt: string;
}

export interface Tag {
  id: string;
  name: string;
  color?: string | null;
}

export interface Setting {
  id: string;
  key: string;
  value: string;
}

export interface EntityMap {
  account: Account;
  incomeSource: IncomeSource;
  category: Category;
  transaction: Transaction;
  savingsAccount: SavingsAccount;
  savingsSnapshot: SavingsSnapshot;
  budget: Budget;
  bill: Bill;
  goal: Goal;
  tag: Tag;
  setting: Setting;
}

export type EntityName = keyof EntityMap;

export const ENTITIES: EntityName[] = [
  'account',
  'incomeSource',
  'category',
  'transaction',
  'savingsAccount',
  'savingsSnapshot',
  'budget',
  'bill',
  'goal',
  'tag',
  'setting',
];

/** Fields that must be normalized to full ISO datetimes before persisting. */
export const DATE_FIELDS: Partial<Record<EntityName, string[]>> = {
  transaction: ['date'],
  incomeSource: ['nextPayDate'],
  savingsAccount: ['goalDate'],
  savingsSnapshot: ['date'],
  bill: ['dueDate', 'lastPaidDate'],
  goal: ['targetDate', 'completedAt'],
};

export interface BackupPayload {
  app: 'aurum';
  version: 1;
  exportedAt: string;
  data: { [K in EntityName]?: EntityMap[K][] };
}

/** The wire protocol between the renderer and any storage backend. */
export interface DataApi {
  list<E extends EntityName>(entity: E): Promise<EntityMap[E][]>;
  create<E extends EntityName>(entity: E, data: Partial<EntityMap[E]>): Promise<EntityMap[E]>;
  createMany<E extends EntityName>(entity: E, rows: Partial<EntityMap[E]>[]): Promise<EntityMap[E][]>;
  update<E extends EntityName>(entity: E, id: string, data: Partial<EntityMap[E]>): Promise<EntityMap[E]>;
  remove(entity: EntityName, id: string): Promise<void>;
  removeMany(entity: EntityName, ids: string[]): Promise<void>;
  setSetting(key: string, value: string): Promise<void>;
  exportAll(): Promise<BackupPayload>;
  restore(payload: BackupPayload): Promise<void>;
}

export function parseTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  try {
    const v = JSON.parse(tags);
    return Array.isArray(v) ? v.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export function serializeTags(tags: string[]): string {
  return JSON.stringify(tags.map((t) => t.trim()).filter(Boolean));
}

/** Normalize date-ish fields ("2026-07-07" or Date) to full ISO strings. */
export function normalizeDates<T extends Record<string, unknown>>(
  entity: EntityName,
  data: T
): T {
  const fields = DATE_FIELDS[entity];
  if (!fields) return data;
  const out: Record<string, unknown> = { ...data };
  for (const f of fields) {
    const v = out[f];
    if (v === undefined || v === null || v === '') continue;
    const d = v instanceof Date ? v : new Date(String(v));
    if (!Number.isNaN(d.getTime())) out[f] = d.toISOString();
  }
  return out as T;
}
