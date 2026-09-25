import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// The desktop's app runtime bundle, evaluated in QuickJS by packages/chat-runtime (`ServiceRuntime`).
const outfile = process.argv[2];
if (!outfile) throw new Error('A service runtime output path is required.');
const service = await build({
  entryPoints: ['apps/desktop/sidebar/service/service.ts'],
  outfile,
  bundle: true, format: 'iife', platform: 'neutral', target: 'es2023',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' },
  mainFields: ['module', 'main'],
  plugins: [{ name: 'native-storage', setup(plugin) {
    plugin.onLoad({ filter: /\.svg$/ }, async args => ({ contents: await Bun.file(args.path).text(), loader: 'text' }));
    // CDXC:PlatformSupport 2026-09-20 WHY:
    // esbuild reports importer paths in the host's own separator, so this POSIX-only spelling stopped
    // matching on Windows and the browser adapters were bundled into the QuickJS service instead of the
    // native ones. The service then threw on `indexedDB` inside nativeService.start(), which left the
    // sidebar blank and, because initialize_cef bails when the native service is down, CEF never started.
    // Match either separator, and hand esbuild a real path: URL.pathname keeps a slash before the drive letter.
    plugin.onResolve({ filter: /(?:^|[\\/])(?:browser|database)$/ }, args => {
      if (!/[\\/]packages[\\/]client-storage[\\/]/.test(args.importer)) return;
      const file = args.path.endsWith('browser') ? 'native-preferences.ts' : 'native-database.ts';
      return { path: fileURLToPath(new URL('../packages/client-storage/adapters/' + file, import.meta.url)) };
    });
  }}],
  metafile: true,
});
for (const path of Object.keys(service.metafile.inputs)) {
  if (/node_modules\/(react|react-dom)(\/|$)/.test(path)) throw new Error(`Native services cannot import React: ${path}`);
  if (/(?:^|[\\/])packages[\\/]client-storage[\\/]adapters[\\/](?:browser|database)\.ts$/.test(path)) {
    throw new Error(`Native services must use native storage adapters: ${path}`);
  }
}
