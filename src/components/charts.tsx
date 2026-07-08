/**
 * Themed Recharts wrappers. Colors come from the CSS custom properties in
 * index.css (validated categorical palette with separate dark-mode steps);
 * `useChartColors` resolves them to concrete values and re-resolves when the
 * theme class flips, so charts repaint correctly on theme change.
 */
import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useSettings } from '@/state/settings';
import { cn } from '@/lib/utils';

/* ------------------------- theme-reactive colors -------------------------- */

let themeVersion = 0;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  const observer = new MutationObserver(() => {
    themeVersion++;
    listeners.forEach((l) => l());
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

function useThemeVersion() {
  return React.useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => themeVersion
  );
}

export function useChartColors() {
  const version = useThemeVersion();
  return React.useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    return {
      series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => get(`--chart-${i}`, '#2a78d6')),
      grid: get('--chart-grid', '#e7e6e0'),
      axis: get('--chart-axis', '#898781'),
      positive: get('--chart-positive', '#1baf7a'),
      negative: get('--chart-negative', '#e34948'),
      primary: `hsl(${get('--primary', '243 66% 54%')})`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
}

/* ------------------------------ tooltip shell ----------------------------- */

interface TooltipRow {
  name: string;
  value: number;
  color?: string;
}

function TooltipShell({ label, rows }: { label?: React.ReactNode; rows: TooltipRow[] }) {
  const { fmtMoney } = useSettings();
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 shadow-md text-xs min-w-[140px]">
      {label != null && <p className="font-medium mb-1.5 text-muted-foreground">{label}</p>}
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {r.color && (
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
              )}
              {r.name}
            </span>
            <span className="font-medium tabular-nums text-foreground">{fmtMoney(r.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function moneyTooltip() {
  return function Content({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    return (
      <TooltipShell
        label={label}
        rows={payload.map((p: any) => ({ name: p.name, value: p.value ?? 0, color: p.color || p.fill }))}
      />
    );
  };
}

const axisProps = (axis: string) => ({
  stroke: 'transparent',
  tick: { fill: axis, fontSize: 11 },
  tickLine: false,
  axisLine: false,
});

function compactMoney(currency: string) {
  const fmt = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  return (v: number) => fmt.format(v);
}

/* --------------------------------- charts --------------------------------- */

export function IncomeExpenseChart({
  data,
  height = 260,
}: {
  data: { label: string; income: number; expense: number }[];
  height?: number;
}) {
  const c = useChartColors();
  const { settings } = useSettings();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} barGap={2} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={c.grid} />
        <XAxis dataKey="label" {...axisProps(c.axis)} />
        <YAxis {...axisProps(c.axis)} tickFormatter={compactMoney(settings.currency)} width={56} />
        <Tooltip content={moneyTooltip()} cursor={{ fill: c.grid, opacity: 0.4 }} />
        <Bar dataKey="income" name="Income" fill={c.positive} radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="expense" name="Expenses" fill={c.series[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SpendingBarChart({
  data,
  height = 260,
}: {
  data: { label: string; expense: number }[];
  height?: number;
}) {
  const c = useChartColors();
  const { settings } = useSettings();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={c.grid} />
        <XAxis dataKey="label" {...axisProps(c.axis)} />
        <YAxis {...axisProps(c.axis)} tickFormatter={compactMoney(settings.currency)} width={56} />
        <Tooltip content={moneyTooltip()} cursor={{ fill: c.grid, opacity: 0.4 }} />
        <Bar dataKey="expense" name="Spending" fill={c.series[0]} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CashFlowChart({
  data,
  height = 260,
}: {
  data: { label: string; net: number }[];
  height?: number;
}) {
  const c = useChartColors();
  const { settings } = useSettings();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={c.grid} />
        <XAxis dataKey="label" {...axisProps(c.axis)} />
        <YAxis {...axisProps(c.axis)} tickFormatter={compactMoney(settings.currency)} width={56} />
        <Tooltip content={moneyTooltip()} cursor={{ fill: c.grid, opacity: 0.4 }} />
        <ReferenceLine y={0} stroke={c.axis} strokeWidth={1} />
        <Bar dataKey="net" name="Net" radius={[4, 4, 0, 0]} maxBarSize={36}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.net >= 0 ? c.positive : c.negative} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TrendAreaChart({
  data,
  dataKey,
  name,
  height = 260,
  color,
  yDomain,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  name: string;
  height?: number;
  color?: string;
  yDomain?: [number | string, number | string];
}) {
  const c = useChartColors();
  const { settings } = useSettings();
  const stroke = color ?? c.series[0];
  const gid = React.useId().replace(/:/g, '');
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={c.grid} />
        <XAxis dataKey="label" {...axisProps(c.axis)} />
        <YAxis
          {...axisProps(c.axis)}
          tickFormatter={compactMoney(settings.currency)}
          width={56}
          domain={yDomain as any}
        />
        <Tooltip content={moneyTooltip()} cursor={{ stroke: c.axis, strokeDasharray: '3 3' }} />
        <Area
          type="monotone"
          dataKey={dataKey}
          name={name}
          stroke={stroke}
          strokeWidth={2}
          fill={`url(#${gid})`}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MultiLineChart({
  data,
  series,
  height = 260,
}: {
  data: Record<string, unknown>[];
  series: { key: string; name: string; color?: string }[];
  height?: number;
}) {
  const c = useChartColors();
  const { settings } = useSettings();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={c.grid} />
        <XAxis dataKey="label" {...axisProps(c.axis)} />
        <YAxis {...axisProps(c.axis)} tickFormatter={compactMoney(settings.currency)} width={56} />
        <Tooltip content={moneyTooltip()} cursor={{ stroke: c.axis, strokeDasharray: '3 3' }} />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color ?? c.series[i % c.series.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Donut + interactive legend. Slices past `maxSlices` fold into “Other”. */
export function CategoryDonut({
  data,
  height = 240,
  maxSlices = 7,
}: {
  data: { name: string; value: number; color: string }[];
  height?: number;
  maxSlices?: number;
}) {
  const { fmtMoney } = useSettings();
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());

  const folded = React.useMemo(() => {
    if (data.length <= maxSlices) return data;
    const head = data.slice(0, maxSlices - 1);
    const rest = data.slice(maxSlices - 1);
    return [
      ...head,
      { name: 'Other', value: rest.reduce((a, b) => a + b.value, 0), color: '#94a3b8' },
    ];
  }, [data, maxSlices]);

  const visible = folded.filter((d) => !hidden.has(d.name));
  const total = visible.reduce((a, b) => a + b.value, 0);

  return (
    <div className="flex flex-col sm:flex-row items-center gap-2">
      <div style={{ height, width: height }} className="shrink-0 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              content={({ active, payload }: any) =>
                active && payload?.length ? (
                  <TooltipShell
                    rows={[{ name: payload[0].name, value: payload[0].value, color: payload[0].payload.color }]}
                  />
                ) : null
              }
            />
            <Pie
              data={visible}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              strokeWidth={0}
            >
              {visible.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[11px] text-muted-foreground">Total</span>
          <span className="text-sm font-semibold tabular-nums">{fmtMoney(total, { compact: true })}</span>
        </div>
      </div>
      <ul className="flex-1 w-full space-y-1 text-sm min-w-0">
        {folded.map((d) => {
          const off = hidden.has(d.name);
          return (
            <li key={d.name}>
              <button
                type="button"
                onClick={() =>
                  setHidden((prev) => {
                    const next = new Set(prev);
                    if (next.has(d.name)) next.delete(d.name);
                    else next.add(d.name);
                    return next;
                  })
                }
                className={cn(
                  'w-full flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-accent cursor-pointer transition-colors',
                  off && 'opacity-40'
                )}
                aria-pressed={!off}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                  <span className="truncate">{d.name}</span>
                </span>
                <span className="tabular-nums text-muted-foreground shrink-0">
                  {total > 0 && !off ? `${Math.round((d.value / total) * 100)}%` : '—'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Horizontal bar list (income sources, top merchants). */
export function BarList({
  data,
  className,
}: {
  data: { name: string; value: number; color?: string; sub?: string }[];
  className?: string;
}) {
  const { fmtMoney } = useSettings();
  const c = useChartColors();
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className={cn('space-y-2.5', className)}>
      {data.map((d, i) => (
        <div key={d.name + i}>
          <div className="flex items-center justify-between text-sm mb-1 gap-2">
            <span className="truncate">{d.name}</span>
            <span className="tabular-nums text-muted-foreground shrink-0">
              {fmtMoney(d.value, { compact: true })}
              {d.sub && <span className="text-xs">{d.sub}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${(d.value / max) * 100}%`,
                backgroundColor: d.color ?? c.series[i % c.series.length],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
