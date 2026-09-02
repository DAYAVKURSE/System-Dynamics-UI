import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { identify } from "../lib/orgStore.js";
import { readModel, reviewTask, submitTask, viewFor, writeModel } from "../lib/workspaceStore.js";
import { ask, waitFor } from "../lib/bridgeStore.js";

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

/* Черновик содержимого задачи от Claude — только владельцу, только через
   мост. Без моста отвечаем 503 словами, а не пустым текстом: интерфейс
   тогда ничего не подставит и не сделает вид, что подставил. */
export const draftPrompt = ({ title, goal, move, assignee, reviewer }) => [
  "Ты помогаешь владельцу бизнес-модели сформулировать задачу исполнителю.",
  "Ответь только текстом задачи на русском, 3–6 коротких предложений, без",
  "заголовков и без markdown: что сделать, какой результат считать сделанным,",
  "как отчитаться. Не выдумывай чисел, которых нет ниже.",
  "",
  `Название задачи: ${title || "—"}`,
  goal ? `Цель: ${goal}` : "",
  move ? `Движение (гипотеза), которое задача выполняет: ${move}` : "",
  assignee ? `Исполнитель: ${assignee}` : "",
  reviewer ? `Проверяющий: ${reviewer}` : "",
].filter(Boolean).join("\n");

router.post("/draft", async (req, res, next) => {
  try {
    if (!req.me.isOwner) return res.status(403).json({ error: "only the owner" });
    if (!process.env.BRIDGE_TOKEN) return res.status(503).json({ error: "bridge is disabled" });
    const item = ask({ text: draftPrompt(req.body || {}), from: req.telegramUserId,
      chatId: null, sid: null });
    const done = await waitFor(item.id, Number(process.env.BRIDGE_DRAFT_TIMEOUT_MS || 90000));
    if (!done) return res.status(504).json({ error: "Claude не ответил вовремя" });
    if (done.error) return res.status(502).json({ error: done.error });
    res.json({ text: done.answer });
  } catch (e) { next(e); }
});
