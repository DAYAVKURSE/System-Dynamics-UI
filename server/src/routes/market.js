import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { avatarOf, formsFor, identify, listOrg, profileOf } from "../lib/orgStore.js";
import { aliasOf } from "../lib/alias.js";
import { peopleOf as workPeopleOf, readModel, viewFor as workViewFor }
  from "../lib/workspaceStore.js";
import {
  BadInput, acceptBrief, acceptRequestBrief, addChat, addDelivery, addOffer, addOrder,
  addRequest, addRequestChat, addRequestDelivery, addService, dealOf, otherSide, peopleOf, procRolesIn,
  readMarket, removeOrder, removeService, serviceViewFor, setBrief, setRequestBrief, updateOrder,
  updateService, viewFor,
} from "../lib/marketStore.js";
import { liveStatus, worksNow } from "../lib/workTime.js";
import { statsFor } from "../lib/ratings.js";
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

const mine = (a, b) => String(a) === String(b);
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
  /* Рейтинг и число выполненных работ — из модели, по автору (владелец,
     2026-09-21): по ним рынок сортируют. Рейтинг — только опубликованный,
     как везде; работы — принятые и не отменённые задачи автора. */
  let model = null;
  try { model = await readModel(); } catch { model = null; }
  const doneBy = {};
  (model?.tasks || []).forEach((t) => {
    if (t.status === "done" && t.canceled !== true && t.assignee != null && t.assignee !== "") {
      doneBy[String(t.assignee)] = (doneBy[String(t.assignee)] || 0) + 1;
    }
  });
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
    const rating = model ? statsFor(model, String(u.id)).mark : null;
    faces[String(u.id)] = { avatar: face.avatar, anon: face.anon,
      status: liveStatus(u, Date.now(), tz),
      rating: rating == null ? null : rating, done: doneBy[String(u.id)] || 0 };
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

/* ─── ДВЕ РОЛИ НАНЯТОГО (владелец, 2026-09-26) ───

   Роль в техпроцессе — постановщик, исполнитель или проверяющий; роль в
   сценарии — из ролей заказчика: нанятый получит её в этом хранилище, без
   неё ему тут нечего открыть. Спрашиваются у заказа и у заявки на
   услугу одинаково. */
const rolesError = async (body = {}) => {
  if (!procRolesIn(body.procRoles != null ? body.procRoles : body.procRole).length) {
    return "Выберите роль в техпроцессе";
  }
  const roleId = String(body.roleId || "").trim();
  const roles = (await listOrg()).roles || [];
  if (!roleId || !roles.some((r) => r.id === roleId)) return "Выберите роль в сценарии";
  return null;
};

/* ─── УВЕДОМЛЕНИЯ В TELEGRAM (владелец, 2026-09-26) ───

   «Когда в заказе приходят предложения — создатель заказа должен
   получать уведомление от бота. Когда приходит новое сообщение в чате —
   той стороне, которой пришло сообщение. Когда соискатель принят на
   выполнение заказа — соискателю. Также и с услугами».

   Сообщение уходит, не задерживая ответ: действие уже сделано, и
   недошедшее уведомление (человек не открывал чат с ботом) не должно
   выглядеть как неудавшееся действие. Имя отправителя — то, каким
   получатель видит его на рынке: незнакомый — двумя словами. */
export const notify = { send: sendMessage };

const nameFor = async (recipientId, userId) => {
  const user = ((await listOrg()).users || []).find((u) => String(u.id) === String(userId));
  if (!user) return aliasOf(String(userId));
  const me = await identify(recipientId, {}, { claim: false });
  return faceOf(user, { known: await knownToAsker(me), me }).name;
};

const tell = (to, build) => {
  (async () => {
    const lines = await build();
    const chat = (await readSchedule(to))?.chatId || to;
    await notify.send(chat, lines.filter((l) => l != null).join("\n"));
  })().catch((e) => console.error(`[market] не сказал ${to}: ${e.message}`));
};


