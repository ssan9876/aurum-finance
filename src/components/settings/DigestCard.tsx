/**
 * Settings card: the weekly digest. Server backend only — the summary is built
 * and delivered by the server (server/digest.ts), on Sunday evening.
 *
 * Sending posts the user's financial summary to an outside service, so the
 * automation toggle lives in the Automation card and defaults off; here you set
 * the destination, preview exactly what would be sent, and fire a test.
 */
import * as React from 'react';
import { toast } from 'sonner';
import { Eye, Mail, Send } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/shared';
import { getServerKey } from '@/data/api';

interface DigestStatus {
  webhookUrl: string;
  lastSentWeek: string | null;
  aiNarration: boolean;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/digest/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-aurum-key': getServerKey() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function DigestCard() {
  const [status, setStatus] = React.useState<DigestStatus | null>(null);
  const [url, setUrl] = React.useState('');
  const [preview, setPreview] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    call<DigestStatus>('status')
      .then((s) => {
        setStatus(s);
        setUrl(s.webhookUrl);
      })
      .catch(() => setStatus(null));
  }, []);

  async function save() {
    setBusy(true);
    try {
      await call<{ webhookUrl: string }>('webhook', { url });
      setStatus((s) => (s ? { ...s, webhookUrl: url } : s));
      toast.success(url ? 'Webhook saved' : 'Webhook cleared');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function showPreview() {
    setBusy(true);
    try {
      const { text } = await call<{ text: string }>('preview');
      setPreview(text);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not build the digest');
    } finally {
      setBusy(false);
    }
  }

  async function sendNow() {
    setBusy(true);
    try {
      await call('send', {});
      toast.success('Digest sent', { description: 'Check your webhook destination.' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-4 w-4" /> Weekly digest
          {status.aiNarration && (
            <Badge variant="secondary" className="ml-1">
              AI intro
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          A short summary of your week — spending, budgets, renewals and anything unusual — posted to
          a webhook on Sunday evening. Enable “Weekly digest” under Automation to send it
          automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field
          label="Webhook URL"
          hint="Anything that accepts a POST — ntfy.sh, Discord, Slack, Home Assistant"
        >
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://ntfy.sh/my-aurum-topic"
              spellCheck={false}
            />
            <Button variant="outline" onClick={save} disabled={busy || url === status.webhookUrl}>
              Save
            </Button>
          </div>
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={showPreview} disabled={busy}>
            <Eye /> Preview
          </Button>
          <Button variant="outline" onClick={sendNow} disabled={busy || !status.webhookUrl}>
            <Send /> Send now
          </Button>
        </div>

        {status.lastSentWeek && (
          <p className="text-xs text-muted-foreground">Last sent for week {status.lastSentWeek}.</p>
        )}

        {preview && (
          <pre className="rounded-lg bg-muted/60 p-3 text-xs whitespace-pre-wrap font-sans max-h-64 overflow-y-auto">
            {preview}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
