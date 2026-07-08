/**
 * Settings card: view and prune the learned merchant → category rules that
 * auto-categorize imports, quick-add and AI-entered transactions.
 */
import * as React from 'react';
import { toast } from 'sonner';
import { Trash2, Wand2, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCategories, useRefreshAll, useSettingRows } from '@/data/hooks';
import { api } from '@/data/api';
import { RULES_KEY, parseRules, type CategoryRule } from '@/lib/rules';

export function RulesCard() {
  const { data: settingRows = [] } = useSettingRows();
  const { data: categories = [] } = useCategories();
  const refreshAll = useRefreshAll();

  const rules = React.useMemo(
    () => parseRules(settingRows.find((r) => r.key === RULES_KEY)?.value),
    [settingRows]
  );
  const entries = Object.entries(rules).sort((a, b) => b[1].at - a[1].at);

  const categoryLabel = (rule: CategoryRule) => {
    const root = categories.find((c) => c.id === rule.categoryId);
    if (!root) return '(deleted category)';
    const sub = rule.subcategoryId ? categories.find((c) => c.id === rule.subcategoryId) : null;
    return sub ? `${root.name} › ${sub.name}` : root.name;
  };

  async function removeRule(key: string) {
    const next = { ...rules };
    delete next[key];
    await api.setSetting(RULES_KEY, JSON.stringify(next));
    refreshAll();
  }

  async function clearAll() {
    await api.setSetting(RULES_KEY, '{}');
    refreshAll();
    toast.success('All rules cleared');
  }

  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="h-4 w-4" /> Auto-categorization
        </CardTitle>
        <CardDescription>
          Aurum learns merchant → category pairs whenever you categorize a transaction, then applies
          them to file imports, bank sync, quick-add and AI-entered transactions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rules learned yet — categorize a few transactions and they'll appear here.
          </p>
        ) : (
          <>
            <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
              {entries.map(([merchant, rule]) => (
                <div key={merchant} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                  <span className="truncate capitalize">{merchant}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="text-muted-foreground">{categoryLabel(rule)}</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete rule for ${merchant}`}
                      onClick={() => removeRule(merchant)}
                    >
                      <X />
                    </Button>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-3">
              <p className="text-xs text-muted-foreground">
                {entries.length} rule{entries.length === 1 ? '' : 's'}
              </p>
              <Button variant="outline" size="sm" onClick={clearAll}>
                <Trash2 /> Clear all
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
