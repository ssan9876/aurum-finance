/**
 * Settings: appearance (theme + accent), localization, notifications and the
 * data section (backup/restore, exports, demo data, wipe).
 */
import * as React from 'react';
import { toast } from 'sonner';
import {
  Bell,
  Check,
  Database,
  Download,
  FileUp,
  Globe,
  HardDrive,
  Laptop,
  Moon,
  Paintbrush,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog, Field, PageHeader } from '@/components/shared';
import { RulesCard } from '@/components/settings/RulesCard';
import { BankSyncCard } from '@/components/settings/BankSyncCard';
import { AutomationCard } from '@/components/settings/AutomationCard';
import { AiCard } from '@/components/settings/AiCard';
import { DigestCard } from '@/components/settings/DigestCard';
import { useSettings } from '@/state/settings';
import { useAccounts, useCategories, useRefreshAll, useTransactions } from '@/data/hooks';
import { api, backendMode } from '@/data/api';
import { downloadBackup, exportTransactionsCsv, exportTransactionsXlsx, restoreBackupFromFile } from '@/lib/csv';
import { loadDemoData } from '@/lib/demo';
import { ACCENTS, CURRENCIES, DATE_FORMATS, type Accent } from '@/shared/defaults';
import { ENTITIES } from '@/shared/types';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const ACCENT_PREVIEW: Record<Accent, string> = {
  indigo: '#4f46e5',
  violet: '#7c3aed',
  blue: '#1d6fd8',
  emerald: '#0b8457',
  rose: '#d02752',
  amber: '#c2610a',
};

