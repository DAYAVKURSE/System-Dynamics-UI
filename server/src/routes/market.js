import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { avatarOf, formsFor, identify, listOrg, profileOf } from "../lib/orgStore.js";
import { aliasOf } from "../lib/alias.js";
import { peopleOf as workPeopleOf, readModel, viewFor as workViewFor }
  from "../lib/workspaceStore.js";
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
  org.users.forEach((u) => {
    if (!ids.has(String(u.id))) return;
    const face = faceOf(u, { known, me });
    people[String(u.id)] = face.name;
    faces[String(u.id)] = { avatar: face.avatar, anon: face.anon };
  });
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
