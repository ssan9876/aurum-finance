/**
 * MCP (Model Context Protocol) endpoint — lets AI assistants (claude.ai
 * connectors, Claude Desktop, Claude Code, …) read and write Aurum data so a
 * user can paste a bank statement, a stack of receipts or a plain-English
 * description into their AI and have transactions, bills, budgets and goals
 * filled out for them.
 *
 * Mounted at POST /mcp on the self-hosted server. Stateless Streamable HTTP:
 * every request gets a fresh server+transport pair, so no session bookkeeping
 * survives between calls. Auth is handled by the caller (server/index.ts) with
 * the same AURUM_PASSWORD that protects /api/data.
 *
 * Conventions the tools enforce (mirroring the app UI):
 *   - money is a positive number; direction comes from `type`
 *   - a transaction's category points at a ROOT category, with the child in
 *     `subcategoryId` — tools accept either name and split correctly
 *   - add_transactions dedupes on externalId (bank id) and, optionally, on
 *     same-day + amount + merchant so re-imports are safe
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { DataService } from './data-service';
import {
  accountBalance,
  advanceBillDate,
  billState,
  budgetStatuses,
  totalMonthlyIncome,
} from '../src/lib/finance';
import { RULES_KEY, matchRule, parseRules } from '../src/lib/rules';
import { guessCategory } from '../src/lib/keywords';
import { SAVINGS_CATEGORY } from '../src/lib/savings-category';
import { simplefinConfigured, simplefinSync } from './simplefin';
import {
  parseTags,
  serializeTags,
  type Account,
  type Bill,
  type Budget,
  type Category,
  type EntityMap,
  type EntityName,
  type Setting,
  type Transaction,
} from '../src/shared/types';

const MCP_SERVER_INFO = { name: 'aurum-finance', version: '1.3.0' };

const INSTRUCTIONS = `Aurum is the user's personal finance app. Start every session with get_overview to learn their accounts, categories, budgets, bills and goals before creating anything.

Conventions:
- Amounts are always positive numbers; direction comes from the transaction type (expense/income/transfer).
- When the user pastes a bank statement or receipts, map debits to expenses and credits to income, resolve categories and accounts by name from the overview, and batch everything into one add_transactions call — its dedup makes re-imports safe.
- If a category the user needs doesn't exist, prefer an existing close match; create new ones with add_categories only when nothing fits.
- Confirm with the user before delete_transactions or anything irreversible.`;

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

const norm = (s: string) => s.trim().toLowerCase();
const round2 = (n: number) => Math.round(n * 100) / 100;
const dayOf = (iso: string) => iso.slice(0, 10);

/** Match a user/AI-supplied reference against rows by id, then name (ci). */
function byRef<T extends { id: string; name: string }>(rows: T[], ref: string): T | undefined {
  return rows.find((r) => r.id === ref) ?? rows.find((r) => norm(r.name) === norm(ref));
}

function parseDate(value: string): string | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Resolve a category reference to { categoryId, subcategoryId } the way the
 * UI stores it: root category in categoryId, child (if any) in subcategoryId.
 * Supports "Parent > Child" syntax as well as plain names and ids.
 */
function resolveCategory(
  categories: Category[],
  ref: string
): { categoryId: string; subcategoryId: string | null } | null {
  let match: Category | undefined;
  const arrow = ref.split('>').map((s) => s.trim());
  if (arrow.length === 2) {
    const parent = byRef(categories, arrow[0]);
    match = categories.find((c) => c.parentId === parent?.id && norm(c.name) === norm(arrow[1]));
  } else {
    match =
      categories.find((c) => c.id === ref) ??
      // Prefer root categories when a name is ambiguous.
      categories.find((c) => !c.parentId && norm(c.name) === norm(ref)) ??
      categories.find((c) => norm(c.name) === norm(ref));
  }
  if (!match) return null;
  return match.parentId
    ? { categoryId: match.parentId, subcategoryId: match.id }
    : { categoryId: match.id, subcategoryId: null };
}

function categoryLabel(categories: Category[], tx: Transaction): string | null {
  const sub = tx.subcategoryId ? categories.find((c) => c.id === tx.subcategoryId) : undefined;
  const root = tx.categoryId ? categories.find((c) => c.id === tx.categoryId) : undefined;
  if (root && sub) return `${root.name} > ${sub.name}`;
  return root?.name ?? null;
}

