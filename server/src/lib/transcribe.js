import { modelFor } from "./assistantSettings.js";
import { listPendingTranscripts, putTranscript, transcriptFor } from "./callStore.js";
import { listReports, ownReport } from "./reportStore.js";

/* ════════════════════════════════════════════════════════════════
   РАСШИФРОВКА ЗАПИСЕЙ ЗВОНКОВ

   Расшифровка — такая же задача для модели, как ответ на вопрос: строка
   «расшифровка записей звонков» в таблице «задача → модель» у того, кто
   запись сохранил (lib/assistantSettings.js, `modelFor(userId,
   'transcribe', {fallback: false})`). Своя модель, свой ключ, свой счёт.
   Строка пуста — расшифровки НЕТ, и отката на модель чата здесь нет
   нарочно: модель чата записи не расшифровывает, и вместо «выберите
   модель» человек читал бы «провайдер ответил 400».

   Умеет это только провайдер вида «OpenAI»: у него есть
   `POST /audio/transcriptions` (сам OpenAI — whisper-1, gpt-4o-transcribe;
   Groq — whisper-large-v3-turbo по тому же адресу). У Anthropic такого
   входа нет, у router Hugging Face — тоже, и говорить об этом надо
   словами, а не «500».

   Идёт в фоне: запись — десятки мегабайт, расшифровка — минуты, а ответ
   «запись сохранена» человек ждёт сейчас. Итог ложится в callStore
   (`putTranscript`) — и «готово», и «не удалось: почему».
   ════════════════════════════════════════════════════════════════ */

export const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";
/* Час записи Whisper обрабатывает минуты, а не секунды, — предел щедрее,
   чем у ответа на вопрос (90 с в aiProviders.js). */
export const TRANSCRIBE_TIMEOUT_MS = 10 * 60 * 1000;
export const NOT_SUPPORTED = "этот провайдер не расшифровывает";
/* Одна фраза на контекст помощника и на журнал: почему текста нет — и
   где это чинится, потому что чинит сам человек, а не владелец. */
export const NO_MODEL = "расшифровки нет: модель для задачи «расшифровка записей звонков» не выбрана"
  + " — выберите её в Инструментах → Агенты, у ассистента";
/* Столько принимает /audio/transcriptions у OpenAI и у Groq: это предел
   провайдера, а не наш, и он меньше предела хранилища (100 МБ). Запись
   при 300 кбит/с видео — около 2,5 МБ в минуту, то есть ~10 минут; больше
   не отправляется вовсе, а человеку говорится, почему. */
export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;
/* Перезапуск сервера посреди расшифровки: done/error писать больше некому. */
export const INTERRUPTED = "расшифровка прервана перезапуском сервера";
const ERROR_TEXT_LIMIT = 300;

const mb = (n) => `${Math.round(n / 1024 / 1024)} МБ`;
/** Почему запись нельзя отправить — словами; null, если можно. */
export const tooBig = (bytes) => (bytes && bytes.length > MAX_TRANSCRIBE_BYTES
  ? `запись ${mb(bytes.length)} больше ${mb(MAX_TRANSCRIBE_BYTES)}, которые принимает провайдер расшифровки`
    + " (/audio/transcriptions); расшифровать можно только запись короче"
  : null);

/* Ключ из текста ошибки — вон, как в aiProviders.js: провайдер (или nginx
   перед ним) может вернуть что угодно, и в журнал ключ попасть не должен. */
const scrub = (text, key) => {
  let t = String(text || "").replace(/\s+/g, " ").trim().slice(0, ERROR_TEXT_LIMIT);
  if (key && key.length >= 8) t = t.split(key).join("[ключ]");
  return t;
};

/**
 * Один файл — один текст.
 *
 * multipart, потому что так устроен сам API: файл байтами, остальное
 * полями. `response_format: text` — ответ приходит голым текстом без JSON,
 * `language: ru` — иначе Whisper первые секунды угадывает язык и на
 * коротких записях ошибается.
 *
 * @param {typeof fetch} doFetch — подменяется в тестах
 */
