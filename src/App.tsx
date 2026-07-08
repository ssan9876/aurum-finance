import { Navigate, Route, Routes } from 'react-router-dom';
import { UIProvider } from '@/state/ui';
import { AppShell } from '@/components/layout/AppShell';
import Dashboard from '@/pages/Dashboard';
import Transactions from '@/pages/Transactions';
import Income from '@/pages/Income';
import Budgets from '@/pages/Budgets';
import Bills from '@/pages/Bills';
import Savings from '@/pages/Savings';
import Goals from '@/pages/Goals';
import Accounts from '@/pages/Accounts';
import Categories from '@/pages/Categories';
import CalendarPage from '@/pages/CalendarPage';
import Analytics from '@/pages/Analytics';
import Settings from '@/pages/Settings';

export default function App() {
  return (
    <UIProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/income" element={<Income />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/bills" element={<Bills />} />
          <Route path="/savings" element={<Savings />} />
          <Route path="/goals" element={<Goals />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </UIProvider>
  );
}
