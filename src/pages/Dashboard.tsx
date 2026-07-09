/**
 * Dashboard: at-a-glance stats, six charts, budgets, upcoming bills, recent
 * activity and the financial health score.
 */
import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import {
  ArrowRight,
  CalendarClock,
  CreditCard,
  Flame,
  Landmark,
  PiggyBank,
  Plus,
  Receipt,
  Percent,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
  WalletCards,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { Amount, CategoryChip, EmptyState, PageHeader, StatCard } from '@/components/shared';
import {
  CashFlowChart,
  CategoryDonut,
  IncomeExpenseChart,
  SpendingBarChart,
  TrendAreaChart,
  BarList,
} from '@/components/charts';
import { EntityIcon } from '@/lib/icons';
import { useSettings } from '@/state/settings';
import { useUI } from '@/state/ui';
import {
  useAccounts,
  useBills,
  useBudgets,
  useCategories,
  useIncomeSources,
  useSavingsAccounts,
  useSavingsSnapshots,
  useTransactions,
} from '@/data/hooks';
import {
  accountTypeDebt,
  billState,
  budgetStatuses,
  healthScore,
  monthlySeries,
  predictMonthSpend,
  savingsAccountsBalance,
  savingsHistorySeries,
  savingsStreak,
  spendByCategory,
  toMonthly,
  totalAccountBalance,
  totalMonthlyIncome,
  totalSavings,
  totalYearlyIncome,
} from '@/lib/finance';

export default function Dashboard() {
  const ui = useUI();
  const navigate = useNavigate();
  const { fmtMoney, fmtDate } = useSettings();

  // Drill from a category slice into its filtered transaction list. The
  // Uncategorized bucket carries the sentinel id '__none__'; folded "Other"
  // has no id, so it isn't clickable.
  const openCategory = (slice: { id?: string }) => {
    if (!slice.id) return;
    navigate(`/transactions?category=${slice.id === '__none__' ? 'uncategorized' : slice.id}`);
  };

  const { data: transactions, isLoading: txLoading } = useTransactions();
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const { data: incomeSources } = useIncomeSources();
  const { data: savings } = useSavingsAccounts();
  const { data: snapshots } = useSavingsSnapshots();
  const { data: budgets } = useBudgets();
  const { data: bills } = useBills();

  const loading =
    txLoading || !transactions || !accounts || !categories || !incomeSources || !savings || !snapshots || !budgets || !bills;

  const now = new Date();

  const derived = React.useMemo(() => {
    if (loading) return null;
    const series = monthlySeries(transactions, 12, now);
    const thisMonth = series[series.length - 1];
    const monthIncomeActual = thisMonth?.income ?? 0;
    const monthExpense = thisMonth?.expense ?? 0;
    const plannedMonthlyIncome = totalMonthlyIncome(incomeSources);
    const monthlyIncome = Math.max(plannedMonthlyIncome, monthIncomeActual);
    const savingsAccountsTotal = savingsAccountsBalance(accounts, transactions);
    const savingsTotal = totalSavings(savings) + savingsAccountsTotal;
    const statuses = budgetStatuses(budgets, categories, transactions, now);
    const prediction = predictMonthSpend(transactions, now);
    const rate = monthlyIncome > 0 ? ((monthlyIncome - monthExpense) / monthlyIncome) * 100 : 0;
    const health = healthScore({
      monthlyIncome,
      monthlyExpense: monthExpense || prediction.predicted,
      savingsTotal,
      budgets: statuses,
      overdueBills: bills.filter((b) => billState(b, now) === 'overdue').length,
      incomeSources: incomeSources.filter((s) => s.active).length,
    });
    return {
      series,
      series6: series.slice(-6),
      thisMonth,
      monthExpense,
      monthIncomeActual,
      plannedMonthlyIncome,
      // Savings, credit cards and loans each get their own card, so keep them
      // out of the Account Balance total to avoid double-counting.
      accountTotal: totalAccountBalance(
        accounts.filter((a) => !['savings', 'credit', 'loan'].includes(a.type)),
        transactions
      ),
      spendingAccountCount: accounts.filter(
        (a) => !a.archived && !['savings', 'credit', 'loan'].includes(a.type)
      ).length,
      creditDebt: accountTypeDebt(accounts, transactions, 'credit'),
      creditCount: accounts.filter((a) => !a.archived && a.type === 'credit').length,
      loanDebt: accountTypeDebt(accounts, transactions, 'loan'),
      loanCount: accounts.filter((a) => !a.archived && a.type === 'loan').length,
      savingsTotal,
      savingsAccountsTotal,
      yearlySalary: totalYearlyIncome(incomeSources),
      rate,
      statuses,
      prediction,
      streak: savingsStreak(transactions, now),
      health,
      donut: spendByCategory(transactions, categories, startOfMonth(now), endOfMonth(now)).map((s) => ({
        name: s.category.name,
        value: s.amount,
        color: s.category.color,
        id: s.category.id, // '__none__' for the Uncategorized bucket
      })),
      savingsHistory: savingsHistorySeries(savings, snapshots, 12, now).map((p) => ({
        label: p.label,
        balance: p.balance,
      })),
      incomeList: incomeSources
        .filter((s) => s.active)
        .map((s) => ({
          name: s.name,
          value: toMonthly(s.amount, s.frequency),
          color: s.color ?? undefined,
          sub: '/mo',
        }))
        .sort((a, b) => b.value - a.value),
      upcomingBills: [...bills]
        .filter((b) => billState(b, now) !== 'overdue' || true)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, 5),
      recent: transactions.slice(0, 8),
    };
  }, [loading, transactions, accounts, categories, incomeSources, savings, snapshots, budgets, bills, now]);

  if (loading || !derived) return <DashboardSkeleton />;

  const catById = new Map(categories!.map((c) => [c.id, c]));
  const d = derived;
  const isEmpty = transactions!.length === 0;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={format(now, 'EEEE, MMMM d, yyyy')}
        actions={
          <Button onClick={() => ui.setQuickTxOpen(true)}>
            <Plus /> Add transaction
          </Button>
        }
      />

      {isEmpty && (
        <Card className="mb-6">
          <EmptyState
            icon={<Sparkles />}
            title="Nothing here yet"
            description="Add your first transaction or income source — or load the demo dataset from Settings → Data to explore."
            action={
              <div className="flex gap-2">
                <Button onClick={() => ui.setQuickTxOpen(true)}>
                  <Plus /> Add transaction
                </Button>
                <Button variant="outline" onClick={() => ui.setQuickIncomeOpen(true)}>
                  <TrendingUp /> Add income
                </Button>
              </div>
            }
          />
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <StatCard
          label="Account Balance"
          value={fmtMoney(d.accountTotal, { compact: true })}
          icon={<Wallet />}
          sub={`${d.spendingAccountCount} accounts · excludes savings`}
        />
        <StatCard
          label="Total Savings"
          value={fmtMoney(d.savingsTotal, { compact: true })}
          icon={<PiggyBank />}
          sub={
            d.streak > 0 ? (
              <span className="inline-flex items-center gap-1 text-warning">
                <Flame className="h-3 w-3" /> {d.streak}-month savings streak
              </span>
            ) : d.savingsAccountsTotal > 0 ? (
              `Incl. ${fmtMoney(d.savingsAccountsTotal, { compact: true })} in savings accounts`
            ) : (
              'Across all savings accounts'
            )
          }
        />
        <StatCard
          label="Credit Card"
          value={fmtMoney(Math.abs(d.creditDebt), { compact: true })}
          tone={d.creditDebt < 0 ? 'negative' : 'default'}
          icon={<CreditCard />}
          sub={d.creditCount > 0 ? `Owed across ${d.creditCount} card${d.creditCount > 1 ? 's' : ''}` : 'No credit cards'}
        />
        <StatCard
          label="Loans"
          value={fmtMoney(Math.abs(d.loanDebt), { compact: true })}
          tone={d.loanDebt < 0 ? 'negative' : 'default'}
          icon={<Landmark />}
          sub={d.loanCount > 0 ? `Owed across ${d.loanCount} loan${d.loanCount > 1 ? 's' : ''}` : 'No loans'}
        />
        <StatCard
          label="Monthly Income"
          value={fmtMoney(d.plannedMonthlyIncome, { compact: true })}
          icon={<TrendingUp />}
          sub={`Received this month: ${fmtMoney(d.monthIncomeActual, { compact: true })}`}
        />
        <StatCard
          label="Monthly Expenses"
          value={fmtMoney(d.monthExpense, { compact: true })}
          icon={<TrendingDown />}
          sub={`Forecast: ${fmtMoney(d.prediction.predicted, { compact: true })} by month end`}
        />
        <StatCard
          label="Monthly Net Income"
          value={fmtMoney((d.thisMonth?.net ?? 0), { compact: true })}
          tone={(d.thisMonth?.net ?? 0) >= 0 ? 'positive' : 'negative'}
          icon={<ArrowRight />}
          sub="Income − expenses this month"
        />
        <StatCard
          label="Yearly Salary"
          value={fmtMoney(d.yearlySalary, { compact: true })}
          icon={<CalendarClock />}
          sub={`${incomeSources!.filter((s) => s.active).length} active income sources`}
        />
        <StatCard
          label="Savings Rate"
          value={`${Math.round(d.rate)}%`}
          tone={d.rate >= 20 ? 'positive' : d.rate < 0 ? 'negative' : 'default'}
          icon={<Percent />}
          sub="Of monthly income kept"
        />
        <StatCard
          label="Spending This Month"
          value={fmtMoney(d.prediction.soFar, { compact: true })}
          icon={<WalletCards />}
          sub={`Day ${now.getDate()} of ${format(endOfMonth(now), 'd')}`}
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid lg:grid-cols-3 gap-4 mt-4 stagger-children">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Income vs Expenses</CardTitle>
            <span className="text-xs text-muted-foreground">Last 6 months</span>
          </CardHeader>
          <CardContent>
            <IncomeExpenseChart data={d.series6} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Expenses by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {d.donut.length === 0 ? (
              <EmptyState icon={<WalletCards />} title="No spending yet" className="py-8" />
            ) : (
              <CategoryDonut data={d.donut} height={170} onSelect={openCategory} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 stagger-children">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Savings Growth</CardTitle>
            <span className="text-xs text-muted-foreground">12 months</span>
          </CardHeader>
          <CardContent>
            <TrendAreaChart data={d.savingsHistory} dataKey="balance" name="Savings" height={200} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Cash Flow</CardTitle>
            <span className="text-xs text-muted-foreground">Net by month</span>
          </CardHeader>
          <CardContent>
            <CashFlowChart data={d.series6} height={200} />
          </CardContent>
        </Card>
        <Card className="md:col-span-2 lg:col-span-1">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Income Sources</CardTitle>
            <Link to="/income" className="text-xs text-primary hover:underline">
              Manage
            </Link>
          </CardHeader>
          <CardContent>
            {d.incomeList.length === 0 ? (
              <EmptyState
                icon={<TrendingUp />}
                title="No income sources"
                className="py-8"
                action={
                  <Button size="sm" variant="outline" onClick={() => ui.setQuickIncomeOpen(true)}>
                    Add income
                  </Button>
                }
              />
            ) : (
              <BarList data={d.incomeList} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 3: budgets / recent / bills+health */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 stagger-children">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Budget Progress</CardTitle>
            <Link to="/budgets" className="text-xs text-primary hover:underline">
              All budgets
            </Link>
          </CardHeader>
          <CardContent className="space-y-4">
            {d.statuses.length === 0 ? (
              <EmptyState
                icon={<WalletCards />}
                title="No budgets set"
                className="py-8"
                action={
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/budgets">Create budgets</Link>
                  </Button>
                }
              />
            ) : (
              d.statuses.slice(0, 5).map((s) => (
                <div key={s.category.id}>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <EntityIcon
                        name={s.category.icon}
                        className="h-3.5 w-3.5 shrink-0"
                        style={{ color: s.category.color }}
                      />
                      <span className="truncate">{s.category.name}</span>
                    </span>
                    <span className="tabular-nums text-xs text-muted-foreground shrink-0">
                      {fmtMoney(s.spent, { compact: true })} / {fmtMoney(s.budget, { compact: true })}
                    </span>
                  </div>
                  <Progress
                    value={Math.min(100, s.pct * 100)}
                    indicatorColor={s.pct > 1 ? 'hsl(var(--destructive))' : s.pct > 0.9 ? 'hsl(var(--warning))' : s.category.color}
                  />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Recent Transactions</CardTitle>
            <Link to="/transactions" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent className="space-y-1">
            {d.recent.length === 0 ? (
              <EmptyState icon={<Receipt />} title="No transactions yet" className="py-8" />
            ) : (
              d.recent.map((t) => (
                <div key={t.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent/60 -mx-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{t.merchant || t.description || '—'}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(t.date)}</p>
                  </div>
                  <CategoryChip category={t.categoryId ? catById.get(t.categoryId) : null} className="hidden xl:inline-flex" />
                  <Amount value={t.amount} type={t.type} className="text-sm shrink-0" />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-4 md:col-span-2 lg:col-span-1">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Upcoming Bills</CardTitle>
              <Link to="/bills" className="text-xs text-primary hover:underline">
                All bills
              </Link>
            </CardHeader>
            <CardContent className="space-y-2">
              {d.upcomingBills.length === 0 ? (
                <EmptyState icon={<Receipt />} title="No bills tracked" className="py-6" />
              ) : (
                d.upcomingBills.map((b) => {
                  const state = billState(b, now);
                  return (
                    <div key={b.id} className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{b.name}</p>
                        <p className="text-xs text-muted-foreground">{fmtDate(b.dueDate)}</p>
                      </div>
                      {state === 'overdue' && <Badge variant="destructive">Overdue</Badge>}
                      {state === 'due-soon' && <Badge variant="warning">Due soon</Badge>}
                      {b.autoPay && state === 'upcoming' && <Badge variant="secondary">Auto</Badge>}
                      <span className="text-sm font-medium tabular-nums">{fmtMoney(b.amount)}</span>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Financial Health</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <HealthRing score={d.health.score} />
                <div className="flex-1 space-y-1.5">
                  {d.health.parts.map((p) => (
                    <SimpleTooltip key={p.label} label={p.hint}>
                      <div className="flex items-center gap-2 text-xs cursor-default">
                        <span className="w-28 shrink-0 text-muted-foreground truncate">{p.label}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${(p.score / p.max) * 100}%` }}
                          />
                        </div>
                        <span className="tabular-nums w-9 text-right text-muted-foreground">
                          {p.score}/{p.max}
                        </span>
                      </div>
                    </SimpleTooltip>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Row 4: monthly spending trend */}
      <div className="grid gap-4 mt-4">
        <Card className="animate-fade-up">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Monthly Spending</CardTitle>
            <span className="text-xs text-muted-foreground">Last 12 months</span>
          </CardHeader>
          <CardContent>
            <SpendingBarChart data={d.series} height={220} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function HealthRing({ score }: { score: number }) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const color =
    score >= 85 ? 'hsl(var(--success))' : score >= 60 ? 'hsl(var(--primary))' : score >= 40 ? 'hsl(var(--warning))' : 'hsl(var(--destructive))';
  const grade = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Fair' : 'Needs work';
  return (
    <div className="relative h-24 w-24 shrink-0" role="img" aria-label={`Financial health score ${score} out of 100 — ${grade}`}>
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="hsl(var(--secondary))" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - score / 100)}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold tabular-nums">{score}</span>
        <span className="text-[10px] text-muted-foreground">{grade}</span>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div>
      <div className="mb-6">
        <Skeleton className="h-8 w-44 mb-2" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[110px] rounded-xl" />
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <Skeleton className="h-[330px] rounded-xl lg:col-span-2" />
        <Skeleton className="h-[330px] rounded-xl" />
      </div>
      <div className="grid md:grid-cols-3 gap-4 mt-4">
        <Skeleton className="h-[280px] rounded-xl" />
        <Skeleton className="h-[280px] rounded-xl" />
        <Skeleton className="h-[280px] rounded-xl" />
      </div>
    </div>
  );
}
