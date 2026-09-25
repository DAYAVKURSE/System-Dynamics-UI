/* ════════════════════════════════════════════════════════════════
   SDK TELEGRAM — СО СРОКОМ, А НЕ ТЕГОМ В <head>

   Для отдельных входов — окна звонка (call-main.jsx) и доски
   (board-main.jsx). Тег `<script src="https://telegram.org/…">` в шапке
   блокирует разбор документа: пока ответ не пришёл, браузер не читает
   даже <body>. Если telegram.org не отказывает, а МОЛЧИТ — плохая сеть,
   блокировка у провайдера, — страница не рисует вообще ничего, и снаружи
   это выглядит как чёрный экран без единой надписи. Проверено браузером:
   при быстром отказе текст виден через 2 секунды, при молчании — не виден
   и через 10.

   Поэтому: страница рисуется сразу (в ней лежит заглушка), а SDK грузится
   отсюда и со сроком. Не пришёл за пять секунд — открываемся без него:
   чёрный экран не помогает никому.
   ════════════════════════════════════════════════════════════════ */

const SDK = "https://telegram.org/js/telegram-web-app.js";
const SDK_TIMEOUT_MS = 5000;

export function loadTelegramSdk() {
  return new Promise((done) => {
    if (typeof window === "undefined" || window.Telegram?.WebApp) return done();
    let settled = false;
    const finish = () => { if (!settled) { settled = true; done(); } };
    const timer = setTimeout(finish, SDK_TIMEOUT_MS);
    const stop = () => { clearTimeout(timer); finish(); };
    try {
      const s = document.createElement("script");
      s.src = SDK;
      s.async = true;
      s.addEventListener("load", stop);
      s.addEventListener("error", stop);
      document.head.appendChild(s);
    } catch { stop(); }
    return undefined;
  });
}
