// Тонкая обёртка над Telegram Web App SDK (window.Telegram.WebApp).
// Используется только на уровне обёртки приложения и хука сохранения на диск —
// сама модель (SystemModel.jsx) про Telegram ничего не знает.

export function getTelegram() {
  return typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
}

export function initTelegram(themeColor) {
  const tg = getTelegram();
  if (!tg) return null;
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor(themeColor);
  } catch {
    /* старые клиенты Telegram могут не поддерживать метод */
  }
  try {
    tg.setBackgroundColor(themeColor);
  } catch {
    /* см. выше */
  }
  try {
    // в приложении есть свой скролл/слайдеры — не даём Telegram перехватывать вертикальные свайпы
    tg.disableVerticalSwipes?.();
  } catch {
    /* необязательная возможность более новых версий Bot API */
  }
  return tg;
}

// initData нужен бэкенду, чтобы подтвердить, что запрос пришёл от реального
// пользователя Telegram, и разложить сохранённые сценарии по id пользователя.
export function getInitData() {
  return getTelegram()?.initData || "";
}
