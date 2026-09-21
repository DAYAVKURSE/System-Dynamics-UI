import { Router } from "express";
import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { telegramUser } from "../middleware/telegramUser.js";
import { identify, listOrg } from "../lib/orgStore.js";
import {
  MAX_REPORT_BYTES, saveReport, getReport, deleteReport, listReports, ownReportMeta, tracksOf,
} from "../lib/reportStore.js";
import { MAX_BOT_DOCUMENT_BYTES, sendDocument, sendMessage } from "../lib/telegram.js";
import { NO_MODEL, loadTracks, transcribeRecording } from "../lib/transcribe.js";
import { modelFor } from "../lib/assistantSettings.js";
import { aliasFor, dropTranscript, transcriptFor } from "../lib/callStore.js";

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

/* Id встречи у записи — короткая base64url-строка (см. callStore). Что-то
   иное в заголовке — не встреча, и в хранилище оно не попадает. */
const safeMeetingId = (raw) => (/^[A-Za-z0-9_-]{6,64}$/.test(String(raw || "")) ? String(raw) : null);
/* Подпись к файлу — base64 JSON в заголовке (заголовки latin-1, а в
   имени говорящего кириллица); не разобралось — подписи нет. */
const headerMeta = (raw) => {
  if (!raw) return null;
  try {
    const m = JSON.parse(Buffer.from(String(raw), "base64").toString("utf8"));
    return m && typeof m === "object" && !Array.isArray(m) ? m : null;
  } catch { return null; }
};

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

/* ─────── «Скачать» = прислать себе в чат с ботом ───────

   WebView Telegram не даёт сохранить файл на телефон: ссылка со
   скачиванием там просто ничего не делает (владелец, 2026-09-20: «кнопка
   „Скачать" не работает»). Чат с ботом — и есть папка «Загрузки».

   Здесь — ЛЮБОЙ файл, который человек и так может открыть по ссылке:
   договор участника, материал на входе. Ссылка и есть ключ к файлу (см.
   чтение ниже, оно открыто), поэтому отправка её тому, кто подписан,
   ничего нового не открывает. Вещь без файла — текст или код — уходит
   сообщением: скачивать там нечего, а забрать надо. */
