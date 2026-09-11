import React, { useEffect, useRef, useState } from "react";
import { C, ACC, BAD, S, btn } from "./ui.jsx";
import { parseExpr, toShown, toStored } from "../lib/expr.js";

/* ════════════════════════════════════════════════════════════════
   ПОЛЕ ВЫРАЖЕНИЯ · «>10», «=@Заявки*2» — как в Excel

   Человек набирает знак, числа и действия; «@» открывает список ресурсов,
   и выбранный вставляется именем. В записи имя заменяется идентификатором
   (`toStored`), на экране идентификатор — именем (`toShown`): ссылка не
   рвётся от переименования, а человек видит слова, а не коды.

   Список — под полем, фильтруется тем, что набрано после «@»; стрелки и
   Enter выбирают, Escape закрывает. Ошибка разбора стоит под полем
   словами, и в запись уходит как есть: чинить за человека нечего, а
   молча выбросить набранное — хуже ошибки.

   ─── знаки кнопками ───

   Под полем, пока оно в фокусе, стоит ряд знаков: сравнение (> < = !),
   четыре действия (+ − * /), скобки и «@». Набрать «*» на телефонной
   клавиатуре — это два переключения раскладки, и из-за них половина
   выражений не пишется вовсе. Знаки вставляются в место курсора, а фокус
   из поля не уходит: ряд — часть набора, а не уход из него.
   ════════════════════════════════════════════════════════════════ */

/* Что можно нажать. Сравнение стоит первым и отделено: оно открывает
   выражение, остальное — внутри него. */
const KEYS = [">", "<", "=", "!", "+", "-", "*", "/", "(", ")", "@"];

export default function ExprField({ value = "", traits = [], onCommit, style, ...rest }) {
  const nameOf = (id) => traits.find((t) => t.id === id)?.l || "";
  const [text, setText] = useState(() => toShown(value, nameOf));
  const [focus, setFocus] = useState(false);
  const [pick, setPick] = useState(null);   // { at, query } — открыт список
  const [cursor, setCursor] = useState(0);
  const inp = useRef(null);
  // Снаружи поменяли (загрузили модель) — а мы не в фокусе: показываем новое.
  useEffect(() => { if (!focus) setText(toShown(value, nameOf)); }, [value, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = pick
    ? traits.filter((t) => t.l && t.l.toLowerCase().startsWith(pick.query.toLowerCase()))
    : [];

  const commit = (t = text) => {
    const stored = toStored(t, traits);
    if (stored !== (value || "")) onCommit?.(stored);
  };
  const onChange = (e) => {
    const v = e.target.value;
    setText(v);
    const at = e.target.selectionStart ?? v.length;
    const before = v.slice(0, at);
    const m = before.match(/@([^@\s+\-*/()]*)$/);
    setPick(m ? { at: at - m[0].length, query: m[1] } : null);
    setCursor(0);
  };
  const choose = (t) => {
    if (!pick) return;
    const after = text.slice(pick.at + 1 + pick.query.length);
    const next = `${text.slice(0, pick.at)}@${t.l}${after}`;
    setText(next);
    setPick(null);
    // Фокус остаётся в поле: выбор из списка — часть набора, не его конец.
    setTimeout(() => inp.current?.focus(), 0);
  };
  /* Вставка знака в место курсора. Не в конец: человек правит середину
     выражения так же часто, как дописывает хвост. Для «@» сразу
     открывается список ресурсов — иначе кнопка ставила бы знак, после
     которого ничего не происходит. */
  const put = (k) => {
    const el = inp.current;
    const at = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? at;
    const next = `${text.slice(0, at)}${k}${text.slice(end)}`;
    setText(next);
    if (k === "@") { setPick({ at, query: "" }); setCursor(0); } else setPick(null);
    setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(at + 1, at + 1);
    }, 0);
  };
  const onKey = (e) => {
    if (pick && items.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => (c + 1) % items.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => (c - 1 + items.length) % items.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(items[cursor]); return; }
      if (e.key === "Escape") { setPick(null); return; }
    }
    if (e.key === "Enter") { commit(); inp.current?.blur(); }
  };
  const err = parseExpr(toStored(text, traits)).error;
  return (
    <div style={{ position: "relative", ...style }}>
      <input ref={inp} value={text} {...rest}
        style={{ ...S.inp, width: "100%", fontFamily: "ui-monospace, Menlo, monospace" }}
        placeholder="> 10   или   > @ресурс*0,5"
        onFocus={() => setFocus(true)}
        onBlur={() => { setFocus(false); setPick(null); commit(); }}
        onChange={onChange} onKeyDown={onKey} />
      {/* Ряд знаков — только у поля в фокусе: иначе у пяти условий было бы
          пять одинаковых рядов, и форма превратилась бы в клавиатуру.
          `onMouseDown` с `preventDefault` держит фокус: без него поле
          теряло бы его на нажатии, ряд исчезал бы, и клик не доходил. */}
      {focus && (
        <div className="flex flex-wrap gap-2" style={{ marginTop: 3 }}>
          {KEYS.map((k) => (
            <button key={k} aria-label={`знак ${k}`} type="button"
              onMouseDown={(e) => { e.preventDefault(); put(k); }}
              style={{ ...btn(false), fontFamily: "ui-monospace, Menlo, monospace",
                fontSize: 12, padding: "2px 8px", minWidth: 26 }}>{k}</button>))}
        </div>)}
      {pick && !!items.length && (
        <div role="listbox" aria-label="ресурсы для выражения"
          style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 20,
            background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6,
            maxHeight: 160, overflowY: "auto", marginTop: 2 }}>
          {items.map((t, i) => (
            <div key={t.id} role="option" aria-selected={i === cursor}
              onMouseDown={(e) => { e.preventDefault(); choose(t); }}
              style={{ padding: "5px 8px", fontSize: 12, cursor: "pointer",
                background: i === cursor ? ACC + "22" : "transparent" }}>
              @{t.l}</div>))}
        </div>)}
      {err && text.trim() && (
        <div style={{ fontSize: 10.5, color: BAD, marginTop: 3 }}>{err}</div>)}
    </div>);
}
