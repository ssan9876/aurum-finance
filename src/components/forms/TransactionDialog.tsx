/**
 * Create/edit dialog for transactions — also serves as the global
 * “Quick Add” (Ctrl+N / FAB / command palette). Handles expenses, income and
 * account-to-account transfers with inline validation.
 */
import * as React from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowRightLeft, Paperclip, TrendingDown, TrendingUp, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DateField, Field, MoneyInput, TagInput } from '@/components/shared';
import { EntityIcon } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { readFileAsDataUrl } from '@/lib/files';
import { PAYMENT_METHODS } from '@/shared/defaults';
import { parseTags, serializeTags, type Transaction, type TransactionType } from '@/shared/types';
import {
  useAccounts,
  useCategories,
  useCreateEntity,
  useSettingRows,
  useTags,
  useUpdateEntity,
} from '@/data/hooks';
import { api } from '@/data/api';
import { RULES_KEY, learnRule, matchRule, parseRules } from '@/lib/rules';

const baseSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amount: z.number({ invalid_type_error: 'Enter an amount' }).positive('Amount must be above zero'),
  merchant: z.string().trim().min(1, 'Merchant is required'),
});

interface Draft {
  type: TransactionType;
  date: string;
  amount: number | '';
  merchant: string;
  description: string;
  categoryId: string;
  subcategoryId: string;
  paymentMethod: string;
  accountId: string;
  toAccountId: string;
  tags: string[];
  recurring: boolean;
  receiptImage: string | null;
  notes: string;
}

const TYPE_OPTIONS: { value: TransactionType; label: string; icon: React.ReactNode }[] = [
  { value: 'expense', label: 'Expense', icon: <TrendingDown className="h-4 w-4" /> },
  { value: 'income', label: 'Income', icon: <TrendingUp className="h-4 w-4" /> },
  { value: 'transfer', label: 'Transfer', icon: <ArrowRightLeft className="h-4 w-4" /> },
];

