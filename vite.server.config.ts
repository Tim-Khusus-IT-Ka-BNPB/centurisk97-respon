import { defineConfig } from "vite";

// The Node server (src/platform/node/main.ts) and the image's two import commands, beside the pages'
// build, so they take the same imports the pages do (JSON, ?inline). Packages stay in node_modules.
export default defineConfig({
  // The pages' build serves public/; the server needs none of it.
  publicDir: false,
  build: {
    ssr: true,
    outDir: "build/node",
    emptyOutDir: true,
    target: "node26",
    rollupOptions: {
      input: {
        main: "src/platform/node/main.ts",
        "import-places": "tools/reference-import/import.ts",
        "import-file": "tools/reference-import/importFile.ts",
      },
      output: { entryFileNames: "[name].js" },
    },
  },
});
