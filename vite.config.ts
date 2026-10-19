import { fileURLToPath, URL } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const dashboardRoot = fileURLToPath(new URL("./src/dashboard", import.meta.url));

export default defineConfig({
  root: dashboardRoot,
  publicDir: false,
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
