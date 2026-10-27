import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const dashboardRoot = fileURLToPath(new URL("./src/dashboard", import.meta.url));

export default defineConfig({
  root: dashboardRoot,
  publicDir: false,
  plugins: [{
    name: "phase-one-email-logo",
    generateBundle() {
      this.emitFile({
        type: "asset",
        // Use a versioned PNG so mail proxies do not retain the previously
        // published, corrupted WebP in their image cache.
        fileName: "assets/phase-one-email-logo-v2.png",
        source: readFileSync(resolve(dashboardRoot, "phase-one-email-logo-v2.png")),
      });
    },
  }],
  build: {
    outDir: fileURLToPath(new URL("./dist/dashboard", import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      input: {
        index: resolve(dashboardRoot, "index.html"),
      },
    },
  },
});
