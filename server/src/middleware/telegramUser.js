import { verifyInitData } from "../lib/telegramAuth.js";

const DEV_USER_ID = "dev-user";

function isProd() {
  return process.env.NODE_ENV === "production";
}

// Требует валидный Telegram.WebApp.initData в проде (иначе кто угодно мог бы
// читать/писать чужие сценарии). Вне прода, если заголовка нет, работает как
// единый dev-пользователь — чтобы можно было тестировать API из браузера
// напрямую, не открывая приложение внутри Telegram.
export function telegramUser(req, res, next) {
  const initData = req.header("X-Telegram-Init-Data") || "";
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!initData) {
    if (!isProd()) {
      req.telegramUserId = DEV_USER_ID;
      req.telegramProfile = { name: "разработчик", username: "" };
      return next();
    }
    return res.status(401).json({ error: "Telegram initData is required" });
  }

  if (!botToken) {
    if (!isProd()) {
      req.telegramUserId = DEV_USER_ID;
      req.telegramProfile = { name: "разработчик", username: "" };
      return next();
    }
    return res.status(500).json({ error: "Server is missing TELEGRAM_BOT_TOKEN" });
  }

  const result = verifyInitData(initData, botToken);
  if (!result.ok) {
    return res.status(401).json({ error: `Invalid Telegram initData (${result.reason})` });
  }

  req.telegramUserId = result.userId;
  // Имя из подписанного initData: подделать его нельзя, поэтому им можно
  // подписывать человека в списке людей.
  req.telegramProfile = {
    name: [result.user?.first_name, result.user?.last_name].filter(Boolean).join(" ")
      || result.user?.username || "",
    username: result.user?.username || "",
  };
  next();
}
