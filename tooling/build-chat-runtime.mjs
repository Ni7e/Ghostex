import { build } from 'esbuild';

const outfile = process.argv[2];
if (!outfile) throw new Error('A chat runtime output path is required.');
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
    throw new Error(`The native chat runtime must remain independent of React: ${path}`);
  }
}


const service = await build({
  entryPoints: ['apps/desktop/sidebar/native-sidebar/service.ts'],
  outfile: outfile.replace(/chat-runtime\.js$/, 'service-runtime.js'),
  bundle: true, format: 'iife', platform: 'neutral', target: 'es2023',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' },
  mainFields: ['module', 'main'],
  plugins: [{ name: 'native-storage', setup(plugin) {
    plugin.onLoad({ filter: /\.svg$/ }, async args => ({ contents: await Bun.file(args.path).text(), loader: 'text' }));
    plugin.onResolve({ filter: /(?:^|\/)(?:browser|database)$/ }, args => {
      if (!args.importer.includes('/packages/client-storage/')) return;
      const file = args.path.endsWith('browser') ? 'native-preferences.ts' : 'native-database.ts';
      return { path: new URL('../packages/client-storage/adapters/' + file, import.meta.url).pathname };
    });
  }}],
  metafile: true,
});
for (const path of Object.keys(service.metafile.inputs)) {
  if (/node_modules\/(react|react-dom)(\/|$)/.test(path)) throw new Error(`Native services cannot import React: ${path}`);
}
