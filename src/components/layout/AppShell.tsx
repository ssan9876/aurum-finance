/**
 * Application chrome: sidebar navigation, topbar (search / quick add / theme),
 * mobile sheet + FAB, global dialogs (command palette, quick-add, shortcuts,
 * onboarding), keyboard shortcuts and reminder toasts.
 */
import * as React from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Toaster, toast } from 'sonner';
import {
  ArrowRightLeft,
  BarChart3,
  CalendarDays,
  FolderTree,
  Gem,
  Keyboard,
  LayoutDashboard,
  Menu,
  Moon,
  PiggyBank,
  Plus,
  Receipt,
  Repeat,
  Search,
  Settings as SettingsIcon,
  Sun,
  SunMoon,
  Target,
  TrendingUp,
  Wallet,
  WalletCards,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettings } from '@/state/settings';
import { useUI } from '@/state/ui';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { SimpleTooltip } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TransactionDialog } from '@/components/forms/TransactionDialog';
import { IncomeDialog } from '@/components/forms/IncomeDialog';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { ShortcutsDialog } from '@/components/layout/ShortcutsDialog';
import { Onboarding } from '@/components/layout/Onboarding';
import { useAccounts, useBills, useBudgets, useCategories, useTransactions } from '@/data/hooks';
import { billState, budgetStatuses } from '@/lib/finance';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: <LayoutDashboard /> },
      { to: '/calendar', label: 'Calendar', icon: <CalendarDays /> },
      { to: '/analytics', label: 'Analytics', icon: <BarChart3 /> },
    ],
  },
  {
    label: 'Money',
    items: [
      { to: '/transactions', label: 'Transactions', icon: <ArrowRightLeft /> },
      { to: '/income', label: 'Income', icon: <TrendingUp /> },
      { to: '/bills', label: 'Bills', icon: <Receipt /> },
      { to: '/subscriptions', label: 'Subscriptions', icon: <Repeat /> },
      { to: '/budgets', label: 'Budgets', icon: <WalletCards /> },
    ],
  },
  {
    label: 'Planning',
    items: [
      { to: '/savings', label: 'Savings', icon: <PiggyBank /> },
      { to: '/goals', label: 'Goals', icon: <Target /> },
    ],
  },
  {
    label: 'Manage',
    items: [
      { to: '/accounts', label: 'Accounts', icon: <Wallet /> },
      { to: '/categories', label: 'Categories', icon: <FolderTree /> },
      { to: '/settings', label: 'Settings', icon: <SettingsIcon /> },
    ],
  },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { data: accounts = [] } = useAccounts();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const savingsAccounts = accounts.filter((a) => a.type === 'savings' && !a.archived);
  const activeAccount =
    location.pathname === '/transactions' ? searchParams.get('account') : null;

  return (
    <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-2 mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <React.Fragment key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    )
                  }
                >
                  {item.icon}
                  {item.label}
                </NavLink>
                {/* Savings-type accounts nest under the Savings entry, each
                    linking to its filtered ledger. */}
                {item.to === '/savings' && savingsAccounts.length > 0 && (
                  <div className="ml-[1.4rem] mt-0.5 space-y-0.5 border-l pl-2">
                    {savingsAccounts.map((a) => (
                      <NavLink
                        key={a.id}
                        to={`/transactions?account=${a.id}`}
                        onClick={onNavigate}
                        className={cn(
                          'block truncate rounded-md px-2 py-1 text-xs font-medium transition-colors',
                          activeAccount === a.id
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        )}
                      >
                        {a.name}
                      </NavLink>
                    ))}
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2 px-5 h-14 shrink-0">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-sm">
        <Gem className="h-4 w-4" />
      </span>
      <span className="font-semibold tracking-tight text-[15px]">Aurum</span>
    </div>
  );
}

