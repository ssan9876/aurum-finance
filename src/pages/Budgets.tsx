/**
 * Budgets: month-by-month category budgets with progress, remaining amounts,
 * recurring templates and per-month overrides.
 */
import * as React from 'react';
import { addMonths, format, isSameMonth, subMonths } from 'date-fns';
import { toast } from 'sonner';
import { CheckCircle2, ChevronLeft, ChevronRight, Pencil, Plus, Trash2, WalletCards } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState, Field, MoneyInput, PageHeader, StatCard } from '@/components/shared';
import { EntityIcon } from '@/lib/icons';
import { useSettings } from '@/state/settings';
import { useBudgets, useCategories, useRefreshAll, useTransactions } from '@/data/hooks';
import { api } from '@/data/api';
import { budgetAmountFor, budgetStatuses } from '@/lib/finance';
import { round2, sum } from '@/lib/utils';
import type { Category } from '@/shared/types';

export default function Budgets() {
  const { fmtMoney } = useSettings();
  const { data: budgets, isLoading } = useBudgets();
  const { data: categories = [] } = useCategories();
  const { data: transactions = [] } = useTransactions();
  const refreshAll = useRefreshAll();

  const [month, setMonth] = React.useState(() => new Date());
  const [editorCat, setEditorCat] = React.useState<Category | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);

  if (isLoading || !budgets) {
    return (
      <div>
        <PageHeader title="Budgets" />
        <Skeleton className="h-[480px] rounded-xl" />
      </div>
    );
  }

  const statuses = budgetStatuses(budgets, categories, transactions, month);
  const totalBudget = round2(sum(statuses.map((s) => s.budget)));
  const totalSpent = round2(sum(statuses.map((s) => s.spent)));
  const overCount = statuses.filter((s) => s.pct > 1).length;
  const isCurrent = isSameMonth(month, new Date());

  const unbudgeted = categories.filter(
    (c) => !c.parentId && c.type === 'expense' && !statuses.some((s) => s.category.id === c.id)
  );

  return (
    <div>
      <PageHeader
        title="Budgets"
        description="Set limits per category — Aurum warns you before you blow past them."
        actions={
          <Button onClick={() => setAddOpen(true)} disabled={unbudgeted.length === 0}>
            <Plus /> Add budget
          </Button>
        }
      />

      {/* Month navigator */}
      <div className="flex items-center gap-2 mb-4">
        <Button variant="outline" size="icon-sm" onClick={() => setMonth((m) => subMonths(m, 1))} aria-label="Previous month">
          <ChevronLeft />
        </Button>
        <span className="font-medium min-w-[140px] text-center tabular-nums">{format(month, 'MMMM yyyy')}</span>
        <Button variant="outline" size="icon-sm" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month">
          <ChevronRight />
        </Button>
        {!isCurrent && (
          <Button variant="ghost" size="sm" onClick={() => setMonth(new Date())}>
            Today
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <StatCard label="Total Budget" value={fmtMoney(totalBudget, { compact: true })} icon={<WalletCards />} sub={`${statuses.length} categories`} />
        <StatCard label="Spent" value={fmtMoney(totalSpent, { compact: true })} icon={<WalletCards />} sub={totalBudget > 0 ? `${Math.round((totalSpent / totalBudget) * 100)}% of budget` : '—'} />
        <StatCard
          label="Remaining"
          value={fmtMoney(round2(totalBudget - totalSpent), { compact: true })}
          tone={totalBudget - totalSpent >= 0 ? 'positive' : 'negative'}
          icon={<CheckCircle2 />}
          sub="Across all budgets"
        />
        <StatCard
          label="Over Budget"
          value={overCount}
          tone={overCount > 0 ? 'negative' : 'positive'}
          icon={<WalletCards />}
          sub={overCount === 0 ? 'All on track 🎉' : 'Categories over the limit'}
        />
      </div>

      {statuses.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<WalletCards />}
            title="No budgets for this month"
            description="Create a budget per category to track limits, get alerts and see progress bars here and on the dashboard."
            action={
              <Button onClick={() => setAddOpen(true)}>
                <Plus /> Add budget
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4 mt-4 stagger-children">
          {statuses.map((s) => {
            const over = s.pct > 1;
            const warn = !over && s.pct > 0.9;
            return (
              <Card key={s.category.id}>
                <CardContent className="pt-5">
                  <div className="flex items-center gap-3 mb-3">
                    <span
                      className="h-9 w-9 rounded-lg inline-flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${s.category.color}22`, color: s.category.color }}
                    >
                      <EntityIcon name={s.category.icon} className="h-4.5 w-4.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm flex items-center gap-2">
                        {s.category.name}
                        {over && <Badge variant="destructive">Over by {fmtMoney(-s.remaining)}</Badge>}
                        {warn && <Badge variant="warning">Almost there</Badge>}
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {fmtMoney(s.spent)} of {fmtMoney(s.budget)}
                        {s.remaining >= 0 && ` · ${fmtMoney(s.remaining)} left`}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon-sm" onClick={() => setEditorCat(s.category)} aria-label={`Edit budget for ${s.category.name}`}>
                      <Pencil />
                    </Button>
                  </div>
                  <Progress
                    value={Math.min(100, s.pct * 100)}
                    indicatorColor={over ? 'hsl(var(--destructive))' : warn ? 'hsl(var(--warning))' : s.category.color}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <BudgetEditor
        category={editorCat ?? undefined}
        open={!!editorCat || addOpen}
        onOpenChange={(o) => {
          if (!o) {
            setEditorCat(null);
            setAddOpen(false);
          }
        }}
        month={month}
        budgets={budgets}
        categories={addOpen ? unbudgeted : categories}
        pickCategory={addOpen}
        onSaved={refreshAll}
      />
    </div>
  );
}

/* --------------------------------- editor --------------------------------- */

function BudgetEditor({
  open,
  onOpenChange,
  category,
  categories,
  pickCategory,
  month,
  budgets,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  category?: Category;
  categories: Category[];
  pickCategory: boolean;
  month: Date;
  budgets: { id: string; categoryId: string; amount: number; period: string; month?: number | null; year?: number | null }[];
  onSaved: () => void;
}) {
  const { fmtMoney } = useSettings();
  const [categoryId, setCategoryId] = React.useState('');
  const [amount, setAmount] = React.useState<number | ''>('');
  const [scope, setScope] = React.useState<'template' | 'override'>('template');
  const [busy, setBusy] = React.useState(false);

  const m = month.getMonth() + 1;
  const y = month.getFullYear();
  const activeCatId = pickCategory ? categoryId : category?.id ?? '';

  React.useEffect(() => {
    if (!open) return;
    setCategoryId('');
    setScope('template');
    if (category) {
      const current = budgetAmountFor(budgets as never, category.id, m, y);
      setAmount(current ?? '');
    } else {
      setAmount('');
    }
  }, [open, category, budgets, m, y]);

  const existingTemplate = budgets.find(
    (b) => b.categoryId === activeCatId && b.period === 'monthly' && b.month == null && b.year == null
  );
  const existingOverride = budgets.find(
    (b) => b.categoryId === activeCatId && b.period === 'monthly' && b.month === m && b.year === y
  );

  async function handleSave() {
    if (!activeCatId) {
      toast.error('Pick a category.');
      return;
    }
    if (amount === '' || amount <= 0) {
      toast.error('Enter a budget above zero.');
      return;
    }
    setBusy(true);
    try {
      if (scope === 'template') {
        if (existingTemplate) await api.update('budget', existingTemplate.id, { amount });
        else await api.create('budget', { categoryId: activeCatId, amount, period: 'monthly' });
      } else {
        if (existingOverride) await api.update('budget', existingOverride.id, { amount });
        else await api.create('budget', { categoryId: activeCatId, amount, period: 'monthly', month: m, year: y });
      }
      onSaved();
      toast.success('Budget saved');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save budget');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      const ids = [existingTemplate?.id, existingOverride?.id].filter(Boolean) as string[];
      if (ids.length) await api.removeMany('budget', ids);
      onSaved();
      toast.success('Budget removed');
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{pickCategory ? 'Add budget' : `Budget · ${category?.name}`}</DialogTitle>
          <DialogDescription>
            {scope === 'template'
              ? 'Applies to every month (a per-month override still wins).'
              : `Applies to ${format(month, 'MMMM yyyy')} only.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {pickCategory && (
            <Field label="Category" required>
              <Select value={categoryId || undefined} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories
                    .filter((c) => !c.parentId && c.type === 'expense')
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="flex items-center gap-2">
                          <EntityIcon name={c.icon} className="h-3.5 w-3.5" style={{ color: c.color }} />
                          {c.name}
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Monthly amount" required>
            <MoneyInput value={amount} onChange={setAmount} autoFocus={!pickCategory} />
          </Field>
          <Field label="Applies to">
            <Select value={scope} onValueChange={(v) => setScope(v as 'template' | 'override')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="template">Every month</SelectItem>
                <SelectItem value="override">{format(month, 'MMMM yyyy')} only</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {existingTemplate && scope === 'override' && (
            <p className="text-xs text-muted-foreground">
              Recurring budget is {fmtMoney(existingTemplate.amount)}/mo — this override replaces it for this
              month.
            </p>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          {!pickCategory && (existingTemplate || existingOverride) ? (
            <Button variant="ghost" className="text-destructive" onClick={handleRemove} disabled={busy}>
              <Trash2 /> Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} loading={busy}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
