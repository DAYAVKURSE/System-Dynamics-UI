import React, { useState } from "react";
import { BAD, OK, S, btn } from "./ui.jsx";
import Modal from "./Modal.jsx";
import { logText, record } from "../lib/appLog.js";
import { screenText } from "../lib/screenText.js";

/* ════════════════════════════════════════════════════════════════
   ВОЛШЕБНАЯ ПАЛОЧКА · вопрос ассистенту (владелец, 2026-09-21)

   «После кнопки с восклицательным знаком и перед кнопкой отменить —
   кнопка с волшебной палочкой. При нажатии — модальное окно с полем ввода
   и кнопкой „вопрос ассистенту“. У ассистента в контексте должна быть
   информация о том, что видел пользователь в приложении в момент, когда
   он решил задать вопрос. Ответ должен приходить в чат, там же
   пользователь может продолжить диалог».

   Что человек видел, снимается В МОМЕНТ НАЖАТИЯ на палочку — до того, как
   откроется окно: экран словами (lib/screenText.js), лента последних
   действий (lib/appLog.js) и снимок экрана. Снимок уходит в чат вместе с
   вопросом только по галочке «отправить скриншот» (владелец,
   2026-09-22) — как в сообщении об ошибке: на экране бывает чужое.
   ════════════════════════════════════════════════════════════════ */

const SHOT_WIDTH = 1080;
/* Прозрачная точка вместо картинки, которую не удалось забрать (аватарка
   с чужого домена): без неё html-to-image оставлял ссылку, и на телефоне
   снимок не собирался вовсе. */
const BLANK_PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
/* Окна (Modal.jsx, data-modal) в снимок не берём: если снимают, когда окно
   уже открыто, человек хочет показать то, что под ним. */
const notModal = (n) => !(n?.dataset && "modal" in n.dataset);

/* ─── Снимок экрана ───
   Сначала html-to-image: страницу рисует сам браузер (SVG foreignObject),
   стекло, тени и градиенты — как на экране. Не вышло (WebKit на телефоне
   капризен к foreignObject) — html2canvas, он рисует своим интерпретатором
   стилей, чуть «криво», но снимок будет. Не вышло и так — без картинки. */
async function shootWithHtmlToImage(bg, w, h, pixelRatio) {
  const { toPng } = await import("html-to-image");
  const png = await toPng(document.documentElement, { pixelRatio, cacheBust: false,
    width: w, height: h, backgroundColor: bg,
    // шрифт в приложении системный — таблицы стилей ради шрифтов не читаем
    skipFonts: true, imagePlaceholder: BLANK_PX,
    style: { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)` },
    filter: notModal });
  return png && png.length > 200 ? png : null;
}
async function shootWithHtml2canvas(bg, w, h, pixelRatio) {
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(document.body, { backgroundColor: bg, scale: pixelRatio,
    useCORS: true, allowTaint: false, logging: false,
    width: w, height: h, x: window.scrollX, y: window.scrollY,
    windowWidth: w, windowHeight: h,
    ignoreElements: (el) => !notModal(el) });
  const png = canvas.toDataURL("image/png");
  return png && png.length > 200 ? png : null;
}

/* РЕЖИМ СНИМКА (владелец, 2026-09-22: «скриншоты очень кривые и не
   отвечают действительности»). Ни одна из библиотек не рисует
   `backdrop-filter`: стекло на снимке выходило светлой плашкой с нечитаемым
   текстом. На время снимка страница помечается `data-shot`, и стекло
   становится сплошным (index.css) — тем же, что и в режиме «уменьшить
   прозрачность». Снимок берётся в разрешении экрана (DPR), а не в CSS-
   пикселях: 411 точек в ширину читались как каша. */
const SHOT_ATTR = "shot";
export async function captureScreen(root = typeof document === "undefined" ? null : document.body) {
  const screen = screenText(root);
  const log = logText();
  let shot = null;
  /* Без настоящего холста (jsdom, тесты) снимать нечем — и библиотеки не
     грузим: они ходят по стилям псевдоэлементов, которых там нет. */
  const canvasOk = typeof document !== "undefined" && import.meta.env?.MODE !== "test"
    && !!document.createElement("canvas").getContext?.("2d");
  if (root && canvasOk) {
    const bg = getComputedStyle(document.body).backgroundColor || "#0b0f14";
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const pixelRatio = Math.min(dpr, SHOT_WIDTH / Math.max(1, w));
    document.documentElement.dataset[SHOT_ATTR] = "1";
    try {
      for (const shoot of [shootWithHtmlToImage, shootWithHtml2canvas]) {
        try { shot = await shoot(bg, w, h, pixelRatio); }
        catch (e) { shot = null; record(`снимок (${shoot.name}) не вышел: ${String(e?.message || e).slice(0, 80)}`); }
        if (shot) break;
      }
    } finally { delete document.documentElement.dataset[SHOT_ATTR]; }
    if (!shot) record("снимок экрана не получился");
  }
  return { screen, log, shot };
}

/* ─── Галочка «отправить скриншот» ───
   Одна на окно ошибки и окно вопроса. Снимок, снятый при нажатии на
   значок, — лучший: без окна поверх. Не снялся — снимаем при отправке,
   окно из снимка вырезается (data-modal). Галочка не гаснет никогда:
   выключенная галочка на телефоне читалась как «не нажимается»
   (владелец, 2026-09-22). */
export function ShotCheck({ checked, onChange, disabled }) {
  return (
    <label className="flex items-center gap-2" style={{ fontSize: "var(--fs-hint)",
      marginTop: "var(--space-8)", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} />
      отправить скриншот
    </label>);
}
/** Снимок для отправки: снятый заранее или свежий, если галочка стоит. */
export async function shotToSend(withShot, seen, capture = captureScreen) {
  if (!withShot) return null;
  if (seen?.shot) return seen.shot;
  try { return (await capture()).shot || null; } catch { return null; }
}

export function WandModal({ seen, onClose, onSend, capture = captureScreen }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [sent, setSent] = useState(false);
  const [withShot, setWithShot] = useState(false);

  const send = async () => {
    const q = text.trim();
    if (!q) return;
    setBusy(true); setMsg("");
    try {
      const shot = await shotToSend(withShot, seen, capture);
      await onSend({ question: q, screen: seen?.screen || "", log: seen?.log || "", shot });
      setSent(true);
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  return (
    <Modal title="Вопрос ассистенту" onClose={onClose}>
      {sent ? (
        <div role="status" style={{ fontSize: "var(--fs-body)" }}>Ответ придёт в чат бота.</div>
      ) : (<>
        <textarea autoFocus aria-label="вопрос ассистенту" rows={5} value={text}
          disabled={busy} onChange={(e) => setText(e.target.value)}
          style={{ ...S.inp, width: "100%", resize: "vertical", minHeight: 90, lineHeight: 1.5 }} />
        <ShotCheck checked={withShot} onChange={setWithShot} disabled={busy} />
        {msg && <div role="status" style={{ fontSize: "var(--fs-hint)", color: BAD, marginTop: "var(--space-4)" }}>{msg}</div>}
      </>)}
      <div className="flex gap-2" style={{ marginTop: "var(--space-8)" }}>
        {!sent && (
          <button type="button" style={btn(true, OK)} disabled={busy || !text.trim()}
            onClick={send}>{busy ? "Отправляю…" : "вопрос ассистенту"}</button>)}
        <button type="button" style={btn(false)} disabled={busy}
          onClick={onClose}>{sent ? "Закрыть" : "Отмена"}</button>
      </div>
    </Modal>);
}