export async function transcribeFile({ kind, baseUrl, key, model, bytes, name, type } = {},
  doFetch = globalThis.fetch) {
  if (String(kind || "") !== "openai") {
    throw new Error(`${NOT_SUPPORTED}: нужен провайдер вида «OpenAI» (у него есть /audio/transcriptions)`);
  }
  const apiKey = String(key || "").trim();
  if (!apiKey) throw new Error("ключ провайдера не задан");
  const m = String(model || "").trim();
  if (!m) throw new Error("модель расшифровки не названа");
  if (!bytes || !bytes.length) throw new Error("запись пуста");
  const big = tooBig(bytes);
  if (big) throw new Error(big);

  const base = (String(baseUrl || "").trim().replace(/\/+$/, "") || DEFAULT_OPENAI_BASE);
  const form = new FormData();
  form.set("model", m);
  form.set("response_format", "text");
  form.set("language", "ru");
  form.set("file", new Blob([bytes], { type: type || "application/octet-stream" }),
    String(name || "запись"));

  let res;
  try {
    res = await doFetch(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    });
  } catch (e) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new Error(`провайдер не ответил за ${Math.round(TRANSCRIBE_TIMEOUT_MS / 60000)} минут`);
    }
    throw new Error(`провайдер недоступен: ${scrub(e?.message, apiKey) || "сеть не ответила"}`);
  }

  const raw = await res.text().catch(() => "");
  if (!res.ok) {
    let explained = raw;
    try {
      const data = JSON.parse(raw);
      explained = data?.error?.message || data?.error?.type || data?.message || raw;
    } catch { /* не JSON — тело как есть */ }
    const words = scrub(explained, apiKey);
    throw new Error(words ? `провайдер ответил ${res.status}: ${words}` : `провайдер ответил ${res.status}`);
  }

  // Просили голый текст, но некоторые совместимые серверы всё равно
  // отвечают JSON {text}: разбираем и его, лишь бы не выдать фигурные
  // скобки за расшифровку.
  let text = raw.trim();
  if (text.startsWith("{")) {
    try { const data = JSON.parse(text); if (typeof data?.text === "string") text = data.text.trim(); }
    catch { /* всё-таки текст */ }
  }
  if (!text) throw new Error("провайдер вернул пустую расшифровку");
  return text;
}

/**
 * Расшифровка сохранённой записи — в фоне, итог в callStore.
 *
 * Модель берётся у того, кто запись сохранил, и ТОЛЬКО из строки
 * «расшифровка записей звонков» — без отката на модель чата. Модели нет
 * — ничего не пишется и ничего не запускается: в контексте помощника на
 * месте текста будет фраза NO_MODEL, а не тишина. Запись больше предела
 * провайдера не отправляется, и причина ложится в callStore словами.
 * Возвращает состояние словами; сам никогда не бросает — вызывающий
 * маршрут ответ уже отдал.
 *
 * `deps` — для тестов: выбор модели (`pick`) и сеть (`doFetch`).
 */
export async function transcribeRecording({ userId, fileId, name, type, bytes, meetingId = null } = {},
  { pick = modelFor, doFetch = globalThis.fetch } = {}) {
  let chosen = null;
  try {
    chosen = await pick(String(userId), "transcribe", { fallback: false });
  } catch (e) {
    // Настройки не прочитались — это тоже ответ, и его надо показать.
    return putTranscript({ fileId, by: userId, name, meetingId, status: "error",
      error: `настройки помощника не прочитались: ${e.message}` });
  }
  if (!chosen) return { status: "none", reason: NO_MODEL };

  const label = [chosen.providerName, chosen.model].filter(Boolean).join(" / ");
  // Размер — до «идёт»: гонять 90 МБ до провайдера, чтобы получить 413,
  // незачем, а «идёт» на записи, которая никуда не уйдёт, — неправда.
  const big = tooBig(bytes);
  if (big) return putTranscript({ fileId, by: userId, name, meetingId, status: "error", error: big, model: label });
  await putTranscript({ fileId, by: userId, name, meetingId, status: "pending", model: label });
  try {
    const text = await transcribeFile({ ...chosen, bytes, name, type }, doFetch);
    return await putTranscript({ fileId, by: userId, name, meetingId, status: "done", text, model: label });
  } catch (e) {
    return putTranscript({ fileId, by: userId, name, meetingId, status: "error",
      error: e.message, model: label });
  }
}

