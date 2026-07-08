/**
 * Settings card: daily server automation toggles. Only rendered on the
 * self-hosted server backend — the jobs run in the server process
 * (server/scheduler.ts). Money-moving jobs default OFF.
 */
import * as React from 'react';
import { Zap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useRefreshAll, useSettingRows } from '@/data/hooks';
import { api } from '@/data/api';

const TOGGLES = [
  {
    key: 'automation.autoPayBills',
    default: false,
    label: 'Auto-pay bills',
    desc: 'Bills marked auto-pay log their expense and advance on the due date',
  },
  {
    key: 'automation.postIncome',
    default: false,
    label: 'Post recurring income',
    desc: 'Income sources with a next pay date post their net pay automatically',
  },
  {
    key: 'automation.savingsSnapshots',
    default: true,
    label: 'Monthly savings snapshots',
    desc: 'Record every savings balance on the 1st for growth charts',
  },
  {
    key: 'automation.backups',
    default: true,
    label: 'Daily backups',
    desc: 'Keep a rotating 14-day set of JSON backups next to the database',
  },
  {
    key: 'automation.bankSync',
    default: true,
    label: 'Daily bank sync',
    desc: 'Pull new bank transactions once a day (when SimpleFIN is connected)',
  },
] as const;

export function AutomationCard() {
  const { data: settingRows = [] } = useSettingRows();
  const refreshAll = useRefreshAll();

  const enabled = (key: string, dflt: boolean) => {
    const row = settingRows.find((r) => r.key === key);
    if (!row) return dflt;
    try {
      return JSON.parse(row.value) === true;
    } catch {
      return dflt;
    }
  };

  async function toggle(key: string, value: boolean) {
    await api.setSetting(key, JSON.stringify(value));
    refreshAll();
  }

  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-4 w-4" /> Automation
        </CardTitle>
        <CardDescription>
          Runs once a day in your server — nothing needs to be open in a browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {TOGGLES.map((row, i) => (
          <React.Fragment key={row.key}>
            {i > 0 && <Separator />}
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{row.label}</p>
                <p className="text-xs text-muted-foreground">{row.desc}</p>
              </div>
              <Switch
                checked={enabled(row.key, row.default)}
                onCheckedChange={(v) => toggle(row.key, v)}
                aria-label={row.label}
              />
            </div>
          </React.Fragment>
        ))}
      </CardContent>
    </Card>
  );
}