export default function Settings() {
  const { settings, setSetting, fmtDate } = useSettings();
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const refreshAll = useRefreshAll();

  const [wipeOpen, setWipeOpen] = React.useState(false);
  const [restoreFile, setRestoreFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [demoConfirm, setDemoConfirm] = React.useState(false);

  async function handleRestore() {
    if (!restoreFile) return;
    setBusy(true);
    try {
      await restoreBackupFromFile(restoreFile);
      refreshAll();
      toast.success('Backup restored');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setBusy(false);
      setRestoreFile(null);
    }
  }

  async function handleWipe() {
    setBusy(true);
    try {
      // Restoring an empty payload clears everything, then defaults reseed on next launch.
      for (const entity of [...ENTITIES].reverse()) {
        const rows = await api.list(entity);
        if (rows.length) await api.removeMany(entity, rows.map((r) => r.id));
      }
      refreshAll();
      toast.success('All data erased', { description: 'Restart the app to reseed default categories.' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not erase data');
    } finally {
      setBusy(false);
      setWipeOpen(false);
    }
  }

  async function handleDemo() {
    setBusy(true);
    try {
      await loadDemoData();
      refreshAll();
      toast.success('Demo data loaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load demo data');
    } finally {
      setBusy(false);
      setDemoConfirm(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" description="Appearance, formats, notifications and your data." />

      <div className="space-y-6">
        {/* Appearance */}
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Paintbrush className="h-4 w-4" /> Appearance
            </CardTitle>
            <CardDescription>Theme and accent color apply instantly.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="text-sm font-medium mb-2">Theme</p>
              <div className="grid grid-cols-3 gap-2 max-w-sm">
                {(
                  [
                    { value: 'light', label: 'Light', icon: <Sun className="h-4 w-4" /> },
                    { value: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" /> },
                    { value: 'system', label: 'System', icon: <Laptop className="h-4 w-4" /> },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setSetting('theme', t.value)}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium cursor-pointer transition-colors',
                      settings.theme === t.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'hover:bg-accent text-muted-foreground'
                    )}
                    aria-pressed={settings.theme === t.value}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Accent color</p>
              <div className="flex gap-2">
                {ACCENTS.map((a) => (
                  <button
                    key={a}
                    onClick={() => setSetting('accent', a)}
                    className={cn(
                      'h-8 w-8 rounded-full cursor-pointer inline-flex items-center justify-center transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      settings.accent === a && 'ring-2 ring-ring ring-offset-2 ring-offset-card'
                    )}
                    style={{ backgroundColor: ACCENT_PREVIEW[a] }}
                    aria-label={`Accent ${a}`}
                    aria-pressed={settings.accent === a}
                  >
                    {settings.accent === a && <Check className="h-4 w-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Localization */}
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-4 w-4" /> Localization
            </CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-4">
            <Field label="Currency">
              <Select value={settings.currency} onValueChange={(v) => setSetting('currency', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} — {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Date format" hint={`Today: ${fmtDate(new Date())}`}>
              <Select value={settings.dateFormat} onValueChange={(v) => setSetting('dateFormat', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_FORMATS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {format(new Date(), f)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4" /> Notifications
            </CardTitle>
            <CardDescription>Shown as toasts when you open the app.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(
              [
                { key: 'notifications', label: 'Enable notifications', desc: 'Master switch for all reminders' },
                { key: 'billReminders', label: 'Bill reminders', desc: 'Warn before bills hit their due date' },
                { key: 'budgetAlerts', label: 'Budget alerts', desc: 'Warn when a budget passes 90%' },
              ] as const
            ).map((row, i) => (
              <React.Fragment key={row.key}>
                {i > 0 && <Separator />}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{row.label}</p>
                    <p className="text-xs text-muted-foreground">{row.desc}</p>
                  </div>
                  <Switch
                    checked={settings[row.key]}
                    onCheckedChange={(v) => setSetting(row.key, v)}
                    disabled={row.key !== 'notifications' && !settings.notifications}
                    aria-label={row.label}
                  />
                </div>
              </React.Fragment>
            ))}
          </CardContent>
        </Card>

        {/* Auto-categorization rules */}
        <RulesCard />

        {/* Server-only: bank sync, automation, Claude */}
        {backendMode === 'server' && (
          <>
            <BankSyncCard />
            <AutomationCard />
            <AiCard />
            <DigestCard />
          </>
        )}

        {/* Data */}
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4" /> Data
            </CardTitle>
            <CardDescription>
              Everything lives{' '}
              {backendMode === 'desktop'
                ? 'in a local SQLite database on this machine'
                : backendMode === 'server'
                  ? "in your self-hosted server's SQLite database"
                  : "in this browser's local storage"}{' '}
              — nothing ever leaves your network.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => downloadBackup()}>
                <Download /> Download JSON backup
              </Button>
              <label>
                <Button variant="outline" asChild>
                  <span className="cursor-pointer">
                    <FileUp /> Restore backup…
                  </span>
                </Button>
                <input
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setRestoreFile(f);
                    e.target.value = '';
                  }}
                />
              </label>
              <Button variant="outline" onClick={() => exportTransactionsCsv(transactions, categories, accounts)}>
                <Download /> Export CSV
              </Button>
              <Button variant="outline" onClick={() => exportTransactionsXlsx(transactions, categories, accounts)}>
                <Download /> Export Excel
              </Button>
              <Button variant="outline" onClick={() => setDemoConfirm(true)}>
                <Sparkles /> Load demo data
              </Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-destructive">Erase all data</p>
                <p className="text-xs text-muted-foreground">
                  Deletes every transaction, account, budget, bill, goal and setting.
                </p>
              </div>
              <Button variant="destructive" onClick={() => setWipeOpen(true)}>
                <Trash2 /> Erase
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* About */}
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" /> About
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p className="flex items-center gap-2">
              Aurum <Badge variant="secondary">v1.11.0</Badge>
              <Badge variant="outline">
                {backendMode === 'desktop'
                  ? 'Desktop · SQLite'
                  : backendMode === 'server'
                    ? 'Self-hosted · SQLite'
                    : 'Browser · Local storage'}
              </Badge>
            </p>
            <p>
              Local-first personal finance. The storage layer is adapter-based, so cloud sync, bank
              imports (Plaid) and multi-device support can plug in later without changing the app.
            </p>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={!!restoreFile}
        onOpenChange={(o) => !o && setRestoreFile(null)}
        title="Restore this backup?"
        description={`"${restoreFile?.name}" will replace ALL current data. Consider downloading a backup of the current state first.`}
        confirmLabel={busy ? 'Restoring…' : 'Replace everything'}
        onConfirm={handleRestore}
      />
      <ConfirmDialog
        open={wipeOpen}
        onOpenChange={setWipeOpen}
        title="Erase all data?"
        description="This permanently deletes everything. Download a backup first if you might want it back."
        confirmLabel={busy ? 'Erasing…' : 'Erase everything'}
        onConfirm={handleWipe}
      />
      <ConfirmDialog
        open={demoConfirm}
        onOpenChange={setDemoConfirm}
        title="Load demo data?"
        description="Adds ~8 months of sample transactions, budgets, bills, savings and goals on top of your current data."
        confirmLabel={busy ? 'Loading…' : 'Load demo data'}
        destructive={false}
        onConfirm={handleDemo}
      />
    </div>
  );
}
