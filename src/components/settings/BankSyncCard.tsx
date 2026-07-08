/**
 * Settings card: SimpleFIN Bridge bank sync. Only rendered on the self-hosted
 * server backend — the server holds the access credentials and does the
 * polling (manual "Sync now" here, plus the daily automation job).
 */
import * as React from 'react';
import { toast } from 'sonner';
import { Landmark, Link2, RefreshCcw, Unlink } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/shared';
import { useSettings } from '@/state/settings';
import { useRefreshAll } from '@/data/hooks';
import { getServerKey } from '@/data/api';

interface SyncStatus {
  connected: boolean;
  lastSync: string | null;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/simplefin/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-aurum-key': getServerKey() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function BankSyncCard() {
  const { fmtDate } = useSettings();
  const refreshAll = useRefreshAll();
  const [status, setStatus] = React.useState<SyncStatus | null>(null);
  const [token, setToken] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    call<SyncStatus>('status').then(setStatus).catch(() => setStatus(null));
  }, []);

  async function handleConnect() {
    setBusy(true);
    try {
      const res = await call<{ accounts: string[] }>('connect', { token });
      setStatus({ connected: true, lastSync: null });
      setToken('');
      toast.success('Bank connected', {
        description: res.accounts.length
          ? `Found: ${res.accounts.join(', ')}. Run a sync to pull transactions.`
          : 'Run a sync to pull transactions.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not connect');
    } finally {
      setBusy(false);
    }
  }

  async function handleSync() {
    setBusy(true);
    try {
      const res = await call<{ created: number; duplicatesSkipped: number; autoCategorized: number; syncedAt: string }>('sync', {});
      setStatus({ connected: true, lastSync: res.syncedAt });
      refreshAll();
      toast.success(
        res.created
          ? `Imported ${res.created} new transactions${res.autoCategorized ? ` · ${res.autoCategorized} auto-categorized` : ''}`
          : 'Already up to date — no new transactions.'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await call('disconnect', {});
      setStatus({ connected: false, lastSync: null });
      toast.success('Bank sync disconnected', { description: 'Imported transactions are kept.' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not disconnect');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="h-4 w-4" /> Bank sync
          {status?.connected && <Badge variant="secondary">Connected</Badge>}
        </CardTitle>
        <CardDescription>
          Pull transactions straight from your bank via{' '}
          <a
            className="underline underline-offset-2 hover:text-foreground"
            href="https://bridge.simplefin.org"
            target="_blank"
            rel="noreferrer"
          >
            SimpleFIN Bridge
          </a>
          . New rows dedupe against existing data and pick up your auto-categorization rules.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status === null ? (
          <p className="text-sm text-muted-foreground">Checking status…</p>
        ) : !status.connected ? (
          <>
            <Field
              label="Setup token"
              hint="Create one at bridge.simplefin.org → Connect an app, then paste it here (single-use)."
            >
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your SimpleFIN setup token"
              />
            </Field>
            <Button onClick={handleConnect} loading={busy} disabled={!token.trim()}>
              <Link2 /> Connect
            </Button>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleSync} loading={busy}>
              <RefreshCcw /> Sync now
            </Button>
            <Button variant="outline" onClick={handleDisconnect} disabled={busy}>
              <Unlink /> Disconnect
            </Button>
            <p className="text-xs text-muted-foreground basis-full">
              {status.lastSync
                ? `Last synced ${fmtDate(status.lastSync)} · also runs automatically once a day.`
                : 'Never synced — click Sync now to pull the last 90 days.'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
