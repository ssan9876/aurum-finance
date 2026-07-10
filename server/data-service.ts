/**
 * Prisma-backed implementation of the Aurum data protocol, shared by the
 * Electron main process (IPC channel) and the self-hosted HTTP server
 * (POST /api/data). Both speak `{ method, payload }` messages — see
 * src/data/api.ts for the clients.
 */
import { PrismaClient } from '@prisma/client';
import { buildSeedRows } from '../src/shared/defaults';
import { normalizeDates, type BackupPayload, type EntityName } from '../src/shared/types';

const ORDER_BY: Partial<Record<EntityName, object | object[]>> = {
  transaction: { date: 'desc' },
  category: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  account: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  savingsAccount: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  savingsSnapshot: { date: 'asc' },
  bill: { dueDate: 'asc' },
  // No createdAt column on these two — the default sort would throw.
  tag: { name: 'asc' },
  setting: { key: 'asc' },
};

const MONEY_FIELDS = new Set([
  'amount',
  'grossAmount',
  'balance',
  'startBalance',
  'goal',
  'monthlyContribution',
  'targetAmount',
  'currentAmount',
  'minPayment',
]);

/** Deletion order that respects foreign keys (children first). */
const DELETE_ORDER: EntityName[] = [
  'setting',
  'tag',
  'goal',
  'bill',
  'budget',
  'savingsSnapshot',
  'transaction',
  'savingsAccount',
  'incomeSource',
  'category',
  'account',
];

/** Insert order for restore (parents first). */
const INSERT_ORDER: EntityName[] = [
  'account',
  'category',
  'savingsAccount',
  'incomeSource',
  'transaction',
  'savingsSnapshot',
  'budget',
  'bill',
  'goal',
  'tag',
  'setting',
];

/** Convert Dates → ISO strings so results survive IPC identically to JSON. */
const toWire = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function sanitize(entity: EntityName, data: Record<string, unknown>, isUpdate: boolean) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (k === 'updatedAt') continue; // managed by @updatedAt
    if (isUpdate && k === 'id') continue;
    // Relation objects/arrays never cross the wire; scalars only.
    if (typeof v === 'object' && v !== null && !(v instanceof Date)) continue;
    out[k] = typeof v === 'number' && MONEY_FIELDS.has(k) ? Math.round(v * 100) / 100 : v;
  }
  return normalizeDates(entity, out);
}

export class DataService {
  private prisma: PrismaClient;

  constructor(dbUrl: string) {
    this.prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  }

  private delegate(entity: EntityName) {
    const d = (this.prisma as Record<string, any>)[entity];
    if (!d) throw new Error(`Unknown entity: ${entity}`);
    return d;
  }

  /** Seed default categories/account on a fresh database. */
  async init() {
    const count = await this.prisma.category.count();
    if (count > 0) return;
    const seed = buildSeedRows();
    const parents = seed.categories.filter((c) => !c.parentId);
    const children = seed.categories.filter((c) => c.parentId);
    await this.prisma.category.createMany({ data: parents });
    await this.prisma.category.createMany({ data: children });
    await this.prisma.account.createMany({ data: seed.accounts });
    const user = await this.prisma.user.count();
    if (!user) await this.prisma.user.create({ data: { name: 'Me' } });
  }

  async handle(method: string, payload: any): Promise<unknown> {
    switch (method) {
      case 'list': {
        const entity = payload.entity as EntityName;
        return toWire(
          await this.delegate(entity).findMany({ orderBy: ORDER_BY[entity] ?? { createdAt: 'asc' } })
        );
      }
      case 'create': {
        const { entity, data } = payload;
        return toWire(await this.delegate(entity).create({ data: sanitize(entity, data, false) }));
      }
      case 'createMany': {
        const { entity, rows } = payload as { entity: EntityName; rows: Record<string, unknown>[] };
        const created: unknown[] = [];
        for (const row of rows) {
          created.push(await this.delegate(entity).create({ data: sanitize(entity, row, false) }));
        }
        return toWire(created);
      }
      case 'update': {
        const { entity, id, data } = payload;
        return toWire(
          await this.delegate(entity).update({ where: { id }, data: sanitize(entity, data, true) })
        );
      }
      case 'remove': {
        const { entity, id } = payload;
        await this.delegate(entity).delete({ where: { id } });
        return null;
      }
      case 'removeMany': {
        const { entity, ids } = payload;
        await this.delegate(entity).deleteMany({ where: { id: { in: ids } } });
        return null;
      }
      case 'setSetting': {
        const { key, value } = payload;
        await this.prisma.setting.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        });
        return null;
      }
      case 'exportAll': {
        const data: Record<string, unknown> = {};
        for (const entity of INSERT_ORDER) {
          data[entity] = await this.delegate(entity).findMany();
        }
        return toWire({
          app: 'aurum',
          version: 1,
          exportedAt: new Date().toISOString(),
          data,
        } satisfies BackupPayload);
      }
      case 'restore': {
        const backup = payload.payload as BackupPayload;
        if (!backup || backup.app !== 'aurum' || !backup.data) {
          throw new Error('Not a valid Aurum backup file.');
        }
        for (const entity of DELETE_ORDER) {
          await this.delegate(entity).deleteMany({});
        }
        for (const entity of INSERT_ORDER) {
          const rows = (backup.data as Record<string, Record<string, unknown>[]>)[entity] ?? [];
          // Parents before children for the self-referencing category tree.
          const ordered =
            entity === 'category' ? [...rows].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0)) : rows;
          for (const row of ordered) {
            await this.delegate(entity).create({ data: sanitize(entity, row, false) });
          }
        }
        return null;
      }
      default:
        throw new Error(`Unknown data method: ${method}`);
    }
  }

  async dispose() {
    await this.prisma.$disconnect();
  }
}
