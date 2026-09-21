import React, { useState } from "react";
import { BAD, OK, S, btn } from "./ui.jsx";
import Modal from "./Modal.jsx";
import { logText } from "../lib/appLog.js";
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
   действий (lib/appLog.js) и снимок экрана. Снимок делает html2canvas, и
   он грузится отдельным куском только здесь: остальному приложению он не
   нужен. Не получилось снять — вопрос уходит без картинки.
   ════════════════════════════════════════════════════════════════ */

const SHOT_WIDTH = 720;

export async function captureScreen(root = typeof document === "undefined" ? null : document.body) {
  const screen = screenText(root);
  const log = logText();
  let shot = null;
  try {
    /* Без настоящего холста (jsdom, тесты) снимать нечем — и html2canvas
       не грузим: он ходит по стилям псевдоэлементов, которых там нет. */
    const canvasOk = typeof document !== "undefined" && import.meta.env?.MODE !== "test"
      && !!document.createElement("canvas").getContext?.("2d");
    if (root && canvasOk) {
      const { default: html2canvas } = await import("html2canvas");
      const scale = Math.min(1, SHOT_WIDTH / Math.max(1, window.innerWidth));
      const canvas = await html2canvas(root, { scale, useCORS: true, logging: false,
        backgroundColor: null, windowWidth: window.innerWidth, windowHeight: window.innerHeight,
        x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight });
      shot = canvas.toDataURL("image/png");
    }
  } catch { shot = null; }
  return { screen, log, shot };
}

export function WandModal({ seen, onClose, onSend }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [sent, setSent] = useState(false);

  const send = async () => {
    const q = text.trim();
    if (!q) return;
    setBusy(true); setMsg("");
    try { await onSend({ question: q, ...(seen || {}) }); setSent(true); }
    catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  return (
    <Modal title="Вопрос ассистенту" onClose={onClose}>
      {sent ? (
        <div role="status" style={{ fontSize: 13 }}>Ответ придёт в чат бота.</div>
      ) : (<>
        <textarea autoFocus aria-label="вопрос ассистенту" rows={5} value={text}
          disabled={busy} onChange={(e) => setText(e.target.value)}
          style={{ ...S.inp, width: "100%", resize: "vertical", minHeight: 90, lineHeight: 1.5 }} />
        {msg && <div role="status" style={{ fontSize: 12, color: BAD, marginTop: "var(--space-4)" }}>{msg}</div>}
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