export function buildMcpServer(service: DataService): McpServer {
  const list = <E extends EntityName>(entity: E) =>
    service.handle('list', { entity }) as Promise<EntityMap[E][]>;
  const create = <E extends EntityName>(entity: E, data: Record<string, unknown>) =>
    service.handle('create', { entity, data }) as Promise<EntityMap[E]>;
  const update = <E extends EntityName>(entity: E, id: string, data: Record<string, unknown>) =>
    service.handle('update', { entity, id, data }) as Promise<EntityMap[E]>;

  const server = new McpServer(MCP_SERVER_INFO, { instructions: INSTRUCTIONS });

  /* ------------------------------ read tools ------------------------------ */

  server.registerTool(
    'get_overview',
    {
      title: 'Get finance overview',
      description:
        'Snapshot of the user\'s finances: accounts with live balances, the category tree, current-month budget status, upcoming bills, goals, income sources and savings. Call this first — it supplies the names and ids every other tool needs.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const [accounts, categories, txs, budgets, bills, goals, incomeSources, savings, settings] =
        await Promise.all([
          list('account'),
          list('category'),
          list('transaction'),
          list('budget'),
          list('bill'),
          list('goal'),
          list('incomeSource'),
          list('savingsAccount'),
          list('setting'),
        ]);
      const now = new Date();
      const currencyRow = (settings as Setting[]).find((s) => s.key === 'currency');
      let currency = 'USD';
      try {
        if (currencyRow) currency = JSON.parse(currencyRow.value);
      } catch {
        /* keep default */
      }
      const catName = (id: string | null | undefined) =>
        categories.find((c) => c.id === id)?.name ?? null;
      return ok({
        today: now.toISOString().slice(0, 10),
        currency,
        accounts: accounts.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          balance: accountBalance(a, txs),
          archived: a.archived || undefined,
        })),
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          parent: catName(c.parentId),
        })),
        budgetsThisMonth: budgetStatuses(budgets, categories, txs, now).map((b) => ({
          category: b.category.name,
          budget: b.budget,
          spent: b.spent,
          remaining: b.remaining,
        })),
        budgetTemplates: (budgets as Budget[])
          .filter((b) => b.month == null && b.year == null)
          .map((b) => ({ category: catName(b.categoryId), amount: b.amount, period: b.period })),
        bills: (bills as Bill[]).map((b) => ({
          id: b.id,
          name: b.name,
          amount: b.amount,
          dueDate: dayOf(b.dueDate),
          frequency: b.frequency,
          status: billState(b, now),
          autoPay: b.autoPay || undefined,
          category: catName(b.categoryId),
        })),
        goals: goals.map((g) => ({
          id: g.id,
          name: g.name,
          type: g.type,
          targetAmount: g.targetAmount,
          currentAmount: g.currentAmount,
          targetDate: g.targetDate ? dayOf(g.targetDate) : null,
          completed: g.completedAt ? true : undefined,
        })),
        incomeSources: incomeSources.map((s) => ({
          id: s.id,
          name: s.name,
          amount: s.amount,
          grossAmount: s.grossAmount ?? undefined,
          frequency: s.frequency,
          active: s.active,
        })),
        estimatedMonthlyIncome: totalMonthlyIncome(incomeSources),
        savingsAccounts: savings.map((s) => ({
          id: s.id,
          name: s.name,
          balance: s.balance,
          goal: s.goal ?? null,
        })),
        transactionCount: txs.length,
        newestTransaction: txs.length ? dayOf(txs[0].date) : null,
      });
    }
  );

  server.registerTool(
    'list_transactions',
    {
      title: 'List transactions',
      description:
        'Search the transaction history. All filters are optional and combine with AND. Dates are inclusive. Returns newest first.',
      inputSchema: {
        from: z.string().optional().describe('Start date (YYYY-MM-DD)'),
        to: z.string().optional().describe('End date (YYYY-MM-DD)'),
        query: z.string().optional().describe('Substring match on merchant, description and notes'),
        category: z.string().optional().describe('Category name or id (matches subcategories too)'),
        account: z.string().optional().describe('Account name or id'),
        type: z.enum(['expense', 'income', 'transfer']).optional(),
        limit: z.number().int().min(1).max(500).default(50),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ from, to, query, category, account, type, limit }) => {
      const [txs, categories, accounts] = await Promise.all([
        list('transaction'),
        list('category'),
        list('account'),
      ]);
      let rows = txs as Transaction[];
      if (from) rows = rows.filter((t) => dayOf(t.date) >= from);
      if (to) rows = rows.filter((t) => dayOf(t.date) <= to);
      if (type) rows = rows.filter((t) => t.type === type);
      if (query) {
        const q = norm(query);
        rows = rows.filter((t) =>
          [t.merchant, t.description, t.notes].some((s) => s && norm(s).includes(q))
        );
      }
      if (category) {
        const resolved = resolveCategory(categories, category);
        if (!resolved) return fail(`Unknown category: "${category}". Call get_overview for the list.`);
        const id = resolved.subcategoryId ?? resolved.categoryId;
        rows = rows.filter((t) => t.categoryId === id || t.subcategoryId === id);
      }
      if (account) {
        const acc = byRef(accounts, account);
        if (!acc) return fail(`Unknown account: "${account}". Call get_overview for the list.`);
        rows = rows.filter((t) => t.accountId === acc.id || t.toAccountId === acc.id);
      }
      const total = rows.length;
      rows = rows.slice(0, limit);
      return ok({
        total,
        returned: rows.length,
        transactions: rows.map((t) => ({
          id: t.id,
          date: dayOf(t.date),
          amount: t.amount,
          type: t.type,
          merchant: t.merchant,
          description: t.description ?? undefined,
          category: categoryLabel(categories, t),
          account: accounts.find((a) => a.id === t.accountId)?.name ?? null,
          tags: parseTags(t.tags).length ? parseTags(t.tags) : undefined,
          notes: t.notes ?? undefined,
        })),
      });
    }
  );

  /* --------------------------- transaction tools -------------------------- */

  server.registerTool(
    'add_transactions',
    {
      title: 'Add transactions',
      description:
        'Create one or many transactions — the main autofill tool for pasted statements, receipts or "I spent $40 at Costco". Duplicates are skipped: rows whose externalId already exists, or (when skipDuplicates is on) rows matching an existing transaction\'s date+amount+merchant. Unknown category/account names don\'t block the row; it is created without them and reported back so you can fix up with add_categories + update_transaction.',
      inputSchema: {
        transactions: z
          .array(
            z.object({
              date: z.string().describe('YYYY-MM-DD or ISO datetime'),
              amount: z.number().describe('Positive; direction comes from `type`'),
              type: z.enum(['expense', 'income', 'transfer']).optional().describe('Default expense'),
              merchant: z.string().min(1),
              description: z.string().optional(),
              category: z.string().optional().describe('Name, id, or "Parent > Child"'),
              account: z.string().optional().describe('Account name or id'),
              toAccount: z.string().optional().describe('Destination account (transfers only)'),
              tags: z.array(z.string()).optional(),
              notes: z.string().optional(),
              recurring: z.boolean().optional(),
              externalId: z.string().optional().describe('Bank transaction id (OFX FITID) for dedup'),
            })
          )
          .min(1)
          .max(500),
        skipDuplicates: z
          .boolean()
          .default(true)
          .describe('Also skip rows matching an existing date+amount+merchant'),
      },
    },
    async ({ transactions, skipDuplicates }) => {
      const [existing, categories, accounts, settings] = await Promise.all([
        list('transaction'),
        list('category'),
        list('account'),
        list('setting'),
      ]);
      const rules = parseRules((settings as Setting[]).find((s) => s.key === RULES_KEY)?.value);
      const knownExternal = new Set(
        (existing as Transaction[]).map((t) => t.externalId).filter(Boolean) as string[]
      );
      const fingerprint = (date: string, amount: number, merchant: string) =>
        `${dayOf(date)}|${round2(Math.abs(amount)).toFixed(2)}|${norm(merchant)}`;
      const knownRows = new Set(
        (existing as Transaction[]).map((t) => fingerprint(t.date, t.amount, t.merchant))
      );

      const created: { id: string; date: string; merchant: string; amount: number; type: string }[] = [];
      const skipped: { merchant: string; date: string; reason: string }[] = [];
      const unknownCategories = new Set<string>();
      const unknownAccounts = new Set<string>();
      let autoCategorized = 0;

      for (const row of transactions) {
        const iso = parseDate(row.date);
        if (!iso) {
          skipped.push({ merchant: row.merchant, date: row.date, reason: 'unparseable date' });
          continue;
        }
        if (row.externalId && knownExternal.has(row.externalId)) {
          skipped.push({ merchant: row.merchant, date: dayOf(iso), reason: 'externalId already imported' });
          continue;
        }
        const fp = fingerprint(iso, row.amount, row.merchant);
        if (skipDuplicates && knownRows.has(fp)) {
          skipped.push({ merchant: row.merchant, date: dayOf(iso), reason: 'matches existing date+amount+merchant' });
          continue;
        }

        // Negative amount with no explicit type reads as a statement debit.
        const type = row.type ?? 'expense';
        let cat = row.category ? resolveCategory(categories, row.category) : null;
        if (row.category && !cat) unknownCategories.add(row.category);
        // No usable category → fall back to the user's learned merchant rules.
        if (!cat && type !== 'transfer') {
          const rule = matchRule(rules, row.merchant, categories);
          const ruleCat = rule ? categories.find((c) => c.id === rule.categoryId) : undefined;
          if (rule && ruleCat?.type === (type === 'income' ? 'income' : 'expense')) {
            cat = { categoryId: rule.categoryId, subcategoryId: rule.subcategoryId };
            autoCategorized++;
          }
        }
        // Still uncategorized → try the built-in keyword library, resolving to
        // an existing category only (the AI path doesn't invent categories).
        if (!cat && type !== 'transfer') {
          const guess = guessCategory(row.merchant, type === 'income' ? 'income' : 'expense');
          if (guess) {
            const resolved = resolveCategory(
              categories,
              guess.subcategory ? `${guess.category} > ${guess.subcategory}` : guess.category
            );
            if (resolved) {
              cat = resolved;
              autoCategorized++;
            }
          }
        }
        const acc = row.account ? byRef(accounts, row.account) : undefined;
        if (row.account && !acc) unknownAccounts.add(row.account);
        const toAcc = row.toAccount ? byRef(accounts, row.toAccount) : undefined;
        if (row.toAccount && !toAcc) unknownAccounts.add(row.toAccount);
        // Money spent from a savings account → categorize as Savings.
        if (!cat && type === 'expense' && acc?.type === 'savings') {
          const resolved = resolveCategory(categories, SAVINGS_CATEGORY);
          if (resolved) {
            cat = resolved;
            autoCategorized++;
          }
        }

        const tx = await create('transaction', {
          date: iso,
          amount: round2(Math.abs(row.amount)),
          type,
          merchant: row.merchant,
          description: row.description ?? null,
          categoryId: cat?.categoryId ?? null,
          subcategoryId: cat?.subcategoryId ?? null,
          accountId: acc?.id ?? null,
          toAccountId: toAcc?.id ?? null,
          tags: serializeTags(row.tags ?? []),
          recurring: row.recurring ?? false,
          notes: row.notes ?? null,
          externalId: row.externalId ?? null,
        });
        if (row.externalId) knownExternal.add(row.externalId);
        knownRows.add(fp);
        created.push({ id: tx.id, date: dayOf(tx.date), merchant: tx.merchant, amount: tx.amount, type: tx.type });
      }

      return ok({
        created: created.length,
        autoCategorizedByRules: autoCategorized || undefined,
        skipped: skipped.length ? skipped : undefined,
        createdTransactions: created,
        unknownCategories: unknownCategories.size
          ? {
              names: [...unknownCategories],
              note: 'These rows were created uncategorized. Use add_categories (or pick an existing category) and update_transaction to fix them.',
            }
          : undefined,
        unknownAccounts: unknownAccounts.size ? [...unknownAccounts] : undefined,
      });
    }
  );

  server.registerTool(
    'update_transaction',
    {
      title: 'Update a transaction',
      description:
        'Edit fields of one transaction (from list_transactions or add_transactions results). Pass null for category or account to clear them.',
      inputSchema: {
        id: z.string(),
        date: z.string().optional(),
        amount: z.number().optional(),
        type: z.enum(['expense', 'income', 'transfer']).optional(),
        merchant: z.string().optional(),
        description: z.string().nullable().optional(),
        category: z.string().nullable().optional().describe('Name, id, "Parent > Child", or null to clear'),
        account: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        notes: z.string().nullable().optional(),
        recurring: z.boolean().optional(),
      },
    },
    async ({ id, date, amount, type, merchant, description, category, account, tags, notes, recurring }) => {
      const data: Record<string, unknown> = {};
      if (date !== undefined) {
        const iso = parseDate(date);
        if (!iso) return fail(`Unparseable date: "${date}"`);
        data.date = iso;
      }
      if (amount !== undefined) data.amount = round2(Math.abs(amount));
      if (type !== undefined) data.type = type;
      if (merchant !== undefined) data.merchant = merchant;
      if (description !== undefined) data.description = description;
      if (notes !== undefined) data.notes = notes;
      if (recurring !== undefined) data.recurring = recurring;
      if (tags !== undefined) data.tags = serializeTags(tags);
      if (category !== undefined) {
        if (category === null) {
          data.categoryId = null;
          data.subcategoryId = null;
        } else {
          const categories = await list('category');
          const cat = resolveCategory(categories, category);
          if (!cat) return fail(`Unknown category: "${category}". Call get_overview for the list.`);
          data.categoryId = cat.categoryId;
          data.subcategoryId = cat.subcategoryId;
        }
      }
      if (account !== undefined) {
        if (account === null) data.accountId = null;
        else {
          const accounts = await list('account');
          const acc = byRef(accounts, account);
          if (!acc) return fail(`Unknown account: "${account}". Call get_overview for the list.`);
          data.accountId = acc.id;
        }
      }
      if (!Object.keys(data).length) return fail('No fields to update.');
      const tx = await update('transaction', id, data);
      return ok({ updated: { id: tx.id, date: dayOf(tx.date), merchant: tx.merchant, amount: tx.amount } });
    }
  );

  server.registerTool(
    'delete_transactions',
    {
      title: 'Delete transactions',
      description:
        'Permanently delete transactions by id. Irreversible — confirm with the user first.',
      inputSchema: { ids: z.array(z.string()).min(1).max(500) },
      annotations: { destructiveHint: true },
    },
    async ({ ids }) => {
      await service.handle('removeMany', { entity: 'transaction', ids });
      return ok({ deleted: ids.length });
    }
  );

  /* ------------------------- setup / autofill tools ------------------------ */

  server.registerTool(
    'add_categories',
    {
      title: 'Add categories',
      description:
        'Create spending/income categories (optionally nested one level under a parent). Existing names are skipped, so it is safe to send a full list.',
      inputSchema: {
        categories: z
          .array(
            z.object({
              name: z.string().min(1),
              type: z.enum(['expense', 'income']).optional().describe('Default expense'),
              parent: z.string().optional().describe('Parent category name or id'),
              color: z.string().optional().describe('Hex color, e.g. #6366f1'),
              icon: z.string().optional().describe('Lucide icon name, e.g. shopping-cart'),
            })
          )
          .min(1)
          .max(100),
      },
    },
    async ({ categories: rows }) => {
      const existing = await list('category');
      const created: { id: string; name: string }[] = [];
      const skipped: string[] = [];
      for (const row of rows) {
        const parent = row.parent ? byRef(existing, row.parent) : undefined;
        if (row.parent && !parent) {
          skipped.push(`${row.name} (unknown parent "${row.parent}")`);
          continue;
        }
        const dupe = existing.find(
          (c) => norm(c.name) === norm(row.name) && (c.parentId ?? null) === (parent?.id ?? null)
        );
        if (dupe) {
          skipped.push(`${row.name} (already exists)`);
          continue;
        }
        const cat = await create('category', {
          name: row.name,
          type: row.type ?? parent?.type ?? 'expense',
          parentId: parent?.id ?? null,
          ...(row.color ? { color: row.color } : {}),
          ...(row.icon ? { icon: row.icon } : {}),
        });
        existing.push(cat);
        created.push({ id: cat.id, name: cat.name });
      }
      return ok({ created, skipped: skipped.length ? skipped : undefined });
    }
  );

  server.registerTool(
    'add_accounts',
    {
      title: 'Add accounts',
      description: 'Create bank/cash/credit accounts. Existing names are skipped.',
      inputSchema: {
        accounts: z
          .array(
            z.object({
              name: z.string().min(1),
              type: z.enum(['checking', 'savings', 'credit', 'cash', 'investment']).optional(),
              startBalance: z
                .number()
                .optional()
                .describe('Balance before any recorded transactions (default 0)'),
              color: z.string().optional(),
            })
          )
          .min(1)
          .max(50),
      },
    },
    async ({ accounts: rows }) => {
      const existing = await list('account');
      const created: { id: string; name: string }[] = [];
      const skipped: string[] = [];
      for (const row of rows) {
        if (byRef(existing, row.name)) {
          skipped.push(`${row.name} (already exists)`);
          continue;
        }
        const acc = await create('account', {
          name: row.name,
          type: row.type ?? 'checking',
          startBalance: row.startBalance ?? 0,
          ...(row.color ? { color: row.color } : {}),
        });
        existing.push(acc);
        created.push({ id: acc.id, name: acc.name });
      }
      return ok({ created, skipped: skipped.length ? skipped : undefined });
    }
  );

  server.registerTool(
    'set_budgets',
    {
      title: 'Set budgets',
      description:
        'Set monthly budgets per category. Without month/year the amount becomes the recurring budget for every month; with month+year it overrides just that month. Amount 0 removes the budget. Budgets attach to root categories — subcategory names roll up automatically.',
      inputSchema: {
        budgets: z
          .array(
            z.object({
              category: z.string().describe('Category name or id'),
              amount: z.number().min(0),
              month: z.number().int().min(1).max(12).optional(),
              year: z.number().int().min(2000).max(2100).optional(),
            })
          )
          .min(1)
          .max(100),
      },
    },
    async ({ budgets: rows }) => {
      const [categories, budgets] = await Promise.all([list('category'), list('budget')]);
      const results: string[] = [];
      for (const row of rows) {
        if ((row.month == null) !== (row.year == null)) {
          results.push(`${row.category}: month and year must be given together — skipped`);
          continue;
        }
        const resolved = resolveCategory(categories, row.category);
        if (!resolved) {
          results.push(`${row.category}: unknown category — skipped`);
          continue;
        }
        const categoryId = resolved.categoryId; // budgets live on root categories
        const label = categories.find((c) => c.id === categoryId)?.name ?? row.category;
        const slot = (b: Budget) =>
          b.categoryId === categoryId &&
          b.period === 'monthly' &&
          (b.month ?? null) === (row.month ?? null) &&
          (b.year ?? null) === (row.year ?? null);
        const existing = (budgets as Budget[]).find(slot);
        const slotDesc = row.month ? `${row.year}-${String(row.month).padStart(2, '0')}` : 'recurring';
        if (row.amount === 0) {
          if (existing) {
            await service.handle('remove', { entity: 'budget', id: existing.id });
            results.push(`${label}: ${slotDesc} budget removed`);
          } else {
            results.push(`${label}: no ${slotDesc} budget to remove`);
          }
          continue;
        }
        if (existing) {
          await update('budget', existing.id, { amount: row.amount });
          results.push(`${label}: ${slotDesc} budget updated to ${row.amount}`);
        } else {
          const created = await create('budget', {
            categoryId,
            amount: row.amount,
            period: 'monthly',
            month: row.month ?? null,
            year: row.year ?? null,
          });
          (budgets as Budget[]).push(created);
          results.push(`${label}: ${slotDesc} budget set to ${row.amount}`);
        }
      }
      return ok({ results });
    }
  );

  server.registerTool(
    'add_bills',
    {
      title: 'Add bills',
      description:
        'Create recurring (or one-time) bills. dueDate is the NEXT due date; marking a bill paid logs the expense and advances it by frequency. Existing bill names are skipped.',
      inputSchema: {
        bills: z
          .array(
            z.object({
              name: z.string().min(1),
              amount: z.number().positive(),
              dueDate: z.string().describe('Next due date (YYYY-MM-DD)'),
              frequency: z
                .enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'once'])
                .optional()
                .describe('Default monthly'),
              autoPay: z.boolean().optional(),
              reminderDays: z.number().int().min(0).max(60).optional().describe('Default 3'),
              category: z.string().optional(),
              account: z.string().optional(),
              notes: z.string().optional(),
            })
          )
          .min(1)
          .max(100),
      },
    },
    async ({ bills: rows }) => {
      const [existing, categories, accounts] = await Promise.all([
        list('bill'),
        list('category'),
        list('account'),
      ]);
      const created: { id: string; name: string; dueDate: string }[] = [];
      const skipped: string[] = [];
      for (const row of rows) {
        if (byRef(existing, row.name)) {
          skipped.push(`${row.name} (already exists)`);
          continue;
        }
        const iso = parseDate(row.dueDate);
        if (!iso) {
          skipped.push(`${row.name} (unparseable dueDate "${row.dueDate}")`);
          continue;
        }
        const cat = row.category ? resolveCategory(categories, row.category) : null;
        const acc = row.account ? byRef(accounts, row.account) : undefined;
        const bill = await create('bill', {
          name: row.name,
          amount: row.amount,
          dueDate: iso,
          frequency: row.frequency ?? 'monthly',
          autoPay: row.autoPay ?? false,
          reminderDays: row.reminderDays ?? 3,
          categoryId: cat?.categoryId ?? null,
          accountId: acc?.id ?? null,
          notes: row.notes ?? null,
        });
        existing.push(bill);
        created.push({ id: bill.id, name: bill.name, dueDate: dayOf(bill.dueDate) });
      }
      return ok({ created, skipped: skipped.length ? skipped : undefined });
    }
  );

  server.registerTool(
    'mark_bill_paid',
    {
      title: 'Mark a bill paid',
      description:
        'Log a payment for a bill exactly like the app: records an expense transaction, then advances the due date by the bill\'s frequency (one-time bills are removed).',
      inputSchema: {
        bill: z.string().describe('Bill name or id'),
        paidDate: z.string().optional().describe('Default today'),
        amount: z.number().positive().optional().describe('Override if this payment differs'),
      },
    },
    async ({ bill: ref, paidDate, amount }) => {
      const bills = await list('bill');
      const bill = byRef(bills as Bill[], ref);
      if (!bill) return fail(`Unknown bill: "${ref}". Call get_overview for the list.`);
      const iso = paidDate ? parseDate(paidDate) : new Date().toISOString();
      if (!iso) return fail(`Unparseable paidDate: "${paidDate}"`);
      const tx = await create('transaction', {
        date: iso,
        amount: amount ?? bill.amount,
        type: 'expense',
        merchant: bill.name,
        description: 'Bill payment',
        categoryId: bill.categoryId ?? null,
        accountId: bill.accountId ?? null,
        recurring: bill.frequency !== 'once',
        paymentMethod: bill.autoPay ? 'Bank Transfer' : null,
      });
      if (bill.frequency === 'once') {
        await service.handle('remove', { entity: 'bill', id: bill.id });
        return ok({ paid: bill.name, transactionId: tx.id, note: 'One-time bill removed.' });
      }
      const updated = await update('bill', bill.id, {
        dueDate: advanceBillDate(bill),
        lastPaidDate: iso,
      });
      return ok({ paid: bill.name, transactionId: tx.id, nextDueDate: dayOf(updated.dueDate) });
    }
  );

  server.registerTool(
    'add_income_sources',
    {
      title: 'Add income sources',
      description:
        'Register recurring income (salary, freelance, …). `amount` is NET take-home per pay period; pass grossAmount too when the user knows it. If you only have gross, supply deductionPct and the net is calculated. Existing names are skipped.',
      inputSchema: {
        sources: z
          .array(
            z.object({
              name: z.string().min(1),
              amount: z
                .number()
                .positive()
                .optional()
                .describe('Net (take-home) per pay period. Omit to derive from grossAmount + deductionPct'),
              grossAmount: z.number().positive().optional().describe('Gross per pay period, before taxes'),
              deductionPct: z
                .number()
                .min(0)
                .max(100)
                .optional()
                .describe('Percent withheld (taxes, 401k, …); only used when `amount` is omitted'),
              frequency: z
                .enum(['weekly', 'biweekly', 'twicemonthly', 'monthly', 'quarterly', 'yearly', 'onetime'])
                .optional()
                .describe('Default monthly'),
              nextPayDate: z.string().optional(),
              notes: z.string().optional(),
            })
          )
          .min(1)
          .max(50),
      },
    },
    async ({ sources: rows }) => {
      const existing = await list('incomeSource');
      const created: { id: string; name: string; net: number; gross?: number }[] = [];
      const skipped: string[] = [];
      for (const row of rows) {
        if (byRef(existing, row.name)) {
          skipped.push(`${row.name} (already exists)`);
          continue;
        }
        const net =
          row.amount ??
          (row.grossAmount != null && row.deductionPct != null
            ? round2(row.grossAmount * (1 - row.deductionPct / 100))
            : undefined);
        if (net == null || net <= 0) {
          skipped.push(`${row.name} (need amount, or grossAmount + deductionPct)`);
          continue;
        }
        if (row.grossAmount != null && row.grossAmount < net) {
          skipped.push(`${row.name} (grossAmount is below net amount)`);
          continue;
        }
        const src = await create('incomeSource', {
          name: row.name,
          amount: net,
          grossAmount: row.grossAmount ?? null,
          frequency: row.frequency ?? 'monthly',
          nextPayDate: row.nextPayDate ? parseDate(row.nextPayDate) : null,
          notes: row.notes ?? null,
        });
        existing.push(src);
        created.push({ id: src.id, name: src.name, net, gross: row.grossAmount });
      }
      return ok({ created, skipped: skipped.length ? skipped : undefined });
    }
  );

  server.registerTool(
    'add_goals',
    {
      title: 'Add goals',
      description: 'Create savings/debt/purchase goals. Existing names are skipped.',
      inputSchema: {
        goals: z
          .array(
            z.object({
              name: z.string().min(1),
              type: z.enum(['savings', 'debt', 'purchase', 'custom']).optional(),
              targetAmount: z.number().positive(),
              currentAmount: z.number().min(0).optional(),
              targetDate: z.string().optional(),
              notes: z.string().optional(),
            })
          )
          .min(1)
          .max(50),
      },
    },
    async ({ goals: rows }) => {
      const existing = await list('goal');
      const created: { id: string; name: string }[] = [];
      const skipped: string[] = [];
      for (const row of rows) {
        if (byRef(existing, row.name)) {
          skipped.push(`${row.name} (already exists)`);
          continue;
        }
        const goal = await create('goal', {
          name: row.name,
          type: row.type ?? 'savings',
          targetAmount: row.targetAmount,
          currentAmount: row.currentAmount ?? 0,
          targetDate: row.targetDate ? parseDate(row.targetDate) : null,
          notes: row.notes ?? null,
        });
        existing.push(goal);
        created.push({ id: goal.id, name: goal.name });
      }
      return ok({ created, skipped: skipped.length ? skipped : undefined });
    }
  );

  server.registerTool(
    'sync_bank_transactions',
    {
      title: 'Sync bank transactions',
      description:
        'Pull new transactions from the user\'s connected bank accounts (SimpleFIN). Deduped against existing data and auto-categorized by the user\'s learned rules. Fails if bank sync has not been set up in Settings.',
    },
    async () => {
      if (!(await simplefinConfigured(service))) {
        return fail('Bank sync is not connected. The user can set it up in Settings → Bank sync with a SimpleFIN setup token.');
      }
      return ok(await simplefinSync(service));
    }
  );

  return server;
}

/**
 * Express handler for POST /mcp. Stateless: a fresh McpServer + transport per
 * request keeps the endpoint compatible with any number of concurrent AI
 * clients without session juggling.
 */
export function createMcpHandler(service: DataService) {
  return async (req: Request, res: Response) => {
    const server = buildMcpServer(service);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: err instanceof Error ? err.message : 'Internal error' },
          id: null,
        });
      }
    }
  };
}
