import { contextBridge, ipcRenderer } from 'electron';

// Minimal, typed surface. The renderer's DataApi client (src/data/api.ts)
// wraps this into the same interface the browser adapter implements.
contextBridge.exposeInMainWorld('aurum', {
  isDesktop: true,
  invoke: (method: string, payload?: unknown) => ipcRenderer.invoke('aurum:data', method, payload),
});
