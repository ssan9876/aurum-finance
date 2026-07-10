/**
 * "Aurum Wrapped" — an animated walk through the year's money.
 *
 * Slides are built from `yearInReview` (src/lib/wrapped.ts), so every figure
 * is one the rest of the app would report. A year with no activity shows an
 * empty state rather than a deck of zeroes.
 */
import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Gem, PartyPopper } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState, PageHeader } from '@/components/shared';
import { useSettings } from '@/state/settings';
import { useCategories, useTransactions } from '@/data/hooks';
import { yearInReview, yearsWithData, type WrappedStats } from '@/lib/wrapped';
import { cn } from '@/lib/utils';

interface Slide {
  key: string;
  eyebrow: string;
  headline: React.ReactNode;
  caption?: React.ReactNode;
  accent?: string;
}

function buildSlides(
  s: WrappedStats,
  fmtMoney: (n: number, o?: { compact?: boolean }) => string,
  fmtDate: (d: string) => string
): Slide[] {
  const slides: Slide[] = [
    {
      key: 'intro',
      eyebrow: `${s.year}${s.inProgress ? ' so far' : ''}`,
      headline: <>Your year in money</>,
      caption: (
        <>
          {s.transactionCount.toLocaleString()} transactions, {s.noSpendDays} days you didn’t spend a
          thing.
        </>
      ),
    },
    {
      key: 'spent',
      eyebrow: 'You spent',
      headline: fmtMoney(s.totalSpent),
      caption: <>That’s {fmtMoney(s.averageDailySpend)} a day, on average.</>,
    },
  ];

  if (s.topCategory) {
    slides.push({
      key: 'category',
      eyebrow: 'Your biggest category',
      headline: s.topCategory.name,
      accent: s.topCategory.color,
      caption: (
        <>
          {fmtMoney(s.topCategory.amount)} — {Math.round(s.topCategory.share * 100)}% of everything
          you spent.
        </>
      ),
    });
  }

  if (s.topMerchants.length) {
    slides.push({
      key: 'merchants',
      eyebrow: 'You kept going back',
      headline: s.topMerchants[0].merchant,
      caption: (
        <>
          {s.topMerchants[0].count} visits · {fmtMoney(s.topMerchants[0].amount)}
          <span className="block mt-4 space-y-1 text-sm">
            {s.topMerchants.slice(1).map((m, i) => (
              <span key={m.merchant} className="flex justify-between gap-4">
                <span className="truncate">
                  {i + 2}. {m.merchant}
                </span>
                <span className="tabular-nums shrink-0">{fmtMoney(m.amount)}</span>
              </span>
            ))}
          </span>
        </>
      ),
    });
  }

  if (s.biggestPurchase) {
    slides.push({
      key: 'purchase',
      eyebrow: 'Your biggest single purchase',
      headline: fmtMoney(s.biggestPurchase.amount),
      caption: (
        <>
          {s.biggestPurchase.merchant}, on {fmtDate(s.biggestPurchase.date)}.
        </>
      ),
    });
  }

  if (s.biggestMonth && s.leanestMonth) {
    slides.push({
      key: 'months',
      eyebrow: 'Your priciest month',
      headline: s.biggestMonth.label,
      caption: (
        <>
          {fmtMoney(s.biggestMonth.amount)} out the door. Your quietest was {s.leanestMonth.label}, at{' '}
          {fmtMoney(s.leanestMonth.amount)}.
        </>
      ),
    });
  }

  if (s.longestNoSpendStreak > 1) {
    slides.push({
      key: 'streak',
      eyebrow: 'Your longest no-spend streak',
      headline: `${s.longestNoSpendStreak} days`,
      caption: <>Not a single expense. Impressive restraint.</>,
    });
  }

  slides.push({
    key: 'net',
    eyebrow: s.net >= 0 ? 'You came out ahead' : 'You spent more than you earned',
    headline: fmtMoney(Math.abs(s.net)),
    accent: s.net >= 0 ? 'hsl(var(--success))' : 'hsl(var(--destructive))',
    caption: (
      <>
        {fmtMoney(s.totalIncome)} in, {fmtMoney(s.totalSpent)} out
        {s.savingMonths > 0 && <> · {s.savingMonths} months in the black</>}.
      </>
    ),
  });

  return slides;
}

