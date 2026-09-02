import { verifyInitData } from "../lib/telegramAuth.js";

/* ════════════════════════════════════════════════════════════════
   КТО ЗВОНИТ

   На звонок зовут ссылкой, и войти по ней должен любой, кому она попала:
   коллега из чата, подрядчик, человек, который бота ни разу не открывал.
   Регистрация в модели тут ни при чём — она решает, кто заводит встречи,
   а не кто на них приходит.

   Поэтому у входящего в комнату два вида имени:

   · подписанный Telegram — когда звонок открыт мини-приложением: id
     берётся из initData, подделать его нельзя;
   · гость — когда страницу открыли просто по ссылке (браузером, в чужом
     мессенджере): id заводит себе сам браузер и хранит у себя. Он ничего
     не даёт, кроме места в комнате: увидеть встречу можно, только зная её
     неугадываемый id, а он и есть приглашение.

   Что гостю недоступно — заводить и удалять встречи и видеть их список:
   там стоит обычная проверка подписи и роли (см. routes/calls.js).
   ════════════════════════════════════════════════════════════════ */

const GUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function callUser(req, res, next) {
  const initData = req.header("X-Telegram-Init-Data") || "";
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (initData && botToken) {
    const r = verifyInitData(initData, botToken);
    if (r.ok) {
      req.callerId = r.userId;
      req.callerName = [r.user?.first_name, r.user?.last_name].filter(Boolean).join(" ")
        || r.user?.username || "";
      req.callerSigned = true;
      return next();
    }
  }

  // Гостя опознаём по номеру, который завёл его же браузер. Он не
  // подтверждает, кто человек, — он только отличает одного участника
  // комнаты от другого, чтобы сигналы не перепутались.
  const guest = String(req.header("X-Call-Guest") || "").trim();
  if (GUEST_ID.test(guest)) {
    req.callerId = `guest-${guest}`;
    req.callerName = "";
    req.callerSigned = false;
    return next();
  }

  return res.status(401).json({
    error: "Откройте звонок по ссылке из приглашения — она заводит участника сама",
  });
}
