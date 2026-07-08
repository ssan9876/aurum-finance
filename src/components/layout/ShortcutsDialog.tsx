import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useUI } from '@/state/ui';

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Ctrl', 'K'], label: 'Command palette / search' },
  { keys: ['N'], label: 'Add transaction' },
  { keys: ['I'], label: 'Add income source' },
  { keys: ['G', 'D'], label: 'Go to Dashboard' },
  { keys: ['G', 'T'], label: 'Go to Transactions' },
  { keys: ['G', 'I'], label: 'Go to Income' },
  { keys: ['G', 'B'], label: 'Go to Budgets' },
  { keys: ['G', 'S'], label: 'Go to Savings' },
  { keys: ['G', 'O'], label: 'Go to Goals' },
  { keys: ['G', 'C'], label: 'Go to Calendar' },
  { keys: ['G', 'A'], label: 'Go to Analytics' },
  { keys: ['?'], label: 'Show this help' },
];

export function ShortcutsDialog() {
  const ui = useUI();
  return (
    <Dialog open={ui.shortcutsOpen} onOpenChange={ui.setShortcutsOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <ul className="space-y-2">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{s.label}</span>
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="inline-flex min-w-[22px] justify-center rounded border bg-muted px-1.5 py-0.5 text-[11px] font-medium"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
