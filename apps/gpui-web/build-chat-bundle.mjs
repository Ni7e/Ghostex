import { build } from 'esbuild';

// The TypeScript chat controller bundle each chat iframe evaluates (src/app/native_chat/runtime_worker.rs).
// The desktop no longer runs it: its chat is packages/gx-chat-core, hosted by apps/desktop/src/app/gx_chat/.
const outfile = process.argv[2];
if (!outfile) throw new Error('A chat bundle output path is required.');
const result = await build({
  entryPoints: ['packages/shared/session-chat-controller/native-host.ts'],
  outfile,
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  target: 'es2023',
  define: { 'process.env.NODE_ENV': '"production"' },
  metafile: true,
});
for (const path of Object.keys(result.metafile.inputs)) {
  if (/node_modules\/(react|react-dom)(\/|$)/.test(path)) {
    throw new Error(`The chat bundle must remain independent of React: ${path}`);
  }
}