const FILE_URL = /^\/api\/reports\/([a-f0-9]{32})\/([A-Za-z0-9-]{6,64})$/;
router.post("/deliver", telegramUser, member, async (req, res, next) => {
  try {
    const { url, text, name } = req.body || {};
    const words = String(text ?? "").trim();
    if (words) {
      await sendMessage(req.telegramUserId,
        `${name ? `${name}\n\n` : ""}${words.slice(0, 3500)}`);
      return res.json({ sent: "text" });
    }
    /* Файл без сервера живёт инлайном (`data:`) — байты приезжают прямо в
       запросе. Иначе — ссылка на диск: она и есть ключ к файлу. */
    const raw = String(url || "");
    let file = null;
    if (raw.startsWith("data:")) {
      const body = raw.slice(raw.indexOf(",") + 1);
      const bytes = /;base64,/i.test(raw)
        ? Buffer.from(body, "base64")
        : Buffer.from(decodeURIComponent(body), "utf8");
      if (!bytes.length) return res.status(400).json({ error: "empty file" });
      if (bytes.length > MAX_REPORT_BYTES) return res.status(413).json({ error: "file too large" });
      const type = raw.slice(5, raw.indexOf(raw.includes(";") ? ";" : ","));
      file = { bytes, name: String(name || "файл"), type: type || "application/octet-stream" };
    } else {
      const m = FILE_URL.exec(raw);
      if (!m) return res.status(400).json({ error: "bad url" });
      file = await getReport(m[1], m[2]);
    }
    if (!file) return res.status(404).json({ error: "not found" });
    const title = String(name || file.name || "файл");
    if (file.bytes.length > MAX_BOT_DOCUMENT_BYTES) {
      // Ссылкой отдаётся только файл с диска: у инлайнового ссылки нет.
      const base = raw.startsWith("data:") ? "" : (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
      if (!base) {
        return res.status(409).json({
          error: `${title} — ${Math.round(file.bytes.length / 1024 / 1024)} МБ, больше, чем бот`
            + " может отправить файлом, а ссылку прислать нечем: на сервере не задан"
            + " адрес приложения (PUBLIC_URL).",
        });
      }
      await sendMessage(req.telegramUserId, `${title}:\n${base}${url}`);
      return res.json({ sent: "link" });
    }
    const blob = new Blob([file.bytes], { type: file.type });
    await sendDocument(req.telegramUserId, { blob, name: file.name || title, caption: title });
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
      /* Подпись к файлу от приложения (`X-Report-Meta`, base64 JSON): у
         звуковой дорожки — чья она и к какой записи; у записи — встреча
         (из `X-Report-Meeting`, если звонок шёл по заведённой). Расшифровка
         запускается не здесь, а кнопкой «транскрибировать» (владелец,
         2026-09-21): дорожки приезжают отдельными файлами после записи, и
         текст с именами получается только когда они все на месте. */
      const meta = headerMeta(req.header("X-Report-Meta")) || {};
      const meeting = safeMeetingId(req.header("X-Report-Meeting"));
      /* Дорожка: кто на ней — узнаём СЕЙЧАС, пока псевдоним звонка жив
         (aliasFor считается на секрете процесса). Своя дорожка — тот, кто
         прислал; чужая — участник хранилища с таким псевдонимом во
         встрече; гость по ссылке остаётся с именем из «привета». */
      if (String(req.header("X-Report-Kind") || "") === "track" && meta.who && typeof meta.who === "object") {
        const video = meta.of ? await ownReportMeta(req.telegramUserId, String(meta.of)) : null;
        const inMeeting = video?.meta?.meeting || null;
        const users = (await listOrg()).users;
        const me = users.find((u) => String(u.id) === String(req.telegramUserId));
        const found = meta.who.me ? me
          : inMeeting ? users.find((u) => aliasFor(inMeeting, String(u.id)) === String(meta.who.id)) : null;
        meta.who = { id: String(meta.who.id ?? ""), name: String(found?.name || meta.who.name || "").slice(0, 80),
          username: String(found?.username || "").slice(0, 64), ...(found ? { userId: String(found.id) } : {}) };
      }
      const entry = await saveReport(req.telegramUserId, {
        name: headerName(req.header("X-Report-Name")),
        type: req.header("X-Report-Type") || req.header("Content-Type"),
        kind: req.header("X-Report-Kind"),
        bytes,
        meta: { ...meta, ...(meeting ? { meeting } : {}) },
      });
      res.status(201).json(entry);
    } catch (e) {
      if (/required|at most|limit/.test(e.message)) {
        return res.status(400).json({ error: e.message });
      }
      next(e);
    }
  });

/* ─────── РАСШИФРОВКА ПО КНОПКЕ (владелец, 2026-09-21) ───────

   «Транскрибировать» на форме записи: моделью строки «расшифровка» у
   ассистента того, кто нажал. Голос записан поканально — по дорожке на
   участника (kind «track», meta.of = запись); имена берутся из анкет
   ЭТОГО хранилища (имя и username), а у гостя по ссылке — из его
   «привета» в звонке. Идёт в фоне, состояние — `GET /:id/transcript`. */
const ownCall = async (req) => {
  const meta = await ownReportMeta(req.telegramUserId, req.params.id);
  return meta && (meta.kind === "call" || String(meta.type || "").startsWith("video/")) ? meta : null;
};
router.post("/:id/transcribe", telegramUser, member, async (req, res, next) => {
  try {
    const meta = await ownCall(req);
    if (!meta) return res.status(404).json({ error: "not found" });
    const chosen = await modelFor(req.telegramUserId, "transcribe", { fallback: false });
    if (!chosen) return res.status(409).json({ error: NO_MODEL });
    const names = Object.fromEntries((await listOrg()).users
      .map((u) => [String(u.id), { name: u.name || "", username: u.username || "" }]));
    const tracks = await loadTracks(req.telegramUserId, meta.id, names);
    const bytes = tracks.length ? Buffer.alloc(0) : await fsp.readFile(meta.path);
    res.status(202).json({ status: "pending", tracks: tracks.length });
    transcribeRecording({
      userId: req.telegramUserId, fileId: meta.id, name: meta.name, type: meta.type, bytes,
      meetingId: meta.meta?.meeting || null, tracks,
    }).catch((e) => console.error(`[transcribe] запись ${meta.id}: ${e.message}`));
  } catch (e) { next(e); }
});
router.get("/:id/transcript", telegramUser, member, async (req, res, next) => {
  try {
    const meta = await ownCall(req);
    if (!meta) return res.status(404).json({ error: "not found" });
    const t = await transcriptFor(meta.id);
    if (!t) return res.json({ status: "none" });
    const { by, ...pub } = t;
    return res.json(pub);
  } catch (e) { next(e); }
});
router.delete("/:id/transcript", telegramUser, member, async (req, res, next) => {
  try {
    const meta = await ownCall(req);
    if (!meta) return res.status(404).json({ error: "not found" });
    await dropTranscript(meta.id);
    return res.status(204).end();
  } catch (e) { next(e); }
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
    // Расшифровка без записи — текст разговора, который человек стёр.
    await dropTranscript(req.params.id);
    // И звуковые дорожки этой записи: без видео они никому не нужны.
    for (const t of await tracksOf(req.telegramUserId, req.params.id)) {
      // eslint-disable-next-line no-await-in-loop
      await deleteReport(req.telegramUserId, t.id);
    }
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
