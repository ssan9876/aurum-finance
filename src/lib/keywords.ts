/**
 * Built-in merchant keyword → category guesser.
 *
 * Second layer of auto-categorization: the user's learned rules
 * (src/lib/rules.ts) always run first, this library catches well-known
 * merchants and statement patterns, and the optional AI pass (server/ai.ts)
 * mops up whatever is left. Pure and dependency-free so it runs in the
 * renderer (OFX/CSV imports), the server (SimpleFIN sync, MCP) and tests.
 *
 * Guesses target the DEFAULT_CATEGORIES names; `applyKeywordsToDrafts`
 * resolves them against the user's real category tree by name (creating a
 * category only when the user deleted the default it needs).
 */
import type { Category, CategoryType, TransactionType } from '@/shared/types';
import { DEFAULT_CATEGORIES } from '@/shared/defaults';

export interface KeywordGuess {
  /** Root category name as seeded in DEFAULT_CATEGORIES. */
  category: string;
  /** Child category name (e.g. Groceries under Food). */
  subcategory?: string;
  type: CategoryType;
}

interface KeywordEntry extends KeywordGuess {
  match: RegExp;
}

const E = (match: RegExp, category: string, subcategory?: string): KeywordEntry => ({
  match,
  category,
  subcategory,
  type: 'expense',
});
const I = (match: RegExp, category: string): KeywordEntry => ({ match, category, type: 'income' });

/**
 * First match wins — keep specific patterns (amazon prime, walmart
 * neighborhood, uber eats) above the generic ones they would otherwise
 * shadow. Patterns run against a lowercased, whitespace-collapsed merchant.
 */
