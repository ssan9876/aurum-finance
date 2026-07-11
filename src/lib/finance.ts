/**
 * Pure financial calculations. Everything here takes plain entity lists and
 * returns derived values — no I/O, no React — so the whole module is trivially
 * testable and reusable by future backends (reports, AI insights, etc.).
 */
import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  endOfMonth,
  format,
  getDaysInMonth,
  startOfMonth,
  subMonths,
} from 'date-fns';
import { FREQUENCIES } from '@/shared/defaults';
import { TRANSFER_TAG } from '@/lib/transfers';
import { round2, sum } from '@/lib/utils';
import { parseTags } from '@/shared/types';
import type {
  Account,
  AccountType,
  Bill,
  Budget,
  Category,
  Frequency,
  IncomeSource,
  SavingsAccount,
  SavingsSnapshot,
  Transaction,
} from '@/shared/types';

/**
 * True when a row must be kept out of income/expense reporting: an actual
 * `transfer` row, or an expense/income leg tagged as a transfer (a verified
 * account-to-account move). Balance math is unaffected — it still sums the
 * row by its real type — this only governs the income/expense/category totals.
 */
export const countsAsTransfer = (t: Pick<Transaction, 'type' | 'tags'>): boolean =>
  t.type === 'transfer' || parseTags(t.tags).includes(TRANSFER_TAG);

/* ------------------------------- frequencies ----------------------------- */

export const payPeriodsPerYear = (f: Frequency): number =>
  FREQUENCIES.find((x) => x.value === f)?.perYear ?? 12;

export const toMonthly = (amount: number, f: Frequency) => (amount * payPeriodsPerYear(f)) / 12;
export const toYearly = (amount: number, f: Frequency) => amount * payPeriodsPerYear(f);

export const totalMonthlyIncome = (sources: IncomeSource[]) =>
  round2(sum(sources.filter((s) => s.active).map((s) => toMonthly(s.amount, s.frequency))));

export const totalYearlyIncome = (sources: IncomeSource[]) =>
  round2(sum(sources.filter((s) => s.active).map((s) => toYearly(s.amount, s.frequency))));

/* -------------------------------- accounts ------------------------------- */

/** Running balance: start balance + all posted transactions and transfers. */
export function accountBalance(account: Account, txs: Transaction[]): number {
  let bal = account.startBalance;
  for (const t of txs) {
    if (t.type === 'transfer') {
      if (t.accountId === account.id) bal -= t.amount;
      if (t.toAccountId === account.id) bal += t.amount;
    } else if (t.accountId === account.id) {
      bal += t.type === 'income' ? t.amount : -t.amount;
    }
  }
  return round2(bal);
}

export function totalAccountBalance(accounts: Account[], txs: Transaction[]): number {
  return round2(sum(accounts.filter((a) => !a.archived).map((a) => accountBalance(a, txs))));
}

/* ------------------------------ time buckets ------------------------------ */

export const monthKey = (d: Date | string) => format(new Date(d), 'yyyy-MM');

export interface MonthPoint {
  key: string;
  label: string;
  date: Date;
  income: number;
  expense: number;
  net: number;
}

/** Income/expense/net per month for the trailing `months` months. */
export function monthlySeries(txs: Transaction[], months: number, end = new Date()): MonthPoint[] {
  const points: MonthPoint[] = [];
  const index = new Map<string, MonthPoint>();
  for (let i = months - 1; i >= 0; i--) {
    const date = startOfMonth(subMonths(end, i));
    const key = format(date, 'yyyy-MM');
    const p: MonthPoint = { key, label: format(date, 'MMM'), date, income: 0, expense: 0, net: 0 };
    points.push(p);
    index.set(key, p);
  }
  for (const t of txs) {
    if (countsAsTransfer(t)) continue;
    const p = index.get(monthKey(t.date));
    if (!p) continue;
    if (t.type === 'income') p.income += t.amount;
    else p.expense += t.amount;
  }
  for (const p of points) {
    p.income = round2(p.income);
    p.expense = round2(p.expense);
    p.net = round2(p.income - p.expense);
  }
  return points;
}

export function txInRange(txs: Transaction[], from: Date, to: Date): Transaction[] {
  return txs.filter((t) => {
    const d = new Date(t.date);
    return d >= from && d <= to;
  });
}

export const expensesIn = (txs: Transaction[], from: Date, to: Date) =>
  txInRange(txs, from, to).filter((t) => t.type === 'expense' && !countsAsTransfer(t));

export const incomeIn = (txs: Transaction[], from: Date, to: Date) =>
  txInRange(txs, from, to).filter((t) => t.type === 'income' && !countsAsTransfer(t));

