import { Router } from "express";
import crypto from "node:crypto";
import { telegramUser } from "../middleware/telegramUser.js";
import { callUser } from "../middleware/callUser.js";
import { identify } from "../lib/orgStore.js";
import { callLinkEnv, callLinkFor } from "../lib/links.js";
import {
  MAX_PEERS, aliasFor, createMeeting, deleteMeeting, getMeeting, listMeetings, peersIn,
  putSignal, takeSignals,
} from "../lib/callStore.js";

/* ════════════════════════════════════════════════════════════════
   ЗВОНКИ · маршруты

   Здесь два разных входа, и это главное, что о них надо знать.

   ЗАВОДИТ встречи тот, кто состоит в модели: список и создание закрыты
   обычной подписью Telegram и ролью. Иначе бот превратился бы в
   бесплатный сервер сигналинга для кого угодно.

   ВХОДИТ в комнату любой, у кого есть ссылка, — включая человека, который
   в боте не зарегистрирован и открыл звонок обычной страницей. Id встречи
   неугадываемый, и он же приглашение: так же устроены файлы отчётов.
   Поэтому на этих маршрутах стоит callUser (см. middleware/callUser.js),
   а не проверка «свой ли ты в модели».

   И ещё одно: на пути входящего в комнату НЕ должно быть identify() из
   orgStore. Он не просто узнаёт человека — он записывает первого
   встречного владельцем модели, если владелец ещё не назначен. Постороннее
   лицо, открывшее ссылку на звонок, владельцем становиться не должно.
   ════════════════════════════════════════════════════════════════ */

const router = Router();

/** Кто состоит в модели: подпись Telegram плюс роль. */
const member = [
  telegramUser,
  async (req, res, next) => {
    try { req.me = await identify(req.telegramUserId, req.telegramProfile || {}); next(); }
    catch (e) { next(e); }
  },
  (req, res, next) => (req.me.known ? next() : res.status(403).json({ error: "not invited" })),
];

/**
 * Что отдавать клиенту для соединения: публичный STUN плюс TURN.
 *
 * TURN двух видов. Свой coturn на этом же сервере ставится деплоем и
 * работает по общему секрету (TURN_SECRET): пароль — HMAC от срока
 * действия, поэтому в браузер уезжают учётные данные на час, а не
 * постоянные. Внешний TURN (TURN_URL/TURN_USER/TURN_PASS) — как есть.
 */
export function iceServers(env = process.env, now = Date.now()) {
  const list = [{ urls: (env.STUN_URLS || "stun:stun.l.google.com:19302").split(",") }];
  if (env.TURN_SECRET && env.TURN_HOST) {
    const ttl = 3600;
    const username = `${Math.floor(now / 1000) + ttl}:sd`;
    const credential = crypto.createHmac("sha1", env.TURN_SECRET).update(username).digest("base64");
    list.push({
      urls: [`turn:${env.TURN_HOST}:3478?transport=udp`, `turn:${env.TURN_HOST}:3478?transport=tcp`],
      username, credential,
    });
  } else if (env.TURN_URL) {
    list.push({ urls: env.TURN_URL.split(","), username: env.TURN_USER || "",
      credential: env.TURN_PASS || "" });
  }
  return list;
}

export const hasTurn = (env = process.env) =>
  Boolean((env.TURN_SECRET && env.TURN_HOST) || env.TURN_URL);

/* ─────── встречи: заводит свой ─────── */

/**
 * Ссылка-приглашение. Собирает её сервер, а не браузер: имя бота и короткое
 * имя приложения звонка знает только он (см. lib/links.js). Иначе доска
 * встреч показывала бы адрес страницы, а бот в это же время рассылал бы
 * ссылку на мини-приложение — две разные ссылки на одну встречу.
 */
const inviteLink = (id) => callLinkFor(callLinkEnv(process.env, process.env.BOT_NAME || ""), id);
const withLink = (m) => ({ ...m, link: inviteLink(m.id) });

router.get("/", member, async (req, res, next) => {
  try {
    const list = await listMeetings(req.me.isOwner ? undefined : req.telegramUserId);
    res.json(list.map(withLink));
  } catch (e) { next(e); }
});

