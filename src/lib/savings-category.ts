/**
 * Auto-apply the "Savings" category to money moving through savings-type
 * accounts, so contributions show up as savings in budgets and analytics
 * instead of as uncategorized spending.
 *
 * Categories are typed (expense/income) and the seeded "Savings" category is
 * an expense, so this only touches EXPENSE rows in savings accounts — i.e.
 * money placed into (or moved out of) savings that wasn't already matched as
 * an account-to-account transfer. Income rows (interest, deposits from
 * elsewhere) are left for the rule/keyword layers to handle. Runs after
 * transfer detection so genuine transfers are never miscategorized.
 *
 * Pure/shared: used by SimpleFIN sync, OFX/CSV imports and the MCP tool.
 */
import type { Account, Category, TransactionType } from '@/shared/types';

export const SAVINGS_CATEGORY = 'Savings';

interface SavingsDraft {
  type?: TransactionType | string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  accountId?: string | null;
}

/**
 * Fill the Savings category on uncategorized expense rows that belong to a
 * savings-type account. Creates the category if the user deleted the default.
 * Returns how many rows were categorized.
 */
export async function applySavingsCategory<T extends SavingsDraft>(
  drafts: T[],
  accounts: Account[],
  categories: Category[],
  createCategory: (data: Partial<Category>) => Promise<Category>
): Promise<number> {
  const savingsAccountIds = new Set(
    accounts.filter((a) => a.type === 'savings').map((a) => a.id)
  );
  if (!savingsAccountIds.size) return 0;

  const needsCategory = drafts.some(
    (d) => d.type === 'expense' && !d.categoryId && d.accountId && savingsAccountIds.has(d.accountId)
  );
  if (!needsCategory) return 0;

  let savings = categories.find(
    (c) => c.type === 'expense' && !c.parentId && c.name.trim().toLowerCase() === SAVINGS_CATEGORY.toLowerCase()
  );
  if (!savings) {
    savings = await createCategory({
      name: SAVINGS_CATEGORY,
      type: 'expense',
      icon: 'piggy-bank',
      color: '#0d9488',
    });
    categories.push(savings);
  }

  let filled = 0;
  for (const d of drafts) {
    if (d.type !== 'expense' || d.categoryId || !d.accountId) continue;
    if (!savingsAccountIds.has(d.accountId)) continue;
    d.categoryId = savings.id;
    d.subcategoryId = null;
    filled++;
  }
  return filled;
}
