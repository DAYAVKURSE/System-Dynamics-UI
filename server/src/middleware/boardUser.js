import { verifyInitData } from "../lib/telegramAuth.js";

/* ════════════════════════════════════════════════════════════════
   КТО НА ДОСКЕ (владелец, 2026-09-25)

   Доску, как и звонок, открывают по ссылке — в общем чате, куда её
   отправили инлайн-запросом. Войти должен любой, кому она попала: id
   доски неугадываемый и сам служит приглашением (см. routes/boards.js).

   В отличие от звонка, ГОСТЕЙ здесь нет. На доске есть «Заблокировать» и
   «Удалить», и они должны держаться: номер, который браузер завёл себе
   сам, сменить — одна строчка, и заблокированный вернулся бы через
   минуту. Поэтому только подписанный Telegram (initData): его id
   подделать нельзя.

   И ещё: identify() из orgStore здесь не зовётся вовсе. Он записывает
   первого встречного владельцем модели, а посторонний, открывший доску
   из общего чата, владельцем становиться не должен.
   ════════════════════════════════════════════════════════════════ */

const DEV_USER_ID = "dev-user";
const isProd = () => process.env.NODE_ENV === "production";

const devUser = (req, next) => {
  req.boardUserId = DEV_USER_ID;
  req.boardUserName = "разработчик";
  req.boardUserPhoto = "";
  return next();
};

export function boardUser(req, res, next) {
  const initData = req.header("X-Telegram-Init-Data") || "";
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  // Вне production без подписи — единый dev-пользователь, как у
  // telegramUser: API можно трогать из браузера, не открывая Telegram.
  if (!isProd() && (!initData || !botToken)) return devUser(req, next);

  if (initData && botToken) {
    const r = verifyInitData(initData, botToken);
    if (r.ok && r.user?.id != null) {
      req.boardUserId = String(r.userId);
      req.boardUserName = [r.user?.first_name, r.user?.last_name].filter(Boolean).join(" ")
        || r.user?.username || "";
      req.boardUserPhoto = String(r.user?.photo_url || "");
      return next();
    }
  }
  return res.status(401).json({ error: "Откройте доску в Telegram." });
}
