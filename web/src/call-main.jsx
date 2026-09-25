import React from "react";
import ReactDOM from "react-dom/client";
import CallApp from "./components/CallApp.jsx";
import { loadTelegramSdk } from "./telegramSdk.js";
import { boardFromLocation } from "./boards.js";
import "./index.css";

/* ════════════════════════════════════════════════════════════════
   ОТДЕЛЬНЫЙ ВХОД ДЛЯ ЗВОНКА (web/call.html → /call)

   SDK Telegram грузится ОТСЮДА, а не тегом в <head>, и это не
   украшательство — см. telegramSdk.js: тег в шапке при молчащем
   telegram.org оставляет чёрный экран без единой надписи. Страница
   рисуется сразу (в ней лежит заглушка), а SDK приходит со сроком. Не
   пришёл за пять секунд — открываем звонок без него: гостем войти можно
   и так, а чёрный экран не помогает никому.

   ДОСКА — ЧЕРЕЗ ЭТО ЖЕ ПРИЛОЖЕНИЕ (владелец, 2026-09-25). Ссылка на
   брейншторм-доску ведёт в то же мини-приложение, что и звонок
   (`startapp=board_<id>`): так владельцу не нужно заводить в @BotFather
   ещё одно. Параметр доски (или `?board=` в адресе) — рисуем доску, а не
   звонок; её код подгружается отдельно и звонку ничего не весит.
   ════════════════════════════════════════════════════════════════ */

/* Код доски подгружается ДО первого рендера, а не ленивым компонентом:
   React при первом рендере стирает заглушку #boot («Загружаю доску…»), и
   пока подгружался бы код, экран был бы пустым. А если подгрузка не
   удалась (связь оборвалась между бандлом и кусочком доски), ленивый
   компонент уронил бы корень — и страховка call.html, которая через 8 с
   ищет #boot, уже не нашла бы её: пустой экран навсегда. Так заглушка
   стоит, пока код не пришёл, а не пришёл — через 8 с она сама скажет
   «Доска не запустилась.» с причиной. */
const root = () => ReactDOM.createRoot(document.getElementById("root"));

loadTelegramSdk().then(async () => {
  // Параметр смотрим уже ПОСЛЕ SDK: `start_param` разбирает он.
  if (!boardFromLocation()) {
    root().render(<CallApp />);
    return;
  }
  let BoardApp;
  try {
    ({ default: BoardApp } = await import("./components/BoardApp.jsx"));
  } catch (e) {
    // Причину — в заглушку call.html: она собирает первую ошибку страницы.
    try { window.dispatchEvent(new ErrorEvent("error", { message: String(e?.message || e) })); }
    catch { /* старый WebView — хватит и заглушки */ }
    return;
  }
  root().render(<BoardApp />);
});
