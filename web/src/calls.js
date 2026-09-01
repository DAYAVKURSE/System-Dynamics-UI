import { getInitData } from "./telegram.js";

/* ════════════════════════════════════════════════════════════════
   ЗВОНКИ · клиентская часть

   Видео и звук идут напрямую между собеседниками (WebRTC). Сервер только
   передаёт им описания соединения и сетевые кандидаты — и перестаёт
   участвовать, как только соединение установлено.

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

/** Ссылка, по которой встреча открывается: её же кладём в приглашение. */
export const callLink = (id) => `${location.origin}/?call=${encodeURIComponent(id)}`;

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

/** Формат записи, который умеет этот браузер. Пусто — записывать нечем. */
export function recorderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  const want = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus",
    "video/webm", "video/mp4"];
  return want.find((t) => {
    try { return MediaRecorder.isTypeSupported(t); } catch { return false; }
  }) || "";
}
