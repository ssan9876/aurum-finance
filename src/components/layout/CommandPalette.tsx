/**
 * Ctrl+K command palette: navigation, quick actions, theme switching, and
 * global search across transactions, categories, merchants and accounts.
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRightLeft,
  BarChart3,
  CalendarDays,
  FolderTree,
  LayoutDashboard,
  Moon,
  PiggyBank,
  Plus,
  Receipt,
  Settings,
  Store,
  Sun,
  Target,
  TrendingUp,
  Wallet,
  WalletCards,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { useUI } from '@/state/ui';
import { useSettings } from '@/state/settings';
import { useAccounts, useCategories, useTransactions } from '@/data/hooks';
import { EntityIcon } from '@/lib/icons';
import { Amount } from '@/components/shared';

const NAV = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard />, kbd: 'G D' },
  { to: '/transactions', label: 'Transactions', icon: <ArrowRightLeft />, kbd: 'G T' },
  { to: '/income', label: 'Income', icon: <TrendingUp />, kbd: 'G I' },
  { to: '/bills', label: 'Bills', icon: <Receipt /> },
  { to: '/budgets', label: 'Budgets', icon: <WalletCards />, kbd: 'G B' },
  { to: '/savings', label: 'Savings', icon: <PiggyBank />, kbd: 'G S' },
  { to: '/goals', label: 'Goals', icon: <Target /> },
  { to: '/accounts', label: 'Accounts', icon: <Wallet /> },
  { to: '/categories', label: 'Categories', icon: <FolderTree /> },
  { to: '/calendar', label: 'Calendar', icon: <CalendarDays />, kbd: 'G C' },
  { to: '/analytics', label: 'Analytics', icon: <BarChart3 />, kbd: 'G A' },
  { to: '/settings', label: 'Settings', icon: <Settings /> },
];

export function CommandPalette() {
  const ui = useUI();
  const navigate = useNavigate();
  const { setSetting, fmtDate } = useSettings();
  const [query, setQuery] = React.useState('');

  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();

  React.useEffect(() => {
    if (!ui.paletteOpen) setQuery('');
  }, [ui.paletteOpen]);

  const go = (fn: () => void) => {
    ui.setPaletteOpen(false);
    // Let the dialog close before side effects (dialog restores focus).
    setTimeout(fn, 0);
  };

  // Search transactions only once the user types (keeps the list calm).
  const q = query.trim().toLowerCase();
  const txMatches = q.length >= 2
    ? transactions
        .filter(
          (t) =>
            t.merchant.toLowerCase().includes(q) ||
            (t.description ?? '').toLowerCase().includes(q) ||
            (t.notes ?? '').toLowerCase().includes(q) ||
            t.tags.toLowerCase().includes(q)
        )
        .slice(0, 6)
    : [];

  return (
    <CommandDialog open={ui.paletteOpen} onOpenChange={ui.setPaletteOpen}>
      <CommandInput
        placeholder="Search transactions, pages, actions…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => go(() => ui.setQuickTxOpen(true))}>
            <Plus /> Add transaction <CommandShortcut>N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go(() => ui.setQuickIncomeOpen(true))}>
            <TrendingUp /> Add income source <CommandShortcut>I</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go(() => setSetting('theme', 'light'))}>
            <Sun /> Switch to light theme
          </CommandItem>
          <CommandItem onSelect={() => go(() => setSetting('theme', 'dark'))}>
            <Moon /> Switch to dark theme
          </CommandItem>
        </CommandGroup>

        {txMatches.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Transactions">
              {txMatches.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`tx-${t.id}-${t.merchant}`}
                  onSelect={() => go(() => navigate(`/transactions?q=${encodeURIComponent(t.merchant)}`))}
                >
                  <Store />
                  <span className="flex-1 truncate">
                    {t.merchant}
                    <span className="text-muted-foreground ml-2 text-xs">{fmtDate(t.date)}</span>
                  </span>
                  <Amount value={t.amount} type={t.type} className="text-xs" />
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Go to">
          {NAV.map((n) => (
            <CommandItem key={n.to} onSelect={() => go(() => navigate(n.to))}>
              {n.icon} {n.label}
              {n.kbd && <CommandShortcut>{n.kbd}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>

        {q.length >= 2 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Categories">
              {categories
                .filter((c) => c.name.toLowerCase().includes(q))
                .slice(0, 4)
                .map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`cat-${c.id}-${c.name}`}
                    onSelect={() => go(() => navigate('/categories'))}
                  >
                    <EntityIcon name={c.icon} style={{ color: c.color }} />
                    {c.name}
                  </CommandItem>
                ))}
            </CommandGroup>
            <CommandGroup heading="Accounts">
              {accounts
                .filter((a) => a.name.toLowerCase().includes(q))
                .slice(0, 4)
                .map((a) => (
                  <CommandItem
                    key={a.id}
                    value={`acc-${a.id}-${a.name}`}
                    onSelect={() => go(() => navigate('/accounts'))}
                  >
                    <Wallet />
                    {a.name}
                  </CommandItem>
                ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
