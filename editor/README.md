# Ghostex Editor

Standalone Monaco editor assets for `GhostexEditor.app`.

Phase 1 builds a self-contained web page with no React or Ghostex app imports.
The native app injects `window.__GHOSTEX_EDITOR_BOOTSTRAP__` before the page
loads, and the page talks back through the `ghostexEditorHost` WKWebView message
handler.

Build the web bundle from the repo root:

```bash
bun editor/scripts/build-editor-web.mjs
```

The output is written to `editor/dist/web/`, with Monaco's AMD runtime staged at
`editor/dist/web/monaco/vs`.
