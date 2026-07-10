/**
 * Analytics: period reports — trends, category breakdown, net worth, top
 * merchants, largest expenses, budget performance, an expense heatmap, and
 * CSV/Excel report export.
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
} from 'date-fns';
import { BarChart3, Download, Landmark, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CategoryChip, EmptyState, PageHeader, StatCard } from '@/components/shared';
import {
  BarList,
  CashFlowChart,
  CategoryDonut,
  IncomeExpenseChart,
  MultiLineChart,
  TrendAreaChart,
  useChartColors,
} from '@/components/charts';
import { useSettings } from '@/state/settings';
import {
  useAccounts,
  useBudgets,
  useCategories,
  useSavingsAccounts,
  useSavingsSnapshots,
  useTransactions,
} from '@/data/hooks';
import {
  budgetStatuses,
  dailySpendMap,
  expensesIn,
  incomeIn,
  largestExpenses,
  monthlySeries,
  netWorthSeries,
  savingsHistorySeries,
  spendByCategory,
  topMerchants,
} from '@/lib/finance';
import { buildTxRows, exportReportCsv, exportReportXlsx } from '@/lib/csv';
import { round2, sum } from '@/lib/utils';

type PeriodKey = 'this-month' | 'last-month' | '3m' | '6m' | 'ytd' | '12m';

const PERIODS: { value: PeriodKey; label: string; months: number }[] = [
  { value: 'this-month', label: 'This month', months: 1 },
  { value: 'last-month', label: 'Last month', months: 1 },
  { value: '3m', label: 'Last 3 months', months: 3 },
  { value: '6m', label: 'Last 6 months', months: 6 },
  { value: 'ytd', label: 'Year to date', months: 12 },
  { value: '12m', label: 'Last 12 months', months: 12 },
];

function periodRange(key: PeriodKey, now = new Date()): { from: Date; to: Date } {
  switch (key) {
    case 'this-month':
      return { from: startOfMonth(now), to: now };
    case 'last-month': {
      const lm = subMonths(now, 1);
      return { from: startOfMonth(lm), to: endOfMonth(lm) };
    }
    case '3m':
      return { from: startOfMonth(subMonths(now, 2)), to: now };
    case '6m':
      return { from: startOfMonth(subMonths(now, 5)), to: now };
    case 'ytd':
      return { from: startOfYear(now), to: now };
    case '12m':
      return { from: startOfMonth(subMonths(now, 11)), to: now };
  }
}

export default function Analytics() {
  const { fmtMoney } = useSettings();
  const navigate = useNavigate();
  const openCategory = (slice: { id?: string }) => {
    if (!slice.id) return;
    navigate(`/transactions?category=${slice.id === '__none__' ? 'uncategorized' : slice.id}`);
  };
  const openMerchant = (item: { name: string }) =>
    navigate(`/merchants/${encodeURIComponent(item.name)}`);
  const { data: transactions, isLoading } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: savings = [] } = useSavingsAccounts();
  const { data: snapshots = [] } = useSavingsSnapshots();
  const { data: budgets = [] } = useBudgets();

  const [period, setPeriod] = React.useState<PeriodKey>('this-month');

  if (isLoading || !transactions) {
    return (
      <div>
        <PageHeader title="Analytics" />
        <Skeleton className="h-[560px] rounded-xl" />
      </div>
    );
  }

  const now = new Date();
  const { from, to } = periodRange(period, now);
  const months = PERIODS.find((p) => p.value === period)!.months;
  const chartMonths = Math.max(months, 3);

  const expenses = expensesIn(transactions, from, to);
  const income = incomeIn(transactions, from, to);
  const totalExpense = round2(sum(expenses.map((t) => t.amount)));
  const totalIncome = round2(sum(income.map((t) => t.amount)));
  const days = Math.max(1, differenceInCalendarDays(to, from) + 1);
  const avgDaily = round2(totalExpense / days);

  const breakdown = spendByCategory(transactions, categories, from, to);
  const donut = breakdown.map((b) => ({ name: b.category.name, value: b.amount, color: b.category.color, id: b.category.id }));
  const trend = monthlySeries(transactions, chartMonths, now);
  const netWorth = netWorthSeries(accounts, transactions, savings, snapshots, chartMonths, now).map((p) => ({
    label: p.label,
    value: p.value,
  }));
  const savingsTrend = savingsHistorySeries(savings, snapshots, chartMonths, now).map((p) => ({
    label: p.label,
    balance: p.balance,
  }));
  const merchants = topMerchants(transactions, from, to, 8);
  const largest = largestExpenses(transactions, from, to, 8);
  const budgetPerf = budgetStatuses(budgets, categories, transactions, period === 'last-month' ? subMonths(now, 1) : now);
  const catById = new Map(categories.map((c) => [c.id, c]));

  async function handleExportXlsx() {
    const label = PERIODS.find((p) => p.value === period)!.label;
    await exportReportXlsx(`aurum-report-${period}`, [
      {
        name: 'Summary',
        rows: [
          { Metric: 'Period', Value: label },
          { Metric: 'Total income', Value: totalIncome },
          { Metric: 'Total expenses', Value: totalExpense },
          { Metric: 'Net', Value: round2(totalIncome - totalExpense) },
          { Metric: 'Average daily spend', Value: avgDaily },
          { Metric: 'Transactions', Value: expenses.length + income.length },
        ],
      },
      {
        name: 'Category Breakdown',
        rows: breakdown.map((b) => ({
          Category: b.category.name,
          Amount: b.amount,
          Share: `${Math.round(b.pct * 100)}%`,
          Transactions: b.count,
        })),
      },
      {
        name: 'Top Merchants',
        rows: merchants.map((m) => ({ Merchant: m.merchant, Amount: m.amount, Visits: m.count })),
      },
      {
        name: 'Monthly Trends',
        rows: trend.map((t) => ({ Month: t.key, Income: t.income, Expenses: t.expense, Net: t.net })),
      },
      {
        name: 'Budget Performance',
        rows: budgetPerf.map((b) => ({
          Category: b.category.name,
          Budget: b.budget,
          Spent: b.spent,
          Remaining: b.remaining,
          Utilization: `${Math.round(b.pct * 100)}%`,
        })),
      },
      { name: 'Transactions', rows: buildTxRows([...expenses, ...income], categories, accounts) as never },
    ]);
  }

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Understand where money comes from and where it goes."
        actions={
          <>
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Download /> Export report
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportXlsx}>Excel workbook (.xlsx)</DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    exportReportCsv(
                      `aurum-category-breakdown-${period}`,
                      breakdown.map((b) => ({
                        Category: b.category.name,
                        Amount: b.amount,
                        Share: `${Math.round(b.pct * 100)}%`,
                        Transactions: b.count,
                      }))
                    )
                  }
                >
                  Category breakdown (.csv)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <StatCard label="Income" value={fmtMoney(totalIncome, { compact: true })} icon={<TrendingUp />} sub={`${income.length} deposits`} />
        <StatCard label="Expenses" value={fmtMoney(totalExpense, { compact: true })} icon={<TrendingDown />} sub={`${expenses.length} transactions`} />
        <StatCard
          label="Net"
          value={fmtMoney(round2(totalIncome - totalExpense), { compact: true })}
          tone={totalIncome - totalExpense >= 0 ? 'positive' : 'negative'}
          icon={<Wallet />}
          sub="Income − expenses"
        />
        <StatCard label="Avg Daily Spend" value={fmtMoney(avgDaily)} icon={<BarChart3 />} sub={`Over ${days} days`} />
      </div>

      {transactions.length === 0 ? (
        <Card className="mt-4">
          <EmptyState icon={<BarChart3 />} title="No data to analyze yet" description="Add transactions and come back — this page fills itself in." />
        </Card>
      ) : (
        <>
          <div className="grid lg:grid-cols-2 gap-4 mt-4 stagger-children">
            <Card>
              <CardHeader>
                <CardTitle>Income vs Expenses</CardTitle>
              </CardHeader>
              <CardContent>
                <IncomeExpenseChart data={trend} height={240} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Category Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                {donut.length === 0 ? (
                  <EmptyState icon={<BarChart3 />} title="No expenses in this period" className="py-8" />
                ) : (
                  <CategoryDonut data={donut} height={190} onSelect={openCategory} />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Net Worth</CardTitle>
              </CardHeader>
              <CardContent>
                <MultiLineChart data={netWorth} series={[{ key: 'value', name: 'Net worth' }]} height={220} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Savings Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <TrendAreaChart data={savingsTrend} dataKey="balance" name="Savings" height={220} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Cash Flow</CardTitle>
              </CardHeader>
              <CardContent>
                <CashFlowChart data={trend} height={220} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Top Merchants</CardTitle>
              </CardHeader>
              <CardContent>
                {merchants.length === 0 ? (
                  <EmptyState icon={<Landmark />} title="No merchants in this period" className="py-8" />
                ) : (
                  <BarList
                    data={merchants.map((m) => ({ name: m.merchant, value: m.amount, sub: `${m.count}×` }))}
                    onSelect={openMerchant}
                  />
                )}
              </CardContent>
            </Card>
          </div>

          <SpendHeatmap transactions={transactions} />

          <div className="grid lg:grid-cols-2 gap-4 mt-4 stagger-children">
            <Card>
              <CardHeader>
                <CardTitle>Largest Expenses</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {largest.length === 0 ? (
                  <EmptyState icon={<TrendingDown />} title="No expenses in this period" className="py-8" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Merchant</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="hidden sm:table-cell">Category</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {largest.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell className="font-medium">{t.merchant}</TableCell>
                          <TableCell className="text-muted-foreground tabular-nums">
                            {format(new Date(t.date), 'MMM d')}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            <CategoryChip category={t.categoryId ? catById.get(t.categoryId) : null} />
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{fmtMoney(t.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Budget Performance</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {budgetPerf.length === 0 ? (
                  <EmptyState icon={<Wallet />} title="No budgets set" className="py-8" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Budget</TableHead>
                        <TableHead className="text-right">Spent</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {budgetPerf.map((b) => (
                        <TableRow key={b.category.id}>
                          <TableCell>
                            <CategoryChip category={b.category} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoney(b.budget)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoney(b.spent)}</TableCell>
                          <TableCell className="text-right">
                            {b.pct > 1 ? (
                              <Badge variant="destructive">{Math.round(b.pct * 100)}%</Badge>
                            ) : b.pct > 0.9 ? (
                              <Badge variant="warning">{Math.round(b.pct * 100)}%</Badge>
                            ) : (
                              <Badge variant="success">{Math.round(b.pct * 100)}%</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------ expense heatmap ---------------------------- */

