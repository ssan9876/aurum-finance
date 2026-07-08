import { app, BrowserWindow, ipcMain, shell, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataService } from '../server/data-service';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let win: BrowserWindow | null = null;
let dataService: DataService | null = null;

/**
 * Dev: use prisma/dev.db in the project. Packaged: copy the bundled template
 * database into userData on first run, then open it from there.
 */
function resolveDbUrl(): string {
  if (devServerUrl) {
    return 'file:' + path.join(process.cwd(), 'prisma', 'dev.db');
  }
  const userDb = path.join(app.getPath('userData'), 'aurum.db');
  if (!fs.existsSync(userDb)) {
    const template = path.join(process.resourcesPath, 'template.db');
    if (fs.existsSync(template)) fs.copyFileSync(template, userDb);
  }
  return 'file:' + userDb;
}

async function createWindow() {
  win = new BrowserWindow({
    title: 'Aurum',
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0c0e' : '#fafaf8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // required for the ESM preload bundle
    },
  });

  win.once('ready-to-show', () => win?.show());

  // Open external links in the system browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (devServerUrl) {
    await win.loadURL(devServerUrl);
  } else {
    await win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  dataService = new DataService(resolveDbUrl());
  try {
    await dataService.init();
  } catch (err) {
    console.error('[aurum] database init failed:', err);
  }

  ipcMain.handle('aurum:data', async (_event, method: string, payload: unknown) => {
    if (!dataService) throw new Error('Data service not ready');
    return dataService.handle(method, payload);
  });

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await dataService?.dispose();
  if (process.platform !== 'darwin') app.quit();
});
