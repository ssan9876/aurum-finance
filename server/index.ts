/**
 * Aurum self-hosted server: serves the built web app and exposes the same
 * data protocol the Electron app uses over IPC, backed by Prisma/SQLite.
 *
 * Environment:
 *   PORT            listen port (default 5533)
 *   AURUM_DB        path to the SQLite file (default ./prisma/dev.db)
 *   DATABASE_URL    full Prisma url — overrides AURUM_DB when set
 *   AURUM_PASSWORD  optional; when set, all /api/data calls require it
 *
 * Intended for localhost / trusted LAN (e.g. an LXC container). Put a
 * reverse proxy with TLS in front if you expose it beyond that.
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DataService } from './data-service';
import { createMcpHandler } from './mcp';
import { simplefinConnect, simplefinDisconnect, simplefinStatus, simplefinSync } from './simplefin';
import { startScheduler } from './scheduler';

const PORT = Number(process.env.PORT ?? 5533);
const PASSWORD = process.env.AURUM_PASSWORD ?? '';
const APP_VERSION = '1.4.0';

// AURUM_DB wins over DATABASE_URL: Prisma's client auto-loads a project .env
// at import time, which would otherwise silently override the service config.
const dbFile = process.env.AURUM_DB ?? path.join(process.cwd(), 'prisma', 'dev.db');
const dbUrl = process.env.AURUM_DB ? 'file:' + process.env.AURUM_DB : (process.env.DATABASE_URL ?? 'file:' + dbFile);

if (dbUrl === 'file:' + dbFile) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
}

const service = new DataService(dbUrl);

function keyMatches(candidate: string | undefined): boolean {
  if (!PASSWORD) return true;
  if (!candidate) return false;
  const a = crypto.createHash('sha256').update(candidate).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    app: 'aurum',
    version: APP_VERSION,
    authRequired: PASSWORD.length > 0,
    authOk: keyMatches(req.header('x-aurum-key') ?? undefined),
  });
});

app.post('/api/auth', (req, res) => {
  const ok = keyMatches(String(req.body?.password ?? ''));
  res.status(ok ? 200 : 401).json({ ok });
});

app.post('/api/data', async (req, res) => {
  if (!keyMatches(req.header('x-aurum-key') ?? undefined)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { method, payload } = req.body ?? {};
  if (typeof method !== 'string') {
    res.status(400).json({ error: 'Missing method' });
    return;
  }
  try {
    const result = await service.handle(method, payload);
    res.json({ result });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Request failed' });
  }
});

function requireKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!keyMatches(req.header('x-aurum-key') ?? undefined)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// SimpleFIN Bridge bank sync (see server/simplefin.ts).
const sfin = (fn: (service: DataService, body: any) => Promise<unknown>) =>
  async (req: express.Request, res: express.Response) => {
    try {
      res.json(await fn(service, req.body ?? {}));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'SimpleFIN request failed' });
    }
  };
app.get('/api/simplefin/status', requireKey, sfin(() => simplefinStatus(service)));
app.post('/api/simplefin/connect', requireKey, sfin((s, body) => simplefinConnect(s, String(body.token ?? ''))));
app.post('/api/simplefin/sync', requireKey, sfin((s, body) => simplefinSync(s, { full: !!body.full })));
app.post('/api/simplefin/disconnect', requireKey, sfin(() => simplefinDisconnect(service)));

// MCP endpoint for AI assistants (Claude Desktop/Code, claude.ai connectors).
// Same secret as /api/data; MCP clients usually send it as a Bearer token.
const mcpHandler = createMcpHandler(service);
app.post('/mcp', (req, res) => {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.header('authorization') ?? '')?.[1];
  if (!keyMatches(bearer ?? req.header('x-aurum-key') ?? undefined)) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized: send the Aurum password as a Bearer token' },
      id: null,
    });
    return;
  }
  void mcpHandler(req, res);
});
// Stateless server — no SSE stream or sessions to resume/terminate.
app.all('/mcp', (_req, res) => {
  res
    .status(405)
    .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
});

// Static web app (hash router → a single index.html is enough).
const distDir = path.join(__dirname, '..', 'dist');
app.use(express.static(distDir));
app.get('/', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));

async function main() {
  await service.init();
  startScheduler(service, path.join(path.dirname(dbFile), 'backups'));
  app.listen(PORT, () => {
    console.log(`[aurum] serving on http://0.0.0.0:${PORT}`);
    console.log(`[aurum] database: ${dbUrl}`);
    console.log(`[aurum] auth: ${PASSWORD ? 'password required' : 'open (set AURUM_PASSWORD to protect)'}`);
  });
}

main().catch((err) => {
  console.error('[aurum] failed to start:', err);
  process.exit(1);
});
