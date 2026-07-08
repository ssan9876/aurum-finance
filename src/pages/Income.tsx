/**
 * Income sources: unlimited sources with live monthly/annual math, projected
 * earnings, and YTD actuals from the ledger.
 */
import * as React from 'react';
import { startOfYear } from 'date-fns';
import { Banknote, CalendarClock, MoreHorizontal, Pencil, Plus, Trash2, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState, PageHeader, StatCard } from '@/components/shared';
import { IncomeDialog } from '@/components/forms/IncomeDialog';
import { BarList } from '@/components/charts';
import { useSettings } from '@/state/settings';
import { useDeleteWithUndo, useIncomeSources, useTransactions, useUpdateEntity } from '@/data/hooks';
import { incomeIn, toMonthly, totalMonthlyIncome, totalYearlyIncome, toYearly } from '@/lib/finance';
import { FREQUENCIES } from '@/shared/defaults';
import { round2, sum } from '@/lib/utils';
import type { IncomeSource } from '@/shared/types';

export default function Income() {
  const { fmtMoney, fmtDate } = useSettings();
  const { data: sources, isLoading } = useIncomeSources();
  const { data: transactions = [] } = useTransactions();
  const update = useUpdateEntity('incomeSource');
  const deleteWithUndo = useDeleteWithUndo('incomeSource');

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<IncomeSource | null>(null);

  if (isLoading || !sources) {
    return (
      <div>
        <PageHeader title="Income" />
        <div className="grid md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[110px] rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const now = new Date();
  const monthly = totalMonthlyIncome(sources);
  const yearly = totalYearlyIncome(sources);
  const ytdActual = round2(sum(incomeIn(transactions, startOfYear(now), now).map((t) => t.amount)));
  const active = sources.filter((s) => s.active);

  const freqLabel = (f: IncomeSource['frequency']) => FREQUENCIES.find((x) => x.value === f)?.label ?? f;

  return (
    <div>
      <PageHeader
        title="Income"
        description="Every income stream, with monthly and annual equivalents calculated live."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus /> Add income source
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <StatCard label="Monthly Income" value={fmtMoney(monthly)} icon={<TrendingUp />} sub={`${active.length} active sources`} />
        <StatCard label="Annual Salary" value={fmtMoney(yearly, { compact: true })} icon={<CalendarClock />} sub="All active sources, annualized" />
        <StatCard label="Received This Year" value={fmtMoney(ytdActual, { compact: true })} icon={<Banknote />} sub="Actual income transactions YTD" />
        <StatCard
          label="Projected 12 Months"
          value={fmtMoney(yearly, { compact: true })}
          icon={<TrendingUp />}
          sub={`≈ ${fmtMoney(monthly)} per month`}
        />
      </div>

      {sources.length === 0 ? (
        <Card className="mt-6">
          <EmptyState
            icon={<TrendingUp />}
            title="No income sources yet"
            description="Add your job, side hustles, freelance work or passive income to see monthly and annual totals."
            action={
              <Button
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus /> Add income source
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mt-6 stagger-children">
          {sources.map((s) => (
            <Card key={s.id} className={!s.active ? 'opacity-60' : undefined}>
              <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="h-9 w-9 rounded-lg inline-flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${s.color ?? '#2a78d6'}22`, color: s.color ?? '#2a78d6' }}
                  >
                    <Banknote className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0">
                    <CardTitle className="text-[15px] truncate">{s.name}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {fmtMoney(s.amount)} · {freqLabel(s.frequency)}
                    </p>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${s.name}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        setEditing(s);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => deleteWithUndo([s], `Deleted "${s.name}"`)}
                    >
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/60 p-3">
                  <div>
                    <p className="text-[11px] text-muted-foreground">Monthly</p>
                    <p className="font-semibold tabular-nums">{fmtMoney(toMonthly(s.amount, s.frequency))}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Yearly</p>
                    <p className="font-semibold tabular-nums">{fmtMoney(toYearly(s.amount, s.frequency))}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <Switch
                      checked={s.active}
                      onCheckedChange={(v) => update.mutate({ id: s.id, data: { active: v } })}
                      aria-label={`${s.name} active`}
                    />
                    {s.active ? 'Active' : 'Paused'}
                  </label>
                  {s.nextPayDate && <Badge variant="secondary">Next: {fmtDate(s.nextPayDate)}</Badge>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {active.length > 0 && (
        <Card className="mt-4 animate-fade-up">
          <CardHeader>
            <CardTitle>Share of monthly income</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList
              data={active
                .map((s) => ({
                  name: s.name,
                  value: toMonthly(s.amount, s.frequency),
                  color: s.color ?? undefined,
                  sub: '/mo',
                }))
                .sort((a, b) => b.value - a.value)}
            />
          </CardContent>
        </Card>
      )}

      <IncomeDialog open={dialogOpen} onOpenChange={setDialogOpen} source={editing} />
    </div>
  );
}
