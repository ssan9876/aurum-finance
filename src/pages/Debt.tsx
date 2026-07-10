/**
 * Debt payoff planner: avalanche vs snowball over credit cards and loans.
 * Balances come from the ledger; APR and minimum payment come from the account
 * (Accounts → edit). Add extra per month and watch the payoff date move.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Landmark, Percent, TrendingDown, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, Field, MoneyInput, PageHeader, StatCard } from '@/components/shared';
import { TrendAreaChart } from '@/components/charts';
import { useSettings } from '@/state/settings';
import { useAccounts, useTransactions } from '@/data/hooks';
import { accountBalance } from '@/lib/finance';
import { comparePayoff, defaultMinPayment, type DebtInput, type Strategy } from '@/lib/debt';
import { cn, round2, sum } from '@/lib/utils';

export default function Debt() {
  const { fmtMoney } = useSettings();
  const { data: transactions, isLoading } = useTransactions();
  const { data: accounts = [] } = useAccounts();

  const now = React.useMemo(() => new Date(), []);
  const [extra, setExtra] = React.useState<number | ''>('');
  const [strategy, setStrategy] = React.useState<Strategy>('avalanche');

  // Credit cards and loans carry negative running balances; owed is the flip.
  const debts = React.useMemo<DebtInput[]>(() => {
    const txs = transactions ?? [];
    return accounts
      .filter((a) => !a.archived && (a.type === 'credit' || a.type === 'loan'))
      .map((a) => {
        const balance = round2(Math.max(0, -accountBalance(a, txs)));
        return {
          id: a.id,
          name: a.name,
          balance,
          apr: a.apr ?? 0,
          minPayment: a.minPayment ?? defaultMinPayment(balance),
        };
      })
      .filter((d) => d.balance > 0);
  }, [accounts, transactions]);

  const extraMonthly = extra === '' ? 0 : extra;
  const comparison = React.useMemo(
    () => comparePayoff(debts, { extraMonthly, now }),
    [debts, extraMonthly, now]
  );
  const plan = strategy === 'avalanche' ? comparison.avalanche : comparison.snowball;

  const totalDebt = round2(sum(debts.map((d) => d.balance)));
  const totalMinimums = round2(sum(debts.map((d) => d.minPayment)));
  const missingApr = debts.filter((d) => d.apr === 0);
  const inferredMin = React.useMemo(() => {
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return debts.filter((d) => byId.get(d.id)?.minPayment == null);
  }, [debts, accounts]);

  if (isLoading || !transactions) {
    return (
      <div>
        <PageHeader title="Debt Payoff" />
        <Skeleton className="h-[480px] rounded-xl" />
      </div>
    );
  }

  if (debts.length === 0) {
    return (
      <div>
        <PageHeader title="Debt Payoff" />
        <Card>
          <EmptyState
            icon={<Landmark />}
            title="No debt to pay off"
            description="Credit card and loan accounts with a balance owed show up here. Nothing owing right now — enjoy it."
            action={
              <Button variant="outline" asChild>
                <Link to="/accounts">Manage accounts</Link>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Debt Payoff"
        description="Avalanche pays the highest rate first. Snowball clears the smallest balance first. Same budget, different order."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <StatCard
          label="Total Debt"
          value={fmtMoney(totalDebt, { compact: true })}
          tone="negative"
          icon={<Landmark />}
          sub={`Across ${debts.length} account${debts.length === 1 ? '' : 's'}`}
        />
        <StatCard
          label="Monthly Budget"
          value={fmtMoney(round2(totalMinimums + extraMonthly), { compact: true })}
          icon={<Zap />}
          sub={`${fmtMoney(totalMinimums)} minimums${extraMonthly ? ` + ${fmtMoney(extraMonthly)} extra` : ''}`}
        />
        <StatCard
          label="Debt Free"
          value={plan.payoffLabel ?? 'Never'}
          tone={plan.payoffLabel ? 'positive' : 'negative'}
          icon={<CalendarClock />}
          sub={
            plan.months != null
              ? `${plan.months} months from now`
              : 'Payments don’t cover the interest'
          }
        />
        <StatCard
          label="Total Interest"
          value={fmtMoney(plan.totalInterest, { compact: true })}
          tone="negative"
          icon={<Percent />}
          sub={`${strategy === 'avalanche' ? 'Avalanche' : 'Snowball'} strategy`}
        />
      </div>

      {plan.months == null && (
        <Card className="mt-4 border-destructive/40 bg-destructive/5 animate-fade-up">
          <CardContent className="pt-5 text-sm">
            <span className="font-medium text-destructive">This never pays off.</span>{' '}
            <span className="text-muted-foreground">
              The monthly budget of {fmtMoney(round2(totalMinimums + extraMonthly))} doesn’t outpace the
              interest. Add extra each month below.
            </span>
          </CardContent>
        </Card>
      )}

      {(missingApr.length > 0 || inferredMin.length > 0) && (
        <Card className="mt-4 animate-fade-up">
          <CardContent className="pt-5 space-y-1 text-xs text-muted-foreground">
            {missingApr.length > 0 && (
              <p>
                No APR set for {missingApr.map((d) => d.name).join(', ')} — assuming 0% interest.{' '}
                <Link to="/accounts" className="text-primary hover:underline">
                  Add it
                </Link>{' '}
                for a real projection.
              </p>
            )}
            {inferredMin.length > 0 && (
              <p>
                Minimum payment estimated (2% of balance, at least $25) for{' '}
                {inferredMin.map((d) => d.name).join(', ')}.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-4 mt-4 stagger-children">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Extra per month" hint="On top of the minimums">
              <MoneyInput value={extra} onChange={setExtra} />
            </Field>

            <div>
              <p className="text-sm font-medium mb-2">Strategy</p>
              <div className="grid grid-cols-2 gap-2">
                {(['avalanche', 'snowball'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStrategy(s)}
                    className={cn(
                      'rounded-md border px-3 py-2 text-sm font-medium capitalize cursor-pointer transition-colors',
                      strategy === s
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'hover:bg-accent text-muted-foreground'
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {strategy === 'avalanche'
                  ? 'Highest interest rate first — mathematically cheapest.'
                  : 'Smallest balance first — quicker wins, usually costs more.'}
              </p>
            </div>

            {comparison.interestSaved !== 0 && (
              <div className="rounded-lg bg-muted/60 p-3 text-xs">
                {comparison.interestSaved > 0 ? (
                  <p>
                    <span className="font-medium text-foreground">Avalanche saves you</span>{' '}
                    {fmtMoney(comparison.interestSaved)} in interest
                    {comparison.monthsSaved
                      ? ` and ${comparison.monthsSaved} month${comparison.monthsSaved === 1 ? '' : 's'}`
                      : ''}{' '}
                    versus snowball.
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    Both strategies cost about the same here ({fmtMoney(Math.abs(comparison.interestSaved))}{' '}
                    difference).
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Balance over time</CardTitle>
            <Badge variant="secondary" className="capitalize">
              {strategy}
            </Badge>
          </CardHeader>
          <CardContent>
            <TrendAreaChart
              data={plan.series.map((p) => ({ label: p.label, balance: p.balance }))}
              dataKey="balance"
              name="Debt remaining"
              height={260}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Payoff order</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right hidden sm:table-cell">APR</TableHead>
                <TableHead className="text-right hidden md:table-cell">Minimum</TableHead>
                <TableHead className="text-right">Paid off</TableHead>
                <TableHead className="text-right hidden lg:table-cell">Interest</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.perDebt.map((d, i) => {
                const input = debts.find((x) => x.id === d.id)!;
                return (
                  <TableRow key={d.id}>
                    <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(input.balance)}</TableCell>
                    <TableCell className="text-right tabular-nums hidden sm:table-cell">
                      {input.apr ? `${input.apr}%` : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums hidden md:table-cell text-muted-foreground">
                      {fmtMoney(input.minPayment)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {d.label ?? <span className="text-destructive">Never</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums hidden lg:table-cell text-muted-foreground">
                      {fmtMoney(d.interestPaid)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
