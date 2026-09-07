import { Router } from "express";
import express from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import { identify } from "../lib/orgStore.js";
import { saveSettings, settingsView } from "../lib/assistantSettings.js";
import { ask, find } from "../lib/assistantQueue.js";
import { MAX_MEMORY_FILE_BYTES, addMemory, listMemory, removeMemory } from "../lib/memoryStore.js";

/* ════════════════════════════════════════════════════════════════
   ПОМОЩНИК · маршруты

   Всё здесь — только позванным: и настройки, и вопросы, и память.
   Настройки МЕНЯЕТ один владелец: ключ — его счёт и его секрет. Читать
   их (без ключа) могут все позванные — интерфейсу надо знать, есть ли
   вообще чем отвечать, прежде чем рисовать поле вопроса.

   Память — только своя: scope выводится из подписи, а не из запроса,
   как и у файлов отчётов.
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

router.get("/settings", (_req, res) => res.json(settingsView()));

router.put("/settings", (req, res, next) => {
  try {
    if (!req.me.isOwner) return res.status(403).json({ error: "only the owner can set the key" });
    const { provider, model, key } = req.body || {};
    return res.json(saveSettings({ provider, model, key }));
  } catch (e) {
    if (/must be|looks wrong/.test(e.message)) return res.status(400).json({ error: e.message });
    return next(e);
  }
});

/* ─────── вопрос в два шага ─────── */

router.post("/ask", (req, res, next) => {
  try {
    const { question, context } = req.body || {};
    if (!String(question || "").trim()) return res.status(400).json({ error: "question is required" });
    const { id } = ask({ userId: req.me.id, question, context });
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
