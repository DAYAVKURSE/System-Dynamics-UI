import { verifyInitData } from "../lib/telegramAuth.js";
import { mayActAs, recordIdFor } from "../lib/orgStore.js";
import * as codes from "../lib/codes.js";
import { bindUid, recordOfUid } from "../lib/identityStore.js";
import { ensureStorage, inStorage, memberOf, ownStorageOf } from "../lib/storages.js";

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
    const code = await checkCode(req);
    if (code === false) {
      return res.status(401).json({ error: "code token is required", needsCode: true });
    }
    req.code = code;
    /* Код ведёт к записи (lib/identityStore.js): вошли с другого
       Telegram — работаем под той же записью, что и всегда. Первый вход
       с кодом привязывает его к записи, под которой человек был. Это
       ГЛОБАЛЬНОЕ имя человека — одно на все хранилища. */
    if (code) {
      req.telegramUserId = await bindUid(code.uid, req.telegramUserId, req.telegramRealId);
      req.telegramRealId = req.telegramUserId;
    }
    /* ─── В КАКОМ ХРАНИЛИЩЕ (lib/storages.js) ───
       Своё — по умолчанию, чужое — по заголовку `X-Storage`, и только
       туда, где человек участник. Дальше весь запрос идёт в контексте
       этого хранилища: сторы сами берут его каталог. */
    const own = await ownStorageOf(req.telegramRealId);
    const wanted = String(req.header("X-Storage") || "").trim() || own;
    if (wanted !== own && !guestRoute(req) && !(await memberOf(wanted, req.telegramRealId))) {
      return res.status(403).json({ error: "not a member of this storage" });
    }
    req.storage = wanted;
    req.ownStorage = own;
    if (wanted === own) await ensureStorage(req.telegramRealId, { name: req.telegramProfile?.name });
    return inStorage(wanted, async () => {
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
      /* Страница виртуального сотрудника — в ЭТОМ хранилище: в каждом
         человек может быть записан под своей страницей. */
      req.telegramUserId = await recordIdFor(req.telegramUserId);
      return next();
    });
  } catch (e) { return next(e); }
}

/* ─────── КОД ИЗ СЕРВИСА КОДОВ (владелец, 2026-09-21) ───────

   Всякое обращение к хранилищу идёт с токеном: подписанной сервисом
   запиской «это такой-то, план такой-то». Проверяется здесь, офлайн
   (lib/codes.js). Без токена или с негодным — отказ, кроме «кто я»:
   он должен ответить и тому, у кого кода ещё нет, — чтобы приложение
   знало, что его надо получить. Сервис выключен — кодов нет, и всё
   работает по одному Telegram, как прежде. */
const isWhoAmI = (req) => req.baseUrl === "/api/org" && req.path === "/me";
/* Куда пускают и НЕ участника чужого хранилища: спросить «кто я» (ответ —
   «не позван»), посмотреть роли с договорами, зарегистрироваться по
   договору, вступить по ссылке. Это и есть вход в чужое хранилище —
   закрыть его для не-участников значило бы, что вступить нельзя. */
const guestRoute = (req) => req.baseUrl === "/api/org"
  && (req.path === "/me" || req.path === "/register" || req.path.startsWith("/join")
    || (req.method === "GET" && req.path === "/roles"));
async function checkCode(req) {
  if (!codes.enabled()) return null;
  const token = String(req.header("X-User-Token") || "").trim();
  const seen = token ? await codes.verify(token) : null;
  if (seen) return { uid: seen.uid, plan: seen.plan, exp: seen.exp };
  return isWhoAmI(req) ? null : false;
}

/** Открыт ли код записи заранее: с кем вошли, к тому и ведём. */
export const recordByCode = recordOfUid;
