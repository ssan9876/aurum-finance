/**
 * Global UI state: command palette + quick-add dialogs, reachable from the
 * topbar, FAB, keyboard shortcuts and the palette itself.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface UIContextValue {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  quickTxOpen: boolean;
  setQuickTxOpen: (open: boolean) => void;
  quickIncomeOpen: boolean;
  setQuickIncomeOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickTxOpen, setQuickTxOpen] = useState(false);
  const [quickIncomeOpen, setQuickIncomeOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const value = useMemo(
    () => ({
      paletteOpen,
      setPaletteOpen,
      quickTxOpen,
      setQuickTxOpen,
      quickIncomeOpen,
      setQuickIncomeOpen,
      shortcutsOpen,
      setShortcutsOpen,
    }),
    [paletteOpen, quickTxOpen, quickIncomeOpen, shortcutsOpen]
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
}