/* ------------------------------- categories ------------------------------ */

/** Resolve a transaction's top-level category (subcategories roll up). */
export function rootCategoryOf(
  categoryId: string | null | undefined,
  byId: Map<string, Category>
): Category | undefined {
  let cat = categoryId ? byId.get(categoryId) : undefined;
  let hops = 0;
  while (cat?.parentId && hops++ < 6) {
    const parent = byId.get(cat.parentId);
    if (!parent) break;
    cat = parent;
  }
  return cat;
}

export interface CategorySpend {
  category: Category;
  amount: number;
  pct: number;
  count: number;
}

export function spendByCategory(
  txs: Transaction[],
  categories: Category[],
  from: Date,
  to: Date
): CategorySpend[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const totals = new Map<string, { amount: number; count: number }>();
  let grand = 0;
  const uncategorized: Category = {
    id: '__none__',
    name: 'Uncategorized',
    type: 'expense',
    color: '#94a3b8',
    icon: 'circle-dashed',
    sortOrder: 999,
    isDefault: false,
    createdAt: '',
  };
  for (const t of expensesIn(txs, from, to)) {
    const root = rootCategoryOf(t.categoryId, byId) ?? uncategorized;
    const cur = totals.get(root.id) ?? { amount: 0, count: 0 };
    cur.amount += t.amount;
    cur.count += 1;
    totals.set(root.id, cur);
    grand += t.amount;
  }
  const list: CategorySpend[] = [];
  for (const [id, { amount, count }] of totals) {
    const category = id === '__none__' ? uncategorized : byId.get(id);
    if (!category) continue;
    list.push({ category, amount: round2(amount), pct: grand ? amount / grand : 0, count });
  }
  return list.sort((a, b) => b.amount - a.amount);
}

/* ------------------------------- money flow ------------------------------- */

export interface FlowNode {
  name: string;
  kind: 'source' | 'income' | 'expense' | 'saved';
  /** Set for real categories (and '__none__' for uncategorized) — enables drill-down. */
  categoryId?: string;
  color?: string;
}

export interface FlowData {
  nodes: FlowNode[];
  links: { source: number; target: number; value: number }[];
  totalIncome: number;
  totalExpense: number;
}

/**
 * Monarch-style cash-flow sankey: income sources → Income → spending
 * categories, with the surplus (if any) flowing to a "Saved" node. Categories
 * beyond `maxCategories` fold into "Other". Returns null for an empty period.
 */
export function cashFlowSankey(
  txs: Transaction[],
  categories: Category[],
  from: Date,
  to: Date,
  maxCategories = 8
): FlowData | null {
  const byId = new Map(categories.map((c) => [c.id, c]));

  const sources = new Map<string, FlowNode & { amount: number }>();
  let totalIncome = 0;
  for (const t of incomeIn(txs, from, to)) {
    const root = rootCategoryOf(t.categoryId, byId);
    const known = root && root.type === 'income';
    const key = known ? root.id : '__other_income__';
    const cur =
      sources.get(key) ??
      ({
        name: known ? root.name : 'Other income',
        kind: 'source',
        categoryId: known ? root.id : undefined,
        color: known ? root.color : undefined,
        amount: 0,
      } as FlowNode & { amount: number });
    cur.amount += t.amount;
    sources.set(key, cur);
    totalIncome += t.amount;
  }

  const spend = spendByCategory(txs, categories, from, to);
  const totalExpense = round2(sum(spend.map((s) => s.amount)));
  if (totalIncome <= 0 && spend.length === 0) return null;

  const top = spend.slice(0, maxCategories);
  const restAmount = round2(sum(spend.slice(maxCategories).map((s) => s.amount)));

  const nodes: FlowNode[] = [];
  const links: FlowData['links'] = [];

  for (const s of [...sources.values()].sort((a, b) => b.amount - a.amount)) {
    nodes.push({ name: s.name, kind: 'source', categoryId: s.categoryId, color: s.color });
    links.push({ source: nodes.length - 1, target: -1, value: round2(s.amount) });
  }
  const incomeIdx = nodes.length;
  nodes.push({ name: 'Income', kind: 'income' });
  for (const l of links) l.target = incomeIdx;

  for (const s of top) {
    nodes.push({
      name: s.category.name,
      kind: 'expense',
      categoryId: s.category.id,
      color: s.category.color,
    });
    links.push({ source: incomeIdx, target: nodes.length - 1, value: round2(s.amount) });
  }
  if (restAmount > 0) {
    nodes.push({ name: 'Other', kind: 'expense' });
    links.push({ source: incomeIdx, target: nodes.length - 1, value: restAmount });
  }
  const saved = round2(totalIncome - totalExpense);
  if (saved > 0) {
    nodes.push({ name: 'Saved', kind: 'saved' });
    links.push({ source: incomeIdx, target: nodes.length - 1, value: saved });
  }

  // Sankey layout cannot place zero/negative links.
  const positive = links.filter((l) => l.value > 0);
  if (positive.length === 0) return null;
  return { nodes, links: positive, totalIncome: round2(totalIncome), totalExpense };
}

