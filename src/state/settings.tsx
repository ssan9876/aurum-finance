/**
 * App settings: currency, date format, theme, accent, notifications.
 * Persisted as key/value Setting rows; theme + accent are mirrored to
 * localStorage so index.html can apply them before first paint.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { format as formatDate } from 'date-fns';
import { api } from '@/data/api';
import { useSettingRows } from '@/data/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, type AppSettings } from '@/shared/defaults';

interface MoneyOpts {
  compact?: boolean;
  signed?: boolean;
}

interface SettingsContextValue {
  settings: AppSettings;
  ready: boolean;
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  fmtMoney: (n: number, opts?: MoneyOpts) => string;
  fmtDate: (d: string | Date | null | undefined, fmt?: string) => string;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data: rows, isSuccess } = useSettingRows();
  const qc = useQueryClient();

  const settings = useMemo<AppSettings>(() => {
    const merged: AppSettings = { ...DEFAULT_SETTINGS };
    for (const row of rows ?? []) {
      if (!(row.key in merged)) continue;
      try {
        (merged as unknown as Record<string, unknown>)[row.key] = JSON.parse(row.value);
      } catch {
        /* ignore malformed rows */
      }
    }
    return merged;
  }, [rows]);

  // Apply theme + accent to the document, and track system preference.
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && media.matches);
      root.classList.toggle('dark', dark);
      root.setAttribute('data-accent', settings.accent);
    };
    apply();
    localStorage.setItem('aurum.theme', settings.theme);
    localStorage.setItem('aurum.accent', settings.accent);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.theme, settings.accent]);

  const setSetting = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      // Optimistic: patch the cached rows, then persist.
      qc.setQueryData(['setting'], (old: { id: string; key: string; value: string }[] | undefined) => {
        const rows = old ? [...old] : [];
        const idx = rows.findIndex((r) => r.key === key);
        const next = { id: idx >= 0 ? rows[idx].id : `local-${key}`, key, value: JSON.stringify(value) };
        if (idx >= 0) rows[idx] = next;
        else rows.push(next);
        return rows;
      });
      api.setSetting(key, JSON.stringify(value)).catch(() => {
        qc.invalidateQueries({ queryKey: ['setting'] });
      });
    },
    [qc]
  );

  const fmtMoney = useCallback(
    (n: number, opts?: MoneyOpts) => {
      const abs = Math.abs(n);
      const formatter = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: settings.currency,
        notation: opts?.compact && abs >= 10_000 ? 'compact' : 'standard',
        maximumFractionDigits: opts?.compact ? (abs >= 10_000 ? 1 : 0) : 2,
        minimumFractionDigits: opts?.compact ? 0 : undefined,
      });
      const text = formatter.format(n);
      return opts?.signed && n > 0 ? `+${text}` : text;
    },
    [settings.currency]
  );

  const fmtDate = useCallback(
    (d: string | Date | null | undefined, fmt?: string) => {
      if (!d) return '—';
      const date = d instanceof Date ? d : new Date(d);
      if (Number.isNaN(date.getTime())) return '—';
      return formatDate(date, fmt ?? settings.dateFormat);
    },
    [settings.dateFormat]
  );

  const value = useMemo(
    () => ({ settings, ready: isSuccess, setSetting, fmtMoney, fmtDate }),
    [settings, isSuccess, setSetting, fmtMoney, fmtDate]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
