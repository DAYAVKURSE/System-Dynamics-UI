/* ════════════════════════════════════════════════════════════════
   ЖУРНАЛ ДЕЙСТВИЙ (владелец, 2026-09-21)

   «У ассистента в контексте должна быть информация о том, что видел
   пользователь в приложении, в момент когда он решил задать вопрос. Я
   думаю, что здесь нужно делать логирование и скриншоты».

   Здесь — логирование: короткая лента последних действий человека в
   приложении. Пишется в память страницы, никуда не уходит сама — только
   вместе с вопросом ассистенту (кнопка с волшебной палочкой). Никаких
   значений паролей и ключей: у поля с `type="password"` пишется только
   «изменено».
   ════════════════════════════════════════════════════════════════ */

export const LOG_SIZE = 80;
const entries = [];

const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();
const short = (v, n = 60) => { const t = clean(v); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};

/** Записать действие словами. */
export function record(text, at = Date.now()) {
  const t = short(text, 120);
  if (!t) return;
  entries.push({ at, text: t });
  if (entries.length > LOG_SIZE) entries.splice(0, entries.length - LOG_SIZE);
}

/** Последние `n` действий, старые первыми. */
export const tail = (n = LOG_SIZE) => entries.slice(-n).map((e) => ({ ...e }));

/** Лента текстом — так она уходит ассистенту. */
export const logText = (n = LOG_SIZE) => tail(n).map((e) => `${hhmm(e.at)} ${e.text}`).join("\n");

/* ─── к сообщению об ошибке (владелец, 2026-09-21) ───
   Последние действия за две минуты, но не меньше пятидесяти (владелец,
   2026-09-22: «последние 50 сообщений вместо 10»; а если всего меньше —
   все), без чувствительных данных. */
export const RECENT_MS = 2 * 60 * 1000;
export const RECENT_MIN = 50;
/** Чувствительное — вон: ключи и токены, адреса почты, длинные номера. */
export const scrub = (text) => String(text || "")
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "«почта»")
  .replace(/\b(?:sk|blp|xoxb|ghp|hf|key|tok)[-_][A-Za-z0-9_-]{8,}/gi, "«ключ»")
  .replace(/\b[A-Za-z0-9_-]{28,}\b/g, "«ключ»")
  .replace(/\b\d[\d\s()-]{8,}\d\b/g, "«номер»");
export function recent({ ms = RECENT_MS, min = RECENT_MIN, now = Date.now() } = {}) {
  const fresh = entries.filter((e) => now - e.at <= ms);
  const list = fresh.length >= min ? fresh : entries.slice(-min);
  return list.map((e) => ({ at: e.at, text: scrub(e.text) }));
}
export const recentText = (opts) => recent(opts).map((e) => `${hhmm(e.at)} ${e.text}`).join("\n");

export const clearLog = () => { entries.length = 0; };

/** Как назвать элемент: подпись для доступности, иначе его текст. */
export const labelOf = (el) => {
  if (!el) return "";
  const aria = el.getAttribute?.("aria-label");
  if (aria) return short(aria);
  const t = short(el.textContent);
  if (t) return t;
  return short(el.getAttribute?.("title") || el.getAttribute?.("placeholder") || el.name || "");
};

/** Что записать о поле, которое поменяли. */
export const fieldNote = (el) => {
  const label = labelOf(el) || el.tagName?.toLowerCase() || "поле";
  // Пароль, ключ, токен — значение не пишется вовсе.
  if (el.type === "password" || /ключ|пароль|токен|token|key|secret|password/i.test(label)) return `поле «${label}»: изменено`;
  if (el.type === "checkbox" || el.type === "radio") return `${el.checked ? "отмечено" : "снято"}: «${label}»`;
  if (el.tagName === "SELECT") {
    const opt = el.options?.[el.selectedIndex];
    return `выбрано «${label}»: ${short(opt?.textContent || el.value)}`;
  }
  return `поле «${label}»: ${short(el.value, 40)}`;
};

/* Слушатели на документе: нажатия по кнопкам и ссылкам, правки полей.
   Возвращает функцию, которая всё снимает. */
export function watchApp(doc = typeof document === "undefined" ? null : document) {
  if (!doc) return () => {};
  const onClick = (e) => {
    const el = e.target?.closest?.("button, [role='button'], a, [role='tab']");
    if (!el) return;
    const kind = el.getAttribute("role") === "tab" ? "вкладка" : el.tagName === "A" ? "ссылка" : "кнопка";
    record(`${kind} «${labelOf(el)}»`);
  };
  const onChange = (e) => {
    const el = e.target;
    if (!el || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    record(fieldNote(el));
  };
  doc.addEventListener("click", onClick, true);
  doc.addEventListener("change", onChange, true);
  return () => {
    doc.removeEventListener("click", onClick, true);
    doc.removeEventListener("change", onChange, true);
  };
}
