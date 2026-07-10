/**
 * "Ask Aurum" — chat panel over the server's read-only finance tools
 * (server/chat.ts). Server backend only, and only once a Claude key is
 * connected in Settings; otherwise the trigger stays hidden.
 *
 * Conversation state lives here and is not persisted: the server is stateless
 * and receives the whole (bounded) history on each turn.
 */
import * as React from 'react';
import { Loader2, Send, Sparkles, Wrench } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { backendMode, getServerKey } from '@/data/api';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  failed?: boolean;
}

const SUGGESTIONS = [
  'How much did I spend on food last month?',
  'What are my biggest expenses this year?',
  'Am I on track with my budgets?',
];

/** Friendly names for the tools the assistant reports having run. */
const TOOL_LABEL: Record<string, string> = {
  get_overview: 'Read your overview',
  list_transactions: 'Searched transactions',
};

async function askServer(messages: Turn[]): Promise<{ reply: string; toolsUsed: string[] }> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-aurum-key': getServerKey() },
    body: JSON.stringify({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export function AskAurum() {
  const [available, setAvailable] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);

  // Only offer the assistant when the server has a Claude key configured.
  React.useEffect(() => {
    if (backendMode !== 'server') return;
    fetch('/api/ai/status', { headers: { 'x-aurum-key': getServerKey() } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setAvailable(!!s?.configured))
      .catch(() => setAvailable(false));
  }, []);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const next = [...turns, { role: 'user' as const, content: question }];
    setTurns(next);
    setDraft('');
    setBusy(true);
    try {
      const { reply, toolsUsed } = await askServer(next);
      setTurns([...next, { role: 'assistant', content: reply, toolsUsed }]);
    } catch (err) {
      setTurns([
        ...next,
        {
          role: 'assistant',
          content: err instanceof Error ? err.message : 'Something went wrong.',
          failed: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (!available) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SimpleTooltip label="Ask Aurum">
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Ask Aurum">
            <Sparkles />
          </Button>
        </SheetTrigger>
      </SimpleTooltip>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0 gap-0">
        <div className="px-5 py-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Ask Aurum
          </SheetTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Answers from your own data. It can read, not change.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {turns.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Try asking:</p>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="block w-full text-left text-sm rounded-lg border px-3 py-2 hover:bg-accent transition-colors cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : (
            turns.map((t, i) => (
              <div key={i} className={cn('flex', t.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'rounded-lg px-3 py-2 max-w-[85%] text-sm whitespace-pre-wrap break-words',
                    t.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : t.failed
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-muted'
                  )}
                >
                  {t.content}
                  {!!t.toolsUsed?.length && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {[...new Set(t.toolsUsed)].map((name) => (
                        <Badge key={name} variant="secondary" className="gap-1 text-[10px]">
                          <Wrench className="h-2.5 w-2.5" />
                          {TOOL_LABEL[name] ?? name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking through your finances…
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t p-3 flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            placeholder="Ask about your money…"
            rows={1}
            className="resize-none min-h-[38px] max-h-32"
            disabled={busy}
          />
          <Button size="icon" onClick={() => send(draft)} disabled={busy || !draft.trim()} aria-label="Send">
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
