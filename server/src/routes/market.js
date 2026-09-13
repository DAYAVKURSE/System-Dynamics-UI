import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { identify, listOrg } from "../lib/orgStore.js";
import {
  BadInput, acceptBrief, addChat, addDelivery, addOffer, addOrder, addService, peopleOf,
  removeOrder, removeService, setBrief, updateOrder, updateService, viewFor,
} from "../lib/marketStore.js";

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

const withNames = async (view) => {
  const ids = peopleOf(view);
  const org = await listOrg();
  const people = {};
  org.users.forEach((u) => { if (ids.has(String(u.id))) people[String(u.id)] = u.name; });
  return { ...view, people };
};

router.get("/", async (req, res, next) => {
  try {
    const view = await viewFor(req.me.id);
    res.json({ ...(await withNames(view)), me: req.me.id });
  } catch (e) { fail(res, e, next); }
});

/* ─── заказы ─── */
router.post("/orders", async (req, res, next) => {
  try { res.status(201).json(await addOrder(req.me.id, req.body || {})); }
  catch (e) { fail(res, e, next); }
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
