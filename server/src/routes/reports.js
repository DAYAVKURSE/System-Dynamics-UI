import { Router } from "express";
import express from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import {
  MAX_REPORT_BYTES, saveReport, getReport, deleteReport,
} from "../lib/reportStore.js";

const router = Router();

/* Имя файла едет в заголовке, а заголовки HTTP — latin-1: «отчёт.pdf»
   в них не помещается. Поэтому клиент шлёт base64 от UTF-8, а мы
   разворачиваем обратно. Битый заголовок — не повод отказать: имя
   подставится по умолчанию в safeName(). */
function headerName(raw) {
  if (!raw) return "";
  try {
    return Buffer.from(String(raw), "base64").toString("utf8");
  } catch {
    return "";
  }
}

// Тело принимаем сырыми байтами: multipart потребовал бы зависимости ради
// одного поля, а файл здесь всегда один.
// Запись и удаление — только за подписью. Чтение живёт ниже и подписи не
// требует: там ключом служит сама ссылка (см. reportStore.js).
router.post("/", telegramUser,
  express.raw({ type: () => true, limit: MAX_REPORT_BYTES }),
  async (req, res, next) => {
    try {
      const bytes = Buffer.isBuffer(req.body) ? req.body : null;
      const entry = await saveReport(req.telegramUserId, {
        name: headerName(req.header("X-Report-Name")),
        type: req.header("X-Report-Type") || req.header("Content-Type"),
        bytes,
      });
      res.status(201).json(entry);
    } catch (e) {
      if (/required|at most|limit/.test(e.message)) {
        return res.status(400).json({ error: e.message });
      }
      next(e);
    }
  });

router.get("/:scope/:id", async (req, res, next) => {
  try {
    const file = await getReport(req.params.scope, req.params.id);
    if (!file) return res.status(404).json({ error: "not found" });
    res.set("Content-Type", file.type);
    // inline — чтобы картинка показалась превью прямо в отчётах; имя
    // отдаём в filename*, иначе кириллица в заголовке превратится в мусор.
    res.set("Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    // Ссылка на файл живёт в сценарии и не меняется, но кэш обязан быть
    // приватным: файл отдаётся только владельцу.
    res.set("Cache-Control", "private, max-age=86400");
    res.send(file.bytes);
  } catch (e) {
    next(e);
  }
});

// В URL удаления scope стоит только ради единообразия ссылок: чей файл
// стирать, решает подпись, а не адрес.
router.delete("/:scope/:id", telegramUser, async (req, res, next) => {
  try {
    const ok = await deleteReport(req.telegramUserId, req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
