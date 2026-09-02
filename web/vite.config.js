import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// На GitHub Pages сайт живёт не в корне домена, а в /<имя-репозитория>/ —
// путь приходит из шага actions/configure-pages. Локально и на своём сервере
// база остаётся корнем.
const base = (process.env.BASE_PATH || "/").replace(/\/?$/, "/");

export default defineConfig({
  base,
  plugins: [react()],
  // Две страницы: модель (index.html) и отдельное окно звонка (call.html →
  // /call). У звонка свой бандл: ему не нужны схема, прогноз и задачи.
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        call: fileURLToPath(new URL("./call.html", import.meta.url)),
      },
    },
  },
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
