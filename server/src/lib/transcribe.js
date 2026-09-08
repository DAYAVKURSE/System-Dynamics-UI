import { modelFor } from "./assistantSettings.js";
import { putTranscript } from "./callStore.js";

/* ════════════════════════════════════════════════════════════════
   РАСШИФРОВКА ЗАПИСЕЙ ЗВОНКОВ

   Расшифровка — такая же задача для модели, как ответ на вопрос: строка
   «расшифровка записей звонков» в таблице «задача → модель» у того, кто
   запись сохранил (lib/assistantSettings.js, `modelFor(userId,
   'transcribe')`). Своя модель, свой ключ, свой счёт.

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
/* Одна фраза на контекст помощника и на журнал: почему текста нет. */
export const NO_MODEL = "расшифровки нет: модель для задачи «расшифровка» не выбрана";
const ERROR_TEXT_LIMIT = 300;

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
 * Модель берётся у того, кто запись сохранил. Модели нет — ничего не
 * пишется и ничего не запускается: в контексте помощника на месте текста
 * будет фраза NO_MODEL, а не тишина. Возвращает состояние словами; сам
 * никогда не бросает — вызывающий маршрут ответ уже отдал.
 *
 * `deps` — для тестов: выбор модели (`pick`) и сеть (`doFetch`).
 */
export async function transcribeRecording({ userId, fileId, name, type, bytes, meetingId = null } = {},
  { pick = modelFor, doFetch = globalThis.fetch } = {}) {
  let chosen = null;
  try {
    chosen = await pick(String(userId), "transcribe");
  } catch (e) {
    // Настройки не прочитались — это тоже ответ, и его надо показать.
    return putTranscript({ fileId, by: userId, name, meetingId, status: "error",
      error: `настройки помощника не прочитались: ${e.message}` });
  }
  if (!chosen) return { status: "none", reason: NO_MODEL };

  const label = [chosen.providerName, chosen.model].filter(Boolean).join(" / ");
  await putTranscript({ fileId, by: userId, name, meetingId, status: "pending", model: label });
  try {
    const text = await transcribeFile({ ...chosen, bytes, name, type }, doFetch);
    return await putTranscript({ fileId, by: userId, name, meetingId, status: "done", text, model: label });
  } catch (e) {
    return putTranscript({ fileId, by: userId, name, meetingId, status: "error",
      error: e.message, model: label });
  }
}