export function TransactionDialog({
  open,
  onOpenChange,
  transaction,
  defaultType = 'expense',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction?: Transaction | null;
  defaultType?: TransactionType;
}) {
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: tagRows = [] } = useTags();
  const { data: settingRows = [] } = useSettingRows();
  const createTx = useCreateEntity('transaction');
  const updateTx = useUpdateEntity('transaction');

  const [draft, setDraft] = React.useState<Draft>(() => emptyDraft(defaultType));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const isEdit = !!transaction;

  React.useEffect(() => {
    if (!open) return;
    setErrors({});
    if (transaction) {
      setDraft({
        type: transaction.type,
        date: transaction.date,
        amount: transaction.amount,
        merchant: transaction.merchant,
        description: transaction.description ?? '',
        categoryId: transaction.categoryId ?? '',
        subcategoryId: transaction.subcategoryId ?? '',
        paymentMethod: transaction.paymentMethod ?? '',
        accountId: transaction.accountId ?? '',
        toAccountId: transaction.toAccountId ?? '',
        tags: parseTags(transaction.tags),
        recurring: transaction.recurring,
        receiptImage: transaction.receiptImage ?? null,
        notes: transaction.notes ?? '',
      });
    } else {
      setDraft({ ...emptyDraft(defaultType), accountId: accounts[0]?.id ?? '' });
    }
  }, [open, transaction, defaultType, accounts]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // Switching between expense/income invalidates the selected category (they
  // are typed) — clear it instead of silently saving a wrong-type category.
  const setType = (type: TransactionType) =>
    setDraft((d) => {
      if (type === d.type) return d;
      const nextCatType = type === 'income' ? 'income' : 'expense';
      const cat = categories.find((c) => c.id === d.categoryId);
      const keep = cat?.type === nextCatType;
      return {
        ...d,
        type,
        categoryId: keep ? d.categoryId : '',
        subcategoryId: keep ? d.subcategoryId : '',
      };
    });

  const catType = draft.type === 'income' ? 'income' : 'expense';
  const topCategories = categories.filter((c) => !c.parentId && c.type === catType);
  const subcategories = categories.filter((c) => c.parentId === draft.categoryId);

  // Suggest a category from learned merchant rules while the user types.
  React.useEffect(() => {
    if (!open || isEdit || draft.type === 'transfer' || draft.categoryId || !draft.merchant.trim()) return;
    const timer = setTimeout(() => {
      const rules = parseRules(settingRows.find((r) => r.key === RULES_KEY)?.value);
      const rule = matchRule(rules, draft.merchant, categories);
      const cat = rule ? categories.find((c) => c.id === rule.categoryId) : undefined;
      if (!rule || !cat || cat.type !== catType) return;
      setDraft((d) =>
        d.categoryId || d.merchant !== draft.merchant
          ? d
          : { ...d, categoryId: rule.categoryId, subcategoryId: rule.subcategoryId ?? '' }
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [open, isEdit, draft.type, draft.categoryId, draft.merchant, settingRows, categories, catType]);

  async function handleSave() {
    const next: Record<string, string> = {};
    const parsed = baseSchema.safeParse({
      date: draft.date,
      amount: draft.amount === '' ? undefined : draft.amount,
      merchant: draft.type === 'transfer' ? draft.merchant || 'Transfer' : draft.merchant,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) next[issue.path[0] as string] = issue.message;
    }
    if (draft.type === 'transfer') {
      if (!draft.accountId) next.accountId = 'Pick the source account';
      if (!draft.toAccountId) next.toAccountId = 'Pick the destination account';
      if (draft.accountId && draft.accountId === draft.toAccountId)
        next.toAccountId = 'Destination must differ from source';
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed.success) return;

    const payload: Partial<Transaction> = {
      type: draft.type,
      date: draft.date,
      amount: parsed.data.amount,
      merchant: parsed.data.merchant,
      description: draft.description || null,
      categoryId: draft.type === 'transfer' ? null : draft.categoryId || null,
      subcategoryId: draft.type === 'transfer' ? null : draft.subcategoryId || null,
      paymentMethod: draft.paymentMethod || null,
      accountId: draft.accountId || null,
      toAccountId: draft.type === 'transfer' ? draft.toAccountId || null : null,
      tags: serializeTags(draft.tags),
      recurring: draft.recurring,
      receiptImage: draft.receiptImage,
      notes: draft.notes || null,
    };

    try {
      if (isEdit && transaction) {
        await updateTx.mutateAsync({ id: transaction.id, data: payload });
        toast.success('Transaction updated');
      } else {
        await createTx.mutateAsync(payload);
        toast.success('Transaction added');
      }
      // Register any brand-new tags for future autocomplete.
      const known = new Set(tagRows.map((t) => t.name));
      for (const t of draft.tags.filter((t) => !known.has(t))) {
        api.create('tag', { name: t }).catch(() => {});
      }
      // Learn merchant → category so imports and quick-add autofill next time.
      if (payload.type !== 'transfer' && payload.categoryId && payload.merchant) {
        const rules = parseRules(settingRows.find((r) => r.key === RULES_KEY)?.value);
        const next = learnRule(rules, payload.merchant, payload.categoryId, payload.subcategoryId ?? null);
        if (next !== rules) api.setSetting(RULES_KEY, JSON.stringify(next)).catch(() => {});
      }
      onOpenChange(false);
    } catch {
      /* error toast comes from the mutation hook */
    }
  }

  async function handleReceipt(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Receipt images must be under 2 MB');
      return;
    }
    set('receiptImage', await readFileAsDataUrl(file));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit transaction' : 'Add transaction'}</DialogTitle>
        </DialogHeader>

        {/* Type selector */}
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Transaction type">
          {TYPE_OPTIONS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={draft.type === t.value}
              onClick={() => setType(t.value)}
              className={cn(
                'flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors cursor-pointer',
                draft.type === t.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'hover:bg-accent text-muted-foreground'
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Amount" required error={errors.amount}>
            <MoneyInput value={draft.amount} onChange={(v) => set('amount', v)} autoFocus />
          </Field>
          <Field label="Date" required error={errors.date}>
            <DateField value={draft.date} onChange={(v) => set('date', v ?? '')} />
          </Field>

          {draft.type !== 'transfer' ? (
            <>
              <Field label="Merchant" required error={errors.merchant}>
                <Input
                  value={draft.merchant}
                  onChange={(e) => set('merchant', e.target.value)}
                  placeholder="e.g. Whole Foods"
                />
              </Field>
              <Field label="Category">
                <Select
                  value={draft.categoryId || undefined}
                  onValueChange={(v) => {
                    set('categoryId', v);
                    set('subcategoryId', '');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {topCategories.map((c) => (
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
              {subcategories.length > 0 && (
                <Field label="Subcategory">
                  <Select
                    value={draft.subcategoryId || undefined}
                    onValueChange={(v) => set('subcategoryId', v === '__none__' ? '' : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Optional" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {subcategories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <Field label="Account">
                <Select value={draft.accountId || undefined} onValueChange={(v) => set('accountId', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick an account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.filter((a) => !a.archived).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Payment method">
                <Select
                  value={draft.paymentMethod || undefined}
                  onValueChange={(v) => set('paymentMethod', v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Optional" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          ) : (
            <>
              <Field label="From account" required error={errors.accountId}>
                <Select value={draft.accountId || undefined} onValueChange={(v) => set('accountId', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Source" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.filter((a) => !a.archived).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="To account" required error={errors.toAccountId}>
                <Select value={draft.toAccountId || undefined} onValueChange={(v) => set('toAccountId', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Destination" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.filter((a) => !a.archived).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Label" className="sm:col-span-2">
                <Input
                  value={draft.merchant}
                  onChange={(e) => set('merchant', e.target.value)}
                  placeholder="e.g. Credit Card Payment"
                />
              </Field>
            </>
          )}

          <Field label="Description" className="sm:col-span-2">
            <Input
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Optional details"
            />
          </Field>

          {draft.type !== 'transfer' && (
            <Field label="Tags" className="sm:col-span-2">
              <TagInput
                value={draft.tags}
                onChange={(tags) => set('tags', tags)}
                suggestions={tagRows.map((t) => t.name)}
              />
            </Field>
          )}

          <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <Switch checked={draft.recurring} onCheckedChange={(v) => set('recurring', v)} />
              Recurring
            </label>
            <div className="flex items-center gap-2">
              {draft.receiptImage ? (
                <span className="flex items-center gap-1.5">
                  <img
                    src={draft.receiptImage}
                    alt="Receipt preview"
                    className="h-9 w-9 rounded-md object-cover border"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => set('receiptImage', null)}
                    aria-label="Remove receipt"
                  >
                    <X />
                  </Button>
                </span>
              ) : (
                <label className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer">
                  <Paperclip className="h-4 w-4" />
                  Attach receipt
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => handleReceipt(e.target.files?.[0])}
                  />
                </label>
              )}
            </div>
          </div>

          <Field label="Notes" className="sm:col-span-2">
            <Textarea
              value={draft.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Anything worth remembering…"
              rows={2}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={createTx.isPending || updateTx.isPending}>
            {isEdit ? 'Save changes' : 'Add transaction'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function emptyDraft(type: TransactionType): Draft {
  return {
    type,
    date: new Date().toISOString(),
    amount: '',
    merchant: '',
    description: '',
    categoryId: '',
    subcategoryId: '',
    paymentMethod: '',
    accountId: '',
    toAccountId: '',
    tags: [],
    recurring: false,
    receiptImage: null,
    notes: '',
  };
}
