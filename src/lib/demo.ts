/**
 * Demo dataset: ~8 months of realistic activity so a new user can explore
 * every feature before entering real data. Deterministic (seeded PRNG).
 */
import { addMonths, endOfMonth, setDate, startOfMonth, subMonths } from 'date-fns';
import { api } from '@/data/api';
import { round2 } from '@/lib/utils';
import type { Category, Transaction } from '@/shared/types';

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function loadDemoData() {
  const rand = mulberry32(20260707);
  const between = (min: number, max: number) => round2(min + rand() * (max - min));
  const int = (min: number, max: number) => Math.floor(min + rand() * (max - min + 1));
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

  const categories = await api.list('category');
  const topByName = new Map(categories.filter((c) => !c.parentId).map((c) => [c.name, c]));
  const childByName = new Map(categories.filter((c) => c.parentId).map((c) => [c.name, c]));
  const cat = (name: string): Category | undefined => topByName.get(name);
  const sub = (name: string): Category | undefined => childByName.get(name);

  /* ------------------------------- accounts ------------------------------ */
  const existing = await api.list('account');
  let checking = existing.find((a) => a.type === 'checking');
  if (!checking) {
    checking = await api.create('account', { name: 'Checking', type: 'checking', icon: 'wallet', color: '#2a78d6' });
  }
  await api.update('account', checking.id, { startBalance: 3200 });
  const credit = await api.create('account', {
    name: 'Sapphire Credit Card', type: 'credit', startBalance: 0, icon: 'credit-card', color: '#9085e9', sortOrder: 1,
  });
  const cash = await api.create('account', {
    name: 'Cash', type: 'cash', startBalance: 180, icon: 'banknote', color: '#1baf7a', sortOrder: 2,
  });

  /* ----------------------------- income sources -------------------------- */
  await api.createMany('incomeSource', [
    { name: 'Acme Corp — Salary', amount: 2050, frequency: 'biweekly', color: '#2a78d6', notes: 'Primary job, paid every other Friday' },
    { name: 'Freelance Design', amount: 350, frequency: 'monthly', color: '#eda100', notes: 'Side projects' },
    { name: 'Dividends', amount: 120, frequency: 'quarterly', color: '#008300' },
  ]);

  /* ------------------------------ transactions --------------------------- */
  const now = new Date();
  const txs: Partial<Transaction>[] = [];
  const T = (
    date: Date,
    amount: number,
    type: 'expense' | 'income' | 'transfer',
    merchant: string,
    opts: Partial<Transaction> = {}
  ) => {
    if (date > now) return;
    txs.push({
      date: date.toISOString(),
      amount: round2(amount),
      type,
      merchant,
      accountId: checking!.id,
      paymentMethod: type === 'expense' ? 'Credit Card' : 'Bank Transfer',
      ...opts,
    });
  };
  const onCredit = { accountId: credit.id, paymentMethod: 'Credit Card' };

  const groceryStores = ['Whole Foods', "Trader Joe's", 'Kroger', 'Costco'];
  const restaurants = ['Chipotle', 'Olive Garden', 'Thai Basil', 'DoorDash', 'Shake Shack', 'Panera Bread'];
  const gasStations = ['Shell', 'Chevron', 'BP'];
  const shops = ['Amazon', 'Target', 'Best Buy', 'IKEA', 'Uniqlo'];
  const fun = ['AMC Theatres', 'Steam', 'Ticketmaster', 'Topgolf'];

  for (let m = 7; m >= 0; m--) {
    const mo = startOfMonth(subMonths(now, m));
    const day = (d: number) => setDate(mo, Math.min(d, endOfMonth(mo).getDate()));

    // Income — biweekly paychecks + occasional freelance
    T(day(1), 2050, 'income', 'Acme Corp', { categoryId: cat('Income')?.id, description: 'Salary', recurring: true });
    T(day(15), 2050, 'income', 'Acme Corp', { categoryId: cat('Income')?.id, description: 'Salary', recurring: true });
    if (m % 2 === 0) T(day(int(18, 26)), between(280, 620), 'income', 'Freelance Client', { categoryId: cat('Income')?.id, description: 'Design work', tags: '["side-hustle"]' });
    if (m % 3 === 0) T(day(int(2, 8)), 120, 'income', 'Vanguard', { categoryId: cat('Income')?.id, description: 'Dividends' });

    // Fixed / recurring expenses
    T(day(1), 1650, 'expense', 'Oakwood Apartments', { categoryId: cat('Housing')?.id, recurring: true, paymentMethod: 'Bank Transfer', description: 'Rent' });
    T(day(12), between(82, 145), 'expense', 'City Power & Light', { categoryId: cat('Utilities')?.id, recurring: true, paymentMethod: 'Bank Transfer' });
    T(day(18), 69.99, 'expense', 'Comcast', { categoryId: cat('Utilities')?.id, recurring: true, description: 'Internet' });
    T(day(20), 65, 'expense', 'Verizon', { categoryId: cat('Utilities')?.id, recurring: true, description: 'Phone plan' });
    T(day(25), 128.4, 'expense', 'GEICO', { categoryId: cat('Insurance')?.id, recurring: true, description: 'Car insurance' });
    T(day(5), 15.49, 'expense', 'Netflix', { categoryId: cat('Subscriptions')?.id, recurring: true, ...onCredit });
    T(day(7), 11.99, 'expense', 'Spotify', { categoryId: cat('Subscriptions')?.id, recurring: true, ...onCredit });
    T(day(3), 2.99, 'expense', 'Apple iCloud', { categoryId: cat('Subscriptions')?.id, recurring: true, ...onCredit });
    T(day(8), 39.99, 'expense', 'Planet Fitness', { categoryId: cat('Subscriptions')?.id, recurring: true, description: 'Gym membership', ...onCredit });

    // Groceries (4-5x)
    for (let i = 0, n = int(4, 5); i < n; i++) {
      T(day(int(1, 28)), between(48, 145), 'expense', pick(groceryStores), {
        categoryId: cat('Food')?.id, subcategoryId: sub('Groceries')?.id, ...onCredit,
      });
    }
    // Restaurants & coffee (6-9x)
    for (let i = 0, n = int(6, 9); i < n; i++) {
      T(day(int(1, 28)), between(11, 78), 'expense', pick(restaurants), {
        categoryId: cat('Food')?.id, subcategoryId: sub('Restaurants')?.id, ...onCredit,
      });
    }
    for (let i = 0, n = int(3, 6); i < n; i++) {
      T(day(int(1, 28)), between(5.25, 9.75), 'expense', 'Starbucks', {
        categoryId: cat('Food')?.id, subcategoryId: sub('Restaurants')?.id, tags: '["coffee"]', ...onCredit,
      });
    }
    // Gas (3x)
    for (let i = 0; i < 3; i++) {
      T(day(int(2, 27)), between(36, 58), 'expense', pick(gasStations), { categoryId: cat('Transportation')?.id, ...onCredit });
    }
    // Shopping (2-4x)
    for (let i = 0, n = int(2, 4); i < n; i++) {
      T(day(int(1, 28)), between(18, 170), 'expense', pick(shops), { categoryId: cat('Shopping')?.id, ...onCredit });
    }
    // Entertainment (1-3x)
    for (let i = 0, n = int(1, 3); i < n; i++) {
      T(day(int(1, 28)), between(12, 65), 'expense', pick(fun), { categoryId: cat('Entertainment')?.id, ...onCredit });
    }
    // Pets
    T(day(int(6, 20)), between(38, 72), 'expense', 'Petco', { categoryId: cat('Pets')?.id, ...onCredit });
    // Occasional medical
    if (m % 3 === 1) T(day(int(4, 24)), between(24, 180), 'expense', 'CVS Pharmacy', { categoryId: cat('Medical')?.id, ...onCredit });
    // Cash spending
    T(day(int(3, 25)), between(10, 45), 'expense', 'Farmers Market', {
      categoryId: cat('Food')?.id, subcategoryId: sub('Groceries')?.id, accountId: cash.id, paymentMethod: 'Cash',
    });

    // Credit card payment (transfer checking → credit)
    T(day(27), between(650, 1050), 'transfer', 'Credit Card Payment', {
      accountId: checking!.id, toAccountId: credit.id, paymentMethod: 'Bank Transfer', description: 'Monthly payment',
    });
  }

  // A vacation four months ago
  const vac = startOfMonth(subMonths(now, 4));
  T(setDate(vac, 9), 428, 'expense', 'Delta Air Lines', { categoryId: cat('Travel')?.id, tags: '["vacation"]', ...onCredit });
  T(setDate(vac, 10), 312.5, 'expense', 'Marriott', { categoryId: cat('Travel')?.id, tags: '["vacation"]', ...onCredit });
  T(setDate(vac, 11), 86.2, 'expense', 'Hertz', { categoryId: cat('Travel')?.id, tags: '["vacation"]', ...onCredit });

  await api.createMany('transaction', txs);

  /* -------------------------------- savings ------------------------------ */
  const savingsDefs = [
    { name: 'Emergency Fund', balance: 8500, goal: 15000, monthlyContribution: 400, interestRate: 4.1, icon: 'shield-check', color: '#2a78d6' },
    { name: 'Vacation', balance: 2350, goal: 4000, monthlyContribution: 150, interestRate: 4.1, icon: 'plane', color: '#eda100' },
    { name: 'House Down Payment', balance: 12750, goal: 60000, monthlyContribution: 500, interestRate: 4.35, icon: 'home', color: '#1baf7a' },
    { name: 'Retirement — 401(k)', balance: 23800, monthlyContribution: 350, interestRate: 7, icon: 'trending-up', color: '#9085e9' },
  ];
  const savings = await api.createMany('savingsAccount', savingsDefs.map((s, i) => ({ ...s, sortOrder: i })));

  const snapshots: { savingsAccountId: string; date: string; balance: number }[] = [];
  for (const s of savings) {
    for (let m = 8; m >= 0; m--) {
      const at = endOfMonth(subMonths(now, m));
      const drift = between(-60, 60);
      const balance = Math.max(0, round2(s.balance - s.monthlyContribution * m + drift));
      snapshots.push({ savingsAccountId: s.id, date: at.toISOString(), balance });
    }
  }
  await api.createMany('savingsSnapshot', snapshots);

  /* --------------------------------- bills ------------------------------- */
  const due = (d: number, monthsAhead = 0) => {
    let date = setDate(startOfMonth(now), d);
    if (date < now) date = addMonths(date, 1);
    return addMonths(date, monthsAhead).toISOString();
  };
  await api.createMany('bill', [
    { name: 'Rent', amount: 1650, dueDate: due(1), frequency: 'monthly', autoPay: true, reminderDays: 5, categoryId: cat('Housing')?.id, accountId: checking!.id },
    { name: 'Electricity', amount: 115, dueDate: due(12), frequency: 'monthly', autoPay: false, reminderDays: 5, categoryId: cat('Utilities')?.id, accountId: checking!.id },
    { name: 'Internet', amount: 69.99, dueDate: due(18), frequency: 'monthly', autoPay: true, reminderDays: 3, categoryId: cat('Utilities')?.id, accountId: checking!.id },
    { name: 'Phone', amount: 65, dueDate: due(20), frequency: 'monthly', autoPay: true, reminderDays: 3, categoryId: cat('Utilities')?.id, accountId: checking!.id },
    { name: 'Car Insurance', amount: 128.4, dueDate: due(25), frequency: 'monthly', autoPay: false, reminderDays: 7, categoryId: cat('Insurance')?.id, accountId: checking!.id },
    { name: 'Gym Membership', amount: 39.99, dueDate: due(8), frequency: 'monthly', autoPay: true, reminderDays: 2, categoryId: cat('Subscriptions')?.id, accountId: credit.id },
  ]);

  /* -------------------------------- budgets ------------------------------ */
  const budgetDefs: [string, number][] = [
    ['Housing', 1700], ['Food', 750], ['Utilities', 300], ['Transportation', 220],
    ['Shopping', 300], ['Entertainment', 150], ['Subscriptions', 75], ['Insurance', 140],
    ['Medical', 120], ['Pets', 80], ['Travel', 200], ['Miscellaneous', 150],
  ];
  await api.createMany(
    'budget',
    budgetDefs
      .filter(([name]) => cat(name))
      .map(([name, amount]) => ({ categoryId: cat(name)!.id, amount, period: 'monthly' as const }))
  );

  /* --------------------------------- goals ------------------------------- */
  const emergency = savings.find((s) => s.name === 'Emergency Fund');
  const vacation = savings.find((s) => s.name === 'Vacation');
  await api.createMany('goal', [
    { name: 'Fully fund emergency fund', type: 'savings', targetAmount: 15000, currentAmount: 8500, savingsAccountId: emergency?.id, icon: 'shield-check', color: '#2a78d6', targetDate: addMonths(now, 16).toISOString() },
    { name: 'Trip to Japan', type: 'savings', targetAmount: 4000, currentAmount: 2350, savingsAccountId: vacation?.id, icon: 'plane', color: '#eda100', targetDate: addMonths(now, 11).toISOString() },
    { name: 'Pay off credit card', type: 'debt', targetAmount: 1200, currentAmount: 780, icon: 'credit-card', color: '#e34948', targetDate: addMonths(now, 4).toISOString() },
    { name: 'New laptop', type: 'purchase', targetAmount: 2200, currentAmount: 650, icon: 'laptop', color: '#9085e9' },
  ]);

  /* ---------------------------------- tags ------------------------------- */
  await api.createMany('tag', [
    { name: 'vacation', color: '#eda100' },
    { name: 'coffee', color: '#a16207' },
    { name: 'side-hustle', color: '#1baf7a' },
    { name: 'essential', color: '#2a78d6' },
  ]);
}
