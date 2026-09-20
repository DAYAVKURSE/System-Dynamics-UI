import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { avatarOf, formsFor, identify, listOrg, profileOf } from "../lib/orgStore.js";
import { aliasOf } from "../lib/alias.js";
import { peopleOf as workPeopleOf, readModel, viewFor as workViewFor }
  from "../lib/workspaceStore.js";
import {
  BadInput, acceptBrief, addChat, addDelivery, addOffer, addOrder, addService, peopleOf,
  readMarket, removeOrder, removeService, setBrief, updateOrder, updateService, viewFor,
} from "../lib/marketStore.js";
import { liveStatus, worksNow } from "../lib/workTime.js";
import { readSchedule } from "../lib/scheduleStore.js";
import { sendMessage } from "../lib/telegram.js";

/* ════════════════════════════════════════════════════════════════
   РЫНОК УСЛУГ · маршруты

   Открыт всем зарегистрированным (позванным) — так просил владелец:
   «любой зарегистрированный пользователь может оставить заказ». Роль тут
   не спрашивается: рынок — не вкладка роли, а место, куда вошедший
   приходит сам. Незваному — отказ: он ещё никто.

   Ответы — глазами спрашивающего (`viewFor`): чужих откликов в них нет,
   и в отладчике их тоже не увидеть. Имена — из организации, здесь и
   сейчас: рынок хранит только id.
   ════════════════════════════════════════════════════════════════ */

const router = Router();
router.use(telegramUser);
router.use(async (req, res, next) => {
  try {
    req.me = await identify(req.telegramUserId, req.telegramProfile || {}, { claim: false });
    if (!req.me.known) return res.status(403).json({ error: "not invited" });
    return next();
  } catch (e) { return next(e); }
});

const fail = (res, e, next) => (e instanceof BadInput
  ? res.status(e.status).json({ error: e.message }) : next(e));

/* ─── КТО ЗДЕСЬ ЗНАКОМ (владелец, 2026-09-20) ───

   Рынок открыт всем позванным, и заказ оставляет любой — в том числе
   человек, которого смотрящий никогда не видел. Такой автор
   представляется ДВУМЯ СЛОВАМИ, а вместо лица у него знак приложения:
   имя и лицо — не то, что показывают незнакомцу на бирже.

   Знаком — тот, С КЕМ ЧЕЛОВЕК ВМЕСТЕ РАБОТАЕТ: те же люди, что видны ему
   в рабочей области (участники его задач и воркеры видимых активов).
   Список берётся оттуда же, чтобы «знаком» значило одно и то же в обоих
   местах, а не два похожих правила. Владелец знаком со всеми: модель его.
   Себя человек, разумеется, знает. */
const knownToAsker = async (me) => {
  if (me.isOwner) return null;               // null — знакомы все
  try { return workPeopleOf(workViewFor(await readModel(), me)); }
  catch { return new Set(); }
};

/** Как автор представляется этому смотрящему: имя и лицо либо два слова. */
export const faceOf = (user, { known, me }) => {
  const id = String(user.id);
  if (known === null || known.has(id) || id === String(me.id)) {
    return { name: user.name, ...avatarOf(user), anon: false };
  }
  return { name: aliasOf(id), avatar: "", avatarOwn: false, avatarOff: false, anon: true };
};

const withNames = async (view, me) => {
  const ids = peopleOf(view);
  const org = await listOrg();
  const known = await knownToAsker(me);
  const people = {};
  const faces = {};
  for (const u of org.users) {
    if (!ids.has(String(u.id))) continue;
    const face = faceOf(u, { known, me });
    people[String(u.id)] = face.name;
    /* Статус автора по его графику — тем же правилом, что и в строке
       воркера (владелец, 2026-09-20): рядом с «принимает автоматически»
       должно быть видно, на месте ли он сейчас. */
    const tz = (await readSchedule(u.id))?.tzOffset ?? 0;
    faces[String(u.id)] = { avatar: face.avatar, anon: face.anon,
      status: liveStatus(u, Date.now(), tz) };
  }
  return { ...view, people, faces };
};

router.get("/", async (req, res, next) => {
  try {
    const view = await viewFor(req.me.id);
    res.json({ ...(await withNames(view, req.me)), me: req.me.id });
  } catch (e) { fail(res, e, next); }
});

/* ─── страница автора ───

   Открывается нажатием на кружок с лицом. Та же страница, что у воркера
   актива: анкета, график, рейтинг. Незнакомому смотрящему она
   представляется двумя словами и знаком приложения, а всё остальное на
   ней то же самое (владелец, 2026-09-20). */
router.get("/people/:id", async (req, res, next) => {
  try {
    const org = await listOrg();
    const user = (org.users || []).find((u) => String(u.id) === String(req.params.id));
    if (!user) return res.status(404).json({ error: "not found" });
    const known = await knownToAsker(req.me);
    const face = faceOf(user, { known, me: req.me });
    const profile = profileOf(user);
    return res.json({
      id: String(user.id), ...face,
      // Анкета — как есть, кроме имени и лица: их решает `face`.
      profile: { ...profile, name: face.name, avatar: face.avatar },
      forms: formsFor(org, user),
    });
  } catch (e) { return fail(res, e, next); }
});

