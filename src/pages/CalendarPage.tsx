/**
 * Calendar: month grid with income, expenses, bill due dates and paydays.
 * Click a day to inspect its activity.
 */
import * as React from 'react';
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Receipt } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Amount, CategoryChip, EmptyState, PageHeader } from '@/components/shared';
import { TransactionDialog } from '@/components/forms/TransactionDialog';
import { useSettings } from '@/state/settings';
import { useBills, useCategories, useIncomeSources, useTransactions } from '@/data/hooks';
import { cn, round2, sum } from '@/lib/utils';
import { billState, countsAsTransfer } from '@/lib/finance';

export default function CalendarPage() {
  const { fmtMoney, fmtDate } = useSettings();
  const { data: transactions, isLoading } = useTransactions();
  const { data: bills = [] } = useBills();
  const { data: categories = [] } = useCategories();
  const { data: incomeSources = [] } = useIncomeSources();

  const [month, setMonth] = React.useState(() => new Date());
  const [selected, setSelected] = React.useState<Date>(() => new Date());
  const [addOpen, setAddOpen] = React.useState(false);

  if (isLoading || !transactions) {
    return (
      <div>
        <PageHeader title="Calendar" />
        <Skeleton className="h-[560px] rounded-xl" />
      </div>
    );
  }

  const catById = new Map(categories.map((c) => [c.id, c]));
  const gridStart = startOfWeek(startOfMonth(month));
  const gridEnd = endOfWeek(endOfMonth(month));
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const txByDay = new Map<string, typeof transactions>();
  for (const t of transactions) {
    const key = format(new Date(t.date), 'yyyy-MM-dd');
    const arr = txByDay.get(key);
    if (arr) arr.push(t);
    else txByDay.set(key, [t]);
  }
  const billsOn = (d: Date) => bills.filter((b) => isSameDay(new Date(b.dueDate), d));
  const paydaysOn = (d: Date) =>
    incomeSources.filter((s) => s.active && s.nextPayDate && isSameDay(new Date(s.nextPayDate), d));

  const selKey = format(selected, 'yyyy-MM-dd');
  const selTx = txByDay.get(selKey) ?? [];
  const selBills = billsOn(selected);
  const selPay = paydaysOn(selected);

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Income, spending and due dates, day by day."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus /> Add transaction
          </Button>
        }
      />

      <div className="flex items-center gap-2 mb-4">
        <Button variant="outline" size="icon-sm" onClick={() => setMonth((m) => subMonths(m, 1))} aria-label="Previous month">
          <ChevronLeft />
        </Button>
        <span className="font-medium min-w-[140px] text-center tabular-nums">{format(month, 'MMMM yyyy')}</span>
        <Button variant="outline" size="icon-sm" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month">
          <ChevronRight />
        </Button>
        {!isSameMonth(month, new Date()) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMonth(new Date());
              setSelected(new Date());
            }}
          >
            Today
          </Button>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Grid */}
        <Card className="lg:col-span-2 overflow-hidden animate-fade-up">
          <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const key = format(day, 'yyyy-MM-dd');
              const dayTx = txByDay.get(key) ?? [];
              const income = round2(sum(dayTx.filter((t) => t.type === 'income' && !countsAsTransfer(t)).map((t) => t.amount)));
              const expense = round2(sum(dayTx.filter((t) => t.type === 'expense' && !countsAsTransfer(t)).map((t) => t.amount)));
              const dayBills = billsOn(day);
              const dayPay = paydaysOn(day);
              const inMonth = isSameMonth(day, month);
              const isSel = isSameDay(day, selected);
              return (
                <button
                  key={key}
                  onClick={() => setSelected(day)}
                  className={cn(
                    'min-h-[86px] border-b border-r p-1.5 text-left align-top transition-colors cursor-pointer hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:z-10',
                    !inMonth && 'bg-muted/30 text-muted-foreground/60',
                    isSel && 'bg-primary/8 ring-1 ring-inset ring-primary/40'
                  )}
                  aria-label={format(day, 'PPPP')}
                >
                  <span
                    className={cn(
                      'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                      isToday(day) && 'bg-primary text-primary-foreground'
                    )}
                  >
                    {format(day, 'd')}
                  </span>
                  <div className="mt-0.5 space-y-0.5 text-[10px] leading-tight">
                    {income > 0 && <p className="text-success tabular-nums truncate">+{fmtMoney(income, { compact: true })}</p>}
                    {expense > 0 && <p className="text-muted-foreground tabular-nums truncate">−{fmtMoney(expense, { compact: true })}</p>}
                    {dayBills.length > 0 && (
                      <p className="flex items-center gap-0.5 text-warning truncate">
                        <Receipt className="h-2.5 w-2.5 shrink-0" />
                        {dayBills.length === 1 ? dayBills[0].name : `${dayBills.length} bills`}
                      </p>
                    )}
                    {dayPay.length > 0 && <p className="text-primary truncate">💼 Payday</p>}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Day detail */}
        <Card className="animate-fade-up self-start">
          <CardHeader>
            <CardTitle className="text-base">{fmtDate(selected, 'EEEE, MMM d')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {selPay.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Paydays</p>
                {selPay.map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-sm py-1">
                    <span>{s.name}</span>
                    <span className="text-success font-medium tabular-nums">+{fmtMoney(s.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            {selBills.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Bills due</p>
                {selBills.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2 text-sm py-1">
                    <span className="truncate">{b.name}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {billState(b) === 'overdue' && <Badge variant="destructive">Overdue</Badge>}
                      <span className="font-medium tabular-nums">{fmtMoney(b.amount)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Transactions ({selTx.length})
              </p>
              {selTx.length === 0 ? (
                <EmptyState
                  icon={<CalendarDays />}
                  title="Quiet day"
                  description="No transactions on this date."
                  className="py-6"
                />
              ) : (
                <div className="space-y-1">
                  {selTx.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 py-1.5 border-b last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{t.merchant}</p>
                        <CategoryChip category={t.categoryId ? catById.get(t.categoryId) : null} />
                      </div>
                      <Amount value={t.amount} type={t.type} className="text-sm shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <TransactionDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
