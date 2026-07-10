/**
 * Settings card: connect Aurum to the Claude API. Server backend only — the
 * key is stored and used server-side (server/ai.ts) and is never sent back to
 * the browser, so this card can only ever report whether one is configured.
 */
import * as React from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Link2, Sparkles, Unlink } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Field } from '@/components/shared';
import { getServerKey } from '@/data/api';

interface AiModel {
  id: string;
  label: string;
  hint: string;
}

interface AiStatus {
  configured: boolean;
  model: string;
  models: AiModel[];
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/ai/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-aurum-key': getServerKey() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function AiCard() {
  const [status, setStatus] = React.useState<AiStatus | null>(null);
  const [apiKey, setApiKey] = React.useState('');
  const [model, setModel] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    call<AiStatus>('status')
      .then((s) => {
        setStatus(s);
        setModel(s.model);
      })
      .catch(() => setStatus(null));
  }, []);

  async function handleConnect() {
    setBusy(true);
    try {
      const res = await call<{ model: string }>('connect', { apiKey, model });
      setStatus((s) => (s ? { ...s, configured: true, model: res.model } : s));
      setApiKey('');
      toast.success('Claude connected', { description: `Verified against ${res.model}.` });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not connect');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await call('disconnect', {});
      setStatus((s) => (s ? { ...s, configured: false } : s));
      toast.success('Claude disconnected', { description: 'The stored API key was cleared.' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not disconnect');
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    try {
      await call('test', {});
      toast.success('Claude is responding');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Claude did not respond');
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Claude
          {status.configured && (
            <Badge variant="success" className="ml-1 gap-1">
              <CheckCircle2 className="h-3 w-3" /> Connected
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Powers the smarter features — categorizing cryptic bank strings, reading receipts and
          answering questions about your money. Your key stays on the server.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!status.configured ? (
          <>
            <Field label="Anthropic API key" hint="Create one at console.anthropic.com">
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-…"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label="Model">
              <Select value={model || undefined} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a model" />
                </SelectTrigger>
                <SelectContent>
                  {status.models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label} · {m.hint}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Button onClick={handleConnect} loading={busy} disabled={!apiKey.trim()}>
              <Link2 /> Connect
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Using{' '}
              <span className="font-medium text-foreground">
                {status.models.find((m) => m.id === status.model)?.label ?? status.model}
              </span>
              . Reconnect with a new key to change models.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleTest} disabled={busy}>
                <Sparkles /> Test
              </Button>
              <Button variant="outline" onClick={handleDisconnect} disabled={busy}>
                <Unlink /> Disconnect
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
