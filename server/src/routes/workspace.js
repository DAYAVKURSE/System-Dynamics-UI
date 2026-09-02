import { Router } from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { identify } from "../lib/orgStore.js";
import { readModel, reviewTask, submitTask, viewFor, writeModel } from "../lib/workspaceStore.js";
import { ask, find, pending } from "../lib/bridgeStore.js";

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

/* Черновик — в два шага: POST ставит вопрос в очередь и сразу отвечает id,
   GET по этому id говорит «ещё думает», «готово» или «не вышло». Ждать ответ
   в одном HTTP-запросе нельзя: Claude отвечает десятки секунд, а nginx и
   WebView Telegram рвут запрос раньше — интерфейс видел «Failed to fetch»
   и ничего больше. Опрос короткими запросами этим не страдает. */
const draftTtl = () => Number(process.env.BRIDGE_DRAFT_TIMEOUT_MS || 180000);

router.post("/draft", async (req, res, next) => {
  try {
    if (!req.me.isOwner) return res.status(403).json({ error: "only the owner" });
    if (!process.env.BRIDGE_TOKEN) return res.status(503).json({ error: "bridge is disabled" });
    const item = ask({ text: draftPrompt(req.body || {}), from: req.telegramUserId,
      chatId: null, sid: null });
    res.status(202).json({ id: item.id, status: "pending" });
  } catch (e) { next(e); }
});

router.get("/draft/:id", (req, res) => {
  if (!req.me.isOwner) return res.status(403).json({ error: "only the owner" });
  const item = find(req.params.id);
  // Чужой или забытый черновик не читается: очередь общая на всех.
  if (!item || item.from !== String(req.telegramUserId) || item.chatId) {
    return res.status(404).json({ error: "not found" });
  }
  if (item.status === "done") {
    item.sent = true;
    return item.error
      ? res.json({ status: "error", error: item.error })
      : res.json({ status: "done", text: item.answer });
  }
  if (Date.now() - item.at > draftTtl()) {
    return res.json({ status: "timeout", error: "Claude не ответил вовремя — напишите текст сами" });
  }
  res.json({ status: "pending", queued: pending() });
});
