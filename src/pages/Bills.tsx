/**
 * Bills: recurring obligations with due dates, auto-pay flags, reminders and
 * one-click "mark paid" that logs the expense and advances the due date.
 */
import * as React from 'react';
import { differenceInCalendarDays } from 'date-fns';
import { toast } from 'sonner';
import { CheckCircle2, MoreHorizontal, Pencil, Plus, Receipt, RefreshCcw, Trash2, Zap } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateField, EmptyState, Field, MoneyInput, PageHeader, StatCard } from '@/components/shared';
import { EntityIcon } from '@/lib/icons';
import { useSettings } from '@/state/settings';
import {
  useAccounts,
  useBills,
  useCategories,
  useCreateEntity,
  useDeleteWithUndo,
  useRefreshAll,
  useUpdateEntity,
} from '@/data/hooks';
import { api } from '@/data/api';
import { advanceBillDate, billState, monthlyBillTotal } from '@/lib/finance';
import { BILL_FREQUENCIES } from '@/shared/defaults';
import type { Bill } from '@/shared/types';

export default function Bills() {
  const { fmtMoney, fmtDate } = useSettings();
  const { data: bills, isLoading } = useBills();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const updateBill = useUpdateEntity('bill');
  const createTx = useCreateEntity('transaction');
  const deleteWithUndo = useDeleteWithUndo('bill');
  const refreshAll = useRefreshAll();

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Bill | null>(null);

  if (isLoading || !bills) {
    return (
      <div>
        <PageHeader title="Bills" />
        <Skeleton className="h-[480px] rounded-xl" />
      </div>
    );
  }

  const now = new Date();
  const sorted = [...bills].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdue = sorted.filter((b) => billState(b, now) === 'overdue');
  const dueSoon = sorted.filter((b) => billState(b, now) === 'due-soon');
  const catById = new Map(categories.map((c) => [c.id, c]));

  async function markPaid(bill: Bill) {
    // Log the expense…
    await createTx.mutateAsync({
      date: new Date().toISOString(),
      amount: bill.amount,
      type: 'expense',
      merchant: bill.name,
      description: 'Bill payment',
      categoryId: bill.categoryId ?? null,
      accountId: bill.accountId ?? null,
      recurring: bill.frequency !== 'once',
      paymentMethod: bill.autoPay ? 'Bank Transfer' : null,
    });
    // …then advance (or retire) the due date.
    if (bill.frequency === 'once') {
      await api.remove('bill', bill.id);
    } else {
      await api.update('bill', bill.id, {
        dueDate: advanceBillDate(bill),
        lastPaidDate: new Date().toISOString(),
      });
    }
    refreshAll();
    toast.success(`${bill.name} marked paid`, { description: 'Expense logged in transactions.' });
  }

  return (
    <div>
      <PageHeader
        title="Bills"
        description="Never miss a due date — reminders fire before each bill lands."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus /> Add bill
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <StatCard label="Monthly Bill Total" value={fmtMoney(monthlyBillTotal(bills))} icon={<Receipt />} sub={`${bills.length} bills tracked`} />
        <StatCard label="Overdue" value={overdue.length} tone={overdue.length ? 'negative' : 'positive'} icon={<Receipt />} sub={overdue.length ? overdue.map((b) => b.name).join(', ') : 'Nothing overdue 🎉'} />
        <StatCard label="Due Soon" value={dueSoon.length} tone={dueSoon.length ? 'default' : 'positive'} icon={<Receipt />} sub="Within reminder window" />
        <StatCard label="On Auto-Pay" value={bills.filter((b) => b.autoPay).length} icon={<Zap />} sub="Paid automatically" />
      </div>

      {sorted.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<Receipt />}
            title="No bills yet"
            description="Track rent, utilities, subscriptions and insurance — upcoming bills appear on the dashboard and calendar."
            action={
              <Button
                onClick={() => {
                  setEditing(null);
                  setEditorOpen(true);
                }}
              >
                <Plus /> Add bill
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="mt-4 divide-y overflow-hidden">
          {sorted.map((b) => {
            const state = billState(b, now);
            const days = differenceInCalendarDays(new Date(b.dueDate), now);
            const cat = b.categoryId ? catById.get(b.categoryId) : null;
            return (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40">
                <span
                  className="h-9 w-9 rounded-lg inline-flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor: `${cat?.color ?? '#64748b'}22`,
                    color: cat?.color ?? '#64748b',
                  }}
                >
                  <EntityIcon name={cat?.icon ?? 'repeat'} className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm flex items-center gap-2 flex-wrap">
                    {b.name}
                    {b.autoPay && (
                      <Badge variant="secondary" className="gap-1">
                        <Zap className="h-3 w-3" /> Auto
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Due {fmtDate(b.dueDate)} ·{' '}
                    {BILL_FREQUENCIES.find((f) => f.value === b.frequency)?.label ?? b.frequency}
                    {b.lastPaidDate && ` · last paid ${fmtDate(b.lastPaidDate)}`}
                  </p>
                </div>
                {state === 'overdue' && <Badge variant="destructive">{Math.abs(days)}d overdue</Badge>}
                {state === 'due-soon' && <Badge variant="warning">{days === 0 ? 'Due today' : `${days}d left`}</Badge>}
                <span className="font-medium tabular-nums">{fmtMoney(b.amount)}</span>
                <Button variant="outline" size="sm" onClick={() => markPaid(b)}>
                  <CheckCircle2 /> Paid
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${b.name}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        setEditing(b);
                        setEditorOpen(true);
                      }}
                    >
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    {b.frequency !== 'once' && (
                      <DropdownMenuItem
                        onClick={async () => {
                          await updateBill.mutateAsync({ id: b.id, data: { dueDate: advanceBillDate(b) } });
                          toast.success('Skipped to next due date');
                        }}
                      >
                        <RefreshCcw /> Skip this cycle
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onClick={() => deleteWithUndo([b], `Deleted "${b.name}"`)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </Card>
      )}

      <BillEditor open={editorOpen} onOpenChange={setEditorOpen} bill={editing} />
    </div>
  );
}

/* --------------------------------- editor --------------------------------- */

function BillEditor({
  open,
  onOpenChange,
  bill,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  bill: Bill | null;
}) {
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const create = useCreateEntity('bill');
  const update = useUpdateEntity('bill');

  const [name, setName] = React.useState('');
  const [amount, setAmount] = React.useState<number | ''>('');
  const [dueDate, setDueDate] = React.useState<string | null>(null);
  const [frequency, setFrequency] = React.useState<Bill['frequency']>('monthly');
  const [autoPay, setAutoPay] = React.useState(false);
  const [reminderDays, setReminderDays] = React.useState('3');
  const [categoryId, setCategoryId] = React.useState('');
  const [accountId, setAccountId] = React.useState('');
  const [notes, setNotes] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setName(bill?.name ?? '');
    setAmount(bill?.amount ?? '');
    setDueDate(bill?.dueDate ?? null);
    setFrequency(bill?.frequency ?? 'monthly');
    setAutoPay(bill?.autoPay ?? false);
    setReminderDays(String(bill?.reminderDays ?? 3));
    setCategoryId(bill?.categoryId ?? '');
    setAccountId(bill?.accountId ?? '');
    setNotes(bill?.notes ?? '');
  }, [open, bill]);

  async function handleSave() {
    if (!name.trim() || amount === '' || amount <= 0 || !dueDate) {
      toast.error('Name, amount and due date are required.');
      return;
    }
    const data = {
      name: name.trim(),
      amount,
      dueDate,
      frequency,
      autoPay,
      reminderDays: Math.max(0, Number(reminderDays) || 0),
      categoryId: categoryId || null,
      accountId: accountId || null,
      notes: notes || null,
    };
    try {
      if (bill) await update.mutateAsync({ id: bill.id, data });
      else await create.mutateAsync(data);
      toast.success(bill ? 'Bill updated' : 'Bill added');
      onOpenChange(false);
    } catch {
      /* hook shows error */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{bill ? 'Edit bill' : 'Add bill'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" required className="col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Rent" />
          </Field>
          <Field label="Amount" required>
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Next due date" required>
            <DateField value={dueDate} onChange={setDueDate} />
          </Field>
          <Field label="Frequency">
            <Select value={frequency} onValueChange={(v) => setFrequency(v as Bill['frequency'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BILL_FREQUENCIES.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Remind me (days before)">
            <Input
              type="number"
              min="0"
              max="30"
              value={reminderDays}
              onChange={(e) => setReminderDays(e.target.value)}
            />
          </Field>
          <Field label="Category">
            <Select value={categoryId || undefined} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
              <SelectContent>
                {categories
                  .filter((c) => !c.parentId && c.type === 'expense')
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Pay from account">
            <Select value={accountId || undefined} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="col-span-2 flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <Switch checked={autoPay} onCheckedChange={setAutoPay} />
              Auto-pay
            </label>
          </div>
          <Field label="Notes" className="col-span-2">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={create.isPending || update.isPending}>
            {bill ? 'Save' : 'Add bill'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
