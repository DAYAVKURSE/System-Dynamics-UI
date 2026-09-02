import { Router } from "express";
import crypto from "node:crypto";
import { telegramUser } from "../middleware/telegramUser.js";
import { identify } from "../lib/orgStore.js";
import {
  MAX_PEERS, createMeeting, deleteMeeting, getMeeting, listMeetings, peersIn, putSignal,
  takeSignals,
} from "../lib/callStore.js";

const router = Router();
router.use(telegramUser);
router.use(async (req, res, next) => {
  try { req.me = await identify(req.telegramUserId, req.telegramProfile || {}); next(); }
  catch (e) { next(e); }
});

// Зовёт на созвон тот, кто состоит в модели: у постороннего комнаты быть
// не может, иначе бот превратился бы в бесплатный сервер сигналинга.
const known = (req, res, next) =>
  (req.me.known ? next() : res.status(403).json({ error: "not invited" }));

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

router.get("/ice", (_req, res) => {
  // TURN нужен, когда собеседники за строгим NAT: без него часть звонков
  // не соединится вовсе. Говорим прямо, а не молчим.
  res.json({ iceServers: iceServers(), turn: hasTurn(), maxPeers: MAX_PEERS });
});

router.get("/", known, async (req, res, next) => {
  try { res.json(await listMeetings(req.me.isOwner ? undefined : req.telegramUserId)); }
  catch (e) { next(e); }
});

router.post("/", known, async (req, res, next) => {
  try {
    res.status(201).json(await createMeeting({ ...(req.body || {}), by: req.telegramUserId }));
  } catch (e) {
    if (/required/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

// Войти во встречу может любой, у кого есть ссылка: id неугадываемый, и
// именно он служит приглашением — так же, как у файлов отчётов.
router.get("/:id", async (req, res, next) => {
  try {
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "not found" });
    res.json({ ...m, peers: peersIn(req.params.id) });
  } catch (e) { next(e); }
});

router.delete("/:id", known, async (req, res, next) => {
  try {
    const ok = await deleteMeeting(req.params.id,
      req.me.isOwner ? null : req.telegramUserId);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  } catch (e) { next(e); }
});

/* ─────── сигналинг ─────── */

router.post("/:id/signal", async (req, res, next) => {
  try {
    if (!(await getMeeting(req.params.id))) return res.status(404).json({ error: "not found" });
    // Комната полна — новому «привет» отказ, а не тихое молчание в ответ.
    const here = peersIn(req.params.id);
    if (req.body?.data?.type === "hello" && !here.includes(req.telegramUserId)
      && here.length >= MAX_PEERS) {
      return res.status(409).json({ error: `в комнате уже ${MAX_PEERS} участников` });
    }
    const n = putSignal(req.params.id, {
      from: req.telegramUserId,
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
router.get("/:id/signal", async (req, res, next) => {
  try {
    if (!(await getMeeting(req.params.id))) return res.status(404).json({ error: "not found" });
    const me = req.telegramUserId;
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
