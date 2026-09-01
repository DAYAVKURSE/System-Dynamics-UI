import { Router } from "express";
import { answer, pending, requeueStale, sameSecret, takeNext } from "../lib/bridgeStore.js";

/* Маршруты воркера. Воркер — не пользователь Telegram, подписью его не
   опознать, поэтому у него общий секрет BRIDGE_TOKEN. Без секрета мост
   выключен целиком: открытая очередь означала бы, что чужой воркер заберёт
   вопрос владельца и ответит на него что угодно. */

const router = Router();

router.use((req, res, next) => {
  if (!process.env.BRIDGE_TOKEN) return res.status(503).json({ error: "bridge is disabled" });
  if (!sameSecret(req.header("X-Bridge-Token"), process.env.BRIDGE_TOKEN)) {
    return res.status(401).json({ error: "bad bridge token" });
  }
  next();
});

/**
 * Длинный опрос за следующим вопросом: воркер висит на этом запросе и
 * получает вопрос сразу, как только он появился. Короткий опрос добавлял бы
 * задержку к каждому ответу на ровном месте.
 */
router.get("/next", (req, res) => {
  const deadline = Date.now() + Math.min(60000, Number(req.query.wait || 25000));
  const look = () => {
    requeueStale();
    const item = takeNext();
    if (item) return res.json({ id: item.id, text: item.text, sid: item.sid });
    if (res.writableEnded) return undefined;
    if (Date.now() >= deadline) return res.json({ id: null, pending: pending() });
    return setTimeout(look, 500);
  };
  req.on("close", () => { if (!res.writableEnded) res.end(); });
  look();
});

router.post("/:id/answer", (req, res) => {
  const item = answer(req.params.id, req.body || {});
  if (!item) return res.status(404).json({ error: "not found" });
  // Отправляет ответ бот: он знает, в какой чат.
  res.json({ ok: true, chatId: item.chatId });
});

export default router;
