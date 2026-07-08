/**
 * Create/edit dialog for income sources with a live monthly/annual preview.
 *
 * Pay can be entered as gross + net: typing gross (with a deduction %) fills
 * net automatically, and correcting net by hand re-derives the effective
 * deduction rate. Only net (`amount`) drives the income math everywhere else;
 * gross is stored for reference and the % is always derived, never persisted.
 */
import * as React from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ColorPicker, DateField, Field, MoneyInput } from '@/components/shared';
import { FREQUENCIES } from '@/shared/defaults';
import { toMonthly, toYearly } from '@/lib/finance';
import { useSettings } from '@/state/settings';
import { useCreateEntity, useUpdateEntity } from '@/data/hooks';
import { round2 } from '@/lib/utils';
import type { Frequency, IncomeSource } from '@/shared/types';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  amount: z.number({ invalid_type_error: 'Enter a net amount' }).positive('Net pay must be above zero'),
});

export function IncomeDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: IncomeSource | null;
}) {
  const { fmtMoney } = useSettings();
  const create = useCreateEntity('incomeSource');
  const update = useUpdateEntity('incomeSource');
  const isEdit = !!source;

  const [name, setName] = React.useState('');
  const [gross, setGross] = React.useState<number | ''>('');
  const [deductPct, setDeductPct] = React.useState<number | ''>('');
  const [amount, setAmount] = React.useState<number | ''>('');
  const [frequency, setFrequency] = React.useState<Frequency>('monthly');
  const [active, setActive] = React.useState(true);
  const [nextPayDate, setNextPayDate] = React.useState<string | null>(null);
  const [color, setColor] = React.useState('#2a78d6');
  const [notes, setNotes] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    setErrors({});
    setName(source?.name ?? '');
    setGross(source?.grossAmount ?? '');
    setAmount(source?.amount ?? '');
    setDeductPct(
      source?.grossAmount && source.grossAmount > 0
        ? round2((1 - source.amount / source.grossAmount) * 100)
        : ''
    );
    setFrequency(source?.frequency ?? 'monthly');
    setActive(source?.active ?? true);
    setNextPayDate(source?.nextPayDate ?? null);
    setColor(source?.color ?? '#2a78d6');
    setNotes(source?.notes ?? '');
  }, [open, source]);

  // Whichever pair the user typed last wins; the third value follows.
  function handleGrossChange(g: number | '') {
    setGross(g);
    if (g === '' || g <= 0) return;
    if (deductPct !== '') setAmount(round2(g * (1 - deductPct / 100)));
    else if (amount !== '') setDeductPct(round2((1 - amount / g) * 100));
  }
  function handlePctChange(p: number | '') {
    setDeductPct(p);
    if (p !== '' && gross !== '' && gross > 0) setAmount(round2(gross * (1 - p / 100)));
  }
  function handleNetChange(n: number | '') {
    setAmount(n);
    if (n !== '' && gross !== '' && gross > 0) setDeductPct(round2((1 - n / gross) * 100));
  }

  const monthly = amount === '' ? 0 : toMonthly(amount, frequency);
  const yearly = amount === '' ? 0 : toYearly(amount, frequency);
  const hasGross = gross !== '' && gross > 0;

  async function handleSave() {
    const parsed = schema.safeParse({ name, amount: amount === '' ? undefined : amount });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[issue.path[0] as string] = issue.message;
      setErrors(next);
      return;
    }
    if (gross !== '' && gross < parsed.data.amount) {
      setErrors({ gross: 'Gross pay can’t be below net pay' });
      return;
    }
    const data = {
      name: parsed.data.name,
      amount: parsed.data.amount,
      grossAmount: gross === '' ? null : gross,
      frequency,
      active,
      nextPayDate,
      color,
      notes: notes || null,
    };
    try {
      if (isEdit && source) {
        await update.mutateAsync({ id: source.id, data });
        toast.success('Income source updated');
      } else {
        await create.mutateAsync(data);
        toast.success('Income source added');
      }
      onOpenChange(false);
    } catch {
      /* handled by hook */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit income source' : 'Add income source'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Field label="Name" required error={errors.name} className="flex-1">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Corp — Salary" autoFocus />
            </Field>
            <Field label="Color">
              <ColorPicker value={color} onChange={setColor} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Gross pay" hint="Before taxes — optional" error={errors.gross}>
              <MoneyInput value={gross} onChange={handleGrossChange} />
            </Field>
            <Field label="Deductions" hint="Auto-fills net from gross">
              <div className="relative">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  max="100"
                  className="pr-8 tabular-nums"
                  value={deductPct}
                  onChange={(e) => handlePctChange(e.target.value === '' ? '' : Number(e.target.value))}
                  aria-label="Deductions percent"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                  %
                </span>
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Net pay (take-home)" required error={errors.amount}>
              <MoneyInput value={amount} onChange={handleNetChange} />
            </Field>
            <Field label="Pay frequency">
              <Select value={frequency} onValueChange={(v) => setFrequency(v as Frequency)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Next pay date" hint="Used on the calendar">
              <DateField value={nextPayDate} onChange={setNextPayDate} />
            </Field>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <Switch checked={active} onCheckedChange={setActive} />
                Active
              </label>
            </div>
          </div>

          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>

          {/* Live calculation preview */}
          <div className="rounded-lg bg-muted/60 p-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Monthly take-home</p>
              <p className="font-semibold tabular-nums">{fmtMoney(monthly)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Annual take-home</p>
              <p className="font-semibold tabular-nums">{fmtMoney(yearly)}</p>
            </div>
            {hasGross && (
              <>
                <div>
                  <p className="text-xs text-muted-foreground">Annual gross</p>
                  <p className="font-semibold tabular-nums">{fmtMoney(toYearly(gross, frequency))}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Deductions / yr</p>
                  <p className="font-semibold tabular-nums">
                    −{fmtMoney(toYearly(round2(gross - (amount === '' ? 0 : amount)), frequency))}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={create.isPending || update.isPending}>
            {isEdit ? 'Save changes' : 'Add income'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
