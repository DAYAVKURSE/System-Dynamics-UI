import { Router } from "express";
import express from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { identify } from "../lib/orgStore.js";
import {
  TASKS, addProvider, isBadInput, kindsView, providerFor, removeProvider, setTasks, settingsView,
  updateProvider,
} from "../lib/assistantSettings.js";
import { listModels } from "../lib/aiProviders.js";
import { ask, find } from "../lib/assistantQueue.js";
import { MAX_MEMORY_FILE_BYTES, addMemory, listMemory, removeMemory } from "../lib/memoryStore.js";
import { retranscribeFor } from "../lib/transcribe.js";

/* ════════════════════════════════════════════════════════════════
   ПОМОЩНИК · маршруты

   Всё здесь — только позванным и только своё: настройки, вопросы,
   память. Провайдеры и ключи — у каждого свои (v1.2): владелец за других
   ничего не ставит, и чужие настройки нельзя ни прочитать, ни поменять —
   человек выводится из подписи, а не из запроса, как и у файлов отчётов.
   Ключ наружу не уходит ни в одном ответе — только «есть/нет».
   ════════════════════════════════════════════════════════════════ */

const router = Router();
router.use(telegramUser);

/* Кто спрашивает. claim: false — открывший вкладку «Инструменты» не
   должен становиться владельцем модели, если владелец ещё не назначен.

   Вне прода запросы приходят от единого «разработчика» (см.
   middleware/telegramUser.js): различать людей нечем, и запирать
   локальную разработку было бы запиранием самого себя. */
router.use(async (req, res, next) => {
  try {
    if (process.env.NODE_ENV !== "production" && req.telegramUserId === "dev-user") {
      req.me = { id: "dev-user", isOwner: true, known: true, name: "разработчик" };
      return next();
    }
    const me = await identify(req.telegramUserId, req.telegramProfile || {}, { claim: false });
    if (!me.known) return res.status(403).json({ error: "not invited" });
    req.me = me;
    return next();
  } catch (e) { return next(e); }
});

/* ─────── чем думает помощник ─────── */

/* Ошибки ввода — 400 словами (по-русски, их читает человек на экране);
   всё остальное — общему обработчику. */
const badInput = (e, res, next) => (isBadInput(e) ? res.status(400).json({ error: e.message }) : next(e));

router.get("/settings", (req, res, next) => {
  try {
    res.json({ ...settingsView(req.me.id), kinds: kindsView(), taskList: TASKS });
  } catch (e) { next(e); }
});

router.post("/providers", (req, res, next) => {
  try {
    const { name, kind, baseUrl, key } = req.body || {};
    return res.status(201).json(addProvider(req.me.id, { name, kind, baseUrl, key }));
  } catch (e) { return badInput(e, res, next); }
});

router.put("/providers/:id", (req, res, next) => {
  try {
    // Чужой или несуществующий провайдер — 404, как у удаления: «не найден»
    // здесь правда, а не ошибка ввода.
    if (!providerFor(req.me.id, req.params.id)) return res.status(404).json({ error: "Провайдер не найден" });
    const { name, baseUrl, key, models } = req.body || {};
    return res.json(updateProvider(req.me.id, req.params.id, { name, baseUrl, key, models }));
  } catch (e) { return badInput(e, res, next); }
});

router.delete("/providers/:id", (req, res, next) => {
  try {
    if (!removeProvider(req.me.id, req.params.id)) return res.status(404).json({ error: "Провайдер не найден" });
    return res.status(204).end();
  } catch (e) { return next(e); }
});

/* Список моделей у провайдера — по его ключу, но сам ключ остаётся на
   сервере: клиент просит список по id, а не шлёт ключ туда-обратно. */
router.get("/providers/:id/models", async (req, res, next) => {
  try {
    const p = providerFor(req.me.id, req.params.id);
    if (!p) return res.status(404).json({ error: "Провайдер не найден" });
    return res.json(await listModels(p));
  } catch (e) {
    // Ошибка провайдера — словами и с его статусом наружу не идёт: 502
    // от нас значило бы «сервер сломан», а сломан ключ или адрес.
    if (/ответил|недоступен|не ответил|не задан/.test(e.message)) return res.status(400).json({ error: e.message });
    return next(e);
  }
});

