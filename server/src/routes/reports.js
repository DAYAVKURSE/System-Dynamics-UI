import { Router } from "express";
import express from "express";
import { telegramUser } from "../middleware/telegramUser.js";
import {
  MAX_REPORT_BYTES, saveReport, getReport, deleteReport, listReports, ownReport,
} from "../lib/reportStore.js";
import { MAX_BOT_DOCUMENT_BYTES, sendDocument, sendMessage } from "../lib/telegram.js";

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
/**
 * Свои файлы. Только свои: каталог выводится из подписанного пользователя,
 * а не берётся из запроса, — иначе список стал бы способом заглянуть
 * в чужой. «?kind=call» оставляет одни записи созвонов: на вкладке звонков
 * не нужны вложения к задачам.
 */
router.get("/", telegramUser, async (req, res, next) => {
  try { res.json(await listReports(req.telegramUserId, { kind: req.query.kind })); }
  catch (e) { next(e); }
});

/**
 * Отправить свой файл себе в чат с ботом.
 *
 * Никакого «скачать» в мини-приложении быть не может: WebView Telegram не
 * даёт сохранить файл на телефон. Зато чат с ботом — это и есть папка
 * «Загрузки», из которой файл открывается, пересылается и сохраняется
 * штатными средствами.
 *
 * Файл берётся ТОЛЬКО из своего каталога, а адресат — тот же подписанный
 * пользователь: чужое ни прочитать, ни отправить нельзя, даже зная id.
 */
router.post("/:id/send", telegramUser, async (req, res, next) => {
  try {
    const file = await ownReport(req.telegramUserId, req.params.id);
    if (!file) return res.status(404).json({ error: "not found" });
    const link = `${(process.env.PUBLIC_URL || "").replace(/\/+$/, "")}${file.url}`;
    // Бот отправляет документ не больше 50 МБ. Запись бывает и вдвое
    // больше — тогда шлём ссылку, а не молчим и не падаем.
    if (file.bytes.length > MAX_BOT_DOCUMENT_BYTES) {
      await sendMessage(req.telegramUserId,
        `${file.name} — ${Math.round(file.bytes.length / 1024 / 1024)} МБ, это больше,`
        + ` чем бот может отправить файлом. Скачать по ссылке:\n${link}`);
      return res.json({ sent: "link", link });
    }
    await sendDocument(req.telegramUserId, {
      bytes: file.bytes, name: file.name, type: file.type, caption: file.name,
    });
    return res.json({ sent: "file" });
  } catch (e) {
    // «Не начинал диалог с ботом» — обычная человеческая причина, и она
    // должна дойти словами, а не пятисоткой.
    if (/chat not found|blocked|initiate conversation|Telegram/i.test(e.message)) {
      return res.status(409).json({ error: `Бот не смог отправить файл: ${e.message}` });
    }
    return next(e);
  }
});

router.post("/", telegramUser,
  express.raw({ type: () => true, limit: MAX_REPORT_BYTES }),
  async (req, res, next) => {
    try {
      const bytes = Buffer.isBuffer(req.body) ? req.body : null;
      const entry = await saveReport(req.telegramUserId, {
        name: headerName(req.header("X-Report-Name")),
        type: req.header("X-Report-Type") || req.header("Content-Type"),
        kind: req.header("X-Report-Kind"),
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
