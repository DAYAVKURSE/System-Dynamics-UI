import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// На GitHub Pages сайт живёт не в корне домена, а в /<имя-репозитория>/ —
// путь приходит из шага actions/configure-pages. Локально и на своём сервере
// база остаётся корнем.
const base = (process.env.BASE_PATH || "/").replace(/\/?$/, "/");

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.js",
  },
});
