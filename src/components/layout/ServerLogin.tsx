/**
 * Password gate shown when a self-hosted Aurum server requires auth
 * (AURUM_PASSWORD set). Renders before the app tree, outside all providers.
 */
import * as React from 'react';
import { Gem, Loader2 } from 'lucide-react';
import { setServerKey } from '@/data/api';

export function ServerLogin() {
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setServerKey(password);
        location.reload();
      } else {
        setError('Wrong password — try again.');
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-xs rounded-xl border bg-card p-6 shadow-card text-center space-y-4 animate-fade-up"
      >
        <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow">
          <Gem className="h-6 w-6" />
        </span>
        <div>
          <h1 className="font-semibold text-lg">Aurum</h1>
          <p className="text-sm text-muted-foreground">This server is password protected.</p>
        </div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Server password"
          aria-label="Server password"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !password}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 h-9 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Unlock
        </button>
      </form>
    </div>
  );
}
