import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { identify, listOrg } from "../lib/orgStore.js";
import { addMessage, deferTask, dropTask, dutyFor, peopleOf, readModel, seeChat,
  refuseFunc, reviewTask, setupTask, submitTask, takeTask, taskViewFor, viewFor,
  withModel, writeModel } from "../lib/workspaceStore.js";
import { publishStep, viewRatingsFor } from "../lib/ratings.js";

const router = Router();
router.use(telegramUser);
router.use(async (req, res, next) => {
  try { req.me = await identify(req.telegramUserId, req.telegramProfile || {}); next(); }
  catch (e) { next(e); }
});

/* Задача в ответе на нажатие — глазами того, кто нажал, а не целиком:
   в целой лежат чужие оценки и чужие скрытые слова, а ответ на POST виден
   в отладчике так же, как ответ на GET. Владельцу — целиком, модель его.
   Один хелпер на все нажатия, чтобы ни одно не осталось без среза. */
const seen = (req, task) => (req.me.isOwner ? task : taskViewFor(task, req.telegramUserId));

/* Роли спрашивающего — идентификаторами: ими записаны роли функций, и по
   ним считается, что человеку поручено. Их может быть несколько. */
const myRoles = (me) => (me?.roles || []).map((r) => r.id);

// Срез модели под спрашивающего. Фильтрует сервер: спрятать чужие задачи
// в интерфейсе значит не спрятать их вовсе.
router.get("/", async (req, res, next) => {
  try {
    if (!req.me.known) return res.status(403).json({ error: "not invited" });
    const view = viewFor(await readModel(), req.me);
    if (!req.me.isOwner) {
      /* Имена — только тех, с кем он работает: воркеров видимых ему
         активов и участников его задач. Список организации целиком (с
         анкетами и должностями) — владельцу; здесь ровно имя, чтобы
         постановщику было из кого выбирать, а «поставил: 100» читалось
         как человек. */
      const ids = peopleOf(view);
      view.people = (await listOrg()).users
        .filter((u) => ids.has(String(u.id)))
        .map((u) => ({ id: u.id, name: u.name }));
    }
    res.json(view);
  } catch (e) { next(e); }
});