router.put("/tasks", (req, res, next) => {
  try {
    const body = req.body || {};
    const tasks = setTasks(req.me.id, body);
    res.json(tasks);
    /* Выбрали модель расшифровки — записи без текста (модели не было, не
       удалось, оборвалось) расшифровываются ей в фоне, ПОСЛЕ ответа: иначе
       выбор модели ничего не менял бы для уже сохранённых записей, и они
       оставались бы без текста навсегда. Итог — в контексте помощника. */
    if (body.transcribe != null && tasks.transcribe) {
      retranscribeFor(req.me.id)
        .then((done) => { if (done.length) console.log(`[transcribe] повтор для ${req.me.id}: ${done.map((d) => `${d.fileId} ${d.status}`).join(", ")}`); })
        .catch((e) => console.error(`[transcribe] повтор для ${req.me.id} не удался: ${e.message}`));
    }
  } catch (e) { badInput(e, res, next); }
});

/* ─────── вопрос в два шага ─────── */

router.post("/ask", (req, res, next) => {
  try {
    // task («space» из пространства, «bot» из чата) выбирает строку
    // таблицы «задача → модель»; очередь (B) принимает его как есть.
    const { question, context, task } = req.body || {};
    if (!String(question || "").trim()) return res.status(400).json({ error: "question is required" });
    const { id } = ask({ userId: req.me.id, question, context, task });
    return res.status(202).json({ id });
  } catch (e) {
    if (/required/.test(e.message)) return res.status(400).json({ error: e.message });
    return next(e);
  }
});

router.get("/ask/:id", (req, res) => {
  const state = find(req.params.id, req.me.id);
  if (!state) {
    return res.status(404).json({
      error: "Ответ не найден или устарел: ответы живут три минуты после вопроса",
    });
  }
  return res.json(state);
});

/* ─────── память ─────── */

router.get("/memory", async (req, res, next) => {
  try { res.json(await listMemory(req.me.id)); } catch (e) { next(e); }
});

/* Имя файла и название едут в заголовках, а заголовки — latin-1: клиент
   шлёт base64 от UTF-8, как и у файлов отчётов. Битый заголовок — не повод
   отказать: имя подставится из файла. */
function headerText(raw) {
  if (!raw) return "";
  try { return Buffer.from(String(raw), "base64").toString("utf8"); } catch { return ""; }
}

/* Файл принимаем сырыми байтами, как файлы отчётов: multipart потребовал
   бы зависимости ради одного поля, а base64 внутри JSON раздул бы файл на
   треть и упёрся бы в предел тела JSON (2 МБ на весь сервер). JSON-тело
   уже разобрано на уровне приложения, поэтому сюда сырым приходит только
   то, что не JSON. */
router.post("/memory",
  express.raw({ type: (req) => !req.is("application/json"), limit: MAX_MEMORY_FILE_BYTES }),
  async (req, res, next) => {
    try {
      const isFile = Buffer.isBuffer(req.body) && req.body.length > 0;
      /* Имя файла есть, а байтов нет — значит файл пришёл как
         application/json и его уже разобрал общий разбор тела: .json-файл
         из старого клиента становился бы записью с полями из содержимого.
         Лучше отказать словами, чем молча положить не то. */
      if (req.header("X-Memory-Name") && !Buffer.isBuffer(req.body)) {
        return res.status(400).json({ error: "send the file as application/octet-stream, not as JSON" });
      }
      const saved = isFile
        ? await addMemory(req.me.id, {
          title: headerText(req.header("X-Memory-Title")),
          text: headerText(req.header("X-Memory-Text")),
          file: {
            name: headerText(req.header("X-Memory-Name")),
            type: req.header("X-Memory-Type") || req.header("Content-Type"),
            bytes: req.body,
          },
        })
        : await addMemory(req.me.id, {
          title: req.body?.title, text: req.body?.text,
        });
      res.status(201).json(saved);
    } catch (e) {
      if (/required|at most|limit/.test(e.message)) return res.status(400).json({ error: e.message });
      return next(e);
    }
  });

router.delete("/memory/:id", async (req, res, next) => {
  try {
    const ok = await removeMemory(req.me.id, req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    return res.status(204).end();
  } catch (e) { return next(e); }
});

/* Тело больше предела режет сам разбор тела, ДО обработчика: иначе человек
   видел бы «сервер ответил 500» вместо «файл слишком большой». */
// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, next) => {
  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({
      error: `file must be at most ${Math.round(MAX_MEMORY_FILE_BYTES / 1024 / 1024)} MB`,
    });
  }
  return next(err);
});

export default router;
