/**
 * Financial goals: savings targets, debt payoff, purchases. Goals linked to a
 * savings account mirror its balance automatically; others track manually.
 */
import * as React from 'react';
import { differenceInCalendarMonths } from 'date-fns';
import { toast } from 'sonner';
import { CheckCircle2, MoreHorizontal, PartyPopper, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
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
import { ColorPicker, DateField, EmptyState, Field, IconPicker, MoneyInput, PageHeader, StatCard } from '@/components/shared';
import { EntityIcon } from '@/lib/icons';
import { useSettings } from '@/state/settings';
import {
  useCreateEntity,
  useDeleteWithUndo,
  useGoals,
  useSavingsAccounts,
  useUpdateEntity,
} from '@/data/hooks';
import { round2, sum } from '@/lib/utils';
import type { Goal, GoalType } from '@/shared/types';

const GOAL_TYPES: { value: GoalType; label: string }[] = [
  { value: 'savings', label: 'Savings' },
  { value: 'debt', label: 'Debt payoff' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'custom', label: 'Custom' },
];

export default function Goals() {
  const { fmtMoney, fmtDate } = useSettings();
  const { data: goals, isLoading } = useGoals();
  const { data: savings = [] } = useSavingsAccounts();
  const update = useUpdateEntity('goal');
  const deleteWithUndo = useDeleteWithUndo('goal');

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Goal | null>(null);
  const [progressFor, setProgressFor] = React.useState<Goal | null>(null);

  if (isLoading || !goals) {
    return (
      <div>
        <PageHeader title="Goals" />
        <Skeleton className="h-[420px] rounded-xl" />
      </div>
    );
  }

  const savingsById = new Map(savings.map((s) => [s.id, s]));
  const currentOf = (g: Goal) =>
    g.savingsAccountId ? (savingsById.get(g.savingsAccountId)?.balance ?? g.currentAmount) : g.currentAmount;

  const open = goals.filter((g) => !g.completedAt);
  const done = goals.filter((g) => g.completedAt);
  const totalTarget = round2(sum(open.map((g) => g.targetAmount)));
  const totalSaved = round2(sum(open.map((g) => Math.min(currentOf(g), g.targetAmount))));

  const forecast = (g: Goal): string | null => {
    const current = currentOf(g);
    if (!g.targetDate || current >= g.targetAmount) return null;
    const months = Math.max(1, differenceInCalendarMonths(new Date(g.targetDate), new Date()));
    const needed = (g.targetAmount - current) / months;
    return `${fmtMoney(round2(needed))}/mo to hit ${fmtDate(g.targetDate, 'MMM yyyy')}`;
  };

  return (
    <div>
      <PageHeader
        title="Goals"
        description="Set targets and watch them fill up — linked goals track their savings account automatically."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus /> New goal
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <StatCard label="Active Goals" value={open.length} icon={<Target />} sub={done.length ? `${done.length} completed` : 'Keep going!'} />
        <StatCard label="Combined Target" value={fmtMoney(totalTarget, { compact: true })} icon={<Target />} sub="Across active goals" />
        <StatCard label="Progress" value={fmtMoney(totalSaved, { compact: true })} icon={<CheckCircle2 />} sub={totalTarget > 0 ? `${Math.round((totalSaved / totalTarget) * 100)}% of combined target` : '—'} />
        <StatCard label="Completed" value={done.length} tone={done.length ? 'positive' : 'default'} icon={<PartyPopper />} sub="All-time" />
      </div>

      {open.length === 0 && done.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<Target />}
            title="No goals yet"
            description={'Save $10,000, pay off a card, fund a trip — give your money a mission.'}
            action={
              <Button
                onClick={() => {
                  setEditing(null);
                  setEditorOpen(true);
                }}
              >
                <Plus /> New goal
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4 stagger-children">
            {open.map((g) => {
              const current = currentOf(g);
              const pct = Math.min((current / g.targetAmount) * 100, 100);
              const color = g.color ?? '#4a3aa7';
              const linked = g.savingsAccountId ? savingsById.get(g.savingsAccountId) : null;
              const tip = forecast(g);
              return (
                <Card key={g.id}>
                  <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="h-9 w-9 rounded-lg inline-flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${color}22`, color }}
                      >
                        <EntityIcon name={g.icon ?? 'target'} className="h-4.5 w-4.5" />
                      </span>
                      <div className="min-w-0">
                        <CardTitle className="text-[15px] truncate">{g.name}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {GOAL_TYPES.find((t) => t.value === g.type)?.label}
                          {linked && ` · linked to ${linked.name}`}
                        </p>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${g.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {!g.savingsAccountId && (
                          <DropdownMenuItem onClick={() => setProgressFor(g)}>
                            <Plus /> Add progress
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => {
                            setEditing(g);
                            setEditorOpen(true);
                          }}
                        >
                          <Pencil /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={async () => {
                            await update.mutateAsync({
                              id: g.id,
                              data: { completedAt: new Date().toISOString(), currentAmount: current },
                            });
                            toast.success(`"${g.name}" completed 🎉`);
                          }}
                        >
                          <CheckCircle2 /> Mark complete
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => deleteWithUndo([g], `Deleted "${g.name}"`)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-xl font-semibold tabular-nums">{fmtMoney(current)}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">of {fmtMoney(g.targetAmount)}</span>
                    </div>
                    <Progress value={pct} indicatorColor={color} />
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      <Badge variant="secondary" className="tabular-nums">{Math.round(pct)}%</Badge>
                      {g.targetDate && <Badge variant="outline">By {fmtDate(g.targetDate)}</Badge>}
                      {tip && <Badge variant="outline">{tip}</Badge>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {done.length > 0 && (
            <div className="mt-8">
              <h2 className="text-sm font-medium text-muted-foreground mb-3">Completed</h2>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                {done.map((g) => (
                  <Card key={g.id} className="opacity-70">
                    <CardContent className="pt-5 flex items-center gap-3">
                      <PartyPopper className="h-5 w-5 text-success shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{g.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {fmtMoney(g.targetAmount)} · completed {fmtDate(g.completedAt!)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${g.name}`}
                        onClick={() => deleteWithUndo([g], `Deleted "${g.name}"`)}
                      >
                        <Trash2 />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <GoalEditor open={editorOpen} onOpenChange={setEditorOpen} goal={editing} />
      <ProgressDialog goal={progressFor} onClose={() => setProgressFor(null)} />
    </div>
  );
}

/* --------------------------------- editor --------------------------------- */

function GoalEditor({
  open,
  onOpenChange,
  goal,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  goal: Goal | null;
}) {
  const { data: savings = [] } = useSavingsAccounts();
  const create = useCreateEntity('goal');
  const update = useUpdateEntity('goal');

  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<GoalType>('savings');
  const [target, setTarget] = React.useState<number | ''>('');
  const [current, setCurrent] = React.useState<number | ''>('');
  const [targetDate, setTargetDate] = React.useState<string | null>(null);
  const [savingsAccountId, setSavingsAccountId] = React.useState('');
  const [icon, setIcon] = React.useState('target');
  const [color, setColor] = React.useState('#4a3aa7');

  React.useEffect(() => {
    if (!open) return;
    setName(goal?.name ?? '');
    setType(goal?.type ?? 'savings');
    setTarget(goal?.targetAmount ?? '');
    setCurrent(goal?.currentAmount ?? '');
    setTargetDate(goal?.targetDate ?? null);
    setSavingsAccountId(goal?.savingsAccountId ?? '');
    setIcon(goal?.icon ?? 'target');
    setColor(goal?.color ?? '#4a3aa7');
  }, [open, goal]);

  async function handleSave() {
    if (!name.trim() || target === '' || target <= 0) {
      toast.error('Name and a target amount are required.');
      return;
    }
    const data = {
      name: name.trim(),
      type,
      targetAmount: target,
      currentAmount: current === '' ? 0 : current,
      targetDate,
      savingsAccountId: savingsAccountId || null,
      icon,
      color,
    };
    try {
      if (goal) await update.mutateAsync({ id: goal.id, data });
      else await create.mutateAsync(data);
      toast.success(goal ? 'Goal updated' : 'Goal created');
      onOpenChange(false);
    } catch {
      /* hook shows error */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{goal ? 'Edit goal' : 'New goal'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2 items-end">
            <Field label="Name" required className="flex-1">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Save $10,000" />
            </Field>
            <IconPicker value={icon} onChange={setIcon} color={color} />
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Type">
              <Select value={type} onValueChange={(v) => setType(v as GoalType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GOAL_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Target date">
              <DateField value={targetDate} onChange={setTargetDate} />
            </Field>
            <Field label="Target amount" required>
              <MoneyInput value={target} onChange={setTarget} />
            </Field>
            <Field label="Current amount">
              <MoneyInput value={current} onChange={setCurrent} disabled={!!savingsAccountId} />
            </Field>
          </div>
          <Field label="Link to savings account" hint="Linked goals mirror the account balance automatically">
            <Select
              value={savingsAccountId || '__none__'}
              onValueChange={(v) => setSavingsAccountId(v === '__none__' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Not linked</SelectItem>
                {savings.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={create.isPending || update.isPending}>
            {goal ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- manual progress ----------------------------- */

function ProgressDialog({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const update = useUpdateEntity('goal');
  const { fmtMoney } = useSettings();
  const [amount, setAmount] = React.useState<number | ''>('');

  React.useEffect(() => setAmount(''), [goal]);

  async function handleSave() {
    if (!goal || amount === '' || amount <= 0) {
      toast.error('Enter an amount above zero.');
      return;
    }
    const next = round2(goal.currentAmount + amount);
    await update.mutateAsync({ id: goal.id, data: { currentAmount: next } });
    toast.success(`Added ${fmtMoney(amount)} toward "${goal.name}"`);
    onClose();
  }

  return (
    <Dialog open={!!goal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>Add progress</DialogTitle>
        </DialogHeader>
        <Field label="Amount" required>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
