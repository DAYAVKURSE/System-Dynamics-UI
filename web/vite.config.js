import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import i18nBabel from "./i18n-babel.js";

// На GitHub Pages сайт живёт не в корне домена, а в /<имя-репозитория>/ —
// путь приходит из шага actions/configure-pages. Локально и на своём сервере
// база остаётся корнем.
const base = (process.env.BASE_PATH || "/").replace(/\/?$/, "/");

export default defineConfig({
  base,
  // Перевод интерфейса: текст в JSX оборачивается вызовом t (см. i18n-babel.js).
  plugins: [react({ babel: { plugins: [i18nBabel] } })],
  // Три страницы: модель (index.html), отдельное окно звонка (call.html →
  // /call) и брейншторм-доска (board.html → /board, владелец, 2026-09-25).
  // У звонка и доски свои бандлы: им не нужны схема, прогноз и задачи.
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        call: fileURLToPath(new URL("./call.html", import.meta.url)),
        board: fileURLToPath(new URL("./board.html", import.meta.url)),
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
