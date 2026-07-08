/**
 * App-level building blocks shared across pages: page headers, stat cards,
 * empty states, confirm dialogs, money/date/color/icon/tag inputs.
 */
import * as React from 'react';
import { format } from 'date-fns';
import { Palette, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettings } from '@/state/settings';
import { COLOR_SWATCHES } from '@/shared/defaults';
import { ICON_NAMES, EntityIcon } from '@/lib/icons';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Category } from '@/shared/types';

/* -------------------------------- PageHeader ------------------------------ */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6 animate-fade-up">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/* --------------------------------- StatCard ------------------------------- */

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = 'default',
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'default' | 'positive' | 'negative';
  className?: string;
}) {
  return (
    <Card className={cn('p-5 hover:shadow-card-hover transition-shadow', className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        {icon && (
          <span className="rounded-md bg-primary/10 text-primary p-1.5 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
        )}
      </div>
      <p
        className={cn(
          'mt-2 text-2xl font-semibold tracking-tight tabular-nums',
          tone === 'positive' && 'text-success',
          tone === 'negative' && 'text-destructive'
        )}
      >
        {value}
      </p>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

/* -------------------------------- EmptyState ------------------------------ */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center py-14 px-6', className)}>
      <div className="rounded-2xl bg-muted p-4 mb-4 text-muted-foreground [&_svg]:h-8 [&_svg]:w-8">{icon}</div>
      <h3 className="font-semibold text-base">{title}</h3>
      {description && <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------- ConfirmDialog ---------------------------- */

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  destructive = true,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction destructive={destructive} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* --------------------------------- Amount --------------------------------- */

export function Amount({
  value,
  type,
  className,
  compact,
}: {
  value: number;
  type?: 'income' | 'expense' | 'transfer';
  className?: string;
  compact?: boolean;
}) {
  const { fmtMoney } = useSettings();
  const signed = type === 'income' ? value : type === 'expense' ? -value : value;
  return (
    <span
      className={cn(
        'tabular-nums font-medium',
        type === 'income' && 'text-success',
        type === 'transfer' && 'text-muted-foreground',
        className
      )}
    >
      {type === 'income' ? '+' : type === 'expense' ? '−' : ''}
      {fmtMoney(Math.abs(signed), { compact })}
    </span>
  );
}

/* -------------------------------- MoneyInput ------------------------------ */

export const MoneyInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
    value: number | '';
    onChange: (v: number | '') => void;
  }
>(({ value, onChange, className, ...props }, ref) => {
  const { settings } = useSettings();
  const symbol = React.useMemo(() => {
    const parts = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: settings.currency,
    }).formatToParts(1);
    return parts.find((p) => p.type === 'currency')?.value ?? '$';
  }, [settings.currency]);
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
        {symbol}
      </span>
      <Input
        ref={ref}
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        className={cn('pl-8 tabular-nums', className)}
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        {...props}
      />
    </div>
  );
});
MoneyInput.displayName = 'MoneyInput';

/* --------------------------------- DateField ------------------------------ */

export function DateField({
  value,
  onChange,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string | null | undefined; // ISO or empty
  onChange: (iso: string | null) => void;
}) {
  const asInput = value ? format(new Date(value), 'yyyy-MM-dd') : '';
  return (
    <Input
      type="date"
      className={cn('tabular-nums', className)}
      value={asInput}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v ? new Date(v + 'T12:00:00').toISOString() : null);
      }}
      {...props}
    />
  );
}

/* -------------------------------- ColorPicker ----------------------------- */

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-9 w-9 rounded-md border shadow-sm shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
          style={{ backgroundColor: value }}
          aria-label="Pick color"
        />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="start">
        <div className="grid grid-cols-6 gap-2">
          {COLOR_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className={cn(
                'h-7 w-7 rounded-md cursor-pointer transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                value === c && 'ring-2 ring-ring ring-offset-2 ring-offset-popover'
              )}
              style={{ backgroundColor: c }}
              onClick={() => onChange(c)}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3 pt-3 border-t">
          <Palette className="h-4 w-4 text-muted-foreground" />
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-7 w-full cursor-pointer rounded border bg-transparent"
            aria-label="Custom color"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------- IconPicker ------------------------------ */

export function IconPicker({
  value,
  onChange,
  color,
}: {
  value: string;
  onChange: (icon: string) => void;
  color?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-9 w-9 rounded-md border shadow-sm shrink-0 inline-flex items-center justify-center hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
          aria-label="Pick icon"
        >
          <EntityIcon name={value} className="h-4 w-4" style={color ? { color } : undefined} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 max-h-64 overflow-y-auto" align="start">
        <div className="grid grid-cols-7 gap-1">
          {ICON_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              className={cn(
                'h-8 w-8 rounded-md inline-flex items-center justify-center hover:bg-accent cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                value === name && 'bg-primary/15 text-primary'
              )}
              onClick={() => onChange(name)}
              aria-label={name}
            >
              <EntityIcon name={name} className="h-4 w-4" />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* --------------------------------- TagInput ------------------------------- */

export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = 'Add tag…',
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}) {
  const [draft, setDraft] = React.useState('');
  const add = (tag: string) => {
    const t = tag.trim().toLowerCase();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft('');
  };
  const filtered = suggestions.filter(
    (s) => s.toLowerCase().includes(draft.toLowerCase()) && !value.includes(s)
  );
  return (
    <div className="rounded-md border border-input px-2 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-ring">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((t) => (
          <Badge key={t} variant="secondary" className="gap-1">
            {t}
            <button
              type="button"
              className="ml-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => onChange(value.filter((x) => x !== t))}
              aria-label={`Remove tag ${t}`}
            >
              ×
            </button>
          </Badge>
        ))}
        <input
          className="flex-1 min-w-[80px] bg-transparent text-sm outline-none placeholder:text-muted-foreground h-6"
          value={draft}
          placeholder={value.length === 0 ? placeholder : ''}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => draft && add(draft)}
        />
      </div>
      {draft && filtered.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t">
          {filtered.slice(0, 6).map((s) => (
            <button
              key={s}
              type="button"
              className="text-xs px-2 py-0.5 rounded-full bg-muted hover:bg-accent cursor-pointer"
              onClick={() => add(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- CategoryChip ----------------------------- */

export function CategoryChip({ category, className }: { category?: Category | null; className?: string }) {
  if (!category)
    return <span className={cn('text-xs text-muted-foreground', className)}>Uncategorized</span>;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        className
      )}
      style={{ backgroundColor: `${category.color}1f`, color: category.color }}
    >
      <EntityIcon name={category.icon} className="h-3 w-3" />
      {category.name}
    </span>
  );
}

/* -------------------------------- SearchInput ----------------------------- */

export const SearchInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <div className={cn('relative', className)}>
    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
    <Input ref={ref} className="pl-8" {...props} />
  </div>
));
SearchInput.displayName = 'SearchInput';

/* ------------------------------ FieldWrapper ------------------------------ */

export function Field({
  label,
  children,
  error,
  hint,
  required,
  className,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="text-sm font-medium leading-none">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
