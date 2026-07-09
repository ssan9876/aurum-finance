/**
 * Seed data + option lists shared by the Electron data service and the
 * browser adapter. Pure data — no DOM or Node APIs.
 */
import type { Frequency } from './types';

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export interface SeedCategory {
  name: string;
  icon: string;
  color: string;
  type: 'expense' | 'income';
  children?: { name: string; icon: string; color: string }[];
}

export const DEFAULT_CATEGORIES: SeedCategory[] = [
  { name: 'Housing', icon: 'home', color: '#2a78d6', type: 'expense' },
  { name: 'Utilities', icon: 'plug-zap', color: '#0ea5b7', type: 'expense' },
  { name: 'Transportation', icon: 'car', color: '#eb6834', type: 'expense' },
  {
    name: 'Food',
    icon: 'utensils',
    color: '#1baf7a',
    type: 'expense',
    children: [
      { name: 'Groceries', icon: 'shopping-cart', color: '#199e70' },
      { name: 'Restaurants', icon: 'utensils-crossed', color: '#34c98e' },
    ],
  },
  { name: 'Shopping', icon: 'shopping-bag', color: '#e87ba4', type: 'expense' },
  { name: 'Entertainment', icon: 'clapperboard', color: '#9085e9', type: 'expense' },
  { name: 'Medical', icon: 'heart-pulse', color: '#e34948', type: 'expense' },
  { name: 'Insurance', icon: 'shield-check', color: '#64748b', type: 'expense' },
  { name: 'Education', icon: 'graduation-cap', color: '#4a3aa7', type: 'expense' },
  { name: 'Subscriptions', icon: 'repeat', color: '#d55181', type: 'expense' },
  { name: 'Travel', icon: 'plane', color: '#eda100', type: 'expense' },
  { name: 'Pets', icon: 'paw-print', color: '#a16207', type: 'expense' },
  { name: 'Investments', icon: 'trending-up', color: '#008300', type: 'expense' },
  { name: 'Taxes', icon: 'landmark', color: '#78716c', type: 'expense' },
  { name: 'Gifts', icon: 'gift', color: '#c026d3', type: 'expense' },
  { name: 'Savings', icon: 'piggy-bank', color: '#0d9488', type: 'expense' },
  { name: 'Miscellaneous', icon: 'circle-ellipsis', color: '#94a3b8', type: 'expense' },
  { name: 'Income', icon: 'banknote', color: '#16a34a', type: 'income' },
];

/** Colors offered in category/account color pickers. */
export const COLOR_SWATCHES = [
  '#2a78d6', '#0ea5b7', '#1baf7a', '#16a34a', '#008300', '#0d9488',
  '#eda100', '#eb6834', '#e34948', '#d55181', '#e87ba4', '#c026d3',
  '#9085e9', '#4a3aa7', '#6366f1', '#a16207', '#64748b', '#94a3b8',
];

export const FREQUENCIES: { value: Frequency; label: string; perYear: number }[] = [
  { value: 'weekly', label: 'Weekly', perYear: 52 },
  { value: 'biweekly', label: 'Biweekly', perYear: 26 },
  { value: 'twicemonthly', label: 'Twice Monthly', perYear: 24 },
  { value: 'monthly', label: 'Monthly', perYear: 12 },
  { value: 'quarterly', label: 'Quarterly', perYear: 4 },
  { value: 'yearly', label: 'Yearly', perYear: 1 },
  { value: 'onetime', label: 'One Time', perYear: 0 },
];

export const BILL_FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'once', label: 'One Time' },
] as const;

export const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Checking', icon: 'wallet' },
  { value: 'savings', label: 'Savings', icon: 'piggy-bank' },
  { value: 'credit', label: 'Credit Card', icon: 'credit-card' },
  { value: 'cash', label: 'Cash', icon: 'banknote' },
  { value: 'investment', label: 'Investment', icon: 'trending-up' },
  { value: 'loan', label: 'Loan', icon: 'landmark' },
] as const;

export const PAYMENT_METHODS = [
  'Credit Card',
  'Debit Card',
  'Cash',
  'Bank Transfer',
  'Check',
  'Mobile Payment',
  'Other',
];

export const CURRENCIES = [
  { code: 'USD', label: 'US Dollar' },
  { code: 'EUR', label: 'Euro' },
  { code: 'GBP', label: 'British Pound' },
  { code: 'JPY', label: 'Japanese Yen' },
  { code: 'CAD', label: 'Canadian Dollar' },
  { code: 'AUD', label: 'Australian Dollar' },
  { code: 'CHF', label: 'Swiss Franc' },
  { code: 'CNY', label: 'Chinese Yuan' },
  { code: 'INR', label: 'Indian Rupee' },
  { code: 'MXN', label: 'Mexican Peso' },
  { code: 'BRL', label: 'Brazilian Real' },
  { code: 'SEK', label: 'Swedish Krona' },
  { code: 'NZD', label: 'New Zealand Dollar' },
  { code: 'SGD', label: 'Singapore Dollar' },
  { code: 'KRW', label: 'South Korean Won' },
];

export const DATE_FORMATS = ['MM/dd/yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd', 'MMM d, yyyy'];

export const ACCENTS = ['indigo', 'violet', 'blue', 'emerald', 'rose', 'amber'] as const;
export type Accent = (typeof ACCENTS)[number];

export interface AppSettings {
  currency: string;
  dateFormat: string;
  theme: 'light' | 'dark' | 'system';
  accent: Accent;
  notifications: boolean;
  budgetAlerts: boolean;
  billReminders: boolean;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  currency: 'USD',
  dateFormat: 'MMM d, yyyy',
  theme: 'system',
  accent: 'indigo',
  notifications: true,
  budgetAlerts: true,
  billReminders: true,
  onboarded: false,
};

/**
 * Rows inserted on first run (fresh database). Returns plain objects with
 * pre-generated ids so parent/child category links can be established.
 */
export function buildSeedRows() {
  const now = new Date().toISOString();
  const categories: Array<{
    id: string;
    name: string;
    type: 'expense' | 'income';
    color: string;
    icon: string;
    parentId: string | null;
    sortOrder: number;
    isDefault: boolean;
    createdAt: string;
  }> = [];

  DEFAULT_CATEGORIES.forEach((c, i) => {
    const id = uid();
    categories.push({
      id,
      name: c.name,
      type: c.type,
      color: c.color,
      icon: c.icon,
      parentId: null,
      sortOrder: i,
      isDefault: true,
      createdAt: now,
    });
    c.children?.forEach((ch, j) => {
      categories.push({
        id: uid(),
        name: ch.name,
        type: c.type,
        color: ch.color,
        icon: ch.icon,
        parentId: id,
        sortOrder: j,
        isDefault: true,
        createdAt: now,
      });
    });
  });

  const accounts = [
    {
      id: uid(),
      name: 'Checking',
      type: 'checking',
      startBalance: 0,
      color: '#2a78d6',
      icon: 'wallet',
      archived: false,
      sortOrder: 0,
      createdAt: now,
    },
  ];

  return { categories, accounts };
}
