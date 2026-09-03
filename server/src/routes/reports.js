import { Router } from "express";
import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { telegramUser } from "../middleware/telegramUser.js";
import { identify } from "../lib/orgStore.js";
import {
  MAX_REPORT_BYTES, saveReport, getReport, deleteReport, listReports, ownReportMeta,
} from "../lib/reportStore.js";
import { MAX_BOT_DOCUMENT_BYTES, sendDocument, sendMessage } from "../lib/telegram.js";

const router = Router();

/* Файлы — только тем, кто состоит в модели.

   Без этой проверки любой человек с аккаунтом Telegram, однажды открывший
   звонок по ссылке, получал личное файлохранилище на нашем диске и бота,
   который присылает ему оттуда файлы. Ссылка на звонок нарочно открыта
   всем — а диск не её часть.

   claim: false — потому что открывший ссылку не должен становиться
   владельцем модели (см. lib/orgStore.js). */
const member = async (req, res, next) => {
  try {
    // Вне прода запросы приходят от единого «разработчика» (см.
    // middleware/telegramUser.js): различать людей нечем, и запирать
    // локальную разработку было бы запиранием самого себя.
    if (process.env.NODE_ENV !== "production" && req.telegramUserId === "dev-user") return next();
    const me = await identify(req.telegramUserId, req.telegramProfile || {}, { claim: false });
    if (!me.known) return res.status(403).json({ error: "not invited" });
    return next();
  } catch (e) { return next(e); }
};

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
router.get("/", telegramUser, member, async (req, res, next) => {
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
router.post("/:id/send", telegramUser, member, async (req, res, next) => {
  try {
    // Сначала только описание: решать про размер, прочитав сто мегабайт в
    // память, — верный способ положить сервер несколькими нажатиями.
    const file = await ownReportMeta(req.telegramUserId, req.params.id);
    if (!file) return res.status(404).json({ error: "not found" });

    if (file.size > MAX_BOT_DOCUMENT_BYTES) {
      const base = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
      // Без адреса ссылка получится относительной — в чате это просто
      // текст, по которому ничего не открывается. Лучше честный отказ.
      if (!base) {
        return res.status(409).json({
          error: `Запись ${Math.round(file.size / 1024 / 1024)} МБ — больше, чем бот может`
            + " отправить файлом, а ссылку прислать нечем: на сервере не задан адрес"
            + " приложения (PUBLIC_URL).",
        });
      }
      const link = `${base}${file.url}`;
      await sendMessage(req.telegramUserId,
        `${file.name} — ${Math.round(file.size / 1024 / 1024)} МБ, это больше, чем бот может`
        + ` отправить файлом. Скачать по ссылке:\n${link}`);
      return res.json({ sent: "link", link });
    }

    // Файл отдаём потоком с диска: копировать его целиком в память ради
    // отправки незачем.
    const blob = typeof fs.openAsBlob === "function"
      ? await fs.openAsBlob(file.path, { type: file.type })
      : new Blob([await fsp.readFile(file.path)], { type: file.type });
    await sendDocument(req.telegramUserId, { blob, name: file.name, caption: file.name });
    return res.json({ sent: "file" });
  } catch (e) {
    if (e.userMessage) return res.status(409).json({ error: e.userMessage });
    return next(e);
  }
});

router.post("/", telegramUser, member,
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
router.delete("/:scope/:id", telegramUser, member, async (req, res, next) => {
  try {
    const ok = await deleteReport(req.telegramUserId, req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/* Тело больше предела режет сам разбор тела, ДО обработчика: без этого
   человек видел «сервер ответил 500» вместо «файл слишком большой», а
   клиент напрасно искал в ответе 413. */
// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, next) => {
  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({
      error: `file must be at most ${Math.round(MAX_REPORT_BYTES / 1024 / 1024)} MB`,
    });
  }
  return next(err);
});

export default router;
