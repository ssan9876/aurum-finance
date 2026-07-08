/**
 * Merchant → category auto-categorization rules.
 *
 * Learned silently whenever the user categorizes a transaction by hand, then
 * applied everywhere uncategorized rows enter the system: OFX/CSV imports,
 * the add-transaction dialog (prefill), the MCP `add_transactions` tool and
 * SimpleFIN bank sync. Stored as JSON in the `setting` table under RULES_KEY
 * so all storage backends share them without a schema change (same pattern
 * as `csvPresets`). Keys are normalized merchant strings; a rule matches a
 * merchant exactly or as a substring ("starbucks" ⊂ "starbucks #1234").
 */
import type { Category, TransactionType } from '@/shared/types';

export const RULES_KEY = 'categoryRules';
const MAX_RULES = 400;

export interface CategoryRule {
  categoryId: string;
  subcategoryId: string | null;
  /** Last confirmed, epoch ms — oldest rules are pruned past MAX_RULES. */
  at: number;
}

export type RuleMap = Record<string, CategoryRule>;

export const normalizeMerchant = (m: string) => m.trim().toLowerCase().replace(/\s+/g, ' ');

export function parseRules(value: string | null | undefined): RuleMap {
  if (!value) return {};
  try {
    const v = JSON.parse(value);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: RuleMap = {};
    for (const [k, r] of Object.entries(v as Record<string, CategoryRule>)) {
      if (r && typeof r.categoryId === 'string') {
        out[k] = { categoryId: r.categoryId, subcategoryId: r.subcategoryId ?? null, at: r.at ?? 0 };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Match a merchant against the rules; stale rules (deleted categories) lose. */
export function matchRule(rules: RuleMap, merchant: string, categories: Category[]): CategoryRule | null {
  const m = normalizeMerchant(merchant);
  if (!m) return null;
  const valid = (r: CategoryRule) =>
    categories.some((c) => c.id === r.categoryId) &&
    (!r.subcategoryId || categories.some((c) => c.id === r.subcategoryId));

  const exact = rules[m];
  if (exact && valid(exact)) return exact;

  // Longest rule key contained in the merchant string wins.
  let bestKey = '';
  for (const key of Object.keys(rules)) {
    if (key.length > bestKey.length && key.length >= 3 && m.includes(key) && valid(rules[key])) {
      bestKey = key;
    }
  }
  return bestKey ? rules[bestKey] : null;
}

/** Record (or overwrite) a rule; returns the SAME map when nothing changed. */
export function learnRule(
  rules: RuleMap,
  merchant: string,
  categoryId: string,
  subcategoryId: string | null
): RuleMap {
  const m = normalizeMerchant(merchant);
  if (!m || !categoryId) return rules;
  const existing = rules[m];
  if (existing && existing.categoryId === categoryId && (existing.subcategoryId ?? null) === (subcategoryId ?? null)) {
    return rules;
  }
  const next: RuleMap = { ...rules, [m]: { categoryId, subcategoryId: subcategoryId ?? null, at: Date.now() } };
  const keys = Object.keys(next);
  if (keys.length > MAX_RULES) {
    keys.sort((a, b) => next[a].at - next[b].at);
    for (const k of keys.slice(0, keys.length - MAX_RULES)) delete next[k];
  }
  return next;
}

/**
 * Fill categoryId/subcategoryId on rows that lack a category. Mutates the
 * rows in place (they are import drafts) and returns how many were filled.
 * Rules only apply when the rule's category type matches the row type.
 */
export function applyRulesToDrafts<
  T extends {
    merchant?: string | null;
    type?: TransactionType | string;
    categoryId?: string | null;
    subcategoryId?: string | null;
  },
>(drafts: T[], rules: RuleMap, categories: Category[]): number {
  if (!Object.keys(rules).length) return 0;
  let filled = 0;
  for (const d of drafts) {
    if (d.categoryId || d.type === 'transfer' || !d.merchant) continue;
    const rule = matchRule(rules, d.merchant, categories);
    if (!rule) continue;
    const cat = categories.find((c) => c.id === rule.categoryId);
    if (!cat || cat.type !== (d.type === 'income' ? 'income' : 'expense')) continue;
    d.categoryId = rule.categoryId;
    d.subcategoryId = rule.subcategoryId;
    filled++;
  }
  return filled;
}
