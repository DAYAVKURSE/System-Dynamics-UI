import { verifyInitData } from "../lib/telegramAuth.js";
import { mayActAs, recordIdFor } from "../lib/orgStore.js";

const DEV_USER_ID = "dev-user";

function isProd() {
  return process.env.NODE_ENV === "production";
}

// Требует валидный Telegram.WebApp.initData в проде (иначе кто угодно мог бы
// читать/писать чужие сценарии). Вне прода, если заголовка нет, работает как
// единый dev-пользователь — чтобы можно было тестировать API из браузера
// напрямую, не открывая приложение внутри Telegram.
export async function telegramUser(req, res, next) {
  const initData = req.header("X-Telegram-Init-Data") || "";
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!initData) {
    if (!isProd()) {
      req.telegramUserId = DEV_USER_ID;
      req.telegramProfile = { name: "разработчик", username: "" };
      return actAs(req, res, next);
    }
    return res.status(401).json({ error: "Telegram initData is required" });
  }

  if (!botToken) {
    if (!isProd()) {
      req.telegramUserId = DEV_USER_ID;
      req.telegramProfile = { name: "разработчик", username: "" };
      return actAs(req, res, next);
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
    // Аватарка из Telegram — то, что человек уже про себя выбрал. Она
    // приходит подписанной, как и имя, поэтому ей можно верить.
    photo: String(result.user?.photo_url || ""),
  };
  return actAs(req, res, next);
}

/* ─────── ПОД КЕМ ЧЕЛОВЕК РАБОТАЕТ ───────

   Обычно — под собой. Но есть два случая, когда id записи не совпадает с
   Telegram-id, и оба про ВИРТУАЛЬНОГО сотрудника (владелец, 2026-09-20):

   · страницу виртуального забрал настоящий человек — она привязана к его
     Telegram (`tg`), и работает он всегда под ней: id записи прежний, и
     все ссылки на него — задачи, оценки, заказы — остались целыми;
   · «Войти под его именем»: заголовок `X-Act-As` называет страницу, и
     тот, кто вправе (владелец или тот, кто её завёл), работает под ней,
     пока не вернётся на свою.

   Подмена стоит ЗДЕСЬ, в одном месте на все маршруты: разложи её по
   маршрутам — и забытый маршрут молча работал бы не от того лица.
   Настоящий Telegram-id остаётся в `telegramRealId`: по нему решается,
   кому подмена разрешена. */
async function actAs(req, res, next) {
  try {
    req.telegramRealId = req.telegramUserId;
    const asked = String(req.header("X-Act-As") || "").trim();
    if (asked) {
      if (!(await mayActAs(req.telegramUserId, asked))) {
        return res.status(403).json({ error: "not your page" });
      }
      req.telegramUserId = asked;
      req.actingAs = asked;
      // Анкета из Telegram — не про эту страницу: она чужая.
      req.telegramProfile = { name: "", username: "" };
      return next();
    }
    req.telegramUserId = await recordIdFor(req.telegramUserId);
    return next();
  } catch (e) { return next(e); }
}