export default function Wrapped() {
  const { fmtMoney, fmtDate } = useSettings();
  const [params, setParams] = useSearchParams();
  const { data: transactions, isLoading } = useTransactions();
  const { data: categories = [] } = useCategories();

  const now = React.useMemo(() => new Date(), []);
  const years = React.useMemo(() => yearsWithData(transactions ?? []), [transactions]);
  const year = Number(params.get('year')) || years[0] || now.getFullYear();

  const stats = React.useMemo(
    () => (transactions ? yearInReview(transactions, categories, year, now) : null),
    [transactions, categories, year, now]
  );

  const slides = React.useMemo(
    () => (stats ? buildSlides(stats, fmtMoney, fmtDate) : []),
    [stats, fmtMoney, fmtDate]
  );

  const [index, setIndex] = React.useState(0);
  const [direction, setDirection] = React.useState(1);

  // A different year is a different deck; start it from the top.
  React.useEffect(() => setIndex(0), [year]);

  const go = React.useCallback(
    (delta: number) => {
      setDirection(delta);
      setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(slides.length - 1, 0)));
    },
    [slides.length]
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  if (isLoading || !transactions) {
    return (
      <div>
        <PageHeader title="Wrapped" />
        <Skeleton className="h-[420px] rounded-xl" />
      </div>
    );
  }

  const picker = years.length > 1 && (
    <Select
      value={String(year)}
      onValueChange={(v) => setParams((p) => {
        const next = new URLSearchParams(p);
        next.set('year', v);
        return next;
      })}
    >
      <SelectTrigger className="w-[110px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {years.map((y) => (
          <SelectItem key={y} value={String(y)}>
            {y}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (!stats || slides.length === 0) {
    return (
      <div>
        <PageHeader title="Wrapped" description={`${year} in review`} actions={picker || undefined} />
        <Card>
          <EmptyState
            icon={<Gem />}
            title={`Nothing to wrap for ${year}`}
            description="Add some transactions for this year and your review will write itself."
          />
        </Card>
      </div>
    );
  }

  const slide = slides[index];
  const last = index === slides.length - 1;

  return (
    <div>
      <PageHeader
        title="Wrapped"
        description={`${stats.year}${stats.inProgress ? ' so far' : ''} · your year in review`}
        actions={picker || undefined}
      />

      <Card className="relative overflow-hidden">
        <div className="relative h-[420px] flex items-center justify-center px-6 text-center">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={slide.key}
              custom={direction}
              initial={{ opacity: 0, y: direction > 0 ? 28 : -28 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: direction > 0 ? -28 : 28 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="max-w-lg"
            >
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
                {slide.eyebrow}
              </p>
              <p
                className="text-4xl sm:text-5xl font-bold tracking-tight tabular-nums break-words"
                style={slide.accent ? { color: slide.accent } : undefined}
              >
                {slide.headline}
              </p>
              {slide.caption && (
                <div className="mt-4 text-sm text-muted-foreground leading-relaxed">{slide.caption}</div>
              )}
              {last && (
                <p className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary">
                  <PartyPopper className="h-4 w-4" /> That’s a wrap.
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Progress + controls */}
        <div className="flex items-center justify-between gap-4 border-t px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => go(-1)} disabled={index === 0}>
            <ChevronLeft /> Back
          </Button>
          <div className="flex gap-1.5" role="tablist" aria-label="Slides">
            {slides.map((s, i) => (
              <button
                key={s.key}
                onClick={() => {
                  setDirection(i > index ? 1 : -1);
                  setIndex(i);
                }}
                aria-label={`Slide ${i + 1}`}
                aria-selected={i === index}
                role="tab"
                className={cn(
                  'h-1.5 rounded-full transition-all cursor-pointer',
                  i === index ? 'w-6 bg-primary' : 'w-1.5 bg-border hover:bg-muted-foreground/40'
                )}
              />
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => go(1)} disabled={last}>
            Next <ChevronRight />
          </Button>
        </div>
      </Card>
    </div>
  );
}