// Модель целиком пишет только владелец: остальным доступны две операции
// ниже, и ничего больше.
router.put("/", async (req, res, next) => {
  try {
    if (!req.me.isOwner) return res.status(403).json({ error: "only the owner can save the model" });
    /* Реестр опубликованных оценок ведёт сервер: у клиента он на полторы
       секунды старше, и, приняв его, сервер стирал бы только что
       опубликованное. */
    const model = req.body?.model;
    if (model && typeof model === "object") delete model.published;
    // В очереди, а не мимо неё: запись целиком читает реестр опубликованного
    // из файла, и нажатие исполнителя между этим чтением и записью пропало бы.
    const saved = await withModel(() => writeModel(model));
    res.json({ savedAt: saved.savedAt });
  } catch (e) {
    if (/required/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

/* Рейтинги глазами спрашивающего: про себя — только адресованные ему
   слова, про остальных — средние и публичные слова, нигде — автор. Каждое
   чтение — попытка публикации: то, что стало анонимным, публикуется, не
   дожидаясь тика планировщика. */
router.get("/ratings", async (req, res, next) => {
  try {
    if (!req.me.known) return res.status(403).json({ error: "not invited" });
    const model = await withModel(async (m) => {
      if (publishStep(m).changed) await writeModel(m);
      return m;
    });
    res.json(viewRatingsFor(model, req.telegramUserId));
  } catch (e) { next(e); }
});

/* Поставить задачу может её постановщик (и владелец — модель его). Модель
   целиком пишет владелец, но ставить работу должен тот, кого назначили
   постановщиком на схеме: иначе его правки жили бы только в его окне, а
   «Поставить» меняло бы статус в памяти и нигде больше. В теле — поля
   постановки (название, содержимое, начало, срок, исполнитель,
   проверяющий) и `status: "backlog"` для «Поставить»; отказ — словами
   в `why`, теми же, что показывает форма. */
router.post("/tasks/:id/setup", async (req, res, next) => {
  try {
    /* Должности живут в org.json, а не в модели: правило «исполнитель по
       должности» без них не проверить, поэтому карта приходит сюда. */
    const org = await listOrg();
    const posts = new Map((org.users || []).map((u) => [String(u.id), u.roles || []]));
    const r = await setupTask(req.telegramUserId, req.params.id, req.body || {},
      { isOwner: req.me.isOwner, rolesOf: (id) => posts.get(String(id)) || [] });
    if (r.error === "not found") return res.status(404).json({ error: r.error });
    if (r.error === "not yours") return res.status(403).json({ error: r.error });
    if (r.error) return res.status(400).json({ error: r.error, why: r.why || "" });
    res.json(seen(req, r.task));
  } catch (e) { next(e); }
});

/* Поручения человека — тем же срезом, что и модель: где он воркер и его
   выбрали по должности. Собирает сервер, потому что позванный модель
   не видит, а список должен быть по всем активам сразу. */
router.get("/duty", async (req, res, next) => {
  try {
    if (!req.me.known) return res.status(403).json({ error: "not invited" });
    res.json({ duty: dutyFor(await readModel(), req.telegramUserId, myRoles(req.me)) });
  } catch (e) { next(e); }
});

/* Отказ от функции. Выбрать себе работу человек не может — только снять
   с себя ту, в которой его выбрали, и вернуть назад тем же нажатием.
   В теле `off: true|false`. */
router.post("/funcs/:id/duty", async (req, res, next) => {
  try {
    if (!req.me.known) return res.status(403).json({ error: "not invited" });
    const r = await refuseFunc(req.telegramUserId, req.params.id,
      req.body?.off === true, { roles: myRoles(req.me) });
    if (r.error === "not found") return res.status(404).json({ error: r.error });
    if (r.error === "not yours")
      return res.status(403).json({ error: "Эта функция вам не поручена." });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (e) { next(e); }
});

/* Взять задачу в работу может только её исполнитель. Модель целиком пишет
   владелец, но брать работу должен тот, кто её делает: иначе нажатие жило
   бы только в его окне. */
router.post("/tasks/:id/take", async (req, res, next) => {
  try {
    const r = await takeTask(req.telegramUserId, req.params.id);
    if (r.error === "not found") return res.status(404).json({ error: r.error });
    if (r.error === "not in backlog") return res.status(400).json({ error: r.error });
    if (r.error) return res.status(403).json({ error: r.error });
    res.json(seen(req, r.task));
  } catch (e) { next(e); }
});

/* Бросить работу — то же право, что и взять: решает тот, кто её делает.
   Задача возвращается в бэклог, её возьмут снова. */
router.post("/tasks/:id/drop", async (req, res, next) => {
  try {
    const r = await dropTask(req.telegramUserId, req.params.id);
    if (r.error === "not found") return res.status(404).json({ error: r.error });
    if (r.error === "not in progress") return res.status(400).json({ error: r.error });
    if (r.error) return res.status(403).json({ error: r.error });
    res.json(seen(req, r.task));
  } catch (e) { next(e); }
});

/* Отложить — то же право, что и взять: решает тот, кого позвали. Задача
   остаётся в бэклоге, но уже с отметкой, что за неё не взялись. `until`
   в теле — до какого момента (ISO); без него откладывается без срока. */
router.post("/tasks/:id/defer", async (req, res, next) => {
  try {
    const r = await deferTask(req.telegramUserId, req.params.id, { until: req.body?.until });
    if (r.error === "not found") return res.status(404).json({ error: r.error });
    if (r.error === "not in backlog") return res.status(400).json({ error: r.error });
    if (r.error) return res.status(403).json({ error: r.error });
    res.json(seen(req, r.task));
  } catch (e) { next(e); }
});

router.post("/tasks/:id/submit", async (req, res, next) => {
  try {
    const r = await submitTask(req.telegramUserId, req.params.id, req.body || {});
    if (r.error === "not found") return res.status(404).json({ error: r.error });
    // Без вещи по обязательному выходу сдачи нет — и сказано, чего не хватает.
    if (r.error === "missing files") {
      return res.status(400).json({ error: r.error, missing: r.missing });
    }
    if (r.error) return res.status(403).json({ error: r.error });
    res.json(seen(req, r.task));
  } catch (e) { next(e); }
});

/* Сообщение в обсуждение задачи пишет любой, кому видна задача: её
   участники и владелец. Убрать сказанное нельзя — сказанное сказано. */
router.post("/tasks/:id/chat", async (req, res, next) => {
  try {
    const r = await addMessage(req.telegramUserId, req.params.id, req.body || {},
      { isOwner: req.me.isOwner });
    if (r.error === "not found") return res.status(404).json({ error: r.error });
    if (r.error === "not yours") return res.status(403).json({ error: r.error });
    if (r.error) return res.status(400).json({ error: r.error });
    res.status(201).json({ message: r.message, task: seen(req, r.task) });
  } catch (e) { next(e); }
});

/* Обсуждение открыли — непрочитанного в нём для этого человека больше нет. */
router.post("/tasks/:id/chat/seen", async (req, res, next) => {
  try {
    const r = await seeChat(req.telegramUserId, req.params.id, { isOwner: req.me.isOwner });
    if (r.error === "not found") return res.status(404).json({ error: r.error });
    if (r.error) return res.status(403).json({ error: r.error });
    res.json(seen(req, r.task));
  } catch (e) { next(e); }
});

router.post("/tasks/:id/review", async (req, res, next) => {
  try {
    const r = await reviewTask(req.telegramUserId, req.params.id, req.body || {});
    if (r.error === "not found") return res.status(404).json({ error: r.error });
    if (r.error === "comment required") return res.status(400).json({ error: r.error });
    if (r.error) return res.status(403).json({ error: r.error });
    res.json(seen(req, r.task));
  } catch (e) { next(e); }
});

export default router;