/* ─── заказы ─── */
/* ─── АВТОМАТИЧЕСКИЙ ПРИЁМ (владелец, 2026-09-20) ───

   У услуги есть отметка «Принять автоматически в рабочее время». Заказ,
   выбравший такую услугу, не ждёт переписки: отклик создаётся сам и сам
   принимается (владелец: «отклик создаётся сам и сам принимается»), —
   внешне всё как обычно, и чат у сторон остаётся, просто шаги уже
   сделаны. Условия берутся из самой услуги: что она берёт, что выдаёт и
   за сколько дней там уже написано.

   ВНЕ рабочего времени исполнителя автоматический приём не работает
   (владелец): заказ идёт обычным путём и ждёт отклика. Графика нет вовсе
   — тоже обычный путь: обещать за человека, который не сказал, когда
   работает, нельзя.

   Ошибка на любом шаге не роняет заказ: он уже оставлен, и остаться без
   заказа из-за того, что не получилось принять его автоматически, — хуже,
   чем остаться без автоматического приёма. */
const autoAccept = async (order, me) => {
  const svcId = order.serviceId;
  if (!svcId) return null;
  const market = await readMarket();
  const svc = (market.services || []).find((x) => x.id === String(svcId));
  if (!svc || svc.auto !== true) return null;
  if (String(svc.by) === String(me.id)) return null;      // свой же заказ
  const org = await listOrg();
  const worker = (org.users || []).find((u) => String(u.id) === String(svc.by));
  if (!worker) return null;
  const tz = (await readSchedule(svc.by))?.tzOffset ?? 0;
  if (!worksNow(worker, Date.now(), tz)) return null;

  const offer = await addOffer(svc.by, order.id,
    { text: `Принято автоматически по услуге «${svc.name}».`, serviceId: svc.id });
  await setBrief(svc.by, order.id, offer.id, {
    gives: order.resources || [], gets: (svc.gives || [])[0] || null,
    days: svc.days, note: svc.text || "" });
  // Принимает ЗАКАЗЧИК: своё предложение принимать не у кого.
  const deal = await acceptBrief(order.by, order.id, offer.id);
  return { svc, offer: deal.offer, task: deal.task };
};

/* Исполнителю — сообщение о задаче прямо сейчас: заказ принят за него, и
   узнать об этом он должен не из доски, когда откроет её. */
const tellWorker = async (svcBy, order, task) => {
  const chat = (await readSchedule(svcBy))?.chatId || svcBy;
  const lines = [`Заказ принят автоматически: ${order.name}`];
  if (task?.end) lines.push(`Срок: ${String(task.end).replace("T", " ").slice(0, 16)}`);
  if (order.text) lines.push("", order.text);
  lines.push("", "Задача уже в вашем бэклоге.");
  await sendMessage(chat, lines.join("\n"));
};

router.post("/orders", async (req, res, next) => {
  try {
    const order = await addOrder(req.me.id, req.body || {});
    let deal = null;
    try { deal = await autoAccept(order, req.me); }
    catch (e) { console.error(`[market] автоприём заказа ${order.id}: ${e.message}`); }
    if (deal) {
      try { await tellWorker(deal.svc.by, order, deal.task); }
      catch (e) { console.error(`[market] не сказал об автоприёме: ${e.message}`); }
    }
    return res.status(201).json(deal
      ? { ...(await viewFor(req.me.id)).orders.find((o) => o.id === order.id), auto: true }
      : order);
  } catch (e) { return fail(res, e, next); }
});
router.put("/orders/:id", async (req, res, next) => {
  try { res.json(await updateOrder(req.me.id, req.params.id, req.body || {})); }
  catch (e) { fail(res, e, next); }
});
router.delete("/orders/:id", async (req, res, next) => {
  try { await removeOrder(req.me.id, req.params.id, { isOwner: req.me.isOwner }); res.status(204).end(); }
  catch (e) { fail(res, e, next); }
});

/* ─── услуги ─── */
router.post("/services", async (req, res, next) => {
  try { res.status(201).json(await addService(req.me.id, req.body || {})); }
  catch (e) { fail(res, e, next); }
});
router.put("/services/:id", async (req, res, next) => {
  try { res.json(await updateService(req.me.id, req.params.id, req.body || {})); }
  catch (e) { fail(res, e, next); }
});
router.delete("/services/:id", async (req, res, next) => {
  try { await removeService(req.me.id, req.params.id, { isOwner: req.me.isOwner }); res.status(204).end(); }
  catch (e) { fail(res, e, next); }
});

/* ─── отклики: предложение, чат, бриф, сделка, ресурсы ─── */
router.post("/orders/:id/offers", async (req, res, next) => {
  try { res.status(201).json(await addOffer(req.me.id, req.params.id, req.body || {})); }
  catch (e) { fail(res, e, next); }
});
router.post("/orders/:id/offers/:oid/chat", async (req, res, next) => {
  try { res.json(await addChat(req.me.id, req.params.id, req.params.oid, req.body?.text)); }
  catch (e) { fail(res, e, next); }
});
router.put("/orders/:id/offers/:oid/brief", async (req, res, next) => {
  try { res.json(await setBrief(req.me.id, req.params.id, req.params.oid, req.body || {})); }
  catch (e) { fail(res, e, next); }
});
router.post("/orders/:id/offers/:oid/accept", async (req, res, next) => {
  try { res.json(await acceptBrief(req.me.id, req.params.id, req.params.oid)); }
  catch (e) { fail(res, e, next); }
});
router.post("/orders/:id/offers/:oid/deliveries", async (req, res, next) => {
  try { res.json(await addDelivery(req.me.id, req.params.id, req.params.oid, req.body || {})); }
  catch (e) { fail(res, e, next); }
});

export default router;