export function AppShell() {
  const { settings, setSetting } = useSettings();
  const ui = useUI();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  // PWA shortcut ("Add transaction" on the home-screen icon) lands on
  // /?add=tx — open quick-add once and scrub the param.
  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get('add') !== 'tx') return;
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    ui.setQuickTxOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------- keyboard shortcuts -------------------------- */
  const pendingG = React.useRef(0);
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.closest('input, textarea, select, [contenteditable="true"]') != null ||
        document.querySelector('[role="dialog"][data-state="open"]') != null;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'n') {
        e.preventDefault();
        ui.setQuickTxOpen(true);
      } else if (e.key === 'i') {
        e.preventDefault();
        ui.setQuickIncomeOpen(true);
      } else if (e.key === '?') {
        e.preventDefault();
        ui.setShortcutsOpen(true);
      } else if (e.key === 'g') {
        pendingG.current = Date.now();
      } else if (Date.now() - pendingG.current < 900) {
        const map: Record<string, string> = {
          d: '/',
          t: '/transactions',
          b: '/budgets',
          s: '/savings',
          a: '/analytics',
          c: '/calendar',
          i: '/income',
          o: '/goals',
        };
        const to = map[e.key];
        if (to) {
          e.preventDefault();
          navigate(to);
        }
        pendingG.current = 0;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [ui, navigate]);

  /* --------------------- reminder toasts (once per run) ------------------ */
  const { data: bills } = useBills();
  const { data: budgets } = useBudgets();
  const { data: categories } = useCategories();
  const { data: transactions } = useTransactions();
  const remindedRef = React.useRef(false);
  React.useEffect(() => {
    if (remindedRef.current || !settings.notifications) return;
    if (!bills || !budgets || !categories || !transactions) return;
    remindedRef.current = true;

    if (settings.billReminders) {
      const soon = bills.filter((b) => billState(b) === 'due-soon');
      const overdue = bills.filter((b) => billState(b) === 'overdue');
      if (overdue.length > 0) {
        toast.error(
          `${overdue.length} bill${overdue.length > 1 ? 's are' : ' is'} overdue`,
          { description: overdue.map((b) => b.name).join(', '), duration: 8000 }
        );
      } else if (soon.length > 0) {
        toast.warning(`${soon.length} bill${soon.length > 1 ? 's' : ''} due soon`, {
          description: soon.map((b) => b.name).join(', '),
          duration: 6000,
        });
      }
    }
    if (settings.budgetAlerts) {
      const statuses = budgetStatuses(budgets, categories, transactions, new Date());
      const hot = statuses.filter((s) => s.pct >= 0.9);
      if (hot.length > 0) {
        toast.warning(
          `${hot.length} budget${hot.length > 1 ? 's' : ''} near or over the limit`,
          { description: hot.map((s) => s.category.name).join(', '), duration: 6000 }
        );
      }
    }
  }, [bills, budgets, categories, transactions, settings]);

  const themeIcon =
    settings.theme === 'dark' ? <Moon /> : settings.theme === 'light' ? <Sun /> : <SunMoon />;

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-56 flex-col shrink-0 border-r bg-sidebar text-sidebar-foreground sticky top-0 h-dvh">
        <Logo />
        <NavLinks />
        <div className="px-4 py-3 border-t">
          <button
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={() => ui.setShortcutsOpen(true)}
          >
            <Keyboard className="h-3.5 w-3.5" />
            Shortcuts
            <kbd className="ml-auto rounded border bg-muted px-1 text-[10px]">?</kbd>
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 backdrop-blur px-4 sm:px-6">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-64 flex flex-col bg-sidebar">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Logo />
              <NavLinks onNavigate={() => setMobileNavOpen(false)} />
            </SheetContent>
          </Sheet>

          {/* Search → command palette */}
          <button
            onClick={() => ui.setPaletteOpen(true)}
            className="flex items-center gap-2 w-full max-w-sm rounded-md border bg-card px-3 h-9 text-sm text-muted-foreground shadow-sm hover:bg-accent transition-colors cursor-pointer"
            aria-label="Search everything"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left truncate">Search or jump to…</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border bg-muted px-1.5 text-[10px] font-medium">
              Ctrl K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <SimpleTooltip label="Add income (I)">
              <Button variant="ghost" size="icon" onClick={() => ui.setQuickIncomeOpen(true)} aria-label="Add income">
                <TrendingUp />
              </Button>
            </SimpleTooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Theme">
                  {themeIcon}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSetting('theme', 'light')}>
                  <Sun /> Light
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSetting('theme', 'dark')}>
                  <Moon /> Dark
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSetting('theme', 'system')}>
                  <SunMoon /> System
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => ui.setQuickTxOpen(true)} size="sm" className="hidden sm:inline-flex">
              <Plus />
              Add transaction
            </Button>
          </div>
        </header>

        {/* Page */}
        <main className="flex-1 px-4 sm:px-6 py-6 max-w-[1400px] w-full mx-auto" key={location.pathname}>
          <Outlet />
        </main>
      </div>

      {/* Mobile floating action button */}
      <Button
        size="icon"
        onClick={() => ui.setQuickTxOpen(true)}
        aria-label="Add transaction"
        className="sm:hidden fixed bottom-5 right-5 z-40 h-12 w-12 rounded-full shadow-lg"
      >
        <Plus className="!h-5 !w-5" />
      </Button>

      {/* Global overlays */}
      <CommandPalette />
      <TransactionDialog open={ui.quickTxOpen} onOpenChange={ui.setQuickTxOpen} />
      <IncomeDialog open={ui.quickIncomeOpen} onOpenChange={ui.setQuickIncomeOpen} />
      <ShortcutsDialog />
      <Onboarding />
      <Toaster richColors closeButton position="bottom-right" theme={settings.theme} />
    </div>
  );
}
