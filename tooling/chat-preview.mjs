#!/usr/bin/env bun
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, openSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'darwin')
  throw new Error(
    'The Chat Lab app launcher currently packages macOS only. The React reference works through Vite on other platforms.'
  );
const data = path.join(homedir(), '.local/share/ghostex/chat-preview');
const statePath = path.join(data, 'state.json');
const app = path.join(homedir(), 'Applications/Ghostex Chat Lab.app');
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
};
mkdirSync(data, { recursive: true });
if (!process.argv.includes('--no-build')) {
  run('bash', ['apps/desktop/scripts/build-macos-rust.sh'], { env: { ...process.env, GHOSTEX_LOCAL_START: '1' } });
}
let serving = false;
try {
  const response = await fetch('http://127.0.0.1:5188/__preview/state');
  serving = response.ok && typeof (await response.json()).scenario === 'string';
} catch {}
if (!serving) {
  const log = openSync(path.join(data, 'vite.log'), 'a');
  const child = spawn('bunx', ['vite', '--config', 'apps/desktop/test/chat-preview/vite.config.ts'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, GHOSTEX_CHAT_PREVIEW_STATE: statePath },
  });
  child.unref();
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      serving = (await fetch('http://127.0.0.1:5188/__preview/state')).ok;
    } catch {}
    if (serving) break;
  }
  if (!serving) throw new Error(`React preview did not start. See ${path.join(data, 'vite.log')}`);
}
const contents = path.join(app, 'Contents');
mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
copyFileSync(
  path.join(root, 'apps/desktop/target/release/ghostex-gpui'),
  path.join(contents, 'MacOS/Ghostex Chat Lab')
);
const xml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
writeFileSync(
  path.join(contents, 'Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Ghostex Chat Lab</string><key>CFBundleIdentifier</key><string>com.madda.ghostex.chat-lab</string><key>CFBundleName</key><string>Ghostex Chat Lab</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>${Date.now()}</string><key>NSHighResolutionCapable</key><true/><key>LSEnvironment</key><dict><key>GHOSTEX_CHAT_PREVIEW_STATE</key><string>${xml(statePath)}</string></dict></dict></plist>`
);
const frameworks = path.join(contents, 'Frameworks');
mkdirSync(frameworks, { recursive: true });
const framework = path.join(frameworks, 'Chromium Embedded Framework.framework');
if (!existsSync(framework))
  symlinkSync(path.join(root, 'apps/desktop/build/cef-cache/Chromium Embedded Framework.framework'), framework);
for (const suffix of ['', ' (Alerts)', ' (GPU)', ' (Plugin)', ' (Renderer)']) {
  const name = `Ghostex Chat Lab Helper${suffix}`;
  const helper = path.join(frameworks, `${name}.app`);
  mkdirSync(path.join(helper, 'Contents/MacOS'), { recursive: true });
  copyFileSync(
    path.join(root, 'apps/desktop/target/release/ghostex-gpui-cef-helper'),
    path.join(helper, 'Contents/MacOS', name)
  );
  writeFileSync(
    path.join(helper, 'Contents/Info.plist'),
    `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>${name}</string><key>CFBundleName</key><string>${name}</string><key>CFBundleIdentifier</key><string>com.madda.ghostex.chat-lab.helper${suffix.replace(/[^a-zA-Z]/g, '')}</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`
  );
  run('codesign', ['--force', '--sign', '-', helper]);
}
run('codesign', ['--force', '--sign', '-', app]);
run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', [
  '-f',
  app,
]);
if (!process.argv.includes('--package-only')) run('cua-driver', [
  'launch_app',
  JSON.stringify({ bundle_id: 'com.madda.ghostex.chat-lab', creates_new_application_instance: true }),
]);
console.log(
  `Side-by-side Chat Lab: ${app}\nStandalone React reference: http://127.0.0.1:5188\nQuit Chat Lab and rerun bun run chat:lab after native code changes. React changes reload automatically.`
);
