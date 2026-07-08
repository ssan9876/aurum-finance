import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';

// `npm run dev`      → desktop app (Electron main + preload built alongside the renderer)
// `npm run dev:web`  → pure browser mode; the renderer falls back to the local
//                      storage adapter, so no Electron/Prisma is needed.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === 'web'
      ? []
      : [
          electron({
            main: {
              entry: 'electron/main.ts',
              vite: {
                build: {
                  outDir: 'dist-electron',
                  rollupOptions: {
                    external: ['@prisma/client', '.prisma/client'],
                  },
                },
              },
            },
            preload: {
              input: path.join(__dirname, 'electron/preload.ts'),
              vite: { build: { outDir: 'dist-electron' } },
            },
          }),
        ]),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: { port: 5199 },
}));
