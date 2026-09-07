import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { identify } from "../lib/orgStore.js";
import { addComment, deferTask, readModel, readSpace, reviewTask, submitTask, takeTask,
  taskViewFor, viewFor, writeModel, writeSpace }
  from "../lib/workspaceStore.js";
import { publishStep, viewRatingsFor } from "../lib/ratings.js";

const router = Router();
router.use(telegramUser);
router.use(async (req, res, next) => {
  try { req.me = await identify(req.telegramUserId, req.telegramProfile || {}); next(); }
  catch (e) { next(e); }
});

// Срез модели под спрашивающего. Фильтрует сервер: спрятать чужие задачи
// в интерфейсе значит не спрятать их вовсе.
router.get("/", async (req, res, next) => {
  try {
    if (!req.me.known) return res.status(403).json({ error: "not invited" });
    const view = viewFor(await readModel(), req.me);
    /* Пространство вкладки задач у позванного — своё, не владельца: срез
       модели его не несёт, а файл на человека — несёт. */
    if (!req.me.isOwner) view.space = await readSpace(req.telegramUserId);
    res.json(view);
  } catch (e) { next(e); }
});

/* Пространство пишет каждый своё. Владельцу оно приезжает в составе модели
   (PUT выше), но и этот путь ему открыт — тогда запись ложится в модель,
   чтобы двух пространств у владельца не было. */
router.put("/space", async (req, res, next) => {
  try {
    if (!req.me.known) return res.status(403).json({ error: "not invited" });
    const space = req.body?.space;
    if (!space || typeof space !== "object" || Array.isArray(space)) {
      return res.status(400).json({ error: "space is required" });
    }
    if (req.me.isOwner) {
      const model = await readModel();
      model.space = space;
      const saved = await writeModel(model);
      return res.json({ savedAt: saved.savedAt });
    }
    res.json(await writeSpace(req.telegramUserId, space));
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
    const saved = await writeModel(model);
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
    const model = await readModel();
    if (publishStep(model).changed) await writeModel(model);
    res.json(viewRatingsFor(model, req.telegramUserId));
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
    res.json(r.task);
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
    res.json(r.task);
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
    res.json(r.task);
  } catch (e) { next(e); }
});

/* Комментарий пишет любой участник задачи (или владелец). В ответе —
   задача глазами писавшего: чужих скрытых слов в ней нет. */
router.post("/tasks/:id/comments", async (req, res, next) => {
  try {
    const r = await addComment(req.telegramUserId, req.params.id, req.body || {},
      { isOwner: req.me.isOwner });
    if (r.error === "not found") return res.status(404).json({ error: r.error });
    if (r.error === "not yours") return res.status(403).json({ error: r.error });
    if (r.error) return res.status(400).json({ error: r.error });
    res.status(201).json({ comment: r.comment,
      task: req.me.isOwner ? r.task : taskViewFor(r.task, req.telegramUserId) });
  } catch (e) { next(e); }
});

router.post("/tasks/:id/review", async (req, res, next) => {
  try {
    const r = await reviewTask(req.telegramUserId, req.params.id, req.body || {});
    if (r.error === "not found") return res.status(404).json({ error: r.error });
    if (r.error === "comment required") return res.status(400).json({ error: r.error });
    if (r.error) return res.status(403).json({ error: r.error });
    res.json(r.task);
  } catch (e) { next(e); }
});

export default router;
