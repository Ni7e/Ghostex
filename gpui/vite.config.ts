import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const gpuiRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(gpuiRoot, "..");
const sidebarOutDir = path.resolve(gpuiRoot, "dist/sidebar");

function inlineSidebarAssetsForCef(): Plugin {
  return {
    name: "ghostex-gpui-inline-sidebar-assets-for-cef",
    writeBundle(options, bundle) {
      const outDir = options.dir ?? sidebarOutDir;
      const htmlPath = path.join(outDir, "index.html");
      if (!fs.existsSync(htmlPath)) {
        throw new Error(`Ghostex GPUI sidebar build did not emit ${htmlPath}.`);
      }
      /*
       * CDXC:GPUIPhase1 2026-06-14-14:37:
       * The packaged GPUI sidebar is loaded by CEF from a file:// app resource URL. Chromium blocks external module scripts and stylesheets from that opaque origin, so the app bundle must ship a self-contained HTML entry that mounts React without relaxing file-origin security switches.
       */
      let html = fs.readFileSync(htmlPath, "utf8");
      for (const entry of Object.values(bundle)) {
        if (entry.type === "chunk" && entry.isEntry) {
          html = html.replace(
            new RegExp(
              `<script([^>]*?)src="${escapeRegExp(`./${entry.fileName}`)}"([^>]*)></script>`,
            ),
            () => `<script type="module">\n${inlineScriptContent(entry.code)}\n</script>`,
          );
        }

        if (entry.type === "asset" && entry.fileName.endsWith(".css")) {
          html = html.replace(
            new RegExp(
              `<link([^>]*?)href="${escapeRegExp(`./${entry.fileName}`)}"([^>]*?)>`,
            ),
            () => `<style>\n${inlineStyleContent(String(entry.source))}\n</style>`,
          );
        }
      }

      fs.writeFileSync(htmlPath, html);
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inlineScriptContent(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
}

function inlineStyleContent(value: string): string {
  return value.replace(/<\/style/gi, "<\\/style");
}

export default defineConfig({
  base: "./",
  root: gpuiRoot,
  plugins: [inlineSidebarAssetsForCef()],
  build: {
    emptyOutDir: true,
    outDir: sidebarOutDir,
    rolldownOptions: {
      /*
       * CDXC:GPUIPhase1 2026-06-14-12:50:
       * The GPUI shell resolves the bundled sidebar through Contents/Resources/sidebar/index.html. Keep the Vite HTML entry at the package root so production-style packaging and local development share that single entry URL.
       */
      input: path.resolve(gpuiRoot, "index.html"),
    },
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      /*
       * CDXC:GPUIPhase1 2026-06-14-12:06:
       * The phase-1 CEF sidebar bundle imports app-owned sidebar and shadcn modules from the repository root. Keep the same @ alias as Storybook and Electron so this prototype exercises the production React component graph.
       */
      "@": repoRoot,
    },
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
});
