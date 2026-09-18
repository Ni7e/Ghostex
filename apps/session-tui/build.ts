import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(root, 'dist'), { recursive: true });
const result = spawnSync(
  process.execPath,
  [
    'build',
    '--compile',
    '--minify',
    '--target=bun',
    join(root, 'src/main.ts'),
    '--outfile',
    join(root, 'dist/ghostex-debug'),
  ],
  { cwd: root, stdio: 'inherit' }
);
process.exitCode = result.status ?? 1;