const KEYWORDS: KeywordEntry[] = [
  // --- income --------------------------------------------------------------
  I(/(payroll|direct ?dep|dir dep|salary|paycheck|\bgusto\b|\badp\b|paychex|workday pay)/, 'Income'),
  I(/(interest|dividend|\byield\b)/, 'Income'),
  I(/(irs treas|tax ?ref|ssa treas|social security|unemployment|\brefund\b|cash ?back|reward)/, 'Income'),

  // --- subscriptions & digital services (before Shopping: "amazon prime") ---
  E(/(netflix|spotify|hulu|disney ?(\+|plus)|hbo ?max|\bmax\.com|paramount ?(\+|plus)|peacock|youtube ?(premium|tv)|apple\.com\/bill|apple ?(music|one|tv)|icloud|amazon prime|prime video|audible|kindle)/, 'Subscriptions'),
  E(/(patreon|substack|twitch|discord|nytimes|wall street journal|\bwsj\b|washington post|medium\.com|masterclass)/, 'Subscriptions'),
  E(/(adobe|dropbox|google (one|storage)|microsoft 365|office 365|canva|openai|chatgpt|anthropic|claude\.ai|github)/, 'Subscriptions'),
  E(/(planet fitness|la fitness|anytime fitness|24 hour fitness|crunch fitness|gold'?s gym|orangetheory|\bymca\b|peloton|gym membership)/, 'Subscriptions'),

  // --- food ------------------------------------------------------------------
  E(/(kroger|safeway|albertsons|publix|wegmans|whole foods|trader joe|\baldi\b|\blidl\b|h-?e-?b\b|meijer|winco|sprouts|food lion|giant eagle|stop & shop|harris teeter|piggly wiggly|save-?a-?lot|winn-?dixie|market basket|fresh market|instacart|costco|sam'?s club|bj'?s wholesale|walmart neighborhood|grocery|supermarket)/, 'Food', 'Groceries'),
  E(/(mcdonald|burger king|wendy'?s|taco bell|chick.?fil.?a|chipotle|\bsubway\b|starbucks|dunkin|domino|pizza hut|little caesars|papa john|\bkfc\b|popeyes|panda express|panera|olive garden|applebee|chili'?s|\bihop\b|denny'?s|waffle house|five guys|sonic drive|arby'?s|dairy queen|jimmy john|jersey mike|firehouse subs|wingstop|raising cane|culver|zaxby|bojangles|in-?n-?out|whataburger|shake shack|cracker barrel|texas roadhouse|outback steak|red lobster|buffalo wild)/, 'Food', 'Restaurants'),
  E(/(doordash|grubhub|uber ?eats|postmates|seamless)/, 'Food', 'Restaurants'),
  E(/(restaurant|\bcafe\b|coffee|espresso|bistro|\bdiner\b|\bgrill\b|pizzeria|\bpizza\b|sushi|ramen|taqueria|cantina|bakery|brewer|taproom|\bpub\b|steakhouse|\bbbq\b|\btavern\b)/, 'Food', 'Restaurants'),

  // --- transportation ----------------------------------------------------
  E(/(\bshell\b|chevron|exxon|\bmobil\b|\bbp\b|texaco|sunoco|circle k|speedway|quiktrip|racetrac|casey'?s|pilot travel|love'?s travel|maverik|sheetz|wawa|gas station|fuel|\bgasoline\b)/, 'Transportation'),
  E(/(\buber(?! ?eats)\b|\blyft\b|amtrak|metro transit|transit auth|\bmta\b|parking|parkmobile|\btoll\b|e-?zpass|sunpass|fastrak)/, 'Transportation'),
  E(/(jiffy lube|valvoline|autozone|o'?reilly auto|advance auto|napa auto|discount tire|firestone|midas|meineke|car wash|\bdmv\b|smog check)/, 'Transportation'),

  // --- housing --------------------------------------------------------------
  E(/(\brent\b|mortgage|\bhoa\b|home depot|lowe'?s|menards|ace hardware|harbor freight|property (mgmt|management)|apartment|realty|landlord|terminix|orkin|lawn|pest control)/, 'Housing'),

  // --- utilities ------------------------------------------------------------
  E(/(electric|power & light|water (dept|district|bill|works)|sewer|city util|utilit|duke energy|dominion energy|pg&e|con ?ed|national grid|waste management|republic services|\btrash\b|recology)/, 'Utilities'),
  E(/(xfinity|comcast|spectrum|charter comm|cox comm|centurylink|frontier comm|verizon|at&t|\batt\b|t-mobile|us cellular|mint mobile|cricket wireless|boost mobile|google fi|internet|broadband)/, 'Utilities'),

  // --- medical ----------------------------------------------------------
  E(/(pharmacy|\bcvs\b|walgreens|rite aid|clinic|hospital|medical|dental|dentist|orthodon|dermatol|pediatric|urgent care|labcorp|quest diag|optical|optometr|vision center|chiropract|physical therapy|kaiser perm)/, 'Medical'),

  // --- insurance -------------------------------------------------------
  E(/(insurance|geico|progressive|state farm|allstate|liberty mutual|farmers ins|nationwide mut|aflac|metlife|aetna|cigna|humana|blue cross|blue shield|anthem)/, 'Insurance'),

  // --- education -------------------------------------------------------
  E(/(tuition|university|college|udemy|coursera|\bedx\b|chegg|skillshare|khan academy|duolingo|student loan|navient|nelnet|mohela)/, 'Education'),

  // --- travel ----------------------------------------------------------
  E(/(airline|airways|delta air|united air|american air|southwest air|alaska air|jetblue|spirit air|frontier air|allegiant|\bhotel\b|\bmotel\b|\binn\b|marriott|hilton|hyatt|wyndham|best western|airbnb|vrbo|expedia|booking\.com|priceline|hopper|hertz|\bavis\b|enterprise rent|budget rent|national car|alamo rent|turo|cruise)/, 'Travel'),

  // --- pets ------------------------------------------------------------
  E(/(petco|petsmart|chewy|pet supplies|veterinar|vet clinic|animal (hospital|clinic)|banfield|rover\.com|\bwag!\b)/, 'Pets'),

  // --- investments -----------------------------------------------------
  E(/(robinhood|coinbase|fidelity|vanguard|schwab|e\*?trade|webull|acorns|betterment|wealthfront|merrill|td ameritrade|\bcrypto\b|binance|kraken)/, 'Investments'),

  // --- taxes -----------------------------------------------------------
  E(/(\birs\b|turbotax|h&r block|taxact|jackson hewitt|tax (payment|pmt)|franchise tax)/, 'Taxes'),

  // --- gifts & giving --------------------------------------------------
  E(/(gofundme|donation|donate|red cross|salvation army|charity|\bchurch\b|tithe|unicef|st\.? jude)/, 'Gifts'),

  // --- savings (one-sided moves to savings elsewhere) -------------------
  E(/(to savings|savings transfer|transfer to sav|auto.?save|goal transfer)/, 'Savings'),

  // --- entertainment ---------------------------------------------------
  E(/(\bamc\b|regal|cinemark|cinema|movie|theatre|theater|ticketmaster|stubhub|\baxs\b|live ?nation|steam ?(games|powered)|playstation|\bxbox\b|nintendo|epic games|riot games|blizzard|bowling|topgolf|dave & buster|museum|\bzoo\b|aquarium|six flags|universal studios|disney(land| world)|arcade)/, 'Entertainment'),

  // --- shopping (generic catch-alls last) ------------------------------
  E(/(amazon|\bamzn\b|walmart|target|best buy|ebay|etsy|ikea|wayfair|macy'?s|nordstrom|kohl'?s|jcpenney|tj ?maxx|marshalls|ross stores|burlington|old navy|banana republic|\bgap\b|h&m|zara|uniqlo|nike|adidas|foot locker|dick'?s sporting|\brei\b|bass pro|cabela|barnes & noble|dollar (tree|general)|family dollar|five below|temu|shein|aliexpress|hobby lobby|michaels|joann)/, 'Shopping'),
];

const normalize = (m: string) => m.trim().toLowerCase().replace(/\s+/g, ' ');

/** Guess a category for a merchant string, or null when nothing matches. */
export function guessCategory(merchant: string, type: TransactionType): KeywordGuess | null {
  if (type === 'transfer') return null;
  const m = normalize(merchant);
  if (!m) return null;
  for (const k of KEYWORDS) {
    if (k.type === type && k.match.test(m)) {
      return { category: k.category, subcategory: k.subcategory, type: k.type };
    }
  }
  return null;
}

/** Seed color/icon for a canonical category we may need to (re)create. */
function seedFor(name: string, sub?: string): { icon: string; color: string } {
  const root = DEFAULT_CATEGORIES.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (sub && root?.children) {
    const child = root.children.find((c) => c.name.toLowerCase() === sub.toLowerCase());
    if (child) return { icon: child.icon, color: child.color };
  }
  if (root) return { icon: root.icon, color: root.color };
  return { icon: 'circle', color: '#94a3b8' };
}

export interface DraftForKeywords {
  merchant?: string | null;
  type?: TransactionType | string;
  categoryId?: string | null;
  subcategoryId?: string | null;
}

/**
 * Fill categoryId/subcategoryId on uncategorized drafts from the keyword
 * library. Missing categories are created via `createCategory` (and pushed
 * onto `categories` so later drafts reuse them). Returns how many were filled.
 */
export async function applyKeywordsToDrafts<T extends DraftForKeywords>(
  drafts: T[],
  categories: Category[],
  createCategory: (data: Partial<Category>) => Promise<Category>
): Promise<number> {
  let filled = 0;
  const findCat = (name: string, type: CategoryType, parentId: string | null) =>
    categories.find(
      (c) =>
        c.name.trim().toLowerCase() === name.toLowerCase() &&
        c.type === type &&
        (c.parentId ?? null) === parentId
    );

  for (const d of drafts) {
    if (d.categoryId || !d.merchant || (d.type !== 'expense' && d.type !== 'income')) continue;
    const guess = guessCategory(d.merchant, d.type);
    if (!guess) continue;

    let root = findCat(guess.category, guess.type, null);
    if (!root) {
      root = await createCategory({
        name: guess.category,
        type: guess.type,
        ...seedFor(guess.category),
      });
      categories.push(root);
    }
    let sub: Category | undefined;
    if (guess.subcategory) {
      sub = findCat(guess.subcategory, guess.type, root.id);
      if (!sub) {
        sub = await createCategory({
          name: guess.subcategory,
          type: guess.type,
          parentId: root.id,
          ...seedFor(guess.category, guess.subcategory),
        });
        categories.push(sub);
      }
    }
    d.categoryId = root.id;
    d.subcategoryId = sub?.id ?? null;
    filled++;
  }
  return filled;
}