/* -------------------------------- budgets -------------------------------- */

/** Effective budget for a category+slot: specific row wins over template. */
export function budgetAmountFor(
  budgets: Budget[],
  categoryId: string,
  month: number,
  year: number,
  period: 'monthly' | 'yearly' = 'monthly'
): number | null {
  const rows = budgets.filter((b) => b.categoryId === categoryId && b.period === period);
  const specific = rows.find((b) =>
    period === 'monthly' ? b.month === month && b.year === year : b.year === year
  );
  if (specific) return specific.amount;
  const template = rows.find((b) => b.month == null && b.year == null);
  return template ? template.amount : null;
}

export interface BudgetStatus {
  category: Category;
  budget: number;
  spent: number;
  remaining: number;
  pct: number; // 0..∞ (1 = at budget)
}

export function budgetStatuses(
  budgets: Budget[],
  categories: Category[],
  txs: Transaction[],
  monthDate: Date
): BudgetStatus[] {
  const month = monthDate.getMonth() + 1;
  const year = monthDate.getFullYear();
  const from = startOfMonth(monthDate);
  const to = endOfMonth(monthDate);
  const spend = spendByCategory(txs, categories, from, to);
  const spentById = new Map(spend.map((s) => [s.category.id, s.amount]));

  const out: BudgetStatus[] = [];
  for (const cat of categories.filter((c) => !c.parentId && c.type === 'expense')) {
    const budget = budgetAmountFor(budgets, cat.id, month, year, 'monthly');
    if (budget == null || budget <= 0) continue;
    const spent = spentById.get(cat.id) ?? 0;
    out.push({
      category: cat,
      budget,
      spent,
      remaining: round2(budget - spent),
      pct: spent / budget,
    });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

/* ---------------------------------- bills -------------------------------- */

export function advanceBillDate(bill: Bill): string {
  const d = new Date(bill.dueDate);
  switch (bill.frequency) {
    case 'weekly':
      return addWeeks(d, 1).toISOString();
    case 'biweekly':
      return addWeeks(d, 2).toISOString();
    case 'monthly':
      return addMonths(d, 1).toISOString();
    case 'quarterly':
      return addQuarters(d, 1).toISOString();
    case 'yearly':
      return addYears(d, 1).toISOString();
    default:
      return d.toISOString(); // one-time bills don't advance
  }
}

export type BillState = 'overdue' | 'due-soon' | 'upcoming';

export function billState(bill: Bill, now = new Date()): BillState {
  const due = new Date(bill.dueDate);
  const days = differenceInCalendarDays(due, now);
  if (days < 0) return 'overdue';
  if (days <= bill.reminderDays) return 'due-soon';
  return 'upcoming';
}

export const monthlyBillTotal = (bills: Bill[]) =>
  round2(
    sum(
      bills
        .filter((b) => b.frequency !== 'once')
        .map((b) => toMonthly(b.amount, b.frequency as Frequency))
    )
  );

/* --------------------------------- savings ------------------------------- */

export const totalSavings = (savings: SavingsAccount[]) => round2(sum(savings.map((s) => s.balance)));

/** Live balance of every non-archived savings-type bank account. */
export function savingsAccountsBalance(accounts: Account[], txs: Transaction[]): number {
  return round2(
    sum(accounts.filter((a) => !a.archived && a.type === 'savings').map((a) => accountBalance(a, txs)))
  );
}

/**
 * Outstanding debt (a value ≤ 0) across non-archived accounts of a given type.
 * Credit cards and loans carry negative running balances; only the amount owed
 * is counted, so an overpaid card doesn't read as a positive "debt".
 */
export function accountTypeDebt(accounts: Account[], txs: Transaction[], type: AccountType): number {
  return round2(
    sum(
      accounts
        .filter((a) => !a.archived && a.type === type)
        .map((a) => Math.min(0, accountBalance(a, txs)))
    )
  );
}

/** Months until the goal is reached with contributions + monthly compounding. */
export function monthsToGoal(s: SavingsAccount): number | null {
  if (!s.goal || s.goal <= 0 || s.balance >= s.goal) return s.goal ? 0 : null;
  if (s.monthlyContribution <= 0 && s.interestRate <= 0) return null;
  const r = s.interestRate / 100 / 12;
  let bal = s.balance;
  for (let m = 1; m <= 600; m++) {
    bal = bal * (1 + r) + s.monthlyContribution;
    if (bal >= s.goal) return m;
  }
  return null;
}

export function projectedCompletionDate(s: SavingsAccount, now = new Date()): Date | null {
  const months = monthsToGoal(s);
  if (months == null) return null;
  return addMonths(now, months);
}

/** Projected balances for the next `months` months (for goal forecasting). */
export function savingsProjection(s: SavingsAccount, months: number, now = new Date()) {
  const r = s.interestRate / 100 / 12;
  const out: { date: Date; label: string; balance: number }[] = [];
  let bal = s.balance;
  for (let m = 0; m <= months; m++) {
    out.push({ date: addMonths(now, m), label: format(addMonths(now, m), 'MMM yy'), balance: round2(bal) });
    bal = bal * (1 + r) + s.monthlyContribution;
  }
  return out;
}

/** Combined historical savings balance by month, from snapshots. */
export function savingsHistorySeries(
  savings: SavingsAccount[],
  snapshots: SavingsSnapshot[],
  months: number,
  end = new Date()
) {
  const out: { key: string; label: string; balance: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const at = endOfMonth(subMonths(end, i));
    let total = 0;
    for (const s of savings) {
      const past = snapshots
        .filter((sn) => sn.savingsAccountId === s.id && new Date(sn.date) <= at)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (past) total += past.balance;
      else if (new Date(s.createdAt) <= at) total += s.balance;
    }
    out.push({ key: format(at, 'yyyy-MM'), label: format(at, 'MMM'), balance: round2(total) });
  }
  return out;
}

/**
 * Combined savings balance by month for the "Savings Growth" chart. Mirrors the
 * dashboard's Total Savings box (savingsAccountsBalance + totalSavings): it adds
 * the historical balance of every non-archived savings-TYPE bank account
 * (reconstructed from transactions up to each month-end) to the SavingsAccount
 * goal-tracker history. Without this the chart only ever saw SavingsAccount
 * entities and read flat/zero for users who keep savings in a bank account.
 */
export function savingsGrowthSeries(
  accounts: Account[],
  txs: Transaction[],
  savings: SavingsAccount[],
  snapshots: SavingsSnapshot[],
  months: number,
  end = new Date()
) {
  const goalHist = savingsHistorySeries(savings, snapshots, months, end);
  const savingsAccounts = accounts.filter((a) => !a.archived && a.type === 'savings');
  const out: { key: string; label: string; balance: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const at = endOfMonth(subMonths(end, i));
    const key = format(at, 'yyyy-MM');
    const upTo = txs.filter((t) => new Date(t.date) <= at);
    let total = goalHist.find((g) => g.key === key)?.balance ?? 0;
    for (const a of savingsAccounts) total += accountBalance(a, upTo);
    out.push({ key, label: format(at, 'MMM'), balance: round2(total) });
  }
  return out;
}

/* -------------------------------- net worth ------------------------------ */

export function netWorthSeries(
  accounts: Account[],
  txs: Transaction[],
  savings: SavingsAccount[],
  snapshots: SavingsSnapshot[],
  months: number,
  end = new Date()
) {
  const savingsHist = savingsHistorySeries(savings, snapshots, months, end);
  const out: { key: string; label: string; value: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const at = endOfMonth(subMonths(end, i));
    let accTotal = 0;
    for (const a of accounts.filter((x) => !x.archived)) {
      const upTo = txs.filter((t) => new Date(t.date) <= at);
      accTotal += accountBalance(a, upTo);
    }
    const sv = savingsHist.find((s) => s.key === format(at, 'yyyy-MM'))?.balance ?? 0;
    out.push({ key: format(at, 'yyyy-MM'), label: format(at, 'MMM'), value: round2(accTotal + sv) });
  }
  return out;
}

/* ----------------------------- insights & score -------------------------- */

/** Blended end-of-month spending prediction from pace + trailing average. */
export function predictMonthSpend(txs: Transaction[], now = new Date()) {
  const from = startOfMonth(now);
  const soFar = round2(sum(expensesIn(txs, from, now).map((t) => t.amount)));
  const dayOfMonth = now.getDate();
  const daysInMonth = getDaysInMonth(now);
  const naive = dayOfMonth > 0 ? (soFar / dayOfMonth) * daysInMonth : soFar;
  const prev = monthlySeries(txs, 4, now).slice(0, 3);
  const prevAvg = prev.length ? sum(prev.map((p) => p.expense)) / prev.length : naive;
  const w = dayOfMonth / daysInMonth; // trust the pace more as the month matures
  const predicted = prevAvg > 0 || soFar > 0 ? naive * w + prevAvg * (1 - w) : 0;
  return { soFar, predicted: round2(Math.max(predicted, soFar)) };
}

/** Consecutive months (ending with the last complete month) with net > 0. */
export function savingsStreak(txs: Transaction[], now = new Date()): number {
  const series = monthlySeries(txs, 36, now);
  let streak = 0;
  // Current month counts only if already positive.
  const current = series[series.length - 1];
  const rest = series.slice(0, -1).reverse();
  if (current && current.net > 0 && (current.income > 0 || current.expense > 0)) streak++;
  for (const p of rest) {
    if (p.net > 0 && (p.income > 0 || p.expense > 0)) streak++;
    else break;
  }
  return streak;
}

export interface HealthPart {
  label: string;
  score: number;
  max: number;
  hint: string;
}

export interface HealthScore {
  score: number;
  grade: string;
  parts: HealthPart[];
}

export function healthScore(input: {
  monthlyIncome: number;
  monthlyExpense: number;
  savingsTotal: number;
  budgets: BudgetStatus[];
  overdueBills: number;
  incomeSources: number;
}): HealthScore {
  const { monthlyIncome, monthlyExpense, savingsTotal, budgets, overdueBills, incomeSources } = input;
  const parts: HealthPart[] = [];

  const rate = monthlyIncome > 0 ? (monthlyIncome - monthlyExpense) / monthlyIncome : 0;
  parts.push({
    label: 'Savings rate',
    score: Math.round(clamp01(rate / 0.2) * 30),
    max: 30,
    hint: 'Save 20%+ of income for full marks',
  });

  const emergencyMonths = monthlyExpense > 0 ? savingsTotal / monthlyExpense : savingsTotal > 0 ? 6 : 0;
  parts.push({
    label: 'Emergency fund',
    score: Math.round(clamp01(emergencyMonths / 6) * 25),
    max: 25,
    hint: '6 months of expenses saved',
  });

  const over = budgets.filter((b) => b.pct > 1).length;
  parts.push({
    label: 'Budget discipline',
    score: budgets.length ? Math.round((1 - over / budgets.length) * 20) : 12,
    max: 20,
    hint: 'Stay under your category budgets',
  });

  parts.push({
    label: 'Bills on time',
    score: overdueBills === 0 ? 15 : Math.max(0, 15 - overdueBills * 5),
    max: 15,
    hint: 'No overdue bills',
  });

  parts.push({
    label: 'Income diversity',
    score: Math.min(incomeSources, 2) * 5,
    max: 10,
    hint: '2+ income streams',
  });

  const score = Math.min(100, sum(parts.map((p) => p.score)));
  const grade = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Fair' : 'Needs work';
  return { score, grade, parts };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/* --------------------------------- misc ---------------------------------- */

export function topMerchants(txs: Transaction[], from: Date, to: Date, limit = 6) {
  const totals = new Map<string, { amount: number; count: number }>();
  for (const t of expensesIn(txs, from, to)) {
    const name = t.merchant.trim() || '(no merchant)';
    const cur = totals.get(name) ?? { amount: 0, count: 0 };
    cur.amount += t.amount;
    cur.count += 1;
    totals.set(name, cur);
  }
  return [...totals.entries()]
    .map(([merchant, v]) => ({ merchant, amount: round2(v.amount), count: v.count }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export function largestExpenses(txs: Transaction[], from: Date, to: Date, limit = 8) {
  return expensesIn(txs, from, to)
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

/** Daily expense totals for heatmaps/calendar (key = yyyy-MM-dd). */
export function dailySpendMap(txs: Transaction[], from: Date, to: Date): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of expensesIn(txs, from, to)) {
    const key = format(new Date(t.date), 'yyyy-MM-dd');
    map.set(key, round2((map.get(key) ?? 0) + t.amount));
  }
  return map;
}

/** Recurring monthly cost: recurring-flagged transactions + recurring bills. */
export function recurringMonthlyCost(txs: Transaction[], bills: Bill[], now = new Date()) {
  const from = startOfMonth(subMonths(now, 1));
  const seen = new Set<string>();
  let txTotal = 0;
  for (const t of txs.filter((t) => t.recurring && t.type === 'expense' && new Date(t.date) >= from)) {
    const key = `${t.merchant}|${t.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    txTotal += t.amount;
  }
  return round2(txTotal + monthlyBillTotal(bills));
}

export { addDays };
