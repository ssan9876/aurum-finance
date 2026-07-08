/**
 * Category management: create, rename, recolor, re-icon, budget, merge,
 * delete, subcategories, and drag-and-drop reordering.
 */
import * as React from 'react';
import { toast } from 'sonner';
import { FolderTree, GripVertical, MoreHorizontal, Pencil, Plus, Shuffle, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { ColorPicker, ConfirmDialog, EmptyState, Field, IconPicker, MoneyInput, PageHeader } from '@/components/shared';
import { EntityIcon } from '@/lib/icons';
import { useSettings } from '@/state/settings';
import {
  useBudgets,
  useCategories,
  useCreateEntity,
  useRefreshAll,
  useTransactions,
  useUpdateEntity,
} from '@/data/hooks';
import { api } from '@/data/api';
import { cn } from '@/lib/utils';
import type { Category } from '@/shared/types';

export default function Categories() {
  const { fmtMoney } = useSettings();
  const { data: categories, isLoading } = useCategories();
  const { data: transactions = [] } = useTransactions();
  const { data: budgets = [] } = useBudgets();
  const updateCat = useUpdateEntity('category');
  const refreshAll = useRefreshAll();

  const [tab, setTab] = React.useState<'expense' | 'income'>('expense');
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Category | null>(null);
  const [parentFor, setParentFor] = React.useState<string | null>(null);
  const [mergeSource, setMergeSource] = React.useState<Category | null>(null);
  const [deleting, setDeleting] = React.useState<Category | null>(null);
  const dragId = React.useRef<string | null>(null);

  if (isLoading || !categories) {
    return (
      <div>
        <PageHeader title="Categories" />
        <Skeleton className="h-[480px] rounded-xl" />
      </div>
    );
  }

  const tops = categories
    .filter((c) => !c.parentId && c.type === tab)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
  const childrenOf = (id: string) => categories.filter((c) => c.parentId === id);

  const txCount = (id: string) =>
    transactions.filter((t) => t.categoryId === id || t.subcategoryId === id).length;

  const templateBudget = (id: string) =>
    budgets.find((b) => b.categoryId === id && b.period === 'monthly' && b.month == null && b.year == null);

  async function handleDrop(targetId: string) {
    const src = dragId.current;
    dragId.current = null;
    if (!src || src === targetId) return;
    const order = tops.map((c) => c.id);
    const fromIdx = order.indexOf(src);
    const toIdx = order.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    order.splice(toIdx, 0, ...order.splice(fromIdx, 1));
    await Promise.all(order.map((id, i) => api.update('category', id, { sortOrder: i })));
    refreshAll();
  }

  async function handleDelete() {
    if (!deleting) return;
    await api.removeMany('category', [deleting.id]);
    refreshAll();
    toast.success(`Deleted "${deleting.name}"`, {
      description: 'Its transactions are now uncategorized.',
    });
    setDeleting(null);
  }

  return (
    <div>
      <PageHeader
        title="Categories"
        description="Organize spending your way — colors, icons, subcategories and per-category budgets."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setParentFor(null);
              setEditorOpen(true);
            }}
          >
            <Plus /> New category
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'expense' | 'income')}>
        <TabsList>
          <TabsTrigger value="expense">Expenses</TabsTrigger>
          <TabsTrigger value="income">Income</TabsTrigger>
        </TabsList>
      </Tabs>

      {tops.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<FolderTree />}
            title="No categories"
            action={
              <Button
                onClick={() => {
                  setEditing(null);
                  setParentFor(null);
                  setEditorOpen(true);
                }}
              >
                <Plus /> New category
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="mt-4 divide-y overflow-hidden">
          {tops.map((cat) => {
            const kids = childrenOf(cat.id);
            const budget = templateBudget(cat.id);
            return (
              <div
                key={cat.id}
                draggable
                onDragStart={() => (dragId.current = cat.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(cat.id)}
              >
                <div className="flex items-center gap-3 px-4 py-3 group hover:bg-accent/40">
                  <GripVertical className="h-4 w-4 text-muted-foreground/40 cursor-grab shrink-0" aria-hidden />
                  <span
                    className="h-8 w-8 rounded-lg inline-flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${cat.color}22`, color: cat.color }}
                  >
                    <EntityIcon name={cat.icon} className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm flex items-center gap-2">
                      {cat.name}
                      {cat.isDefault && (
                        <Badge variant="secondary" className="text-[10px]">
                          default
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {txCount(cat.id)} transactions
                      {kids.length > 0 && ` · ${kids.length} subcategories`}
                    </p>
                  </div>
                  {budget ? (
                    <Badge variant="outline" className="tabular-nums hidden sm:inline-flex">
                      {fmtMoney(budget.amount)}/mo budget
                    </Badge>
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${cat.name}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setEditing(cat);
                          setParentFor(null);
                          setEditorOpen(true);
                        }}
                      >
                        <Pencil /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setEditing(null);
                          setParentFor(cat.id);
                          setEditorOpen(true);
                        }}
                      >
                        <Plus /> Add subcategory
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setMergeSource(cat)}>
                        <Shuffle /> Merge into…
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive" onClick={() => setDeleting(cat)}>
                        <Trash2 /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {kids.map((kid) => (
                  <div key={kid.id} className="flex items-center gap-3 pl-14 pr-4 py-2 hover:bg-accent/40 border-t border-dashed">
                    <span
                      className="h-6 w-6 rounded-md inline-flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${kid.color}22`, color: kid.color }}
                    >
                      <EntityIcon name={kid.icon} className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{kid.name}</p>
                      <p className="text-[11px] text-muted-foreground">{txCount(kid.id)} transactions</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${kid.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setEditing(kid);
                            setParentFor(kid.parentId ?? null);
                            setEditorOpen(true);
                          }}
                        >
                          <Pencil /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleting(kid)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            );
          })}
        </Card>
      )}

      <CategoryEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        category={editing}
        parentId={parentFor}
        type={tab}
        templateBudget={editing ? templateBudget(editing.id) : undefined}
      />
      <MergeDialog source={mergeSource} onClose={() => setMergeSource(null)} categories={categories} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description="Transactions keep their history but become uncategorized. Subcategories and budgets for this category are removed. This can't be undone."
        onConfirm={handleDelete}
      />
    </div>
  );
}

