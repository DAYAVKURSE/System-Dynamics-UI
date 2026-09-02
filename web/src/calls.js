import { getInitData } from "./telegram.js";

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
   ════════════════════════════════════════════════════════════════ */

const headers = () => ({
  "Content-Type": "application/json",
  "X-Telegram-Init-Data": getInitData(),
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
export const getIce = () => json("/api/calls/ice");

export const sendSignal = (id, data, to = null) =>
  json(`/api/calls/${encodeURIComponent(id)}/signal`,
    { method: "POST", body: JSON.stringify({ to, data }) });

export const pollSignals = (id, since, signal) =>
  fetch(`/api/calls/${encodeURIComponent(id)}/signal?since=${since}`,
    { headers: headers(), signal }).then((r) => (r.ok ? r.json() : null));

/** Ссылка на страницу звонка — отдельную, без вкладок модели. */
export const callLink = (id) => `${location.origin}/call?call=${encodeURIComponent(id)}`;

/** Встреча, с которой приложение открыли: ?call=… или startapp=call_… */
export function callFromLocation() {
  try {
    const q = new URLSearchParams(location.search);
    const direct = q.get("call");
    if (direct) return direct;
    const start = q.get("tgWebAppStartParam")
      || window.Telegram?.WebApp?.initDataUnsafe?.start_param || "";
    return /^call_(.+)$/.test(start) ? start.replace(/^call_/, "") : null;
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