router.post("/orders", async (req, res, next) => {
  try {
    const bad = await rolesError(req.body || {});
    if (bad) return res.status(400).json({ error: bad });
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
  try {
    const body = req.body || {};
    if ("procRoles" in body || "procRole" in body || "roleId" in body) {
      const bad = await rolesError(body);
      if (bad) return res.status(400).json({ error: bad });
    }
    return res.json(await updateOrder(req.me.id, req.params.id, body));
  } catch (e) { return fail(res, e, next); }
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

/* Что сказать после шага разговора — одинаково для отклика и заявки. */
/* Фразы — целиком на каждый случай, а не склеенные из кусков: так их
   переводит словарь языков (lib/i18n.js), шаблон к шаблону. */
const tellChat = (deal, from, text) => tell(otherSide(deal, from), async () => {
  const who = await nameFor(otherSide(deal, from), from);
  return [deal.kind === "order"
    ? `Новое сообщение по заказу «${deal.name}» от ${who}:`
    : `Новое сообщение по услуге «${deal.name}» от ${who}:`, "", text];
});
const PROC_NAME = { setter: "постановщик", assignee: "исполнитель", reviewer: "проверяющий" };
const tellAccepted = (deal, by) => tell(otherSide(deal, by), async () => {
  const to = otherSide(deal, by);
  const order = deal.kind === "order";
  if (mine(to, deal.executor)) {
    return [order ? `Вас приняли на выполнение заказа «${deal.name}».`
      : `Вас приняли на выполнение услуги «${deal.name}».`,
    deal.procRoles.length > 1
      ? `Ваши роли в задаче: ${deal.procRoles.map((r) => PROC_NAME[r]).join(", ")}.`
      : `Ваша роль в задаче: ${PROC_NAME[deal.procRoles[0]]}.`];
  }
  const who = await nameFor(to, by);
  return [order ? `${who} принял(а) ваше предложение по заказу «${deal.name}».`
    : `${who} принял(а) ваше предложение по услуге «${deal.name}».`];
});

router.post("/orders/:id/offers", async (req, res, next) => {
  try {
    const before = (await readMarket()).orders.find((o) => o.id === String(req.params.id));
    const fresh = before && !(before.offers || []).some((f) => mine(f.by, req.me.id));
    const offer = await addOffer(req.me.id, req.params.id, req.body || {});
    if (fresh) {
      tell(before.by, async () => [
        `Новое предложение по заказу «${before.name}» от ${await nameFor(before.by, req.me.id)}:`, "", offer.text]);
    }
    return res.status(201).json(offer);
  } catch (e) { return fail(res, e, next); }
});
router.post("/orders/:id/offers/:oid/chat", async (req, res, next) => {
  try {
    const offer = await addChat(req.me.id, req.params.id, req.params.oid, req.body?.text);
    tellChat(await dealOf("order", req.params.id, req.params.oid), req.me.id, offer.chat.at(-1).text);
    res.json(offer);
  } catch (e) { fail(res, e, next); }
});
router.put("/orders/:id/offers/:oid/brief", async (req, res, next) => {
  try { res.json(await setBrief(req.me.id, req.params.id, req.params.oid, req.body || {})); }
  catch (e) { fail(res, e, next); }
});
router.post("/orders/:id/offers/:oid/accept", async (req, res, next) => {
  try {
    const out = await acceptBrief(req.me.id, req.params.id, req.params.oid);
    tellAccepted(await dealOf("order", req.params.id, req.params.oid), req.me.id);
    res.json(out);
  } catch (e) { fail(res, e, next); }
});
router.post("/orders/:id/offers/:oid/deliveries", async (req, res, next) => {
  try { res.json(await addDelivery(req.me.id, req.params.id, req.params.oid, req.body || {})); }
  catch (e) { fail(res, e, next); }
});

/* ─── заявки на услугу: тот же разговор, что у отклика ───

   Услугу заказывают прямо с её карточки: заказавший пишет, что нужно,
   и выбирает две роли нанятого — как в заказе. Дальше всё как у
   отклика: чат, «Договорились», сделка, ресурсы, уведомления. Услуга с
   отметкой «Принять автоматически» в рабочее время исполнителя
   принимает заявку сама — на своих условиях. */
const autoAcceptRequest = async (svc, r) => {
  if (svc.auto !== true) return null;
  const org = await listOrg();
  const worker = (org.users || []).find((u) => String(u.id) === String(svc.by));
  if (!worker) return null;
  const tz = (await readSchedule(svc.by))?.tzOffset ?? 0;
  if (!worksNow(worker, Date.now(), tz)) return null;
  // Условий в услуге нет — предлагать от имени исполнителя нечего.
  if (!(svc.takes || []).length && !(svc.gives || []).length) return null;
  await setRequestBrief(svc.by, svc.id, r.id, {
    gives: svc.takes || [], gets: (svc.gives || [])[0] || null, days: svc.days, note: svc.text || "" });
  return acceptRequestBrief(r.by, svc.id, r.id);
};

const svcView = async (req, id) => {
  const s = (await readMarket()).services.find((x) => x.id === String(id));
  return s ? serviceViewFor(s, req.me.id) : null;
};

router.post("/services/:id/requests", async (req, res, next) => {
  try {
    const bad = await rolesError(req.body || {});
    if (bad) return res.status(400).json({ error: bad });
    const before = (await readMarket()).services.find((x) => x.id === String(req.params.id));
    const fresh = before && !(before.requests || []).some((r) => mine(r.by, req.me.id) && !r.accepted);
    const r = await addRequest(req.me.id, req.params.id, req.body || {});
    if (fresh) {
      tell(before.by, async () => [
        `Новая заявка на услугу «${before.name}» от ${await nameFor(before.by, req.me.id)}:`, "", r.text]);
    }
    let deal = null;
    if (fresh) {
      try { deal = await autoAcceptRequest(before, r); }
      catch (e) { console.error(`[market] автоприём заявки ${r.id}: ${e.message}`); }
      if (deal) tellAccepted(await dealOf("service", before.id, r.id), req.me.id);
    }
    return res.status(201).json({ ...(await svcView(req, req.params.id)), ...(deal ? { auto: true } : {}) });
  } catch (e) { return fail(res, e, next); }
});
router.post("/services/:id/requests/:rid/chat", async (req, res, next) => {
  try {
    const r = await addRequestChat(req.me.id, req.params.id, req.params.rid, req.body?.text);
    tellChat(await dealOf("service", req.params.id, req.params.rid), req.me.id, r.chat.at(-1).text);
    res.json(r);
  } catch (e) { fail(res, e, next); }
});
router.put("/services/:id/requests/:rid/brief", async (req, res, next) => {
  try { res.json(await setRequestBrief(req.me.id, req.params.id, req.params.rid, req.body || {})); }
  catch (e) { fail(res, e, next); }
});
router.post("/services/:id/requests/:rid/accept", async (req, res, next) => {
  try {
    const out = await acceptRequestBrief(req.me.id, req.params.id, req.params.rid);
    tellAccepted(await dealOf("service", req.params.id, req.params.rid), req.me.id);
    res.json(out);
  } catch (e) { fail(res, e, next); }
});
router.post("/services/:id/requests/:rid/deliveries", async (req, res, next) => {
  try { res.json(await addRequestDelivery(req.me.id, req.params.id, req.params.rid, req.body || {})); }
  catch (e) { fail(res, e, next); }
});

export default router;
