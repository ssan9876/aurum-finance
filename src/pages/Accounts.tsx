/**
 * Accounts: checking, savings, credit, cash and investment accounts with
 * live running balances, transfers between accounts, and archiving.
 */
import * as React from 'react';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, ArrowRightLeft, Landmark, MoreHorizontal, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ColorPicker, ConfirmDialog, DateField, EmptyState, Field, IconPicker, MoneyInput, PageHeader, StatCard } from '@/components/shared';
import { EntityIcon } from '@/lib/icons';
import { useSettings } from '@/state/settings';
import {
  useAccounts,
  useCreateEntity,
  useRefreshAll,
  useSavingsAccounts,
  useTransactions,
  useUpdateEntity,
} from '@/data/hooks';
import { api } from '@/data/api';
import { accountBalance, totalSavings } from '@/lib/finance';
import { ACCOUNT_TYPES } from '@/shared/defaults';
import { round2, sum } from '@/lib/utils';
import type { Account, AccountType } from '@/shared/types';

export default function Accounts() {
  const { fmtMoney } = useSettings();
  const { data: accounts, isLoading } = useAccounts();
  const { data: transactions = [] } = useTransactions();
  const { data: savings = [] } = useSavingsAccounts();
  const update = useUpdateEntity('account');
  const refreshAll = useRefreshAll();

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Account | null>(null);
  const [transferOpen, setTransferOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<Account | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);

  if (isLoading || !accounts) {
    return (
      <div>
        <PageHeader title="Accounts" />
        <Skeleton className="h-[480px] rounded-xl" />
      </div>
    );
  }

  const balances = new Map(accounts.map((a) => [a.id, accountBalance(a, transactions)]));
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);
  const assets = round2(
    sum(active.filter((a) => a.type !== 'credit' && a.type !== 'loan').map((a) => balances.get(a.id) ?? 0))
  );
  const debt = round2(
    sum(active.filter((a) => a.type === 'credit' || a.type === 'loan').map((a) => Math.min(0, balances.get(a.id) ?? 0)))
  );
  const savingsTotal = totalSavings(savings);
  const netWorth = round2(assets + debt + savingsTotal);

  const typeMeta = (t: AccountType) => ACCOUNT_TYPES.find((x) => x.value === t);

  async function handleDelete() {
    if (!deleting) return;
    await api.removeMany('account', [deleting.id]);
    refreshAll();
    toast.success(`Deleted "${deleting.name}"`, { description: 'Its transactions keep their history.' });
    setDeleting(null);
  }

  const renderCard = (a: Account) => {
    const bal = balances.get(a.id) ?? 0;
    const meta = typeMeta(a.type);
    const color = a.color ?? '#2a78d6';
    return (
      <Card key={a.id} className={a.archived ? 'opacity-60' : undefined}>
        <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="h-9 w-9 rounded-lg inline-flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${color}22`, color }}
            >
              <EntityIcon name={a.icon ?? meta?.icon} className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-[15px] truncate">{a.name}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{meta?.label}</p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${a.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setEditing(a);
                  setEditorOpen(true);
                }}
              >
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => update.mutate({ id: a.id, data: { archived: !a.archived } })}>
                {a.archived ? <ArchiveRestore /> : <Archive />}
                {a.archived ? 'Restore' : 'Archive'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => setDeleting(a)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent>
          <p
            className={
              'text-2xl font-semibold tabular-nums tracking-tight ' +
              (bal < 0 ? 'text-destructive' : '')
            }
          >
            {fmtMoney(bal)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {transactions.filter((t) => t.accountId === a.id || t.toAccountId === a.id).length} transactions ·
            started at {fmtMoney(a.startBalance)}
          </p>
        </CardContent>
      </Card>
    );
  };

  return (
    <div>
      <PageHeader
        title="Accounts"
        description="Balances update automatically from your transactions and transfers."
        actions={
          <>
            <Button variant="outline" onClick={() => setTransferOpen(true)} disabled={active.length < 2}>
              <ArrowRightLeft /> Transfer
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
            >
              <Plus /> Add account
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <StatCard label="Net Worth" value={fmtMoney(netWorth, { compact: true })} icon={<Landmark />} sub="Accounts + savings − credit debt" tone={netWorth >= 0 ? 'positive' : 'negative'} />
        <StatCard label="Total Assets" value={fmtMoney(round2(assets + savingsTotal), { compact: true })} icon={<Wallet />} sub={`incl. ${fmtMoney(savingsTotal, { compact: true })} in savings`} />
        <StatCard label="Credit Card Debt" value={fmtMoney(Math.abs(debt), { compact: true })} tone={debt < 0 ? 'negative' : 'positive'} icon={<Wallet />} sub={debt < 0 ? 'Across credit accounts' : 'Debt-free 🎉'} />
        <StatCard label="Active Accounts" value={active.length} icon={<Wallet />} sub={archived.length ? `${archived.length} archived` : 'None archived'} />
      </div>

      {active.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<Wallet />}
            title="No accounts"
            action={
              <Button
                onClick={() => {
                  setEditing(null);
                  setEditorOpen(true);
                }}
              >
                <Plus /> Add account
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4 stagger-children">{active.map(renderCard)}</div>
      )}

      {archived.length > 0 && (
        <div className="mt-6">
          <button
            className="text-sm text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? 'Hide' : 'Show'} {archived.length} archived account{archived.length > 1 ? 's' : ''}
          </button>
          {showArchived && (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mt-3">{archived.map(renderCard)}</div>
          )}
        </div>
      )}

      <AccountEditor open={editorOpen} onOpenChange={setEditorOpen} account={editing} />
      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} accounts={active} balances={balances} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description="Transactions on this account are kept but detached. Consider archiving instead — this can't be undone."
        onConfirm={handleDelete}
      />
    </div>
  );
}

