/**
 * Subscription Detective: recurring merchant charges detected from the ledger —
 * normalized monthly cost, upcoming renewals, price hikes and possible
 * overlapping services. Read-only; everything is derived from transactions.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { differenceInCalendarDays } from 'date-fns';
import { AlertTriangle, CalendarClock, Layers, Repeat, TrendingUp, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CategoryChip, EmptyState, PageHeader, StatCard } from '@/components/shared';
import { useSettings } from '@/state/settings';
import { useCategories, useTransactions } from '@/data/hooks';
import { detectSubscriptions, summarizeSubscriptions, type Cadence } from '@/lib/subscriptions';

const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

/** "in 3 days" / "today" / "5 days ago" */
function relativeDay(iso: string, now: Date): string {
  const days = differenceInCalendarDays(new Date(iso), now);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 0) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

export default function Subscriptions() {
  const { fmtMoney, fmtDate } = useSettings();
  const { data: transactions, isLoading } = useTransactions();
  const { data: categories = [] } = useCategories();

  const now = React.useMemo(() => new Date(), []);
  const subs = React.useMemo(() => detectSubscriptions(transactions ?? []), [transactions]);
  const summary = React.useMemo(() => summarizeSubscriptions(subs, { now }), [subs, now]);
  const catById = React.useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  if (isLoading || !transactions) {
    return (
      <div>
        <PageHeader title="Subscriptions" />
        <Skeleton className="h-[480px] rounded-xl" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Subscriptions"
        description="Recurring charges found in your transactions — what they cost, when they renew, and what got pricier."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <StatCard
          label="Monthly Cost"
          value={fmtMoney(summary.monthlyTotal, { compact: true })}
          icon={<Repeat />}
          sub={`${summary.count} subscription${summary.count === 1 ? '' : 's'}`}
        />
        <StatCard
          label="Yearly Cost"
          value={fmtMoney(summary.yearlyTotal, { compact: true })}
          icon={<Wallet />}
          sub="Annualized at current prices"
        />
        <StatCard
          label="Renewing Soon"
          value={summary.renewingSoon.length}
          icon={<CalendarClock />}
          sub={
            summary.renewingSoon.length
              ? summary.renewingSoon.map((s) => s.merchant).slice(0, 2).join(', ')
              : 'Nothing in the next 14 days'
          }
        />
        <StatCard
          label="Price Hikes"
          value={summary.priceHikes.length}
          tone={summary.priceHikes.length ? 'negative' : 'positive'}
          icon={<TrendingUp />}
          sub={summary.priceHikes.length ? 'Charged more than before' : 'No price increases'}
        />
      </div>

      {summary.priceHikes.length > 0 && (
        <Card className="mt-4 border-warning/40 bg-warning/5 animate-fade-up">
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
            <CardTitle className="text-base">Prices went up</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {summary.priceHikes.map((s) => (
              <p key={s.key} className="text-sm">
                <span className="font-medium">{s.merchant}</span>{' '}
                <span className="text-muted-foreground">
                  {fmtMoney(s.priceChange!.from)} → {fmtMoney(s.priceChange!.to)} as of{' '}
                  {fmtDate(s.priceChange!.at)} · {fmtMoney(
                    (s.priceChange!.to - s.priceChange!.from) * (s.yearlyCost / s.amount)
                  )}
                  /yr more
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {summary.overlaps.length > 0 && (
        <Card className="mt-4 animate-fade-up">
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
            <CardTitle className="text-base">Possible overlap</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {summary.overlaps.map((o) => (
              <p key={o.categoryId} className="text-sm">
                <span className="font-medium">{catById.get(o.categoryId)?.name ?? 'Uncategorized'}</span>
                <span className="text-muted-foreground">
                  {' '}— {o.subs.length} services ({o.subs.map((s) => s.merchant).join(', ')}) costing{' '}
                  {fmtMoney(o.subs.reduce((sum, s) => sum + s.monthlyCost, 0))}/mo
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="mt-4">
        {subs.length === 0 ? (
          <EmptyState
            icon={<Repeat />}
            title="No subscriptions detected"
            description="Aurum looks for merchants that charge you a consistent amount on a regular cadence. Import a few months of transactions and they'll show up here."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead className="hidden sm:table-cell">Cadence</TableHead>
                <TableHead className="hidden md:table-cell">Category</TableHead>
                <TableHead>Next charge</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right hidden lg:table-cell">Per month</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subs.map((s) => (
                <TableRow key={s.key}>
                  <TableCell>
                    <Link
                      to={`/merchants/${encodeURIComponent(s.key)}`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {s.merchant}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {s.count} charges since {fmtDate(s.firstDate)}
                    </p>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="secondary">{CADENCE_LABEL[s.cadence]}</Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <CategoryChip category={s.categoryId ? catById.get(s.categoryId) : null} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="tabular-nums">{fmtDate(s.nextDate)}</span>
                    <p className="text-xs text-muted-foreground">{relativeDay(s.nextDate, now)}</p>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-medium tabular-nums">{fmtMoney(s.amount)}</span>
                    {s.priceChange && s.priceChange.to > s.priceChange.from && (
                      <p className="text-xs text-destructive tabular-nums">
                        ↑ from {fmtMoney(s.priceChange.from)}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums hidden lg:table-cell text-muted-foreground">
                    {fmtMoney(s.monthlyCost)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
