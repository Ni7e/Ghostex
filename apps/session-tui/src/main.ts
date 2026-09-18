#!/usr/bin/env bun
import { options } from './paths';
import { Store } from './store';
import { TerminalUI } from './ui';
import { openBrowser, nameAttachedPane } from './herdr';
import { attach } from './attach';
import { Zmx } from './zmx';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`ghostex-debug: standalone Ghostex session TUI

  ghostex-debug                 Browse spaces, projects and sessions
  ghostex-debug --direct        List local zmx daemons directly
  ghostex-debug --offline       Do not contact gxserver
  ghostex-debug --json          Print the current catalog and daemon inventory
  ghostex-debug --herdr-float   Open the floating Herdr debugger (F8 / Esc hides)

  --url URL                    Local gxserver URL (auto-discovered)
  --token-file PATH            Auth token file (never cached)
  --zmx PATH                   Ghostex-compatible zmx executable
  --zmx-dir PATH               Explicit socket namespace
  --state-dir PATH             Debugger cache directory
  --space ID                   Initially selected space

  ↑↓ select  Enter attach  ←→ collapse/expand  [ ] spaces  / search
  n new  z direct zmx  s/t Herdr split/tab  ? help  q quit
  Mouse: click rows, spaces, headings or buttons; wheel to scroll.
  Ctrl+\\ detaches back to the standalone browser.
`);
} else {
  try {
    if (process.platform === 'win32')
      throw new Error(
        'Use this zmx debugger on macOS, Linux or inside WSL. Native Windows wmx is not supported.'
      );
    const config = await options(args);
    if (args.includes('--herdr-float')) await openBrowser(true);
    else if (args.includes('--herdr-open')) await openBrowser();
    else if (args.includes('--attach-env')) {
      const name = process.env.GHOSTEX_DEBUG_ZMX_NAME;
      if (!name) throw new Error('Missing daemon identity.');
      if (process.env.GHOSTEX_DEBUG_STATE_DIR) config.stateDir = process.env.GHOSTEX_DEBUG_STATE_DIR;
      await nameAttachedPane();
      await attach(new Zmx(config), name);
    } else {
      const store = new Store(config);
      if (config.json) {
        await store.initialize();
        console.log(JSON.stringify(store.export(), null, 2));
        if (store.zmxError || (!store.view && !store.daemons.length && store.serverError))
          process.exitCode = 1;
      } else await new TerminalUI(store, args.includes('--popup-ui')).start();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
