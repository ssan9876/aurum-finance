/**
 * Daily automation for the self-hosted server. An hourly tick checks whether
 * today's run already happened (setting `automation.lastRunDay`); if not it:
 *
 *   1. marks autoPay bills paid on/after their due date  (opt-in)
 *   2. posts recurring income on nextPayDate             (opt-in)
 *   3. snapshots savings balances on the 1st             (on by default)
 *   4. writes a rotating JSON backup next to the db      (on by default)
 *   5. pulls new bank transactions via SimpleFIN         (on by default, when connected)
 *
 * Toggles live in the `setting` table (JSON-encoded booleans) and are edited
 * in Settings → Automation. Money-moving jobs (1 and 2) default OFF so
 * nothing posts without the user explicitly opting in.
 */
import fs from 'node:fs';
import path from 'node:path';
import { addDays, addMonths, addQuarters, addWeeks, addYears } from 'date-fns';
import type { DataService } from './data-service';
import { advanceBillDate } from '../src/lib/finance';
import type { Bill, IncomeSource, SavingsAccount, SavingsSnapshot, Setting } from '../src/shared/types';
import { simplefinConfigured, simplefinSync } from './simplefin';

const LAST_RUN_KEY = 'automation.lastRunDay';
const BACKUPS_TO_KEEP = 14;

export const AUTOMATION_FLAGS = {
  autoPayBills: { key: 'automation.autoPayBills', default: false },
  postIncome: { key: 'automation.postIncome', default: false },
  savingsSnapshots: { key: 'automation.savingsSnapshots', default: true },
  backups: { key: 'automation.backups', default: true },
  bankSync: { key: 'automation.bankSync', default: true },
} as const;

function flagEnabled(settings: Setting[], flag: { key: string; default: boolean }): boolean {
  const row = settings.find((s) => s.key === flag.key);
  if (!row) return flag.default;
  try {
    return JSON.parse(row.value) === true;
  } catch {
    return flag.default;
  }
}

function advanceIncomeDate(source: IncomeSource): string {
  const d = new Date(source.nextPayDate!);
  switch (source.frequency) {
    case 'weekly':
      return addWeeks(d, 1).toISOString();
    case 'biweekly':
      return addWeeks(d, 2).toISOString();
    case 'twicemonthly':
      return addDays(d, 15).toISOString();
    case 'quarterly':
      return addQuarters(d, 1).toISOString();
    case 'yearly':
      return addYears(d, 1).toISOString();
    case 'monthly':
    default:
      return addMonths(d, 1).toISOString();
  }
}

export function startScheduler(service: DataService, backupDir: string) {
  const tick = () =>
    runDaily(service, backupDir).catch((err) =>
      console.error('[aurum] automation error:', err instanceof Error ? err.message : err)
    );
  setTimeout(tick, 15_000); // shortly after boot
  setInterval(tick, 60 * 60 * 1000).unref();
}

export async function runDaily(service: DataService, backupDir: string, force = false) {
  const settings = (await service.handle('list', { entity: 'setting' })) as Setting[];
  const today = new Date().toISOString().slice(0, 10);
  const lastRun = settings.find((s) => s.key === LAST_RUN_KEY)?.value;
  if (!force && lastRun === today) return null;
  // Claim the day up front so a failing job can't retry-loop every hour.
  await service.handle('setSetting', { key: LAST_RUN_KEY, value: today });

  const ran: Record<string, unknown> = { date: today };
  const endOfToday = `${today}T23:59:59.999Z`;

  if (flagEnabled(settings, AUTOMATION_FLAGS.autoPayBills)) {
    const bills = (await service.handle('list', { entity: 'bill' })) as Bill[];
    let paid = 0;
    for (const bill of bills.filter((b) => b.autoPay && b.dueDate <= endOfToday)) {
      // Mirrors the app's "mark paid": log the expense, then advance/retire.
      await service.handle('create', {
        entity: 'transaction',
        data: {
          date: new Date().toISOString(),
          amount: bill.amount,
          type: 'expense',
          merchant: bill.name,
          description: 'Bill payment (auto-pay)',
          categoryId: bill.categoryId ?? null,
          accountId: bill.accountId ?? null,
          recurring: bill.frequency !== 'once',
          paymentMethod: 'Bank Transfer',
        },
      });
      if (bill.frequency === 'once') {
        await service.handle('remove', { entity: 'bill', id: bill.id });
      } else {
        await service.handle('update', {
          entity: 'bill',
          id: bill.id,
          data: { dueDate: advanceBillDate(bill), lastPaidDate: new Date().toISOString() },
        });
      }
      paid++;
    }
    if (paid) ran.autoPaidBills = paid;
  }

  if (flagEnabled(settings, AUTOMATION_FLAGS.postIncome)) {
    const sources = (await service.handle('list', { entity: 'incomeSource' })) as IncomeSource[];
    let posted = 0;
    for (const src of sources.filter((s) => s.active && s.nextPayDate && s.nextPayDate <= endOfToday)) {
      await service.handle('create', {
        entity: 'transaction',
        data: {
          date: new Date().toISOString(),
          amount: src.amount, // net take-home
          type: 'income',
          merchant: src.name,
          description: 'Recurring income (auto-posted)',
          recurring: true,
        },
      });
      if (src.frequency === 'onetime') {
        await service.handle('update', { entity: 'incomeSource', id: src.id, data: { active: false } });
      } else {
        await service.handle('update', {
          entity: 'incomeSource',
          id: src.id,
          data: { nextPayDate: advanceIncomeDate(src) },
        });
      }
      posted++;
    }
    if (posted) ran.incomePosted = posted;
  }

  if (flagEnabled(settings, AUTOMATION_FLAGS.savingsSnapshots) && today.endsWith('-01')) {
    const [savings, snapshots] = (await Promise.all([
      service.handle('list', { entity: 'savingsAccount' }),
      service.handle('list', { entity: 'savingsSnapshot' }),
    ])) as [SavingsAccount[], SavingsSnapshot[]];
    const month = today.slice(0, 7);
    let taken = 0;
    for (const acct of savings) {
      const exists = snapshots.some(
        (s) => s.savingsAccountId === acct.id && s.date.slice(0, 7) === month
      );
      if (exists) continue;
      await service.handle('create', {
        entity: 'savingsSnapshot',
        data: { savingsAccountId: acct.id, date: new Date().toISOString(), balance: acct.balance },
      });
      taken++;
    }
    if (taken) ran.savingsSnapshots = taken;
  }

  if (flagEnabled(settings, AUTOMATION_FLAGS.backups)) {
    fs.mkdirSync(backupDir, { recursive: true });
    const payload = await service.handle('exportAll', {});
    const file = path.join(backupDir, `aurum-${today}.json`);
    fs.writeFileSync(file, JSON.stringify(payload));
    const backups = fs
      .readdirSync(backupDir)
      .filter((f) => /^aurum-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    for (const old of backups.slice(0, Math.max(0, backups.length - BACKUPS_TO_KEEP))) {
      fs.unlinkSync(path.join(backupDir, old));
    }
    ran.backup = path.basename(file);
  }

  if (flagEnabled(settings, AUTOMATION_FLAGS.bankSync) && (await simplefinConfigured(service))) {
    try {
      const result = await simplefinSync(service);
      ran.bankSync = { created: result.created, duplicatesSkipped: result.duplicatesSkipped };
    } catch (err) {
      ran.bankSyncError = err instanceof Error ? err.message : String(err);
      console.error('[aurum] scheduled bank sync failed:', ran.bankSyncError);
    }
  }

  console.log('[aurum] daily automation ran:', JSON.stringify(ran));
  return ran;
}
