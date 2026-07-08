/**
 * First-run experience: choose between starting fresh (categories and a
 * checking account are already seeded) or exploring with demo data.
 */
import * as React from 'react';
import { toast } from 'sonner';
import { Gem, Rocket, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/state/settings';
import { useRefreshAll, useTransactions } from '@/data/hooks';
import { loadDemoData } from '@/lib/demo';

export function Onboarding() {
  const { settings, ready, setSetting } = useSettings();
  const { data: transactions } = useTransactions();
  const refreshAll = useRefreshAll();
  const [loading, setLoading] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);

  const open =
    ready && !settings.onboarded && !dismissed && transactions !== undefined && transactions.length === 0;

  const finish = () => {
    setSetting('onboarded', true);
    setDismissed(true);
  };

  async function handleDemo() {
    setLoading(true);
    try {
      await loadDemoData();
      refreshAll();
      finish();
      toast.success('Demo data loaded', {
        description: 'Explore freely — you can wipe it any time from Settings.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load demo data');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && finish()}>
      <DialogContent className="max-w-md text-center" aria-describedby={undefined}>
        <div className="mx-auto mt-2 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-lg">
          <Gem className="h-7 w-7" />
        </div>
        <DialogHeader className="text-center sm:text-center">
          <DialogTitle className="text-xl">Welcome to Aurum</DialogTitle>
          <DialogDescription>
            Your money, entirely on your machine. Track spending, budgets, bills, savings and
            goals — no account, no cloud, no tracking.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 mt-2">
          <Button onClick={handleDemo} loading={loading} size="lg" className="w-full">
            <Sparkles />
            Explore with demo data
          </Button>
          <Button onClick={finish} variant="outline" size="lg" className="w-full" disabled={loading}>
            <Rocket />
            Start fresh
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Tip: press <kbd className="rounded border bg-muted px-1">Ctrl K</kbd> anywhere to search and
          jump around.
        </p>
      </DialogContent>
    </Dialog>
  );
}
