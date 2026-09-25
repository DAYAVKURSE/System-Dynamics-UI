import React from "react";
import ReactDOM from "react-dom/client";
import BoardApp from "./components/BoardApp.jsx";
import { loadTelegramSdk } from "./telegramSdk.js";
import "./index.css";

/* ════════════════════════════════════════════════════════════════
   ОТДЕЛЬНЫЙ ВХОД ДЛЯ ДОСКИ (web/board.html → /board, владелец, 2026-09-25)

   Страница, на которую ведёт ссылка на доску, когда мини-приложения у
   бота нет: /board?board=<id>. Как и у звонка, SDK Telegram грузится
   отсюда и со сроком (telegramSdk.js), а не тегом в <head>: молчащий
   telegram.org не должен оставлять чёрный экран.
   ════════════════════════════════════════════════════════════════ */

loadTelegramSdk().then(() => {
  ReactDOM.createRoot(document.getElementById("root")).render(<BoardApp />);
});
