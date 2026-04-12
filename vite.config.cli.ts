import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((value) => `node:${value}`),
  "commander",
  "yaml"
];

export default defineConfig({
  build: {
    target: "node20",
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    lib: {
      entry: resolve(__dirname, "src/cli.ts"),
      formats: ["es"],
      fileName: () => "cli.mjs"
    },
    rollupOptions: {
      external: nodeExternals,
      output: {
        banner: "#!/usr/bin/env node"
      }
    }
  }
});
