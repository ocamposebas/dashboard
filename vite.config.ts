import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./src/dashboard", import.meta.url)),
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL("./dist/dashboard", import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },
});
