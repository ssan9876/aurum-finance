/**
 * Merchant profile: one payee's lifetime spend, cadence, typical ticket,
 * category history and full charge list. Derived entirely from transactions —
 * merchants aren't a stored entity (see src/lib/merchants.ts).
 */
import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarClock, Receipt, Repeat, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Amount, CategoryChip, EmptyState, PageHeader, StatCard } from '@/components/shared';
import { TrendAreaChart } from '@/components/charts';
import { useSettings } from '@/state/settings';
import { useCategories, useTransactions } from '@/data/hooks';
import { merchantProfile } from '@/lib/merchants';

/** "every 30 days" / "every 2 weeks" — a cadence a human would say out loud. */
function cadenceLabel(days: number | null): string {
  if (days == null) return 'Only one visit';
  if (days <= 1) return 'Almost daily';
  if (days <= 10) return `Every ${days} days`;
  if (days <= 20) return 'Every couple of weeks';
  if (days <= 45) return 'Roughly monthly';
  if (days <= 120) return 'Every few months';
  return 'A few times a year';
}

export default function Merchant() {
  const { key = '' } = useParams();
  const { fmtMoney, fmtDate } = useSettings();
  const { data: transactions, isLoading } = useTransactions();
  const { data: categories = [] } = useCategories();

  const now = React.useMemo(() => new Date(), []);
  const profile = React.useMemo(
    () => (transactions ? merchantProfile(transactions, key, { now }) : null),
    [transactions, key, now]
  );
  const catById = React.useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  if (isLoading || !transactions) {
    return (
      <div>
        <PageHeader title="Merchant" />
        <Skeleton className="h-[480px] rounded-xl" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div>
        <PageHeader title={key} />
        <Card>
          <EmptyState
            icon={<Receipt />}
            title="No charges from this merchant"
            description="Nothing in your ledger matches this name."
            action={
              <Button variant="outline" asChild>
                <Link to="/transactions">Back to transactions</Link>
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
        title={profile.merchant}
        description={`${profile.count} charges · first seen ${fmtDate(profile.firstDate)} · last ${fmtDate(profile.lastDate)}`}
        actions={
          <Button variant="outline" asChild>
            <Link to={`/transactions?q=${encodeURIComponent(profile.merchant)}`}>
              <ArrowLeft /> In transactions
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <StatCard
          label="Total Spent"
          value={fmtMoney(profile.total, { compact: true })}
          icon={<Wallet />}
          sub="Lifetime, all time"
        />
        <StatCard
          label="Average Ticket"
          value={fmtMoney(profile.average)}
          icon={<Receipt />}
          sub={`${fmtMoney(profile.min)} – ${fmtMoney(profile.max)}`}
        />
        <StatCard
          label="Visits"
          value={profile.count}
          icon={<Repeat />}
          sub={cadenceLabel(profile.cadenceDays)}
        />
        <StatCard
          label="Typical Gap"
          value={profile.cadenceDays == null ? '—' : `${profile.cadenceDays}d`}
          icon={<CalendarClock />}
          sub="Median days between charges"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4 stagger-children">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Spend by Month</CardTitle>
            <span className="text-xs text-muted-foreground">Last 12 months</span>
          </CardHeader>
          <CardContent>
            <TrendAreaChart
              data={profile.monthly.map((m) => ({ label: m.label, amount: m.amount }))}
              dataKey="amount"
              name="Spend"
              height={200}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Categories</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {profile.categories.map((c) => (
              <div key={c.categoryId ?? 'none'} className="flex items-center justify-between gap-2 text-sm">
                <CategoryChip category={c.categoryId ? catById.get(c.categoryId) : null} />
                <span className="tabular-nums text-muted-foreground shrink-0">
                  {fmtMoney(c.amount)} · {c.count}×
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>All Charges</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="hidden sm:table-cell">Category</TableHead>
                <TableHead className="hidden md:table-cell">Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profile.transactions.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {fmtDate(t.date)}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <CategoryChip category={t.categoryId ? catById.get(t.categoryId) : null} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground truncate max-w-[260px]">
                    {t.description || '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={t.amount} type={t.type} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
