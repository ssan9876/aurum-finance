/**
 * What-if sandbox: toggle subscriptions off, nudge spending and income, and
 * watch the monthly net, savings projection and health score move. Nothing is
 * saved — it's a scratchpad over the real numbers.
 */
import * as React from 'react';
import { FlaskConical, Percent, PiggyBank, RotateCcw, TrendingUp, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, PageHeader, StatCard } from '@/components/shared';
import { MultiLineChart, useChartColors } from '@/components/charts';
import { useSettings } from '@/state/settings';
import {
  useAccounts,
  useBills,
  useBudgets,
  useCategories,
  useIncomeSources,
  useSavingsAccounts,
  useTransactions,
} from '@/data/hooks';
import {
  billState,
  budgetStatuses,
  healthScore,
  monthlySeries,
  savingsAccountsBalance,
  totalMonthlyIncome,
  totalSavings,
} from '@/lib/finance';
import { detectSubscriptions } from '@/lib/subscriptions';
import { simulateWhatIf } from '@/lib/whatif';
import { cn, round2, sum } from '@/lib/utils';

/** Native range input — no slider dependency in this project. */
function Slider({
  label,
  value,
  onChange,
  min,
  max,
  suffix = '%',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1.5">
        <span className="font-medium">{label}</span>
        <span
          className={cn(
            'tabular-nums font-medium',
            value > 0 ? 'text-success' : value < 0 ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {value > 0 ? '+' : ''}
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="w-full h-1.5 rounded-full appearance-none bg-secondary cursor-pointer accent-primary"
      />
    </div>
  );
}

export default function WhatIf() {
  const { fmtMoney } = useSettings();
  const colors = useChartColors();
  const { data: transactions, isLoading } = useTransactions();
  const { data: accounts = [] } = useAccounts();
  const { data: incomeSources = [] } = useIncomeSources();
  const { data: savings = [] } = useSavingsAccounts();
  const { data: budgets = [] } = useBudgets();
  const { data: bills = [] } = useBills();
  const { data: categories = [] } = useCategories();

  const now = React.useMemo(() => new Date(), []);
  const [cancelled, setCancelled] = React.useState<Set<string>>(new Set());
  const [spendingDeltaPct, setSpendingDeltaPct] = React.useState(0);
  const [incomeDeltaPct, setIncomeDeltaPct] = React.useState(0);

  const subs = React.useMemo(() => detectSubscriptions(transactions ?? []), [transactions]);

  const baseNumbers = React.useMemo(() => {
    const txs = transactions ?? [];
    // Average the last three complete months so one odd month doesn't skew it.
    const prev = monthlySeries(txs, 4, now).slice(0, 3);
    const monthlyExpense = prev.length ? round2(sum(prev.map((p) => p.expense)) / prev.length) : 0;
    return {
      monthlyIncome: totalMonthlyIncome(incomeSources),
      monthlyExpense,
      savingsTotal: round2(totalSavings(savings) + savingsAccountsBalance(accounts, txs)),
    };
  }, [transactions, incomeSources, savings, accounts, now]);

  const cancelledMonthly = React.useMemo(
    () => round2(sum(subs.filter((s) => cancelled.has(s.key)).map((s) => s.monthlyCost))),
    [subs, cancelled]
  );

  const baseline = React.useMemo(
    () => simulateWhatIf({ ...baseNumbers, cancelledMonthly: 0, spendingDeltaPct: 0, incomeDeltaPct: 0 }, { now }),
    [baseNumbers, now]
  );
  const scenario = React.useMemo(
    () => simulateWhatIf({ ...baseNumbers, cancelledMonthly, spendingDeltaPct, incomeDeltaPct }, { now }),
    [baseNumbers, cancelledMonthly, spendingDeltaPct, incomeDeltaPct, now]
  );

  const health = React.useMemo(() => {
    const txs = transactions ?? [];
    const statuses = budgetStatuses(budgets, categories, txs, now);
    const overdueBills = bills.filter((b) => billState(b, now) === 'overdue').length;
    const activeSources = incomeSources.filter((s) => s.active).length;
    const score = (expense: number, income: number, savingsTotal: number) =>
      healthScore({
        monthlyIncome: income,
        monthlyExpense: expense,
        savingsTotal,
        budgets: statuses,
        overdueBills,
        incomeSources: activeSources,
      }).score;
    return {
      before: score(baseline.monthlyExpense, baseline.monthlyIncome, baseNumbers.savingsTotal),
      after: score(scenario.monthlyExpense, scenario.monthlyIncome, baseNumbers.savingsTotal),
    };
  }, [transactions, budgets, categories, bills, incomeSources, baseline, scenario, baseNumbers, now]);

  const chartData = React.useMemo(
    () =>
      baseline.projection.map((p, i) => ({
        label: p.label,
        baseline: p.balance,
        scenario: scenario.projection[i]?.balance ?? p.balance,
      })),
    [baseline, scenario]
  );

  const dirty = cancelled.size > 0 || spendingDeltaPct !== 0 || incomeDeltaPct !== 0;
  const netDelta = round2(scenario.monthlyNet - baseline.monthlyNet);
  const yearDelta = round2(scenario.yearlySaved - baseline.yearlySaved);

  const reset = () => {
    setCancelled(new Set());
    setSpendingDeltaPct(0);
    setIncomeDeltaPct(0);
  };

  if (isLoading || !transactions) {
    return (
      <div>
        <PageHeader title="What If" />
        <Skeleton className="h-[480px] rounded-xl" />
      </div>
    );
  }

  if (baseNumbers.monthlyIncome === 0 && baseNumbers.monthlyExpense === 0) {
    return (
      <div>
        <PageHeader title="What If" />
        <Card>
          <EmptyState
            icon={<FlaskConical />}
            title="Nothing to simulate yet"
            description="Add an income source and a few months of transactions, then come back to play with the numbers."
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="What If"
        description="Try a change before you make it. Nothing here is saved."
        actions={
          dirty ? (
            <Button variant="outline" onClick={reset}>
              <RotateCcw /> Reset
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <StatCard
          label="Monthly Net"
          value={fmtMoney(scenario.monthlyNet, { compact: true })}
          tone={scenario.monthlyNet >= 0 ? 'positive' : 'negative'}
          icon={<Wallet />}
          sub={
            dirty ? (
              <span className={netDelta >= 0 ? 'text-success' : 'text-destructive'}>
                {netDelta >= 0 ? '+' : ''}
                {fmtMoney(netDelta)} vs today
              </span>
            ) : (
              'Income − expenses'
            )
          }
        />
        <StatCard
          label="Savings Rate"
          value={`${Math.round(scenario.savingsRate * 100)}%`}
          tone={scenario.savingsRate >= 0.2 ? 'positive' : scenario.savingsRate < 0 ? 'negative' : 'default'}
          icon={<Percent />}
          sub={dirty ? `Was ${Math.round(baseline.savingsRate * 100)}%` : 'Of monthly income kept'}
        />
        <StatCard
          label="Saved Per Year"
          value={fmtMoney(scenario.yearlySaved, { compact: true })}
          tone={yearDelta > 0 ? 'positive' : yearDelta < 0 ? 'negative' : 'default'}
          icon={<PiggyBank />}
          sub={
            dirty ? (
              <span className={yearDelta >= 0 ? 'text-success' : 'text-destructive'}>
                {yearDelta >= 0 ? '+' : ''}
                {fmtMoney(yearDelta)} vs today
              </span>
            ) : (
              'At the current rate'
            )
          }
        />
        <StatCard
          label="Health Score"
          value={health.after}
          tone={health.after > health.before ? 'positive' : health.after < health.before ? 'negative' : 'default'}
          icon={<TrendingUp />}
          sub={dirty ? `Was ${health.before}/100` : 'Out of 100'}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4 stagger-children">
        {/* Levers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Levers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <Slider
              label="Spending"
              value={spendingDeltaPct}
              onChange={setSpendingDeltaPct}
              min={-50}
              max={50}
            />
            <Slider label="Income" value={incomeDeltaPct} onChange={setIncomeDeltaPct} min={-50} max={50} />

            <div>
              <p className="text-sm font-medium mb-2">Cancel subscriptions</p>
              {subs.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  None detected yet — they show up once a merchant charges you on a steady cadence.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto -mx-1 px-1">
                  {subs.map((s) => (
                    <label
                      key={s.key}
                      className="flex items-center gap-2 text-sm rounded-md px-1.5 py-1 cursor-pointer hover:bg-accent"
                    >
                      <Checkbox
                        checked={cancelled.has(s.key)}
                        onCheckedChange={(v) =>
                          setCancelled((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(s.key);
                            else next.delete(s.key);
                            return next;
                          })
                        }
                        aria-label={`Cancel ${s.merchant}`}
                      />
                      <span className={cn('truncate flex-1', cancelled.has(s.key) && 'line-through opacity-60')}>
                        {s.merchant}
                      </span>
                      <span className="tabular-nums text-xs text-muted-foreground shrink-0">
                        {fmtMoney(s.monthlyCost)}/mo
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {cancelledMonthly > 0 && (
                <Badge variant="success" className="mt-2">
                  Frees up {fmtMoney(cancelledMonthly)}/mo · {fmtMoney(round2(cancelledMonthly * 12))}/yr
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Projection */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Savings in 12 months</CardTitle>
            <span className="text-xs text-muted-foreground">No interest assumed</span>
          </CardHeader>
          <CardContent>
            <MultiLineChart
              data={chartData}
              series={[
                { key: 'baseline', name: 'Today’s path', color: colors.axis },
                { key: 'scenario', name: 'Scenario', color: colors.series[0] },
              ]}
              height={260}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Ends at <span className="font-medium text-foreground">{fmtMoney(scenario.projection[scenario.projection.length - 1].balance)}</span>
              {dirty && (
                <>
                  {' '}vs{' '}
                  <span className="font-medium">
                    {fmtMoney(baseline.projection[baseline.projection.length - 1].balance)}
                  </span>{' '}
                  on today’s path
                </>
              )}
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
