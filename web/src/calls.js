import { getInitData, getTelegram } from "./telegram.js";
import { codeHeader } from "./codes.js";
import { actingAs } from "./identity.js";

/* ════════════════════════════════════════════════════════════════
   ЗВОНКИ · клиентская часть

   Видео и звук идут через сервер: у каждого участника соединение с
   каждым, но медиа всегда ретранслирует coturn на этом же сервере
   (iceTransportPolicy: relay). Прямых путей между телефонами нет — один
   и тот же механизм для двоих и для десяти, и никаких «у одного не
   соединилось из-за NAT».

   Сигналы ходят обычным HTTP с длинным опросом: nginx на сервере
   проксирует без Upgrade, и вебсокет через него не пройдёт. Сигналов за
   звонок десяток — этого транспорта хватает.

   Кто мы для сервера. Открыли звонок мини-приложением — подписанный
   Telegram: id настоящий, подделать нельзя. Открыли просто ссылкой (в
   браузере, в чужом мессенджере) — гость: номер заводит себе сам браузер
   и хранит у себя. Гостю этого хватает: право войти даёт знание id
   встречи, а не регистрация в боте. Заводить встречи гость по-прежнему
   не может — там подпись обязательна.
   ════════════════════════════════════════════════════════════════ */

const GUEST_KEY = "sd.call.guest";

/** Номер гостя: случайный, свой на каждый браузер, живёт между звонками. */
export function guestId() {
  const make = () => {
    const b = new Uint8Array(12);
    (globalThis.crypto?.getRandomValues
      ? globalThis.crypto.getRandomValues(b)
      : b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); }));
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  };
  try {
    const kept = localStorage.getItem(GUEST_KEY);
    if (kept && /^[A-Za-z0-9_-]{8,64}$/.test(kept)) return kept;
    const fresh = make();
    localStorage.setItem(GUEST_KEY, fresh);
    return fresh;
  } catch {
    // Хранилище закрыто (приватное окно, старый WebView) — номер живёт
    // столько же, сколько открытая страница. Для одного звонка достаточно.
    if (!guestId.once) guestId.once = make();
    return guestId.once;
  }
}

/** Кто я в комнате: id Telegram, если он есть, иначе номер гостя. */
export const callerId = () =>
  String(getTelegram()?.initDataUnsafe?.user?.id || `guest-${guestId()}`);

const headers = () => ({
  "Content-Type": "application/json",
  "X-Telegram-Init-Data": getInitData(), ...codeHeader(),
  /* Под чужой страницей — и здесь: «Войти под его именем» меняет не
     одну вкладку, а всё приложение (см. identity.js). */
  ...(actingAs() ? { "X-Act-As": actingAs() } : {}),
  "X-Call-Guest": guestId(),
});

const json = async (url, opts) => {
  const r = await fetch(url, { headers: headers(), ...opts });
  if (!r.ok) {
    throw new Error((await r.json().catch(() => ({}))).error || `Сервер ответил ${r.status}`);
  }
  return r.status === 204 ? null : r.json();
};

export const listMeetings = () => json("/api/calls");
export const createMeeting = (m) =>
  json("/api/calls", { method: "POST", body: JSON.stringify(m) });
export const getMeeting = (id) => json(`/api/calls/${encodeURIComponent(id)}`);
export const deleteMeeting = (id) =>
  json(`/api/calls/${encodeURIComponent(id)}`, { method: "DELETE" });
export const getIce = (id) => json(`/api/calls/${encodeURIComponent(id)}/ice`);

export const sendSignal = (id, data, to = null) =>
  json(`/api/calls/${encodeURIComponent(id)}/signal`,
    { method: "POST", body: JSON.stringify({ to, data }) });

export const pollSignals = (id, since, signal) =>
  fetch(`/api/calls/${encodeURIComponent(id)}/signal?since=${since}`,
    { headers: headers(), signal }).then((r) => (r.ok ? r.json() : null));

/* ─────── записи созвонов ───────

   Лежат в том же хранилище файлов, что и вложения к задачам, но помечены
   видом «call» — иначе вкладка звонков показывала бы всё подряд. Список,
   отправка себе в чат и удаление доступны только своему: сервер выводит
   каталог из подписи Telegram, а не из запроса. */