/* ─────── повтор: после выбора модели и после перезапуска ───────

   Обе функции идут по записям ПО ОДНОЙ, а не Promise.all: запись — до
   100 МБ в памяти, и десять разом положили бы сервер. Байты берутся из
   хранилища файлов того же человека (`ownReport`), а не хранятся у
   расшифровки: текст относится к встрече, байты — к файлу. */

/** «Идёт» дольше предела ожидания провайдера — это не идёт, это оборвано. */
export const isStalePending = (t, now = Date.now()) => t?.status === "pending"
  && !(now - Date.parse(t.at) < TRANSCRIBE_TIMEOUT_MS);

/**
 * Дорасшифровать записи человека, у которых текста нет: модели не было,
 * не удалось, или «идёт» оборвалось. Зовётся, когда человек выбрал
 * модель в строке «расшифровка» — раньше выбор модели ничего не менял
 * для уже сохранённых записей, и они оставались без текста навсегда.
 * Возвращает, что с какой записью стало.
 */
export async function retranscribeFor(userId, deps = {}) {
  const id = String(userId);
  const out = [];
  for (const f of await listReports(id, { kind: "call" })) {
    // eslint-disable-next-line no-await-in-loop
    const t = await transcriptFor(f.id);
    if (t && t.status === "done") continue;
    if (t && t.status === "pending" && !isStalePending(t)) continue;
    // eslint-disable-next-line no-await-in-loop
    const file = await ownReport(id, f.id);
    if (!file) { out.push({ fileId: f.id, status: "missing" }); continue; }
    // eslint-disable-next-line no-await-in-loop
    const r = await transcribeRecording({ userId: id, fileId: f.id, name: file.name, type: file.type,
      bytes: file.bytes, meetingId: t?.meetingId ?? null }, deps);
    out.push({ fileId: f.id, status: r.status });
  }
  return out;
}

/**
 * При старте сервера: всё, что осталось в «идёт», перезапускается —
 * ни одна расшифровка не может идти через перезапуск, потому что ждал её
 * процесс, которого больше нет. Байты на месте — расшифровка заново;
 * файла нет (запись удалили) — «прервана» словами, а не «идёт» навечно.
 */
export async function resumeTranscripts(deps = {}) {
  const out = [];
  for (const t of await listPendingTranscripts()) {
    // eslint-disable-next-line no-await-in-loop
    const file = t.by == null ? null : await ownReport(t.by, t.fileId);
    if (!file) {
      // eslint-disable-next-line no-await-in-loop
      await putTranscript({ fileId: t.fileId, by: t.by, name: t.name, meetingId: t.meetingId, status: "error",
        error: `${INTERRUPTED}, а записи на диске уже нет — загрузите её заново`, model: t.model });
      out.push({ fileId: t.fileId, status: "error" });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const r = await transcribeRecording({ userId: t.by, fileId: t.fileId, name: file.name, type: file.type,
      bytes: file.bytes, meetingId: t.meetingId }, deps);
    if (r.status === "none") {
      // Модель с тех пор сняли: «идёт» врало бы, и «нет модели» тут точнее.
      // eslint-disable-next-line no-await-in-loop
      await putTranscript({ fileId: t.fileId, by: t.by, name: t.name, meetingId: t.meetingId, status: "error",
        error: `${INTERRUPTED}; ${NO_MODEL}`, model: t.model });
    }
    out.push({ fileId: t.fileId, status: r.status });
  }
  return out;
}
