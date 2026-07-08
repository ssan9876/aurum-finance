/**
 * Savings accounts: balances, goals, contributions, interest, projections
 * and historical growth (snapshots taken on every balance change).
 */
import * as React from 'react';
import { toast } from 'sonner';
import { CalendarClock, MoreHorizontal, Pencil, PiggyBank, Plus, Percent, Trash2, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
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
import { ColorPicker, DateField, EmptyState, Field, IconPicker, MoneyInput, PageHeader, StatCard } from '@/components/shared';
import { TrendAreaChart } from '@/components/charts';
import { EntityIcon } from '@/lib/icons';
import { useSettings } from '@/state/settings';
import {
  useCreateEntity,
  useDeleteWithUndo,
  useRefreshAll,
  useSavingsAccounts,
  useSavingsSnapshots,
  useUpdateEntity,
} from '@/data/hooks';
import { api } from '@/data/api';
import { monthsToGoal, projectedCompletionDate, savingsHistorySeries, savingsProjection, totalSavings } from '@/lib/finance';
import { round2, sum } from '@/lib/utils';
import type { SavingsAccount } from '@/shared/types';

export default function Savings() {
  const { fmtMoney, fmtDate } = useSettings();
  const { data: savings, isLoading } = useSavingsAccounts();
  const { data: snapshots = [] } = useSavingsSnapshots();
  const deleteWithUndo = useDeleteWithUndo('savingsAccount');
  const refreshAll = useRefreshAll();

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SavingsAccount | null>(null);
  const [contributeTo, setContributeTo] = React.useState<SavingsAccount | null>(null);

  if (isLoading || !savings) {
    return (
      <div>
        <PageHeader title="Savings" />
        <Skeleton className="h-[480px] rounded-xl" />
      </div>
    );
  }

  const total = totalSavings(savings);
  const monthlyContrib = round2(sum(savings.map((s) => s.monthlyContribution)));
  const history = savingsHistorySeries(savings, snapshots, 12).map((p) => ({ label: p.label, balance: p.balance }));
  const withGoal = savings.filter((s) => s.goal && s.goal > 0);
  const goalPct =
    withGoal.length > 0
      ? Math.round((sum(withGoal.map((s) => Math.min(s.balance / s.goal!, 1))) / withGoal.length) * 100)
      : null;

  return (
    <div>
      <PageHeader
        title="Savings"
        description="Emergency funds, big purchases, retirement — every goal in one place."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus /> New savings account
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <StatCard label="Total Savings" value={fmtMoney(total, { compact: true })} icon={<PiggyBank />} sub={`${savings.length} accounts`} />
        <StatCard label="Monthly Contributions" value={fmtMoney(monthlyContrib)} icon={<TrendingUp />} sub="Planned across accounts" />
        <StatCard
          label="Average Goal Progress"
          value={goalPct != null ? `${goalPct}%` : '—'}
          icon={<Percent />}
          sub={withGoal.length ? `${withGoal.length} goals tracked` : 'No goals set'}
        />
        <StatCard
          label="Projected in 12 Months"
          value={fmtMoney(
            round2(sum(savings.map((s) => savingsProjection(s, 12).at(-1)?.balance ?? s.balance))),
            { compact: true }
          )}
          icon={<CalendarClock />}
          sub="With contributions + interest"
        />
      </div>

      {savings.length > 0 && (
        <Card className="mt-4 animate-fade-up">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Savings growth</CardTitle>
            <span className="text-xs text-muted-foreground">Combined, last 12 months</span>
          </CardHeader>
          <CardContent>
            <TrendAreaChart data={history} dataKey="balance" name="Balance" height={220} />
          </CardContent>
        </Card>
      )}

      {savings.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<PiggyBank />}
            title="No savings accounts yet"
            description="Create an emergency fund, vacation fund, house down payment — anything you're saving toward."
            action={
              <Button
                onClick={() => {
                  setEditing(null);
                  setEditorOpen(true);
                }}
              >
                <Plus /> New savings account
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4 stagger-children">
          {savings.map((s) => {
            const pct = s.goal && s.goal > 0 ? Math.min((s.balance / s.goal) * 100, 100) : null;
            const eta = projectedCompletionDate(s);
            const monthsLeft = monthsToGoal(s);
            const color = s.color ?? '#2a78d6';
            return (
              <Card key={s.id}>
                <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="h-9 w-9 rounded-lg inline-flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${color}22`, color }}
                    >
                      <EntityIcon name={s.icon ?? 'piggy-bank'} className="h-4.5 w-4.5" />
                    </span>
                    <div className="min-w-0">
                      <CardTitle className="text-[15px] truncate">{s.name}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {s.interestRate > 0 ? `${s.interestRate}% APY · ` : ''}
                        {s.monthlyContribution > 0 ? `${fmtMoney(s.monthlyContribution)}/mo` : 'No auto contribution'}
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
                      <DropdownMenuItem onClick={() => setContributeTo(s)}>
                        <Plus /> Add contribution
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setEditing(s);
                          setEditorOpen(true);
                        }}
                      >
                        <Pencil /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={async () => {
                          await deleteWithUndo([s], `Deleted "${s.name}"`);
                          refreshAll();
                        }}
                      >
                        <Trash2 /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold tabular-nums tracking-tight">{fmtMoney(s.balance)}</p>
                  {s.goal && s.goal > 0 ? (
                    <>
                      <div className="flex items-center justify-between text-xs text-muted-foreground mt-2 mb-1.5">
                        <span>Goal: {fmtMoney(s.goal)}</span>
                        <span className="tabular-nums">{Math.round(pct!)}%</span>
                      </div>
                      <Progress value={pct!} indicatorColor={color} />
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {s.goalDate && <Badge variant="secondary">Target: {fmtDate(s.goalDate)}</Badge>}
                        {monthsLeft === 0 ? (
                          <Badge variant="success">Goal reached 🎉</Badge>
                        ) : eta ? (
                          <Badge variant="outline">On track for {fmtDate(eta, 'MMM yyyy')}</Badge>
                        ) : (
                          <Badge variant="warning">Add contributions to project a date</Badge>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-2">No goal set</p>
                  )}
                  <Button variant="outline" size="sm" className="w-full mt-4" onClick={() => setContributeTo(s)}>
                    <Plus /> Contribute
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <SavingsEditor open={editorOpen} onOpenChange={setEditorOpen} account={editing} />
      <ContributeDialog account={contributeTo} onClose={() => setContributeTo(null)} />
    </div>
  );
}

/* --------------------------------- editor --------------------------------- */

function SavingsEditor({
  open,
  onOpenChange,
  account,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  account: SavingsAccount | null;
}) {
  const create = useCreateEntity('savingsAccount');
  const update = useUpdateEntity('savingsAccount');

  const [name, setName] = React.useState('');
  const [balance, setBalance] = React.useState<number | ''>('');
  const [goal, setGoal] = React.useState<number | ''>('');
  const [goalDate, setGoalDate] = React.useState<string | null>(null);
  const [contribution, setContribution] = React.useState<number | ''>('');
  const [rate, setRate] = React.useState('');
  const [icon, setIcon] = React.useState('piggy-bank');
  const [color, setColor] = React.useState('#2a78d6');

  React.useEffect(() => {
    if (!open) return;
    setName(account?.name ?? '');
    setBalance(account?.balance ?? '');
    setGoal(account?.goal ?? '');
    setGoalDate(account?.goalDate ?? null);
    setContribution(account?.monthlyContribution ?? '');
    setRate(account ? String(account.interestRate) : '');
    setIcon(account?.icon ?? 'piggy-bank');
    setColor(account?.color ?? '#2a78d6');
  }, [open, account]);

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Give the account a name.');
      return;
    }
    const data = {
      name: name.trim(),
      balance: balance === '' ? 0 : balance,
      goal: goal === '' ? null : goal,
      goalDate,
      monthlyContribution: contribution === '' ? 0 : contribution,
      interestRate: rate === '' ? 0 : Number(rate),
      icon,
      color,
    };
    try {
      let id = account?.id;
      if (account) await update.mutateAsync({ id: account.id, data });
      else id = (await create.mutateAsync(data)).id;
      // Record a snapshot whenever the balance is (re)stated.
      if (id && (!account || account.balance !== data.balance)) {
        await api.create('savingsSnapshot', { savingsAccountId: id, date: new Date().toISOString(), balance: data.balance });
      }
      toast.success(account ? 'Savings account updated' : 'Savings account created');
      onOpenChange(false);
    } catch {
      /* hook shows error */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{account ? 'Edit savings account' : 'New savings account'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2 items-end">
            <Field label="Name" required className="flex-1">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Emergency Fund" />
            </Field>
            <IconPicker value={icon} onChange={setIcon} color={color} />
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Current balance">
              <MoneyInput value={balance} onChange={setBalance} />
            </Field>
            <Field label="Goal amount">
              <MoneyInput value={goal} onChange={setGoal} />
            </Field>
            <Field label="Goal date">
              <DateField value={goalDate} onChange={setGoalDate} />
            </Field>
            <Field label="Monthly contribution">
              <MoneyInput value={contribution} onChange={setContribution} />
            </Field>
            <Field label="Interest rate (APY %)" className="col-span-2">
              <Input
                type="number"
                step="0.05"
                min="0"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="e.g. 4.25"
              />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={create.isPending || update.isPending}>
            {account ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- contribute -------------------------------- */

function ContributeDialog({ account, onClose }: { account: SavingsAccount | null; onClose: () => void }) {
  const { fmtMoney } = useSettings();
  const update = useUpdateEntity('savingsAccount');
  const refreshAll = useRefreshAll();
  const [amount, setAmount] = React.useState<number | ''>('');
  const [mode, setMode] = React.useState<'deposit' | 'withdraw'>('deposit');

  React.useEffect(() => {
    setAmount('');
    setMode('deposit');
  }, [account]);

  async function handleSave() {
    if (!account || amount === '' || amount <= 0) {
      toast.error('Enter an amount above zero.');
      return;
    }
    const delta = mode === 'deposit' ? amount : -amount;
    const newBalance = round2(Math.max(0, account.balance + delta));
    await update.mutateAsync({ id: account.id, data: { balance: newBalance } });
    await api.create('savingsSnapshot', {
      savingsAccountId: account.id,
      date: new Date().toISOString(),
      balance: newBalance,
    });
    refreshAll();
    toast.success(`${mode === 'deposit' ? 'Added' : 'Withdrew'} ${fmtMoney(amount)} — balance is now ${fmtMoney(newBalance)}`);
    onClose();
  }

  return (
    <Dialog open={!!account} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>{account?.name}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {(['deposit', 'withdraw'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={
                'rounded-md border px-3 py-1.5 text-sm font-medium capitalize cursor-pointer transition-colors ' +
                (mode === m ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground')
              }
            >
              {m}
            </button>
          ))}
        </div>
        <Field label="Amount" required>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>{mode === 'deposit' ? 'Add' : 'Withdraw'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