export const listRecordings = () => json("/api/reports?kind=call");

/** Отправить запись себе в чат с ботом: сохранить файл из мини-приложения
 *  на телефон нельзя, а из чата — можно. */
export const sendRecording = (id) =>
  json(`/api/reports/${encodeURIComponent(id)}/send`, { method: "POST" });

export const deleteRecording = (scope, id) =>
  json(`/api/reports/${encodeURIComponent(scope)}/${encodeURIComponent(id)}`,
    { method: "DELETE" });

/** Ссылка на страницу звонка — отдельную, без вкладок модели. */
export const callLink = (id) => `${location.origin}/call?call=${encodeURIComponent(id)}`;

/**
 * Встреча, с которой приложение открыли: `?call=…` или `startapp=call_…`.
 *
 * Свои параметры Telegram кладёт во ФРАГМЕНТ адреса, а не в строку запроса:
 * `https://…/#tgWebAppData=…&tgWebAppStartParam=call_abc`. Читать только
 * `location.search` — значит не увидеть их вовсе: приложение открывалось
 * ссылкой на звонок и показывало всю модель с вкладками вместо окна звонка.
 * Смотрим в оба места и в разобранный SDK-ом `start_param`.
 */
export function callFromLocation() {
  try {
    const q = new URLSearchParams(location.search);
    const h = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
    const direct = q.get("call") || h.get("call");
    if (direct) return direct;
    const start = q.get("tgWebAppStartParam") || h.get("tgWebAppStartParam")
      || window.Telegram?.WebApp?.initDataUnsafe?.start_param || "";
    const m = String(start).match(/^call_(.+)$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/* ─────── медиа ─────── */

export const mediaSupported = () =>
  Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

/**
 * Просит камеру и микрофон. Отказ и отсутствие поддержки — разные вещи, и
 * пользователю надо сказать, что именно случилось: «нажмите разрешить» и
 * «ваш клиент этого не умеет» лечатся по-разному.
 */
export async function getLocalStream({ video = true, audio = true } = {}) {
  if (!mediaSupported()) {
    const e = new Error("Этот клиент не даёт доступ к камере и микрофону из мини-приложения.");
    e.code = "unsupported";
    throw e;
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: video ? { facingMode: "user" } : false,
      audio,
    });
  } catch (err) {
    const e = new Error(
      err?.name === "NotAllowedError"
        ? "Доступ к камере и микрофону не разрешён. Разрешите его в настройках Telegram."
        : err?.name === "NotFoundError"
          ? "Камера или микрофон не найдены."
          : `Не удалось включить камеру: ${err?.message || err?.name || "неизвестная ошибка"}`);
    e.code = err?.name || "error";
    throw e;
  }
}

/** Умеет ли этот клиент показывать экран. На телефонах Telegram этого не
 *  даёт вовсе (ни iOS, ни Android WebView); на компьютере — да. */
export const screenShareSupported = () =>
  Boolean(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

/** Экран для трансляции. Отказ — не поломка: человек передумал. */
export async function getScreenStream() {
  if (!screenShareSupported()) {
    throw new Error("Этот клиент не умеет показывать экран — на телефоне Telegram это недоступно.");
  }
  try {
    return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (err) {
    throw new Error(err?.name === "NotAllowedError"
      ? "Показ экрана отменён."
      : `Не удалось начать показ экрана: ${err?.message || err?.name || "неизвестная ошибка"}`);
  }
}

/** Запись — умеренного качества: 300 кбит/с видео и 32 кбит/с звук дают
 *  около 2,5 МБ в минуту, то есть 100 МБ — это сорок минут созвона. */
export const RECORDER_OPTS = { videoBitsPerSecond: 300000, audioBitsPerSecond: 32000 };

/** Формат записи, который умеет этот браузер. Пусто — записывать нечем. */
export function recorderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  const want = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus",
    "video/webm", "video/mp4"];
  return want.find((t) => {
    try { return MediaRecorder.isTypeSupported(t); } catch { return false; }
  }) || "";
}
