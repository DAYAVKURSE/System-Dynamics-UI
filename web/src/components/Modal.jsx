import React, { useEffect, useRef } from "react";
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

  return (
    <div role="presentation" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "#0009", zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={box}
        onClick={(e) => e.stopPropagation()}
        style={{ ...S.card, maxWidth: 460, width: "100%", outline: "none",
          maxHeight: "80vh", overflow: "auto" }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>{title}</span>
          <button aria-label="закрыть" style={{ ...btn(false), padding: "2px 8px" }}
            onClick={onClose}>✕</button>
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.6, color: C.text }}>{children}</div>
      </div>
    </div>);
}

/**
 * Подпись под названием: «актив», «ресурс», «функциональный элемент».
 *
 * Белая, пока строение сходится, и красная, когда нет. Знак вопроса
 * появляется ТОЛЬКО у красной: у белой объяснять нечего, а лишний значок
 * рядом с каждым названием превратил бы схему в частокол.
 */
export function Mark({ text, ok, onWhy, style }) {
  return (
    <span style={{ fontSize: 10.5, color: ok ? C.text : BAD, whiteSpace: "nowrap", ...style }}>
      {text}
      {!ok && (
        <button aria-label={`почему «${text}» не сходится`} title="почему подпись красная"
          onClick={(e) => { e.stopPropagation(); onWhy(); }}
          style={{ marginLeft: 4, width: 15, height: 15, lineHeight: "13px", padding: 0,
            borderRadius: "50%", background: "transparent", color: BAD,
            border: `1px solid ${BAD}`, fontSize: 10, cursor: "pointer" }}>?</button>)}
    </span>);
}
