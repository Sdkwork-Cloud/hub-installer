import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((value) => `node:${value}`),
  "commander",
  "yaml"
];

export default defineConfig({
  plugins: [
    dts({
      entryRoot: "src",
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts"],
      outDir: "dist/types",
      insertTypesEntry: true
    })
  ],
  build: {
    target: "node20",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es", "cjs"],
      fileName: (format: string) => (format === "es" ? "index.mjs" : "index.cjs")
    },
    rollupOptions: {
      external: nodeExternals
    }
  }
});