router.post("/", member, async (req, res, next) => {
  try {
    res.status(201).json(withLink(
      await createMeeting({ ...(req.body || {}), by: req.telegramUserId })));
  } catch (e) {
    if (/required/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

router.delete("/:id", member, async (req, res, next) => {
  try {
    const ok = await deleteMeeting(req.params.id,
      req.me.isOwner ? null : req.telegramUserId);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  } catch (e) { next(e); }
});

/* ─────── комната: входит любой со ссылкой ─────── */

// Войти во встречу может любой, у кого есть ссылка: id неугадываемый, и
// именно он служит приглашением — так же, как у файлов отчётов.
router.get("/:id", callUser, async (req, res, next) => {
  try {
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "not found" });
    // Наружу — только то, что нужно, чтобы войти. Номеров Telegram здесь
    // нет ни в каком виде: ни того, кто позвал (`by`), ни участников — те
    // приходят псевдонимами (см. aliasFor в lib/callStore.js). Войти может
    // любой со ссылкой, а чужие номера — не техническая подробность.
    res.json({
      id: m.id, title: m.title, at: m.at, text: m.text, createdAt: m.createdAt,
      me: aliasFor(req.params.id, req.callerId),
      peers: peersIn(req.params.id),
    });
  } catch (e) { next(e); }
});

/**
 * Серверы соединения — под конкретную встречу.
 *
 * TURN — это наш канал: через него идёт всё видео и весь звук. Отдавать
 * учётные данные каждому, кто просто спросил, значит держать открытый
 * ретранслятор за свой счёт. Поэтому их выдаёт только знание id встречи —
 * ровно то же право, что и войти в комнату.
 */
router.get("/:id/ice", callUser, async (req, res, next) => {
  try {
    if (!(await getMeeting(req.params.id))) return res.status(404).json({ error: "not found" });
    // TURN нужен, когда собеседники за строгим NAT: без него часть звонков
    // не соединится вовсе. Говорим прямо, а не молчим.
    res.json({ iceServers: iceServers(), turn: hasTurn(), maxPeers: MAX_PEERS });
  } catch (e) { next(e); }
});

/* ─────── сигналинг ─────── */

router.post("/:id/signal", callUser, async (req, res, next) => {
  try {
    if (!(await getMeeting(req.params.id))) return res.status(404).json({ error: "not found" });
    // Комната полна — новому «привет» отказ, а не тихое молчание в ответ.
    const here = peersIn(req.params.id);
    const me = aliasFor(req.params.id, req.callerId);
    if (req.body?.data?.type === "hello" && !here.includes(me)
      && here.length >= MAX_PEERS) {
      return res.status(409).json({ error: `в комнате уже ${MAX_PEERS} участников` });
    }
    const n = putSignal(req.params.id, {
      from: me,
      to: req.body?.to ?? null,
      data: req.body?.data,
    });
    res.json({ n });
  } catch (e) { next(e); }
});

/**
 * Длинный опрос: ответ уходит, как только для этого участника появляется
 * сигнал, а если за 20 секунд ничего не появилось — пустым. Короткий опрос
 * добавлял бы к каждому шагу соединения по секунде задержки, а звонок
 * складывается из десятка таких шагов.
 */
router.get("/:id/signal", callUser, async (req, res, next) => {
  try {
    if (!(await getMeeting(req.params.id))) return res.status(404).json({ error: "not found" });
    const me = aliasFor(req.params.id, req.callerId);
    const since = Number(req.query.since || 0);
    const deadline = Date.now() + Number(req.query.wait || 20000);

    const look = () => {
      const out = takeSignals(req.params.id, me, since);
      if (out.signals.length || Date.now() >= deadline || res.writableEnded) {
        if (!res.writableEnded) res.json({ ...out, peers: peersIn(req.params.id) });
        return;
      }
      setTimeout(look, 400);
    };
    // Клиент ушёл со страницы — ждать больше некого.
    req.on("close", () => { if (!res.writableEnded) res.end(); });
    look();
  } catch (e) { next(e); }
});

export default router;
