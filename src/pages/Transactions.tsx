/**
 * Transactions: searchable, filterable ledger with sorting, pagination,
 * bulk edit/delete (with undo), inline editing, receipts, CSV import/export.
 */
import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowDownUp,
  ArrowRightLeft,
  Copy,
  Download,
  FileUp,
  Filter,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Receipt,
  Repeat,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Amount, CategoryChip, DateField, EmptyState, Field, PageHeader, SearchInput } from '@/components/shared';
import { TransactionDialog } from '@/components/forms/TransactionDialog';
import { useSettings } from '@/state/settings';
import {
  useAccounts,
  useBulkUpdate,
  useCategories,
  useCreateEntity,
  useDeleteWithUndo,
  useRefreshAll,
  useSettingRows,
  useTags,
  useTransactions,
  useUpdateEntity,
} from '@/data/hooks';
import { api } from '@/data/api';
import {
  exportTransactionsCsv,
  exportTransactionsXlsx,
  parseCsvFile,
  rowsToTransactions,
  type CsvMapping,
  type CsvParseResult,
} from '@/lib/csv';
import { looksLikeOfx, ofxToTransactions, parseOfx, type OfxParseResult } from '@/lib/ofx';
import { parseTags, type Transaction } from '@/shared/types';
import { PAYMENT_METHODS } from '@/shared/defaults';
import { cn, readFileAsText } from '@/lib/utils';

const PAGE_SIZE = 50;

type SortKey = 'date' | 'amount' | 'merchant';