/* ------------------------------ editor dialog ----------------------------- */

function CategoryEditor({
  open,
  onOpenChange,
  category,
  parentId,
  type,
  templateBudget,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  category: Category | null;
  parentId: string | null;
  type: 'expense' | 'income';
  templateBudget?: { id: string; amount: number };
}) {
  const create = useCreateEntity('category');
  const update = useUpdateEntity('category');
  const refreshAll = useRefreshAll();

  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState('#6366f1');
  const [icon, setIcon] = React.useState('circle-dollar');
  const [budget, setBudget] = React.useState<number | ''>('');

  React.useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setColor(category?.color ?? '#6366f1');
    setIcon(category?.icon ?? 'circle-dollar');
    setBudget(templateBudget?.amount ?? '');
  }, [open, category, templateBudget]);

  const isSub = !!(parentId ?? category?.parentId);

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Give the category a name.');
      return;
    }
    try {
      let id = category?.id;
      if (category) {
        await update.mutateAsync({ id: category.id, data: { name: name.trim(), color, icon } });
      } else {
        const created = await create.mutateAsync({
          name: name.trim(),
          color,
          icon,
          type,
          parentId: parentId ?? null,
        });
        id = created.id;
      }
      // Budgets only apply to top-level categories.
      if (id && !isSub) {
        if (budget !== '' && budget > 0) {
          if (templateBudget) await api.update('budget', templateBudget.id, { amount: budget });
          else await api.create('budget', { categoryId: id, amount: budget, period: 'monthly' });
        } else if (templateBudget) {
          await api.remove('budget', templateBudget.id);
        }
        refreshAll();
      }
      toast.success(category ? 'Category updated' : 'Category created');
      onOpenChange(false);
    } catch {
      /* hook shows error */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {category ? 'Edit category' : isSub ? 'New subcategory' : 'New category'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2 items-end">
            <Field label="Name" required className="flex-1">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Coffee" />
            </Field>
            <IconPicker value={icon} onChange={setIcon} color={color} />
            <ColorPicker value={color} onChange={setColor} />
          </div>
          {!isSub && type === 'expense' && (
            <Field label="Monthly budget" hint="Leave empty for no budget">
              <MoneyInput value={budget} onChange={setBudget} />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={create.isPending || update.isPending}>
            {category ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- merge dialog ----------------------------- */

function MergeDialog({
  source,
  onClose,
  categories,
}: {
  source: Category | null;
  onClose: () => void;
  categories: Category[];
}) {
  const refreshAll = useRefreshAll();
  const [targetId, setTargetId] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => setTargetId(''), [source]);

  const targets = categories.filter((c) => !c.parentId && c.id !== source?.id && c.type === source?.type);

  async function handleMerge() {
    if (!source || !targetId) return;
    setBusy(true);
    try {
      const txs = await api.list('transaction');
      const affected = txs.filter((t) => t.categoryId === source.id);
      for (const t of affected) {
        await api.update('transaction', t.id, { categoryId: targetId, subcategoryId: null });
      }
      const kids = categories.filter((c) => c.parentId === source.id);
      for (const k of kids) await api.update('category', k.id, { parentId: targetId });
      const bills = await api.list('bill');
      for (const b of bills.filter((b) => b.categoryId === source.id)) {
        await api.update('bill', b.id, { categoryId: targetId });
      }
      await api.removeMany('category', [source.id]);
      refreshAll();
      toast.success(`Merged "${source.name}" into "${targets.find((t) => t.id === targetId)?.name}"`, {
        description: `${affected.length} transactions moved.`,
      });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!source} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Merge "{source?.name}"</DialogTitle>
        </DialogHeader>
        <Field label="Move everything into" required hint="Transactions, subcategories and bills are reassigned, then the category is deleted.">
          <Select value={targetId || undefined} onValueChange={setTargetId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick target category" />
            </SelectTrigger>
            <SelectContent>
              {targets.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex items-center gap-2">
                    <EntityIcon name={c.icon} className={cn('h-3.5 w-3.5')} style={{ color: c.color }} />
                    {c.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleMerge} disabled={!targetId} loading={busy}>
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