/* --------------------------------- editor --------------------------------- */

function AccountEditor({
  open,
  onOpenChange,
  account,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  account: Account | null;
}) {
  const create = useCreateEntity('account');
  const update = useUpdateEntity('account');

  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<AccountType>('checking');
  const [startBalance, setStartBalance] = React.useState<number | ''>('');
  const [icon, setIcon] = React.useState('wallet');
  const [color, setColor] = React.useState('#2a78d6');

  React.useEffect(() => {
    if (!open) return;
    setName(account?.name ?? '');
    setType(account?.type ?? 'checking');
    setStartBalance(account?.startBalance ?? '');
    setIcon(account?.icon ?? 'wallet');
    setColor(account?.color ?? '#2a78d6');
  }, [open, account]);

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Give the account a name.');
      return;
    }
    const data = {
      name: name.trim(),
      type,
      startBalance: startBalance === '' ? 0 : startBalance,
      icon,
      color,
    };
    try {
      if (account) await update.mutateAsync({ id: account.id, data });
      else await create.mutateAsync(data);
      toast.success(account ? 'Account updated' : 'Account created');
      onOpenChange(false);
    } catch {
      /* hook shows error */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{account ? 'Edit account' : 'New account'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2 items-end">
            <Field label="Name" required className="flex-1">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Everyday Checking" />
            </Field>
            <IconPicker value={icon} onChange={setIcon} color={color} />
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Type">
              <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Starting balance" hint="Balance before tracked transactions">
              <MoneyInput value={startBalance} onChange={setStartBalance} />
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

/* -------------------------------- transfer -------------------------------- */

function TransferDialog({
  open,
  onOpenChange,
  accounts,
  balances,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  accounts: Account[];
  balances: Map<string, number>;
}) {
  const { fmtMoney } = useSettings();
  const createTx = useCreateEntity('transaction');
  const [fromId, setFromId] = React.useState('');
  const [toId, setToId] = React.useState('');
  const [amount, setAmount] = React.useState<number | ''>('');
  const [date, setDate] = React.useState<string | null>(new Date().toISOString());
  const [label, setLabel] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setFromId(accounts[0]?.id ?? '');
    setToId(accounts[1]?.id ?? '');
    setAmount('');
    setDate(new Date().toISOString());
    setLabel('');
  }, [open, accounts]);

  async function handleSave() {
    if (!fromId || !toId || fromId === toId || amount === '' || amount <= 0 || !date) {
      toast.error('Pick two different accounts and an amount above zero.');
      return;
    }
    await createTx.mutateAsync({
      type: 'transfer',
      date,
      amount,
      merchant: label.trim() || 'Transfer',
      accountId: fromId,
      toAccountId: toId,
      paymentMethod: 'Bank Transfer',
    });
    toast.success('Transfer recorded');
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Transfer between accounts</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="From" required>
            <Select value={fromId || undefined} onValueChange={setFromId}>
              <SelectTrigger>
                <SelectValue placeholder="Source account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {fmtMoney(balances.get(a.id) ?? 0)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="To" required>
            <Select value={toId || undefined} onValueChange={setToId}>
              <SelectTrigger>
                <SelectValue placeholder="Destination account" />
              </SelectTrigger>
              <SelectContent>
                {accounts
                  .filter((a) => a.id !== fromId)
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {fmtMoney(balances.get(a.id) ?? 0)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Amount" required>
              <MoneyInput value={amount} onChange={setAmount} />
            </Field>
            <Field label="Date">
              <DateField value={date} onChange={setDate} />
            </Field>
          </div>
          <Field label="Label">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Credit card payment" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={createTx.isPending}>
            <ArrowRightLeft /> Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