export default function Transactions() {
  const [params, setParams] = useSearchParams();
  const { fmtDate, fmtMoney } = useSettings();

  const { data: transactions, isLoading } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: tagRows = [] } = useTags();

  const updateTx = useUpdateEntity('transaction');
  const bulkUpdate = useBulkUpdate('transaction');
  const createTx = useCreateEntity('transaction');
  const deleteWithUndo = useDeleteWithUndo('transaction');

  /* --------------------------------- state -------------------------------- */
  const q = params.get('q') ?? '';
  const setQ = (v: string) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (v) next.set('q', v);
      else next.delete('q');
      return next;
    }, { replace: true });

  const [type, setType] = React.useState('all');
  const [categoryId, setCategoryId] = React.useState('all');
  const [accountId, setAccountId] = React.useState('all');
  const [method, setMethod] = React.useState('all');
  const [tag, setTag] = React.useState('all');
  const [from, setFrom] = React.useState<string | null>(null);
  const [to, setTo] = React.useState<string | null>(null);
  const [sort, setSort] = React.useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'date', dir: -1 });
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [editing, setEditing] = React.useState<Transaction | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  React.useEffect(() => setPage(0), [q, type, categoryId, accountId, method, tag, from, to]);

  const catById = React.useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accById = React.useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const activeFilterCount = [type, categoryId, accountId, method, tag].filter((v) => v !== 'all').length + (from ? 1 : 0) + (to ? 1 : 0);

  /* ------------------------------- filtering ------------------------------ */
  const filtered = React.useMemo(() => {
    if (!transactions) return [];
    const needle = q.trim().toLowerCase();
    let rows = transactions.filter((t) => {
      if (type !== 'all' && t.type !== type) return false;
      if (categoryId !== 'all' && t.categoryId !== categoryId && t.subcategoryId !== categoryId) return false;
      if (accountId !== 'all' && t.accountId !== accountId && t.toAccountId !== accountId) return false;
      if (method !== 'all' && t.paymentMethod !== method) return false;
      if (tag !== 'all' && !parseTags(t.tags).includes(tag)) return false;
      if (from && t.date < from) return false;
      if (to && t.date > to.slice(0, 10) + 'T23:59:59.999Z') return false;
      if (needle) {
        const hay = [
          t.merchant,
          t.description ?? '',
          t.notes ?? '',
          t.categoryId ? catById.get(t.categoryId)?.name ?? '' : '',
          t.accountId ? accById.get(t.accountId)?.name ?? '' : '',
          parseTags(t.tags).join(' '),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    rows = rows.sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return cmp * sort.dir;
    });
    return rows;
  }, [transactions, q, type, categoryId, accountId, method, tag, from, to, sort, catById, accById]);

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const totals = React.useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of filtered) {
      if (t.type === 'income') income += t.amount;
      else if (t.type === 'expense') expense += t.amount;
    }
    return { income, expense };
  }, [filtered]);

  /* ------------------------------- actions -------------------------------- */
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }));

  const allPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });

  async function handleDeleteSelected() {
    const rows = filtered.filter((t) => selected.has(t.id));
    setSelected(new Set());
    await deleteWithUndo(rows);
  }

  async function handleDuplicate(t: Transaction) {
    const { id, createdAt, updatedAt, ...rest } = t;
    await createTx.mutateAsync({ ...rest, date: new Date().toISOString() });
    toast.success('Transaction duplicated');
  }

  async function bulkSet(data: Partial<Transaction>) {
    await bulkUpdate.mutateAsync({ ids: [...selected], data });
    toast.success(`Updated ${selected.size} transactions`);
    setSelected(new Set());
  }

  const clearFilters = () => {
    setType('all');
    setCategoryId('all');
    setAccountId('all');
    setMethod('all');
    setTag('all');
    setFrom(null);
    setTo(null);
    setQ('');
  };

  /* --------------------------------- render ------------------------------- */
  if (isLoading || !transactions) {
    return (
      <div>
        <PageHeader title="Transactions" />
        <Skeleton className="h-10 w-full mb-3" />
        <Skeleton className="h-[480px] w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Transactions"
        description={`${filtered.length} of ${transactions.length} transactions · ${fmtMoney(totals.income)} in · ${fmtMoney(totals.expense)} out`}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Download /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportTransactionsCsv(filtered, categories, accounts)}>
                  CSV (.csv)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportTransactionsXlsx(filtered, categories, accounts)}>
                  Excel (.xlsx)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileUp /> Import
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus /> Add
            </Button>
          </>
        }
      />

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <SearchInput
          placeholder="Search merchant, notes, tags…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full sm:w-72"
        />
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="expense">Expenses</SelectItem>
            <SelectItem value="income">Income</SelectItem>
            <SelectItem value="transfer">Transfers</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories
              .filter((c) => !c.parentId)
              .map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All accounts</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-1.5">
              <Filter />
              More
              {activeFilterCount > 0 && (
                <Badge className="h-5 min-w-5 px-1 justify-center">{activeFilterCount}</Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-3" align="start">
            <Field label="Payment method">
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any</SelectItem>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Tag">
              <Select value={tag} onValueChange={setTag}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any</SelectItem>
                  {tagRows.map((t) => (
                    <SelectItem key={t.id} value={t.name}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="From">
                <DateField value={from} onChange={setFrom} />
              </Field>
              <Field label="To">
                <DateField value={to} onChange={setTo} />
              </Field>
            </div>
            <Button variant="ghost" size="sm" onClick={clearFilters} className="w-full">
              <X /> Clear all filters
            </Button>
          </PopoverContent>
        </Popover>
        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 rounded-lg border bg-primary/5 px-3 py-2 animate-fade-up">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Select onValueChange={(v) => bulkSet({ categoryId: v, subcategoryId: null })}>
            <SelectTrigger className="w-[170px] h-8">
              <SelectValue placeholder="Set category…" />
            </SelectTrigger>
            <SelectContent>
              {categories
                .filter((c) => !c.parentId)
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select onValueChange={(v) => bulkSet({ accountId: v })}>
            <SelectTrigger className="w-[160px] h-8">
              <SelectValue placeholder="Set account…" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="destructive" size="sm" onClick={handleDeleteSelected}>
            <Trash2 /> Delete
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Cancel
          </Button>
        </div>
      )}

      {/* Table */}
      <Card>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Receipt />}
            title={transactions.length === 0 ? 'No transactions yet' : 'Nothing matches your filters'}
            description={
              transactions.length === 0
                ? 'Add your first transaction to start tracking your spending.'
                : 'Try adjusting or clearing the filters above.'
            }
            action={
              transactions.length === 0 ? (
                <Button
                  onClick={() => {
                    setEditing(null);
                    setDialogOpen(true);
                  }}
                >
                  <Plus /> Add transaction
                </Button>
              ) : (
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allPageSelected ? true : selected.size > 0 ? 'indeterminate' : false}
                      onCheckedChange={toggleAll}
                      aria-label="Select all on page"
                    />
                  </TableHead>
                  <SortableHead label="Date" active={sort.key === 'date'} dir={sort.dir} onClick={() => toggleSort('date')} />
                  <SortableHead label="Merchant" active={sort.key === 'merchant'} dir={sort.dir} onClick={() => toggleSort('merchant')} />
                  <TableHead className="hidden md:table-cell">Category</TableHead>
                  <TableHead className="hidden lg:table-cell">Account</TableHead>
                  <TableHead className="hidden xl:table-cell">Tags</TableHead>
                  <SortableHead
                    label="Amount"
                    active={sort.key === 'amount'}
                    dir={sort.dir}
                    onClick={() => toggleSort('amount')}
                    className="text-right"
                  />
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((t) => (
                  <TableRow key={t.id} data-state={selected.has(t.id) ? 'selected' : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(t.id)}
                        onCheckedChange={(v) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(t.id);
                            else next.delete(t.id);
                            return next;
                          })
                        }
                        aria-label={`Select ${t.merchant}`}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {fmtDate(t.date)}
                    </TableCell>
                    <TableCell className="max-w-[240px]">
                      <InlineText
                        value={t.merchant}
                        onSave={(v) => updateTx.mutateAsync({ id: t.id, data: { merchant: v } })}
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          {t.type === 'transfer' && <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                          <span className="truncate font-medium">{t.merchant || '—'}</span>
                          {t.recurring && <Repeat className="h-3 w-3 text-muted-foreground shrink-0" aria-label="Recurring" />}
                          {t.receiptImage && <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" aria-label="Has receipt" />}
                        </span>
                        {t.description && (
                          <span className="block text-xs text-muted-foreground truncate">{t.description}</span>
                        )}
                      </InlineText>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {t.type === 'transfer' ? (
                        <span className="text-xs text-muted-foreground">
                          → {t.toAccountId ? accById.get(t.toAccountId)?.name : '—'}
                        </span>
                      ) : (
                        <CategoryChip
                          category={
                            t.subcategoryId
                              ? catById.get(t.subcategoryId)
                              : t.categoryId
                                ? catById.get(t.categoryId)
                                : null
                          }
                        />
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">
                      {t.accountId ? accById.get(t.accountId)?.name ?? '—' : '—'}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <span className="flex gap-1 flex-wrap">
                        {parseTags(t.tags).slice(0, 3).map((tg) => (
                          <Badge key={tg} variant="secondary" className="text-[10px] px-1.5">
                            {tg}
                          </Badge>
                        ))}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <InlineNumber
                        value={t.amount}
                        onSave={(v) => updateTx.mutateAsync({ id: t.id, data: { amount: v } })}
                      >
                        <Amount value={t.amount} type={t.type} />
                      </InlineNumber>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label="Row actions">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setEditing(t);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDuplicate(t)}>
                            <Copy /> Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => deleteWithUndo([t], 'Transaction deleted')}>
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination */}
            {pageCount > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
                <span className="text-muted-foreground">
                  Page {page + 1} of {pageCount}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= pageCount - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <TransactionDialog open={dialogOpen} onOpenChange={setDialogOpen} transaction={editing} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

/* ------------------------------ sortable head ----------------------------- */

function SortableHead({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
  className?: string;
}) {
  return (
    <TableHead className={className} aria-sort={active ? (dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button
        className={cn(
          'inline-flex items-center gap-1 hover:text-foreground cursor-pointer',
          active && 'text-foreground'
        )}
        onClick={onClick}
      >
        {label}
        <ArrowDownUp className={cn('h-3 w-3', active ? 'opacity-100' : 'opacity-30')} />
      </button>
    </TableHead>
  );
}

/* ------------------------------ inline editing ---------------------------- */

function InlineText({
  value,
  onSave,
  children,
}: {
  value: string;
  onSave: (v: string) => Promise<unknown>;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  if (!editing) {
    return (
      <div
        onDoubleClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        title="Double-click to edit"
        className="cursor-text"
      >
        {children}
      </div>
    );
  }
  const commit = async () => {
    setEditing(false);
    if (draft.trim() && draft !== value) await onSave(draft.trim());
  };
  return (
    <Input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
      className="h-7 text-sm"
    />
  );
}

function InlineNumber({
  value,
  onSave,
  children,
}: {
  value: number;
  onSave: (v: number) => Promise<unknown>;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(String(value));
  if (!editing) {
    return (
      <div
        onDoubleClick={() => {
          setDraft(String(value));
          setEditing(true);
        }}
        title="Double-click to edit"
        className="cursor-text inline-block"
      >
        {children}
      </div>
    );
  }
  const commit = async () => {
    setEditing(false);
    const n = Number(draft);
    if (!Number.isNaN(n) && n > 0 && n !== value) await onSave(n);
  };
  return (
    <Input
      autoFocus
      type="number"
      step="0.01"
      min="0"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
      className="h-7 w-28 text-sm text-right ml-auto"
    />
  );
}

/* ---------------------------- CSV / OFX import ---------------------------- */

function guessColumn(headers: string[], candidates: string[]): string {
  const lower = headers.map((h) => h.toLowerCase());
  for (const c of candidates) {
    const idx = lower.findIndex((h) => h.includes(c));
    if (idx >= 0) return headers[idx];
  }
  return '';
}

const EMPTY_MAPPING: CsvMapping & { description: string; category: string; notes: string } = {
  date: '',
  amount: '',
  merchant: '',
  description: '',
  category: '',
  notes: '',
};

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: transactions = [] } = useTransactions();
  const { data: settingRows = [] } = useSettingRows();
  const refreshAll = useRefreshAll();

  const [parsed, setParsed] = React.useState<CsvParseResult | null>(null);
  const [ofx, setOfx] = React.useState<OfxParseResult | null>(null);
  const [fileName, setFileName] = React.useState('');
  const [mapping, setMapping] = React.useState({ ...EMPTY_MAPPING });
  const [accountId, setAccountId] = React.useState('');
  const [skipDupes, setSkipDupes] = React.useState(true);
  const [presetName, setPresetName] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  // Saved column-mapping presets ("Chase card", "Amex", …) live in settings.
  const presets = React.useMemo<Record<string, typeof EMPTY_MAPPING>>(() => {
    const row = settingRows.find((r) => r.key === 'csvPresets');
    try {
      return row ? JSON.parse(row.value) : {};
    } catch {
      return {};
    }
  }, [settingRows]);

  React.useEffect(() => {
    if (!open) {
      setParsed(null);
      setOfx(null);
      setFileName('');
      setPresetName('');
    }
  }, [open]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    try {
      const isOfxName = /\.(ofx|qfx)$/i.test(file.name);
      const text = isOfxName ? await readFileAsText(file) : null;
      if (isOfxName || (text && looksLikeOfx(text))) {
        const result = parseOfx(text ?? (await readFileAsText(file)));
        if (result.transactions.length === 0) {
          toast.error('No transactions found in that OFX/QFX file.');
          return;
        }
        setOfx(result);
        setFileName(file.name);
        setAccountId(accounts[0]?.id ?? '');
        return;
      }
      const res = await parseCsvFile(file);
      if (!res.headers.length || !res.rows.length) {
        toast.error('That CSV appears to be empty.');
        return;
      }
      setParsed(res);
      setFileName(file.name);
      setMapping({
        date: guessColumn(res.headers, ['date', 'posted']),
        amount: guessColumn(res.headers, ['amount', 'value', 'total']),
        merchant: guessColumn(res.headers, ['merchant', 'payee', 'name', 'vendor', 'description']),
        description: guessColumn(res.headers, ['description', 'memo', 'details']),
        category: guessColumn(res.headers, ['category']),
        notes: guessColumn(res.headers, ['note']),
      });
      setAccountId(accounts[0]?.id ?? '');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read that file');
    }
  }

  async function savePreset() {
    const name = presetName.trim();
    if (!name) {
      toast.error('Name the preset first (e.g. "Chase card").');
      return;
    }
    await api.setSetting('csvPresets', JSON.stringify({ ...presets, [name]: mapping }));
    refreshAll();
    toast.success(`Preset "${name}" saved`);
  }

  async function handleImportOfx() {
    if (!ofx) return;
    setBusy(true);
    try {
      const { drafts, duplicates } = ofxToTransactions(ofx, transactions, accountId || null);
      if (!drafts.length) {
        toast.info(
          duplicates > 0
            ? `All ${duplicates} transactions were already imported — nothing new.`
            : 'No importable transactions found.'
        );
        onOpenChange(false);
        return;
      }
      await api.createMany('transaction', drafts);
      refreshAll();
      toast.success(
        `Imported ${drafts.length} transactions${duplicates ? ` · ${duplicates} duplicates skipped` : ''}`
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    if (!parsed) return;
    if (!mapping.date || !mapping.amount || !mapping.merchant) {
      toast.error('Map at least Date, Amount and Merchant columns.');
      return;
    }
    setBusy(true);
    try {
      let { drafts, skipped } = rowsToTransactions(parsed.rows, mapping, categories, accountId || null);
      let duplicates = 0;
      if (skipDupes) {
        // CSVs carry no stable id, so dedupe on date + amount + merchant.
        const key = (d: { date?: string | null; amount?: number; merchant?: string }) =>
          `${String(d.date).slice(0, 10)}|${d.amount}|${(d.merchant ?? '').toLowerCase()}`;
        const existing = new Set(transactions.map(key));
        const before = drafts.length;
        drafts = drafts.filter((d) => !existing.has(key(d)));
        duplicates = before - drafts.length;
      }
      if (!drafts.length) {
        toast.info(
          duplicates > 0 ? `All ${duplicates} rows were already imported — nothing new.` : 'No importable rows found — check the column mapping.'
        );
        return;
      }
      await api.createMany('transaction', drafts);
      refreshAll();
      toast.success(
        `Imported ${drafts.length} transactions` +
          (duplicates ? ` · ${duplicates} duplicates skipped` : '') +
          (skipped ? ` · ${skipped} rows unreadable` : '')
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  const colSelect = (key: keyof typeof mapping, label: string, required = false) => (
    <Field label={label} required={required}>
      <Select value={mapping[key] || undefined} onValueChange={(v) => setMapping((m) => ({ ...m, [key]: v === '__none__' ? '' : v }))}>
        <SelectTrigger>
          <SelectValue placeholder="Not mapped" />
        </SelectTrigger>
        <SelectContent>
          {!required && <SelectItem value="__none__">Not mapped</SelectItem>}
          {parsed?.headers.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import transactions</DialogTitle>
        </DialogHeader>
        {!parsed && !ofx ? (
          <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center cursor-pointer hover:bg-accent/50 transition-colors">
            <FileUp className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm font-medium">Choose a CSV, OFX or QFX file</span>
            <span className="text-xs text-muted-foreground">
              OFX/QFX (Quicken) downloads from Chase, Amex, etc. dedupe automatically via bank
              transaction ids. For CSV, negative amounts import as expenses.
            </span>
            <input
              type="file"
              accept=".csv,.ofx,.qfx,text/csv"
              className="sr-only"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </label>
        ) : ofx ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">{fileName}</strong>
              {ofx.org ? ` · ${ofx.org}` : ''} — {ofx.transactions.length} transactions found
              {ofx.accountId ? ` (account …${ofx.accountId.slice(-4)})` : ''}. Already-imported
              transactions are skipped automatically.
            </p>
            <Field label="Import into account">
              <Select value={accountId || undefined} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="No account" />
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
          </div>
        ) : parsed ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">{fileName}</strong> — {parsed.rows.length} rows detected.
              Map the columns:
            </p>
            {Object.keys(presets).length > 0 && (
              <Field label="Apply saved preset">
                <Select onValueChange={(name) => presets[name] && setMapping({ ...EMPTY_MAPPING, ...presets[name] })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a preset…" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(presets).map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              {colSelect('date', 'Date', true)}
              {colSelect('amount', 'Amount', true)}
              {colSelect('merchant', 'Merchant', true)}
              {colSelect('description', 'Description')}
              {colSelect('category', 'Category')}
              {colSelect('notes', 'Notes')}
            </div>
            <Field label="Import into account">
              <Select value={accountId || undefined} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="No account" />
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
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={skipDupes} onCheckedChange={(v) => setSkipDupes(v === true)} />
              Skip rows matching existing transactions (date + amount + merchant)
            </label>
            <div className="flex items-end gap-2 rounded-lg bg-muted/50 p-3">
              <Field label="Save this mapping as a preset" className="flex-1">
                <Input
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder='e.g. "Chase card"'
                />
              </Field>
              <Button variant="outline" onClick={savePreset}>
                Save preset
              </Button>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {ofx && (
            <Button onClick={handleImportOfx} loading={busy}>
              Import {ofx.transactions.length} transactions
            </Button>
          )}
          {parsed && (
            <Button onClick={handleImport} loading={busy}>
              Import {parsed.rows.length} rows
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
