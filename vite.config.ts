import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from 'vite';
import dts from "vite-plugin-dts";

const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((value) => `node:${value}`),
  "commander",
  "yaml"
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  return {
    define: {
      'process.env.SDKWORK_ACCESS_TOKEN': JSON.stringify(env.SDKWORK_ACCESS_TOKEN ?? ''),
    },
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
