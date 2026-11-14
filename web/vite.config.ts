import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  // Android's generated asset copies and Gradle reports are not web entries.
  optimizeDeps: { entries: ["index.html"] },
  build: {
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL("./index.html", import.meta.url)),
        hostChromePreview: fileURLToPath(new URL("./host-chrome-preview.html", import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3040",
      "/ws": {
        target: "ws://localhost:3040",
        ws: true,
      },
    },
  },
});
