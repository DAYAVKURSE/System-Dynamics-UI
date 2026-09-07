import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { identify } from "../lib/orgStore.js";
import { deferTask, readModel, reviewTask, submitTask, takeTask, viewFor, writeModel }
  from "../lib/workspaceStore.js";

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
    res.json(viewFor(await readModel(), req.me));
  } catch (e) { next(e); }
});

// Модель целиком пишет только владелец: остальным доступны две операции
// ниже, и ничего больше.
router.put("/", async (req, res, next) => {
  try {
    if (!req.me.isOwner) return res.status(403).json({ error: "only the owner can save the model" });
    const saved = await writeModel(req.body?.model);
    res.json({ savedAt: saved.savedAt });
  } catch (e) {
    if (/required/.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
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
   остаётся в бэклоге, но уже с отметкой, что за неё не взялись. */
router.post("/tasks/:id/defer", async (req, res, next) => {
  try {
    const r = await deferTask(req.telegramUserId, req.params.id);
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
    if (r.error) return res.status(403).json({ error: r.error });
    res.json(r.task);
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
