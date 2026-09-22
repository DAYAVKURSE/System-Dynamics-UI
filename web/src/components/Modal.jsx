import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { C, BAD, S, btn } from "./ui.jsx";

/* ════════════════════════════════════════════════════════════════
   МОДАЛЬНОЕ ОКНО

   В приложении не было ни одного, и это не случайность: всё, что можно
   сказать на месте, лучше говорить на месте. Здесь окно появилось ради
   объяснений «почему подпись красная» — текст длинный, читать его нужно
   один раз, и место под него на схеме взять неоткуда.

   Что окно обязано уметь, чтобы не мешать: закрываться по Escape, по
   нажатию вне себя и кнопкой; забирать фокус на себя, чтобы клавиатура
   не бродила по схеме за спиной у окна, и возвращать его туда, откуда
   взяли. Без последнего человек, закрывший окно, теряет место в
   интерфейсе и ищет его заново.

   Рисуется ПОРТАЛОМ в `body`, а не там, где вызвано: `position: fixed`
   внутри прокрученного или трансформированного предка считается от него,
   и на телефоне окно уезжало за край экрана. У `body` предков нет.
   Высота — от видимой области (`dvh`), не от `vh`: в WebView Telegram
   `vh` считает и полосы, которых на экране нет.
   ════════════════════════════════════════════════════════════════ */

export default function Modal({ title, children, onClose }) {
  const box = useRef(null);
  const cameFrom = useRef(null);

  useEffect(() => {
    cameFrom.current = document.activeElement;
    box.current?.focus();
    const key = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      // Фокус возвращаем туда, откуда пришли: иначе после закрытия он
      // окажется в начале страницы, и человек потеряет своё место.
      try { cameFrom.current?.focus?.(); } catch { /* элемента уже нет */ }
    };
  }, [onClose]);

  // data-modal — чтобы снимок экрана (WandModal.captureScreen) не включал
  // само окно, если снимают, когда оно уже открыто.
  const node = (
    <div role="presentation" onClick={onClose} data-modal=""
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(5,7,12,.62)", backdropFilter: "blur(2px)",
        zIndex: 50, display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "var(--space-12)", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <div role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={box}
        onClick={(e) => e.stopPropagation()}
        style={{ ...S.card, maxWidth: 460, width: "100%", outline: "none",
          margin: "max(12px, 4dvh) 0", maxHeight: "calc(100dvh - 24px)", overflow: "auto",
          boxSizing: "border-box" }}>
        <div className="flex items-center gap-2" style={{ marginBottom: "var(--space-12)" }}>
          <span style={{ fontSize: "var(--fs-title)", lineHeight: "22px", fontWeight: 600, flex: 1 }}>
            {title}</span>
          {/* Закрыть — иконная капсула, как в верхней панели: контурная
              иконка, не эмодзи и не крестик текстом. */}
          <button type="button" aria-label="закрыть" onClick={onClose}
            style={{ width: 30, height: 30, borderRadius: "var(--radius-pill)", flex: "0 0 auto",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              background: "var(--surface-glass)", border: "1px solid var(--border-glass)",
              color: C.text, padding: 0, cursor: "pointer" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {/* Переносы строк сохраняются: объяснения устроены как определение
            и список условий под ним, а HTML схлопнул бы их в один абзац —
            и список перестал бы читаться списком. */}
        <div style={{ fontSize: "var(--fs-body)", lineHeight: "20px", color: C.text,
          whiteSpace: "pre-line" }}>{children}</div>
      </div>
    </div>);
  return typeof document === "undefined" ? node : createPortal(node, document.body);
}

/**
 * Подпись под названием: «актив», «ресурс», «функциональный элемент».
 *
 * Белая, пока строение сходится, и красная, когда нет. Знак вопроса
 * появляется ТОЛЬКО у красной: у белой объяснять нечего, а лишний значок
 * рядом с каждым названием превратил бы схему в частокол.
 */
/* `label` — то, как подпись зовут в вопросе «почему не сходится»: слово в
   подписи бывает состоянием («не заполнена»), а спрашивают всё равно про
   функцию. `tone` задаёт цвет там, где состояний больше двух: «собрана, но
   не принята» — это ещё не зелёный, хотя проверки уже проходят. */
export function Mark({ text, ok, onWhy, style, label = text, tone }) {
  return (
    <span style={{ fontSize: "var(--fs-hint)", color: tone || (ok ? C.text : BAD),
      whiteSpace: "nowrap", ...style }}>
      {text}
      {!ok && (
        <button aria-label={`почему «${label}» не сходится`} title="почему подпись красная"
          onClick={(e) => { e.stopPropagation(); onWhy(); }}
          style={{ marginLeft: "var(--space-4)", width: 15, height: 15, lineHeight: "13px", padding: 0,
            borderRadius: "50%", background: "transparent", color: BAD,
            border: `1px solid ${BAD}`, fontSize: "var(--fs-hint)", cursor: "pointer" }}>?</button>)}
    </span>);
}
