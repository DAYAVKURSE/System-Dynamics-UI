/* ════════════════════════════════════════════════════════════════
   ЭКРАН СЛОВАМИ (владелец, 2026-09-21)

   Что человек видел в приложении в момент вопроса — как текст: заголовки,
   подписи, значения полей, кнопки, отметки — в порядке чтения. Это и
   уходит ассистенту в подсказку: модель читает текст, а не картинку.
   Снимок экрана идёт отдельно, в чат.

   Берётся только то, что на экране: элемент, чей прямоугольник не
   пересекает окно, пропускается. Без разметки (тест) прямоугольников нет —
   тогда берётся всё.
   ════════════════════════════════════════════════════════════════ */

export const MAX_SCREEN_CHARS = 8000;

const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();

const hidden = (el) => {
  if (el.getAttribute?.("aria-hidden") === "true") return true;
  const st = el.style || {};
  if (st.display === "none" || st.visibility === "hidden") return true;
  return false;
};

/** На экране ли: по прямоугольнику; нет прямоугольников — считаем, что да. */
export function onScreen(el, view = null) {
  if (!el.getBoundingClientRect) return true;
  const r = el.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0)) return true;
  const h = view?.height ?? (typeof window !== "undefined" ? window.innerHeight : Infinity);
  const w = view?.width ?? (typeof window !== "undefined" ? window.innerWidth : Infinity);
  return r.bottom > 0 && r.top < h && r.right > 0 && r.left < w;
}

const label = (el) => clean(el.getAttribute("aria-label") || el.getAttribute("placeholder")
  || el.getAttribute("title") || "");

/**
 * Текст экрана. `root` — откуда читать; окна (модальные) читаются вместе
 * со всем, как и видит их человек.
 */
export function screenText(root = typeof document === "undefined" ? null : document.body,
  { view = null, limit = MAX_SCREEN_CHARS } = {}) {
  if (!root) return "";
  const lines = [];
  const push = (s) => { const t = clean(s); if (t && lines[lines.length - 1] !== t) lines.push(t); };
  const walk = (el) => {
    if (!el || el.nodeType !== 1) return;
    if (hidden(el)) return;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "SVG" || tag === "svg") return;
    if (!onScreen(el, view)) return;
    /* Барабан вкладок разбит по буквам: читаем подписи вкладок, а не буквы. */
    if (el.hasAttribute("data-drum")) {
      const tabs = [...el.querySelectorAll("[data-tab]")];
      const names = tabs.map((t) => (t.getAttribute("aria-current") === "page"
        ? `[${label(t) || t.textContent}]` : (label(t) || t.textContent)));
      push(`Вкладки: ${names.join(" · ")}`);
      return;
    }
    if (tag === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "hidden") return;
      if (type === "checkbox" || type === "radio") { push(`${el.checked ? "[x]" : "[ ]"} ${label(el)}`); return; }
      if (type === "password") { push(`${label(el)}: •••`); return; }
      push(`${label(el)}: ${clean(el.value) || "—"}`);
      return;
    }
    if (tag === "TEXTAREA") { push(`${label(el)}: ${clean(el.value) || "—"}`); return; }
    if (tag === "SELECT") {
      const opt = el.options?.[el.selectedIndex];
      push(`${label(el)}: ${clean(opt?.textContent || el.value) || "—"}`);
      return;
    }
    if (tag === "BUTTON" || el.getAttribute("role") === "button") {
      const t = clean(el.textContent) || label(el);
      if (t) push(`[${t}]${el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-selected") === "true" ? " (выбрано)" : ""}`);
      return;
    }
    if (tag === "IMG") { const a = clean(el.getAttribute("alt")); if (a) push(`(картинка: ${a})`); return; }
    // Свой текст элемента — только прямые текстовые узлы; дети — сами.
    let own = "";
    el.childNodes.forEach((n) => {
      if (n.nodeType === 3) own += ` ${n.textContent}`;
      else if (n.nodeType === 1) { if (own.trim()) { push(own); own = ""; } walk(n); }
    });
    if (own.trim()) push(own);
  };
  walk(root);
  let out = lines.join("\n");
  if (out.length > limit) out = `${out.slice(0, limit - 1)}…`;
  return out;
}