function SpendHeatmap({ transactions }: { transactions: { date: string; amount: number; type: string }[] }) {
  const { fmtMoney } = useSettings();
  const colors = useChartColors();
  const now = new Date();
  const start = subDays(now, 12 * 7 - 1);
  const spend = dailySpendMap(transactions as never, start, now);
  const days = eachDayOfInterval({ start, end: now });
  const max = Math.max(...spend.values(), 1);

  // Column per week, row per weekday.
  const weeks: Date[][] = [];
  let week: Date[] = [];
  for (const d of days) {
    if (d.getDay() === 0 && week.length) {
      weeks.push(week);
      week = [];
    }
    week.push(d);
  }
  if (week.length) weeks.push(week);

  const level = (v: number) => {
    if (v <= 0) return 'transparent';
    const t = Math.min(1, v / max);
    const alpha = 0.18 + t * 0.82;
    return `color-mix(in srgb, ${colors.series[0]} ${Math.round(alpha * 100)}%, transparent)`;
  };

  return (
    <Card className="mt-4 animate-fade-up">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Expense Heatmap</CardTitle>
        <span className="text-xs text-muted-foreground">Daily spending, last 12 weeks</span>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="flex gap-1 min-w-fit">
            {weeks.map((w, i) => (
              <div key={i} className="flex flex-col gap-1">
                {Array.from({ length: 7 }).map((_, dow) => {
                  const day = w.find((d) => d.getDay() === dow);
                  if (!day) return <div key={dow} className="h-4 w-4" />;
                  const key = format(day, 'yyyy-MM-dd');
                  const v = spend.get(key) ?? 0;
                  return (
                    <div
                      key={dow}
                      className="h-4 w-4 rounded-[3px] border border-border/60"
                      style={{ backgroundColor: level(v) }}
                      title={`${format(day, 'MMM d')}: ${v > 0 ? fmtMoney(v) : 'no spending'}`}
                      aria-label={`${format(day, 'MMM d')}: ${v > 0 ? fmtMoney(v) : 'no spending'}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-3 text-[11px] text-muted-foreground">
          Less
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <span
              key={t}
              className="h-3 w-3 rounded-[3px] border border-border/60 inline-block"
              style={{ backgroundColor: t === 0 ? 'transparent' : level(t * max) }}
            />
          ))}
          More
        </div>
      </CardContent>
    </Card>
  );
}
