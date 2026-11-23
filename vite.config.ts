import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [cloudflare({ viteEnvironment: { name: "ssr" } }), tailwindcss(), reactRouter()],
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // zod places its pure annotations where the bundler cannot read them; they are dropped harmlessly.
        if (warning.code === "INVALID_ANNOTATION" && warning.id?.includes("/node_modules/zod/")) return;
        warn(warning);
      },
    },
  },
});
