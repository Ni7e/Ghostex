import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CHAT_PREVIEW, PREVIEW_SCENARIOS } from '../../../../packages/shared/session-chat-preview/fixture';
const root = fileURLToPath(new URL('.', import.meta.url));
export const statePath =
  process.env.GHOSTEX_CHAT_PREVIEW_STATE ?? path.join(os.homedir(), '.local/share/ghostex/chat-preview/state.json');
fs.mkdirSync(path.dirname(statePath), { recursive: true });
if (!fs.existsSync(statePath)) fs.writeFileSync(statePath, JSON.stringify(DEFAULT_CHAT_PREVIEW));
export default defineConfig({
  root,
  plugins: [
    react(),
    {
      name: 'chat-preview-controls',
      configureServer(server) {
        server.middlewares.use('/__preview/state', async (req, res) => {
          try {
            if (req.method === 'POST') {
              let data = '';
              for await (const chunk of req) {
                data += chunk;
                if (data.length > 4096) throw new Error('Invalid configuration');
              }
              const next = JSON.parse(data);
              if (
                !PREVIEW_SCENARIOS.includes(next.scenario) ||
                !['dark', 'light'].includes(next.theme) ||
                !Number.isFinite(next.zoom) ||
                next.zoom < 70 ||
                next.zoom > 200
              )
                throw new Error('Invalid configuration');
              fs.writeFileSync(
                statePath,
                JSON.stringify({
                  scenario: next.scenario,
                  theme: next.theme,
                  zoom: next.zoom,
                  verbose: next.verbose === true,
                  simple: next.simple === true,
                  revision: Date.now(),
                })
              );
            } else if (req.method !== 'GET') {
              res.statusCode = 405;
              res.end();
              return;
            }
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(fs.readFileSync(statePath));
          } catch (error) {
            res.statusCode = 400;
            res.end(String(error));
          }
        });
      },
    },
  ],
  resolve: { alias: { '@': path.resolve(root, '../../../..') }, dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1', port: 5188, strictPort: true, fs: { allow: [path.resolve(root, '../../../..')] } },
});
