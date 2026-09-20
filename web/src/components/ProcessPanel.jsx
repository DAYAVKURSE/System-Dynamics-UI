import React, { useEffect, useRef, useState } from "react";
import { C, OK, WARN, BAD, ACC, NEU, S, btn, nm, DiffBoxes, WAS_STYLE } from "./ui.jsx";
import { Section } from "./AssetPanel.jsx";
import { normalizeFunc } from "../lib/funcs.js";
import { PROC_STATUS, dropHypo, newProc, procLabel, resolveProc, syncProcFuncs, tidyProcText } from "../lib/process.js";
import { HINT, ICON, ROLE_KINDS, ROLE_WORD, diffTasks, exportText, fromV1, hintAt, importText, isV1,
  issuesOf, itemState, labelOf, paintOf, parseText, peopleOfPosition, procFuncs, replaceName, setAuto, setHand, setPerson,
  suggest, toggleRole, usesAsset, whoState, renameVar, setTaskTime, parseDur, parseEvery, parsePar,
  durText, everyText, parText, TIME_UNITS, setFuncHead, capFirstTyped, indentText, splitProc, joinProc, liftTaskMeta, varsOf } from "../lib/proc2.js";
import { allHands, handColor, newHandName, newVarName } from "../lib/hands.js";
import { hasKind, toggleKind } from "../lib/traits.js";
import ProcMaps from "./ProcMaps.jsx";
import { MATERIAL_KINDS, traitKind } from "../lib/units.js";

/* ════════════════════════════════════════════════════════════════
   ТЕХНОЛОГИЧЕСКИЙ ПРОЦЕСС · раздел на «Управлении»

   Владелец: «я буквально должен вводить текст, а он должен выдавать
   подсказки»; «как она была полем ввода, так должна и остаться;
   подсказки — только всплывающим окном» (2026-09-13). Язык текста —
   его (2026-09-18): строки с метками «Функция:», «Задача:», «Кто:»,
   «Берёт:», «Отдаёт:», «Кому:», «Или:», «Если … То:», «Иначе:» (см.
   lib/proc2.js).

   Поле — textarea с прозрачным текстом над подложкой (`Backdrop`),
   которая рисует те же слова плашками: должность — фиолетовая, актив —
   как блок на схеме, ресурс с количеством — цветом стороны, «берёт»/
   «отдаёт» — в круглых скобках цвета стороны; справа у «Кто:» —
   пометка актива; роли — квадратики-значки, а у выделенной должности —
   кнопки ролей. Окно подсказки — над полем.

   Все правки идут через одну дверь (`commit`): процесс, его функции и
   заведённые им ресурсы меняются одним заходом — в историю правок
   ложится один шаг.
   ════════════════════════════════════════════════════════════════ */

const STATUS_TONE = { off: null, hypo: WARN, on: OK };
const DARK = "#0E1420";
const PURPLE = "#C9A0FF";
const ROLE_COLOR = { setter: WARN, doer: ACC, checker: OK };
const SIDE = { take: ACC, give: OK };
const LINE_H = 1.9;
/* Высота места под подсказки в правке: шапка и список на 150 px, как и
   было, — только теперь место не дышит (владелец, 2026-09-20). */
const HINT_H = 178;

/* ─────── подложка ───────
   Плашка — без отступов: цвет и кольцо `box-shadow` вокруг слова, чтобы
   буквы подложки и поля не разъезжались (отступы сдвинули бы текст). */
const plate = (bg, fg = DARK, ring = "") => ({ background: bg, color: fg, borderRadius: 5,
  boxShadow: `0 0 0 3px ${bg}${ring ? `, 0 0 0 4px ${ring}` : ""}` });
function spanStyle(k) {
  const bad = k.state === "unknown" || k.state === "rejected" || k.state === "deleted" || k.state === "noasset";
  // «Если:», «То:», «Иначе:» — одним цветом с условием (владелец, 2026-09-18).
  if (k.kind === "mark") return { color: ["if", "then", "else"].includes(k.label) ? WARN : C.muted };
  if (k.kind === "func") return { color: C.text, borderBottom: `2px solid ${C.line}` };
  if (k.kind === "task") return { color: C.text, borderBottom: `1px solid ${C.line}` };
  if (k.kind === "cond") return { color: WARN };
  if (k.kind === "roles") {
    const one = k.roles.length === 1 ? k.roles[0] : null;
    return one ? plate(ROLE_COLOR[one]) : plate(C.panel2, C.muted, C.line);
  }
  if (k.kind === "hand") return plate(handColor(k.hand));
  if (k.kind === "var") return k.state && k.state !== "ok" ? plate(BAD) : plate(handColor(k.varName || ""));
  /* Количество/операция — свой квадратик: фон панели в рамке цвета стороны. */
  if (k.kind === "qty") {
    const st = { ...plate(C.panel2, C.text, SIDE[k.side] || ACC), borderRadius: 4 };
    if (k.exprError) st.boxShadow = `${st.boxShadow}, 0 0 0 6px ${BAD}`;
    return st;
  }
  if (k.kind === "person") return k.known ? plate("#FFD9A0") : plate(BAD);
  let st;
  if (bad) st = plate(BAD);
  else if (k.kind === "asset") st = plate(C.panel2, C.text, C.line);   // как блок на схеме
  else if (k.kind === "role") st = plate(PURPLE);
  else st = plate(SIDE[k.side] || ACC);
  if (k.state === "rejected") st.textDecoration = "underline dotted";
  if (k.state === "deleted") st.textDecoration = "underline dashed";
  if (k.exprError) st.boxShadow = `${st.boxShadow}, 0 0 0 6px ${BAD}`;
  return st;
}
/* Круглая скобка стороны: две дуги на якорях нулевой ширины в начале и в
   конце — при переносе на две строки каждая остаётся в своей строке. */
function Bracket({ side, children }) {
  const c = SIDE[side] || ACC;
  const anchor = { display: "inline-block", width: 0, height: "1em", verticalAlign: "text-bottom", position: "relative", overflow: "visible" };
  const arc = { position: "absolute", top: -6, height: "1.55em", width: 7, border: `2px solid ${c}`, pointerEvents: "none", boxSizing: "border-box" };
  return (
    <span data-bracket={side} style={{ background: `${c}1F`, boxShadow: `0 0 0 3px ${c}1F`, borderRadius: 7,
      WebkitBoxDecorationBreak: "clone", boxDecorationBreak: "clone" }}>
      <span style={anchor}><i style={{ ...arc, left: -11, borderRight: "none", borderRadius: "8px 0 0 8px" }} /></span>
      {children}
      <span style={anchor}><i style={{ ...arc, right: -11, borderLeft: "none", borderRadius: "0 8px 8px 0" }} /></span>
    </span>);
}
/* Простое количество («2», «=1», «45-55») показывается как есть; иная
   операция на строках без курсора — значком «ƒ» той же ширины (владелец,
   2026-09-18: «в поле — значок, при нажатии видна вся операция»). */
const SIMPLE_TAIL = /^=?\s*\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?$/;
/* Пропущенное значение — знак «?» (владелец, 2026-09-18): у ресурса без
   количества, у метки без значения. Якорь нулевой ширины, чтобы подложка
   не разъезжалась с текстом. */
function Missing({ what }) {
  return (
    <span data-missing={what} title={what === "qty" ? "сколько — не указано (считается 1)" : "значение не указано"}
      style={{ display: "inline-block", width: 0, position: "relative", verticalAlign: "text-bottom", height: "1em", overflow: "visible" }}>
      <span aria-hidden="true" style={{ position: "absolute", left: 1, top: "-0.75em", fontSize: 9, lineHeight: "12px", width: 12, height: 12,
        borderRadius: 6, background: WARN, color: DARK, textAlign: "center", fontWeight: 700 }}>?</span>
    </span>);
}
function Backdrop({ text, paint, style, noteGap = 0, activeRow = -1, caretRow = -1, backRef = null }) {
  const lines = String(text || "").split("\n");
  const byRow = new Map(paint.map((r) => [r.row, r]));
  const piece = (ln, from, to, spans, key, row = -1) => {
    const out = [];
    let at = from;
    spans.filter((k) => k.start >= from && k.end <= to).forEach((k, j) => {
      if (k.start > at) out.push(<span key={`${key}t${j}`}>{ln.slice(at, k.start)}</span>);
      const bad = k.state && k.state !== "ok";
      const raw = ln.slice(k.start, k.end);
      /* Рука «{имя}» и сотрудник «@Имя»: скобки и «@» остаются в тексте,
         но не видны — в прямоугольнике только имя (владелец, 2026-09-18). */
      const wrap = (k.kind === "hand" && k.brace) ? [1, 1] : (k.kind === "person" && k.at) ? [1, 0] : null;
      const inner = wrap ? raw.slice(wrap[0], raw.length - wrap[1]) : raw;
      const vr = k.kind === "var" && k.inner ? { a: k.inner.start - k.start, b: k.inner.end - k.start } : null;
      // Сложная операция на строке без курсора — значком «ƒ» той же ширины.
      const op = k.kind === "qty" && k.tail && !SIMPLE_TAIL.test(k.tail) && row !== caretRow
        ? { a: 0, b: raw.length } : null;
      out.push(<span key={`${key}m${j}`} data-kind={k.kind} data-side={k.side || undefined}
        data-mark={bad ? k.state : (k.exprError ? "expr" : undefined)}
        title={k.exprError || (k.kind === "roles" ? k.roles.map((r) => ROLE_WORD[r]).join(", ") : k.kind === "hand" ? `переменная сотрудника: ${k.hand}` : k.kind === "var" ? `закреплённый ресурс: ${k.varName}` : k.kind === "person" ? (k.known ? "именно этот сотрудник" : "нет такого сотрудника") : bad ? k.state : undefined)}
        style={wrap || vr ? {} : spanStyle(k)}>
        {vr ? (<>
          <span style={{ color: "transparent" }}>{raw.slice(0, vr.a)}</span>
          <span data-var={k.varName} style={spanStyle(k)}>{raw.slice(vr.a, vr.b)}</span>
          <span style={{ color: "transparent" }}>{raw.slice(vr.b)}</span>
        </>) : k.kind === "trait" && !k.tail && k.name ? (<>{raw}<Missing what="qty" /></>) : op ? (<>
          {raw.slice(0, op.a)}
          <span data-op={k.tail} title={`операция: ${k.tail}`} style={{ position: "relative", display: "inline-block" }}>
            <span style={{ color: "transparent" }}>{raw.slice(op.a, op.b)}</span>
          </span>
          {raw.slice(op.b)}
        </>) : wrap ? (<>
          <span style={{ color: "transparent" }}>{raw.slice(0, wrap[0])}</span>
          <span style={spanStyle(k)}>{inner}</span>
          {wrap[1] ? <span style={{ color: "transparent" }}>{raw.slice(raw.length - wrap[1])}</span> : null}
        </>) : raw}</span>);
      if (k.kind === "mark" && k.label !== "else" && k.label !== "then" && !ln.slice(k.end).trim()) out.push(<Missing key={`${key}q${j}`} what="value" />);
      at = k.end;
    });
    if (to > at) out.push(<span key={`${key}r`}>{ln.slice(at, to)}</span>);
    return out;
  };
  return (
    <div aria-hidden="true" data-proc-backdrop="" ref={backRef} style={{ ...style, position: "absolute", inset: 0,
      color: C.text, pointerEvents: "none", overflow: "hidden", whiteSpace: "pre-wrap",
      wordBreak: "break-word", borderColor: "transparent", background: "transparent" }}>
      {lines.map((ln, i) => {
        const r = byRow.get(i);
        const parts = [];
        let at = 0;
        (r?.brackets || []).sort((a, b) => a.start - b.start).forEach((b, j) => {
          if (b.start > at) parts.push(...piece(ln, at, b.start, r.spans, `p${j}`, i));
          parts.push(<Bracket key={`b${j}`} side={b.side}>{piece(ln, b.start, b.end, r.spans, `i${j}`, i)}</Bracket>);
          at = b.end;
        });
        parts.push(...piece(ln, at, ln.length, r?.spans || [], "z", i));
        return (
          <div key={i} style={{ position: "relative", minHeight: `${LINE_H}em` }}>
            {parts}{"​"}
            {/* Актив у строки «Кто:»/«Кому:» — подсказка, а не часть текста:
                мелко, полупрозрачно и чуть выше строки, чтобы не мешать
                основному тексту (владелец, 2026-09-18). */}
            {r?.note && (
              <span data-note={r.note} style={{ position: "absolute", right: 4 + (i === activeRow ? noteGap : 0), top: "-0.45em", color: C.muted,
                fontSize: 8.5, lineHeight: 1.4, opacity: 0.6, background: `${C.ink}b3`, padding: "0 4px", borderRadius: 3,
                border: `1px solid ${C.line}66`, whiteSpace: "nowrap", maxWidth: "45%", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.note}</span>)}
            {r?.error && (
              <span data-mark="error" style={{ position: "absolute", right: 0, top: 0, color: BAD,
                fontSize: 10, lineHeight: `${LINE_H}em`, background: C.ink, padding: "0 4px",
                maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                ← {r.error}</span>)}
          </div>);
      })}
    </div>);
}

/* ─────── части контекстных меню (владелец, 2026-09-18) ───────
   Спойлер раздела: заголовок с текущим значением, внутри — поля. Вид тот
   же, что у кнопок меню, чтобы меню читалось одним списком. */
function Fold({ title, value, open, onToggle, children }) {
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 5 }}>
      <button type="button" aria-expanded={open} aria-label={title} onClick={onToggle}
        className="flex items-center gap-2"
        style={{ width: "100%", background: "transparent", border: "none", color: C.text, cursor: "pointer",
          padding: "3px 6px", fontSize: 11.5, textAlign: "left" }}>
        <span style={{ width: 10, color: C.muted }}>{open ? "▾" : "▸"}</span>
        <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        {value != null && <span style={{ fontSize: 10.5, color: C.muted, whiteSpace: "nowrap" }}>{value}</span>}
      </button>
      {open && <div style={{ padding: "2px 6px 6px" }}>{children}</div>}
    </div>);
}
/** Небольшое числовое поле меню: правка по месту, запись при уходе. */
function MiniNum({ value, label, onCommit, width = 54 }) {
  const [draft, setDraft] = useState(String(value ?? ""));
  useEffect(() => { setDraft(String(value ?? "")); }, [value]);
  return (
    <input value={draft} aria-label={label} inputMode="decimal"
      style={{ ...S.inp, width, fontSize: 11.5, padding: "2px 5px" }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(Number(String(draft).replace(",", ".")) || 0)}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />);
}
/** «От … до …» с единицей: одно число, пока «до» не больше. */
function Range({ lo, hi, unit, label, onChange }) {
  const [wide, setWide] = useState(Number(hi) > Number(lo));
  useEffect(() => { setWide(Number(hi) > Number(lo)); }, [lo, hi]);
  return (
    <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
      <MiniNum value={lo} label={`${label}: сколько`} onCommit={(v) => onChange(v, wide ? Math.max(v, Number(hi) || 0) : v, unit)} />
      {wide && (<>
        <span style={S.lbl}>до</span>
        <MiniNum value={hi} label={`${label}: до`} onCommit={(v) => onChange(Number(lo) || 0, Math.max(Number(lo) || 0, v), unit)} />
      </>)}
      <select value={unit} aria-label={`${label}: единица`} onChange={(e) => onChange(Number(lo) || 0, Number(hi) || 0, e.target.value)}
        style={{ ...S.inp, width: "auto", padding: "2px 4px", fontSize: 11.5 }}>
        {TIME_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
      <label className="flex items-center gap-2" style={{ fontSize: 10.5, color: C.muted, cursor: "pointer" }}>
        <input type="checkbox" aria-label={`${label}: вилка`} checked={wide} style={{ accentColor: ACC }}
          onChange={(e) => { setWide(e.target.checked); onChange(Number(lo) || 0, e.target.checked ? Math.max(Number(lo) || 0, Number(hi) || 0) * (Number(hi) > Number(lo) ? 1 : 2) : Number(lo) || 0, unit); }} />
        вилка
      </label>
    </div>);
}

/* ─────── поле с подсказками ─────── */
function ProcText({ value = "", model, proc: proc0, onCommit, label, usedHands = () => new Set(), kinds = [], onTrait, outerVars = [], meta = [], onMeta }) {
  /* Разбор поля знает о закреплённых ресурсах соседних функций процесса:
     поле видит только своё тело, а переменные общие (владелец, 2026-09-19). */
  const proc = { ...proc0, outerVars };
  const [text, setText] = useState(value);
  const [focus, setFocus] = useState(false);
  /* Правка — только по двойному нажатию на текст (владелец, 2026-09-18);
     одинарное нажатие в любом другом месте выключает её. До этого поле
     только для чтения: без клавиатуры, подсказок и меню. */
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);
  editingRef.current = editing;
  const lastTap = useRef(0);
  /* Плавающее меню живёт, пока его не закрыли крестиком или не начали
     правку (владелец, 2026-09-18): нажатие вне меню делает его
     полупрозрачным (неактивным), нажатие на нём — снова активным. */
  const [menuActive, setMenuActive] = useState(true);
  /* В правке меню остаётся, но неактивно; прокрутка страницы тоже гасит
     его (владелец, 2026-09-18). */
  useEffect(() => { if (editing) setMenuActive(false); }, [editing]);
  useEffect(() => {
    const dim = () => setMenuActive(false);
    window.addEventListener("scroll", dim, { passive: true });
    return () => window.removeEventListener("scroll", dim);
  }, []);
  const [pick, setPick] = useState(null);   // подсказка у курсора + at
  const [cursor, setCursor] = useState(0);
  const [caretRow, setCaretRow] = useState(-1);
  const inp = useRef(null);
  const back = useRef(null);
  /* Возврат фокуса и курсора после подстановки не должен уносить страницу
     (владелец, 2026-09-18: «при нажатии на оператор ИЛИ страница
     проскроллилась в начало»). На телефоне focus/setSelectionRange у
     textarea прокручивают страницу к полю, и preventScroll помогает не
     везде: держим положение сами — до и сразу после правки. */
  const keepScroll = (fn, ms = [60, 150, 300]) => {
    const x = window.scrollX || 0;
    const y = window.scrollY || 0;
    /* Возвращаем только заметный прыжок (> 24 px): мелкий сдвиг от того,
       что текст под полем подрос, — не беда, а борьба с ним дёргала бы
       страницу под рукой. Следим треть секунды: на телефоне прокрутка к
       полю случается и через кадр после возврата фокуса. */
    const undo = () => {
      const dx = Math.abs((window.scrollX || 0) - x);
      const dy = Math.abs((window.scrollY || 0) - y);
      try { if (dx > 24 || dy > 24) window.scrollTo(x, y); } catch { /* jsdom и старые движки — не беда */ }
    };
    fn();
    undo();
    requestAnimationFrame(undo);
    ms.forEach((t) => setTimeout(undo, t));
  };
  /* Прокрутка поля (владелец, 2026-09-18): пока поле в фокусе, его высота
     ограничена и включается собственная прокрутка; подложка и меню
     участника сдвигаются вместе с текстом. */
  const [scrollTop, setScrollTop] = useState(0);
  const paint = paintOf(text, model, proc);
  const field = { ...S.inp, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12,
    lineHeight: LINE_H, boxSizing: "border-box" };
  useEffect(() => { if (!focus) setText(value); }, [value, focus]);

  const items = pick ? suggest(pick, model, proc) : [];
  /* Отступы по смыслу: выравниваем текст и ведём курсор за его строкой
     (владелец, 2026-09-18). */
  const reflow = (next, caret) => {
    const out = indentText(next);
    if (out === next) return { text: next, caret };
    const rowsA = next.split("\n");
    const rowsB = out.split("\n");
    const row = next.slice(0, caret).split("\n").length - 1;
    const startA = rowsA.slice(0, row).reduce((n, l) => n + l.length + 1, 0);
    const startB = rowsB.slice(0, row).reduce((n, l) => n + l.length + 1, 0);
    const leadA = (rowsA[row] || "").length - (rowsA[row] || "").replace(/^[ \t]+/, "").length;
    const leadB = (rowsB[row] || "").length - (rowsB[row] || "").replace(/^[ \t]+/, "").length;
    const col = Math.max(leadA, caret - startA);
    return { text: out, caret: Math.min(out.length, startB + leadB + (col - leadA)) };
  };
  const place = (v, at) => {
    const h = hintAt(v, at, model);
    setPick({ ...h, at });
    setCursor(0);
    setCaretRow(v.slice(0, at).split("\n").length - 1);
    setMenuActive(!editingRef.current);
  };
  /* Подмена текста поля — сразу в узле, вместе с курсором и прокруткой
     (владелец, 2026-09-20: «меня кидает по странице то вверх, то вниз,
     когда я удаляю какую-то строку или добавляю её»). Прежде новый текст
     ставил React при перерисовке: браузер при замене значения уводит курсор
     в конец, прокручивает поле к нему, а на телефоне за курсором едет и
     страница; курсор возвращался на место следующим тиком — уже после
     прыжка. Теперь значение, курсор и прокрутка поля ставятся одним махом
     внутри события, React находит в узле то же значение и не трогает его. */
  const putText = (next, caret) => {
    const el = inp.current;
    if (el && el.value !== next) {
      const top = el.scrollTop;
      el.value = next;
      el.setSelectionRange(caret, caret);
      el.scrollTop = top;
    } else if (el) el.setSelectionRange(caret, caret);
    setText(next);
    place(next, caret);
  };
  const apply = (raw, rawCaret) => {
    const { text: next, caret } = reflow(raw, rawCaret);
    keepScroll(() => {
      /* Подстановка из подсказки: фокус мог уйти на неё — вернуть без
         прокрутки, и уже потом ставить текст с курсором. */
      if (document.activeElement !== inp.current) inp.current?.focus({ preventScroll: true });
      putText(next, caret);
    });
  };
  const onChange = (e) => {
    const v = e.target.value;
    const at = e.target.selectionStart ?? v.length;
    /* Имя новой сущности начинается с большой буквы (владелец, 2026-09-18):
       поднимаем только что введённый первый символ значения строки. */
    const big = capFirstTyped(text, v, at);
    if (big) { putText(big, at); return; }
    /* Отступы — сразу при наборе: и после перевода строки, и как только в
       новой строке появился первый символ (владелец, 2026-09-18). */
    const { text: next, caret } = reflow(v, at);
    if (next !== v) { putText(next, caret); return; }
    setText(v); place(v, at);
  };
  /* Строка, по которой нажали. Курсор за пальцем браузер двигает не
     всегда (владелец, 2026-09-20: «не отреагировало на нажатие… и
     отреагировало только на длительное нажатие»): при коротком нажатии он
     остаётся там, где был, и меню открывалось для чужой строки. Поэтому
     строку берём по координате нажатия, а столбец — у курсора, когда тот
     и правда на этой строке. */
  const rowAt = (clientY) => {
    const el = inp.current;
    if (!el || clientY == null) return -1;
    const r = el.getBoundingClientRect();
    const px = LINE_H * 12;
    const y = clientY - r.top - 7 + (el.scrollTop || 0);
    if (y < 0) return -1;
    const rows = text.split("\n").length;
    return Math.min(rows - 1, Math.floor(y / px));
  };
  const startOf = (row) => text.split("\n").slice(0, row).reduce((n, l) => n + l.length + 1, 0);
  const onMove = (e) => {
    const at = e.target.selectionStart ?? text.length;
    const want = e.type === "click" ? rowAt(e.clientY) : -1;
    if (want >= 0 && want !== text.slice(0, at).split("\n").length - 1) {
      const idx = startOf(want);
      inp.current?.setSelectionRange(idx, idx);
      place(text, idx);
      return;
    }
    place(text, at);
  };
  const startEdit = () => {
    const el = inp.current;
    if (!el || editing) return;
    const keep = keepScroll;
    /* readOnly снимается на узле сразу: iOS решает, открывать ли
       клавиатуру, в момент focus(), а он должен случиться внутри жеста. */
    keep(() => {
      el.readOnly = false;
      el.focus({ preventScroll: true });
      setEditing(true); setFocus(true);
      place(text, el.selectionStart ?? text.length);
    });
  };
  /* Правку заканчивает только нажатие вне поля (onBlur). */
  /* Подстановка: пункт несёт `suffix` (что после), `insert` (вставить у
     курсора, не заменяя набранное), `text` (что вставить вместо имени),
     `trimBefore` (убрать пробелы перед), `caretBack` (курсор внутрь). */
  const choose = (it, pk = pick) => {
    if (!pk || it.info) return;
    const suffix = it.suffix ?? ", ";
    const from = it.insert ? pk.at : pk.start;
    const head = it.trimBefore ? text.slice(0, from).replace(/[ \t]+$/, "") : text.slice(0, from);
    const put = it.text ?? it.name;
    const next = `${head}${put}${suffix}${text.slice(pk.at)}`;
    apply(next, head.length + put.length + suffix.length - (it.caretBack || 0));
  };
  const onKey = (e) => {
    /* В просмотре подсказки не участвуют: набранная клавиша включает
       правку и попадает в поле как обычно (владелец, 2026-09-18: «после
       закрепления переменной Enter не переводит строку» — вместо переноса
       Enter подставлял скрытую подсказку в readOnly-поле). */
    if (!editing) {
      const puts = e.key === "Enter" || e.key === "Backspace" || e.key === "Delete"
        || (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey);
      if (!puts) return;
      const el = inp.current;
      if (el) { el.readOnly = false; setEditing(true); setFocus(true); }
      return;   // событие не перехватываем — браузер сам вставит
    }
    const list = pick ? items.filter((i) => !i.info) : [];
    if (e.key === "Enter" && !e.shiftKey) {
      /* Enter подставляет начатое имя; иначе — обычный перенос строки, и
         на новой строке подсказка предлагает метку следующей сущности
         (владелец, 2026-09-18: «должна просто переводиться строка»).
         Правка при этом не кончается — только нажатием вне поля. */
      if (pick && pick.kind !== "qty" && pick.kind !== "name" && pick.query && list[cursor]
        && !list[cursor].insert && list[cursor].name.toLowerCase().startsWith(pick.query.toLowerCase())) {
        e.preventDefault(); choose(list[cursor]);
      }
      return;
    }
    if (!pick) return;
    if (e.key === "Escape") { setPick(null); return; }
    if (!items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => (c + 1) % list.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => (c - 1 + list.length) % list.length); }
    else if (e.key === "Tab") { e.preventDefault(); if (list[cursor]) choose(list[cursor]); }
  };
  /* Меню у выделенной должности (владелец, 2026-09-18): строка «Кто:», где
     стоит курсор. Столбиком: три роли с названиями, «Зафиксировать
     сотрудника» (рука — переменная из двух слов) и «Выбрать сотрудника»
     (автоматически / зафиксированные переменные / сотрудники должности).
     Каждое нажатие правит текст — единственный источник. */
  const rowLine = caretRow >= 0 ? text.split("\n")[caretRow] || "" : "";
  /* Меню сущностей — в просмотре (одинарное нажатие ставит курсор); в правке их нет, есть подсказки. */
  const rowKind = labelOf(rowLine)?.kind || "";
  /* Меню ЗАДАЧИ (владелец, 2026-09-18): курсор на «Задача:» или на строке
     её сроков. Значения живут в тексте — «Срок:», «Попытка:»,
     «Одновременно:» — и потому переживают пересборку функций. */
  const taskRow = (() => {
    if (caretRow < 0) return -1;
    if (rowKind === "task") return caretRow;
    if (!["dur", "every", "par"].includes(rowKind)) return -1;
    const rows = text.split("\n");
    for (let i = caretRow - 1; i >= 0; i -= 1) {
      const k = labelOf(rows[i])?.kind;
      if (k === "task") return i;
      if (!["dur", "every", "par"].includes(k)) return -1;
    }
    return -1;
  })();
  /* Меню ФУНКЦИИ (владелец, 2026-09-19): курсор на «Функция:» или на её
     шапке — строках «Критерий:»/«Результат:» до первой задачи. */
  const funcRow = (() => {
    if (caretRow < 0) return -1;
    if (rowKind === "func") return caretRow;
    if (rowKind !== "result") return -1;
    const rows = text.split("\n");
    for (let i = caretRow - 1; i >= 0; i -= 1) {
      const k = labelOf(rows[i])?.kind;
      if (k === "func") return i;
      if (k !== "result") return -1;
    }
    return -1;
  })();
  const funcName = funcRow >= 0 ? (labelOf(text.split("\n")[funcRow])?.rest.text || "").trim() : "";
  const funcHead = (() => {
    if (funcRow < 0) return { result: "" };
    const lab = labelOf(text.split("\n")[funcRow + 1] || "");
    return { result: lab?.kind === "result" ? lab.rest.text.trim() : "" };
  })();
  const setFuncResult = (v) => rewrite(setFuncHead(text, funcRow, { result: v }));
  const taskLine = taskRow >= 0 ? (text.split("\n")[taskRow] || "") : "";
  const taskName = taskRow >= 0 ? (labelOf(taskLine)?.rest.text || "").trim() : "";
  const taskTime = (() => {
    if (taskRow < 0) return null;
    const rows = text.split("\n");
    const out = { dur: 1, durHi: 1, durUnit: "дн", every: 0, everyHi: 0, everyUnit: "дн", par: 1, parAll: 0 };
    for (let i = taskRow + 1; i < rows.length; i += 1) {
      const lab = labelOf(rows[i]);
      if (!lab || !["dur", "every", "par"].includes(lab.kind)) break;
      const v = lab.kind === "dur" ? parseDur(lab.rest.text) : lab.kind === "every" ? parseEvery(lab.rest.text) : parsePar(lab.rest.text);
      if (v) Object.assign(out, v);
    }
    return out;
  })();
  const setTime = (kind, next) => rewrite(setTaskTime(text, taskRow, kind, next));
  /* Описание и критерии задачи — в МЕНЮ, а не в поле (владелец,
     2026-09-20). В тексте процесса они по-прежнему строками «Описание:» и
     «Критерий:», но поле их не показывает: `splitProc` поднимает их в
     `meta` по порядку задач, `joinProc` ставит обратно. Номер задачи
     считается по тому же телу, что показано, — поэтому он и совпадает. */
  const taskIndex = taskRow < 0 ? -1
    : text.split("\n").slice(0, taskRow + 1).filter((l) => labelOf(l)?.kind === "task").length - 1;
  const taskMeta = (taskIndex >= 0 && meta[taskIndex]) || { about: "", checks: [] };
  const taskChecks = taskMeta.checks || [];
  const taskAbout = taskMeta.about || "";
  /* Наружу уходит и нынешнее тело: в нём могли остаться несохранённые
     правки, и брать текст из записи значило бы их потерять. */
  const setMeta = (patch) => onMeta?.(text, taskIndex, patch);
  const setChecks = (list) => setMeta({ checks: list });
  const setAbout = (v) => setMeta({ about: v });
  /* «Кому:»/«От кого:» — то же меню, что у «Кто:», без ролей (владелец, 2026-09-18). */
  const whoRow = caretRow >= 0 && ["who", "to", "from"].includes(rowKind) ? caretRow : -1;
  const isWho = whoRow >= 0 && rowKind === "who";
  const whoSpan = whoRow >= 0 ? paint.find((r) => r.row === whoRow)?.spans : null;
  const whoName = whoSpan?.find((k) => k.kind === "role" || k.kind === "asset")?.name || "";
  const whoHand = whoSpan?.find((k) => k.kind === "hand")?.hand || null;
  const whoPerson = whoSpan?.find((k) => k.kind === "person")?.person || null;
  const [pickPerson, setPickPerson] = useState(false);
  const [renamingHand, setRenamingHand] = useState(false);
  /* Пока правят имя переменной, фокус уходит из поля в строку ввода — меню
     при этом не закрывается (`hold`), а после правки фокус возвращается. */
  const hold = useRef(false);
  /* Касания (владелец, 2026-09-18: «на телефоне нет Tab — выбор по нажатию
     на объект»): пока палец на окне подсказок или меню, потеря фокуса поля
     не считается (`hold`), а короткое касание пункта подсказки выбирает
     его само, без синтетического click, который на телефоне приходит уже
     после закрытия клавиатуры. */
  const touch = useRef(null);
  const touchStart = (e) => { hold.current = true; const t = e.touches[0]; touch.current = t ? { x: t.clientX, y: t.clientY } : null; };
  const touchEnd = (e, act) => {
    const t = e.changedTouches[0];
    const moved = touch.current && t && (Math.abs(t.clientX - touch.current.x) > 8 || Math.abs(t.clientY - touch.current.y) > 8);
    touch.current = null;
    if (act && !moved) { e.preventDefault(); act(); }
    setTimeout(() => { hold.current = false; }, 400);
  };
  const roleOn = (role) => rowLine.includes(ICON[role]);
  /* `at` — куда поставить курсор после правки; без него он остаётся на
     месте. После правок из меню ставим в конец изменённой строки, чтобы
     дальше сразу набирать или переводить строку (владелец, 2026-09-18). */
  const rowEnd = (t, row) => {
    const rows = String(t).split("\n");
    if (row < 0 || row >= rows.length) return null;
    return rows.slice(0, row).reduce((n, l) => n + l.length + 1, 0) + rows[row].length;
  };
  const rewrite = (raw, at = null) => {
    const want = at != null ? Math.min(at, raw.length) : Math.min(inp.current?.selectionStart ?? raw.length, raw.length);
    const { text: next, caret } = reflow(raw, want);
    setText(next); onCommit(next);
    /* Правка из меню уезжает в модель: функции пересобираются, схема
       перерисовывается — прыжок случается и через полсекунды (владелец,
       2026-09-18: «кидает на схеме в самый низ при выборе сотрудника»). */
    setTimeout(() => keepScroll(() => { inp.current?.focus({ preventScroll: true }); inp.current?.setSelectionRange(caret, caret); place(next, caret); },
      [60, 150, 300, 500, 800]), 0);
  };
  const toggle = (role) => rewrite(toggleRole(text, whoRow, role));
  const fixHand = () => rewrite(setHand(text, whoRow, newHandName(usedHands())));
  const renameHand = (name) => {
    const n = String(name || "").trim().toLowerCase();
    hold.current = false;
    setRenamingHand(false);
    if (!n || n === whoHand) { setTimeout(() => inp.current?.focus({ preventScroll: true }), 0); return; }
    if ([...usedHands()].some((h) => h === n) && n !== whoHand) { setTimeout(() => inp.current?.focus({ preventScroll: true }), 0); return; }
    // Переименовать — во всех строках этого процесса, где стоит эта рука.
    const re = new RegExp(`\\{\\s*${whoHand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}`, "gi");
    rewrite(text.replace(re, `{${n}}`));
  };
  const procHands = [...new Set(paint.flatMap((r) => r.spans.filter((k) => k.kind === "hand" && k.hand).map((k) => k.hand)))];
  /* Меню ресурса (владелец, 2026-09-18): курсор на ресурсе в строке
     «Берёт:/Отдаёт:/Или:» — справа окно как у участника: поле операции,
     под ним список (буквы, знаки с «=», ресурсы схемы, «дальше»). После
     знака — явная просьба ввести число или выбрать из списка. Текст —
     единственный источник: поле и список правят хвост после имени. */
  const rowStartOf = (row) => text.split("\n").slice(0, row).reduce((n, l) => n + l.length + 1, 0);
  const resRow = caretRow >= 0 && ["take", "give", "or"].includes(labelOf(rowLine)?.kind) ? caretRow : -1;
  const resStart = resRow >= 0 ? rowStartOf(resRow) : 0;
  const caretIn = pick ? pick.at - resStart : -1;
  const resSpans = resRow >= 0 ? (paint.find((r) => r.row === resRow)?.spans || []) : [];
  const inItem = (k) => k.itemSpan && k.itemSpan.start <= caretIn && (caretIn <= k.itemSpan.end || /^\s*$/.test(rowLine.slice(k.itemSpan.end, caretIn)));
  const res = resSpans.find((k) => ((k.kind === "trait" && k.name) || (k.kind === "var" && k.ref)) && inItem(k)) || null;
  /* Переменная этого ресурса (закреплён) или сама ссылка «(X)». */
  const resVar = res ? (res.kind === "var" ? res : resSpans.find((k) => k.kind === "var" && !k.ref && k.itemSpan.start === res.itemSpan.start) || null) : null;
  const resRef = !!res && res.kind === "var";
  const resName = res ? (resRef ? `(${res.varName})` : res.name) : "";
  const resKey = res ? `${resRow}:${res.itemSpan.start}` : "";
  const resTrait = res && !resRef && res.traitId ? (model.traits || []).find((t) => t.id === res.traitId) || null : null;
  /* Закрепить ресурс — переменная из одного слова; выбрать — ссылка на
     закреплённый ресурс этого процесса (владелец, 2026-09-18). */
  /* Закреплённые ресурсы — свои и соседних функций процесса: поле у каждой
     функции своё, а переменные общие (владелец, 2026-09-19). */
  const procVars = [...new Set([
    ...paint.flatMap((r) => r.spans.filter((k) => k.kind === "var" && !k.ref && k.varName).map((k) => k.varName)),
    ...outerVars,
  ])];
  const [pickVar, setPickVar] = useState(false);
  const [renamingVar, setRenamingVar] = useState(false);
  const [fold, setFold] = useState("");   // какой раздел меню раскрыт
  const [newCheck, setNewCheck] = useState(null);   // пустое поле нового критерия
  const pinRes = () => {
    const at = resStart + (res.tail ? res.tailSpan.end : res.nameSpan.end);
    const next = `${text.slice(0, at)} (${newVarName(new Set([...procVars, ...usedHands()]))})${text.slice(at)}`;
    rewrite(next, rowEnd(next, resRow));
  };
  const unpinRes = () => {
    let a = resStart + resVar.start; const b = resStart + resVar.end;
    while (a > resStart && text[a - 1] === " ") a -= 1;
    rewrite(text.slice(0, a) + text.slice(b));
  };
  const useVar = (v) => {
    const a = resStart + res.itemSpan.start, b = resStart + res.itemSpan.end;
    setPickVar(false);
    const next = `${text.slice(0, a)}(${v})${text.slice(b)}`;
    rewrite(next, rowEnd(next, resRow));
  };
  const dropRef = () => {
    let a = resStart + res.itemSpan.start; let b = resStart + res.itemSpan.end;
    while (a > resStart && text[a - 1] === " ") a -= 1;
    if (text.slice(b).match(/^,\s*/)) b += text.slice(b).match(/^,\s*/)[0].length;
    rewrite(text.slice(0, a) + text.slice(b));
  };
  const renameVarTo = (name) => {
    const n = String(name || "").trim();
    hold.current = false; setRenamingVar(false);
    if (!n || n === resVar.varName || procVars.some((v) => v.toLowerCase() === n.toLowerCase())) { setTimeout(() => inp.current?.focus({ preventScroll: true }), 0); return; }
    rewrite(renameVar(text, resVar.varName, n));
  };
  const [opDraft, setOpDraft] = useState("");
  const opFocus = useRef(false);
  const opRef = useRef(null);
  useEffect(() => { if (!opFocus.current) setOpDraft(res?.tail || ""); opRef.current = null; }, [resKey, res?.tail]);   // eslint-disable-line react-hooks/exhaustive-deps
  const opAnchor = () => {
    if (opRef.current) return opRef.current;
    if (resRef) { opRef.current = { a: resStart + res.itemSpan.start, b: resStart + res.itemSpan.end }; return opRef.current; }
    const has = !!res.tail;
    const a = resStart + (has ? res.tailSpan.start : res.nameSpan.end);
    let b = resStart + (has ? res.tailSpan.end : res.nameSpan.end);
    if (!has) while (text[b] === " ") b += 1;
    opRef.current = { a, b };
    return opRef.current;
  };
  const putOp = (v) => {
    const r = opAnchor();
    const val = String(v || "").trim();
    const head = text.slice(0, r.a).replace(/ +$/, "");
    const rest = text.slice(r.b);
    opRef.current = { a: head.length + (val ? 1 : 0), b: head.length + (val ? 1 + val.length : 0) };
    return val ? `${head} ${val}${rest}` : `${head}${rest}`;
  };
  const opEdit = (v) => { setOpDraft(v); setText(putOp(v)); };
  const opDone = (v) => { opFocus.current = false; hold.current = false; rewrite(putOp(v)); };
  const dangling = /[=+\-*/%(@]\s*$/.test(opDraft);
  const tailAt = res && !resRef ? resStart + (res.tail ? res.tailSpan.end : res.nameSpan.end) : 0;
  const tailHint = res && !resRef ? (res.tail ? hintAt(text, tailAt, model) : hintAt(`${text.slice(0, tailAt)} ${text.slice(tailAt)}`, tailAt + 1, model)) : null;
  /* Список меню — тот же `suggest` для «сколько», по черновику операции;
     закреплённые ресурсы — всего процесса. */
  const opAll = tailHint && tailHint.kind === "qty"
    ? suggest({ ...tailHint, tailText: opDraft, query: /@[^\s]*$/.test(opDraft) ? opDraft.match(/@[^\s]*$/)[0] : "",
      ctx: { ...(tailHint.ctx || {}), vars: [...new Set([...(tailHint.ctx?.vars || []), ...procVars])] } }, model, proc) : [];
  const opItems = opAll.filter((it) => !it.info);
  const opInfo = opAll.find((it) => it.info)?.note || "можно продолжить: знак или «дальше»";
  /* Плавающее меню (владелец, 2026-09-18): не привязано к полю, перетаскивается
     за шапку; появляется и исчезает вместе с курсором на сущности. Положение
     после перетаскивания помнится, пока открыт процесс. */
  const wrap = useRef(null);
  const [menuPos, setMenuPos] = useState(null);
  const drag = useRef(null);
  /* Тащили ли меню рукой: только тогда его место своё. Иначе оно встаёт у
     той строки, на которую нажали (владелец, 2026-09-20: «контекстное меню
     появляется в самом верху, а не там, где я нажал») — прежде место
     считалось один раз, при первом появлении, и дальше не менялось. */
  const dragged = useRef(false);
  const menuKey = funcRow >= 0 ? `func:${funcRow}` : taskRow >= 0 ? `task:${taskRow}` : whoRow >= 0 ? `who:${whoRow}` : res ? `res:${resKey}` : "";
  useEffect(() => {
    if (!menuKey || (menuPos && dragged.current)) return;
    /* Всплывает рядом со строкой, но всегда в видимой части экрана: если
       снизу не помещается — поднимается выше (владелец, 2026-09-18). */
    const r = wrap.current?.getBoundingClientRect?.() || { right: 0, top: 0, bottom: 0 };
    const row = funcRow >= 0 ? funcRow : taskRow >= 0 ? taskRow : whoRow >= 0 ? whoRow : resRow;
    const W = 210;
    const H = taskRow >= 0 || funcRow >= 0 ? 230 : 300;
    const vh = window.innerHeight || 800;
    const x = Math.max(8, Math.min((window.innerWidth || 400) - W - 8, r.right - W - 6));
    const want = r.top + 7 + Math.max(0, row) * LINE_H * 12 - scrollTop;
    const y = Math.max(8, Math.min(vh - H - 8, want));
    setMenuPos({ x, y });
  }, [menuKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  /* Одно касание: меню сразу активно и едет за пальцем — без первого
     «просто нажать» (владелец, 2026-09-18). Тянем и мышью (pointer), и
     пальцем (touch): на части устройств pointermove после preventDefault
     не приходит. */
  const dragFrom = (x, y) => {
    setMenuActive(true);
    dragged.current = true;
    const cur = menuPos || (() => { const r = document.querySelector("[data-proc-menu]")?.getBoundingClientRect(); return r ? { x: r.left, y: r.top } : { x: 8, y: 8 }; })();
    if (!menuPos) setMenuPos(cur);
    drag.current = { dx: x - cur.x, dy: y - cur.y };
  };
  const dragTo = (x, y) => { if (drag.current) setMenuPos({ x: Math.max(0, x - drag.current.dx), y: Math.max(0, y - drag.current.dy) }); };
  const onDragStart = (e) => { e.preventDefault(); dragFrom(e.clientX, e.clientY); e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onDragMove = (e) => dragTo(e.clientX, e.clientY);
  const onDragEnd = () => { drag.current = null; };
  const onDragTouch = (e) => { const t = e.touches[0]; if (!t) return; hold.current = true; e.preventDefault(); dragFrom(t.clientX, t.clientY); };
  const onDragTouchMove = (e) => { const t = e.touches[0]; if (!t || !drag.current) return; e.preventDefault(); dragTo(t.clientX, t.clientY); };
  const onDragTouchEnd = () => { drag.current = null; setTimeout(() => { hold.current = false; }, 400); };
  const opPick = (it) => {
    if (it.kind === "дальше" || it.kind === "переменная" || it.kind === "закрепить") { choose(it, { ...tailHint, at: tailAt, start: tailAt }); return; }
    let next;
    const sp = opDraft && !/\s$/.test(opDraft) ? " " : "";
    if (it.name === "=") next = opDraft.startsWith("=") ? opDraft : `=${opDraft}`;
    else if (it.kind === "ресурс") next = /@[^\s]*$/.test(opDraft) ? opDraft.replace(/@[^\s]*$/, it.name) : `${opDraft}${sp}${it.name}`;
    else if (it.kind === "буква" || it.kind === "закреплённый") next = `${opDraft}${sp}${it.name}`;
    else next = `${opDraft}${it.name}`;
    setOpDraft(next); rewrite(putOp(next));
  };
  const persons = whoRow >= 0 ? peopleOfPosition(whoName, model) : [];
  const header = pick ? `${HINT[pick.kind] || ""}${pick.kind === "trait" && pick.asset ? ` — ресурсы «${pick.asset.name}»` : ""}${pick.kind === "qty" && pick.traitName ? ` — для «${pick.traitName}»` : ""}` : "";
  const pinBtn = (label, icon, onClick, style = {}) => (
    <button type="button" aria-label={label} onClick={onClick} className="flex items-center gap-2"
      style={{ borderRadius: 5, fontSize: 11.5, padding: "3px 6px", cursor: "pointer", textAlign: "left", background: "transparent",
        color: C.text, border: `1px solid ${C.line}`, ...style }}>
      <span style={{ width: 16, textAlign: "center" }}>{icon}</span>{label.split(":")[0].replace(/^./, (c) => c.toUpperCase())}</button>);
  const menuTitle = funcRow >= 0 ? `функция «${funcName || "без названия"}»`
    : taskRow >= 0 ? `задача «${taskName || "без названия"}»` : whoRow >= 0 ? `${rowKind === "to" ? "кому" : rowKind === "from" ? "от кого" : "участник"} «${whoName}»` : res ? (resRef ? `закреплённый ресурс «${res.varName}»` : `ресурс «${res.name}»`) : "";
  return (
    /* overflow-anchor: none (владелец, 2026-09-20: «кидает по странице то
       вверх, то вниз, когда удаляю или добавляю строку»). Когда поле видно
       не целиком — на телефоне за клавиатурой, — якорь прокрутки браузера
       цепляется за строку подложки внутри поля: строка выше якоря
       добавилась — страница едет вниз, удалилась — вверх. Поле с
       подсказками якорем не служит. */
    <div style={{ position: "relative", overflowAnchor: "none" }}>
      <div ref={wrap} style={{ position: "relative", background: C.ink, borderRadius: field.borderRadius }}>
        <Backdrop text={text} paint={paint} style={field} activeRow={whoRow} caretRow={focus ? caretRow : -1} noteGap={0} backRef={back} />
        <style>{`textarea[data-proc-text]::placeholder{color:${NEU};opacity:1}
[data-proc-backdrop] [data-op]::before{content:"ƒ";position:absolute;left:0;top:0;font-style:italic;font-weight:700}`}</style>
        {/* Поле фиксированной высоты (владелец, 2026-09-18) — длинный текст
            листается внутри; подложка повторяет прокрутку. */}
        <textarea ref={inp} value={text} aria-label={label} data-proc-text="" rows={12}
          placeholder={`Задача: название\nКто: Должность ✎ ⚙\nБерёт: ресурс 2\nОтдаёт: ресурс 50% A\nКому: Должность`}
          style={{ ...field, resize: "vertical", position: "relative", zIndex: 1, overflowY: "auto",
            background: "transparent", color: "transparent", caretColor: C.text, display: "block" }}
          onScroll={(e) => { const t = e.target.scrollTop; if (back.current) back.current.scrollTop = t; setScrollTop(t); }}
          onFocus={(e) => { setFocus(true); place(text, e.target.selectionStart ?? text.length); }}
          onBlur={(e) => {
            /* Фокус ушёл в поле меню (операция, имя) — меню не закрывать. */
            if (e.relatedTarget?.closest?.("[data-proc-menu]")) hold.current = true;
            if (hold.current) return;
            // Меню не закрывается — становится неактивным; закрывает крестик или начало правки.
            setEditing(false); setFocus(false); setScrollTop(0); setMenuActive(false); if (text !== value) onCommit(text); }}
          readOnly={!editing}
          /* В правке одинарное нажатие и прокрутка внутри поля правку не
             прерывают (владелец, 2026-09-18) — только нажатие вне поля
             (потеря фокуса) или Enter, когда нечего подставить. */
          onMouseDown={(e) => { if (!editing && e.detail >= 2) { e.preventDefault(); startEdit(); } }}
          onDoubleClick={() => { if (!editing) startEdit(); }}
          onTouchEnd={(e) => {
            const now = Date.now();
            if (!editing && now - lastTap.current < 350) { e.preventDefault(); startEdit(); }
            lastTap.current = now;
          }}
          onChange={(e) => { opRef.current = null; onChange(e); }} onKeyUp={onMove} onClick={onMove} onKeyDown={onKey} />
        {!editing && text && (
          <div aria-hidden="true" style={{ position: "absolute", right: 8, top: 4, fontSize: 10, color: C.muted, pointerEvents: "none", zIndex: 2 }}>
            двойное нажатие — правка</div>)}
      </div>
      {/* Подсказки — под полем, в потоке: ничего не заслоняют (владелец, 2026-09-18).
          Место под них — постоянной высоты на всё время правки (владелец,
          2026-09-20): прежде блок рос и сжимался на каждой клавише
          (210 → 93 px за одно слово), документ под полем дышал, и у низа
          страницы прокрутку подрезало — страница дёргалась. */}
      {editing && (
        <div style={{ height: HINT_H, marginTop: 4 }}>
        {pick && (
        <div role="dialog" aria-label="подсказка процесса"
          onMouseDown={(e) => { if (e.target.tagName !== "INPUT") e.preventDefault(); }}
          onTouchStart={touchStart} onTouchEnd={(e) => touchEnd(e, null)} onTouchCancel={() => { touch.current = null; hold.current = false; }}
          style={{ height: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box",
            background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6 }}>
          <div style={{ padding: "5px 8px", fontSize: 10.5, color: C.muted, borderBottom: `1px solid ${C.line}`, flex: "none" }}>
            {header}<span style={{ opacity: 0.7 }}> · нажмите пункт · Enter — новая строка</span>
          </div>
          <div role="listbox" aria-label="подсказки процесса" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {items.filter((i) => !i.info).map((it, i) => (
              <div key={`${it.kind}:${it.name}:${it.note || ""}`} role="option" aria-selected={i === cursor}
                onClick={() => choose(it)}
                onTouchEnd={(e) => { e.stopPropagation(); touchEnd(e, () => choose(it)); }}
                style={{ padding: "7px 8px", fontSize: 12.5, cursor: "pointer", touchAction: "pan-y",
                  background: i === cursor ? `${C.line}88` : "transparent" }}>
                <span style={{ color: C.muted }}>{it.kind} </span>{it.name}
                {it.note && <span style={{ color: C.muted }}> — {it.note}</span>}
              </div>))}
            {items.filter((i) => i.info).map((it, i) => (
              <div key={`info${i}`} style={{ padding: "4px 8px", fontSize: 11, color: C.muted }}>{it.note}</div>))}
            {!items.length && (
              <div style={{ padding: "4px 8px", fontSize: 11, color: C.muted }}>
                {pick.query ? `«${pick.query}» — своё имя; дальше — Enter или пункт «↵»` : "введите своё"}
              </div>)}
          </div>
        </div>)}
        </div>)}
      {/* Плавающее меню сущности: участник или ресурс. */}
      {(whoRow >= 0 || res || taskRow >= 0 || funcRow >= 0) && (
        <div data-proc-menu="" data-active={menuActive ? "1" : "0"}
          /* pointerdown — раньше mousedown и не гасится preventDefault шапки при перетаскивании. */
          onPointerDown={() => setMenuActive(true)}
          onTouchStart={touchStart} onTouchEnd={(e) => touchEnd(e, null)} onTouchCancel={() => { touch.current = null; hold.current = false; }}
          onMouseDown={(e) => { setMenuActive(true); if (e.target.tagName === "INPUT") hold.current = true; else e.preventDefault(); }}
          style={{ position: "fixed", left: menuPos?.x ?? 8, top: menuPos?.y ?? 8, zIndex: 40, width: 210,
            /* Меньше прозрачности у спящего меню (владелец, 2026-09-19):
               сквозь него читался текст под ним, и меню терялось. */
            opacity: menuActive ? 1 : 0.85, transition: "opacity .15s",
            background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 5, boxShadow: "0 6px 20px rgba(0,0,0,.35)" }}>
          <div className="flex items-center gap-1" style={{ padding: "1px 2px 4px" }}>
            <div aria-label="перетащить меню" title="перетащить"
              onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
              onTouchStart={onDragTouch} onTouchMove={onDragTouchMove} onTouchEnd={onDragTouchEnd} onTouchCancel={onDragTouchEnd}
              className="flex items-center gap-2"
              style={{ flex: 1, minWidth: 0, cursor: "move", touchAction: "none", fontSize: 10.5, color: C.muted, userSelect: "none" }}>
              <span style={{ letterSpacing: -1 }}>⋮⋮</span>
              <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{menuTitle}</span>
            </div>
            <button type="button" aria-label="закрыть меню" title="закрыть"
              onClick={() => { setCaretRow(-1); setPickVar(false); setPickPerson(false); }}
              style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", padding: "0 3px", fontSize: 13, lineHeight: 1 }}>✕</button>
          </div>
          {funcRow >= 0 ? (
          <div data-func-menu="" aria-label={`меню функции ${funcName}`} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Fold title="ожидаемый результат" open={fold === "fresult"} onToggle={() => setFold(fold === "fresult" ? "" : "fresult")}
              value={funcHead.result ? "есть" : "—"}>
              <input defaultValue={funcHead.result} aria-label="ожидаемый результат функции"
                style={{ ...S.inp, width: "100%", fontSize: 11.5, padding: "2px 5px" }}
                onBlur={(e) => setFuncResult(e.target.value.trim())}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
            </Fold>
          </div>
          ) : taskRow >= 0 ? (
          <div data-task-menu="" aria-label={`меню задачи ${taskName}`} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {/* Описание — ПЕРВЫМ, до критериев (владелец, 2026-09-20):
                сперва что за работа, потом по чему её примут. Оно едет в
                каждую задачу этой функции и видно на форме постановки. */}
            <Fold title="описание" open={fold === "about"} onToggle={() => setFold(fold === "about" ? "" : "about")}
              value={taskAbout ? "есть" : "—"}>
              <textarea key={taskAbout} defaultValue={taskAbout} aria-label="описание задачи" rows={2}
                style={{ ...S.inp, width: "100%", fontSize: 11.5, padding: "3px 5px", resize: "vertical" }}
                onBlur={(e) => setAbout(e.target.value.trim())} />
            </Fold>
            <Fold title="критерии проверки" open={fold === "checks"} onToggle={() => setFold(fold === "checks" ? "" : "checks")}
              value={taskChecks.length ? String(taskChecks.length) : "—"}>
              {taskChecks.map((c, i) => (
                <div key={`${i}:${c}`} className="flex items-center gap-2" style={{ marginBottom: 3 }}>
                  <input defaultValue={c} aria-label={`критерий ${i + 1}`}
                    style={{ ...S.inp, flex: 1, fontSize: 11.5, padding: "2px 5px" }}
                    onBlur={(e) => { const v = e.target.value.trim(); setChecks(taskChecks.map((x, k) => (k === i ? v : x)).filter(Boolean)); }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
                  <button type="button" aria-label={`убрать критерий ${i + 1}`} title="убрать"
                    onClick={() => setChecks(taskChecks.filter((x, k) => k !== i))}
                    style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", padding: 0 }}>✕</button>
                </div>))}
              {/* Новый критерий — ПУСТОЕ поле: слова в нём пишет человек,
                  а не приложение (владелец, 2026-09-20). Пустое при уходе
                  из поля просто исчезает. */}
              {newCheck != null && (
                <div className="flex items-center gap-2" style={{ marginBottom: 3 }}>
                  <input autoFocus defaultValue="" aria-label={`критерий ${taskChecks.length + 1}`}
                    style={{ ...S.inp, flex: 1, fontSize: 11.5, padding: "2px 5px" }}
                    onBlur={(e) => { const v = e.target.value.trim(); setNewCheck(null); if (v) setChecks([...taskChecks, v]); }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
                </div>)}
              <button type="button" aria-label="добавить критерий" onClick={() => setNewCheck("")}
                style={{ ...btn(false), fontSize: 11, padding: "2px 8px" }}>+ критерий</button>
            </Fold>
            <Fold title="срок" open={fold === "dur"} onToggle={() => setFold(fold === "dur" ? "" : "dur")}
              value={durText(taskTime)}>
              <Range lo={taskTime.dur} hi={taskTime.durHi} unit={taskTime.durUnit} label="срок"
                onChange={(lo, hi, u) => setTime("dur", `${nm(lo)}${hi > lo ? `-${nm(hi)}` : ""} ${u}`)} />
            </Fold>
            <Fold title="следующая попытка" open={fold === "every"} onToggle={() => setFold(fold === "every" ? "" : "every")}
              value={everyText(taskTime)}>
              <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
                <select value={taskTime.every > 0 ? "every" : "flow"} aria-label="когда следующая попытка"
                  onChange={(e) => setTime("every", e.target.value === "every" ? `через 1 ${taskTime.everyUnit || "дн"}` : "сразу")}
                  style={{ ...S.inp, width: "auto", padding: "2px 4px", fontSize: 11.5 }}>
                  <option value="flow">сразу</option>
                  <option value="every">через…</option>
                </select>
              </div>
              {taskTime.every > 0 && (
                <Range lo={taskTime.every} hi={taskTime.everyHi} unit={taskTime.everyUnit} label="следующая попытка"
                  onChange={(lo, hi, u) => setTime("every", `через ${nm(lo)}${hi > lo ? `-${nm(hi)}` : ""} ${u}`)} />)}
            </Fold>
            <Fold title="одновременные выполнения" open={fold === "par"} onToggle={() => setFold(fold === "par" ? "" : "par")}
              value={parText(taskTime)}>
              <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                <span style={{ ...S.lbl, flex: "1 1 100%" }}>на воркера</span>
                <MiniNum value={taskTime.par} label="одновременных выполнений на воркера"
                  onCommit={(v) => setTime("par", `${Math.max(1, Math.round(v) || 1)}${taskTime.parAll > 0 ? `, на актив ${Math.round(taskTime.parAll)}` : ""}`)} />
                <span style={{ ...S.lbl, flex: "1 1 100%" }}>на актив (0 — без предела)</span>
                <MiniNum value={taskTime.parAll} label="одновременных выполнений на актив"
                  onCommit={(v) => setTime("par", `${Math.max(1, Math.round(taskTime.par) || 1)}${Math.round(v) > 0 ? `, на актив ${Math.round(v)}` : ""}`)} />
              </div>
            </Fold>
          </div>
          ) : whoRow >= 0 ? (
          <div data-role-buttons="" aria-label={`меню участника ${whoName}`}
            style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {isWho && ROLE_KINDS.map((role) => (
              <button key={role} type="button" aria-pressed={roleOn(role)} aria-label={`${ROLE_WORD[role]}: ${whoName}`}
                onClick={() => toggle(role)} className="flex items-center gap-2"
                style={{ borderRadius: 5, fontSize: 11.5, padding: "3px 6px", cursor: "pointer", textAlign: "left",
                  background: roleOn(role) ? ROLE_COLOR[role] : "transparent", color: roleOn(role) ? DARK : C.text,
                  border: `1px solid ${roleOn(role) ? ROLE_COLOR[role] : C.line}` }}>
                <span style={{ width: 16, textAlign: "center" }}>{ICON[role]}</span>{ROLE_WORD[role]}</button>))}
            {whoHand ? (
              <div style={{ border: `1px solid ${C.line}`, borderRadius: 5, padding: "3px 6px", fontSize: 11 }}>
                <div className="flex items-center gap-2">
                  <span style={{ width: 16, textAlign: "center" }}>🔒</span>
                  {renamingHand ? (
                    <input autoFocus defaultValue={whoHand} aria-label="имя закреплённого сотрудника"
                      style={{ ...S.inp, flex: 1, fontSize: 11, padding: "1px 4px" }}
                      onBlur={(e) => renameHand(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { hold.current = false; setRenamingHand(false); inp.current?.focus({ preventScroll: true }); } }} />
                  ) : (
                    <button type="button" aria-label={`переименовать закреплённого сотрудника ${whoHand}`} title="нажмите, чтобы переименовать"
                      onClick={() => { hold.current = true; setRenamingHand(true); }}
                      style={{ flex: 1, textAlign: "left", background: handColor(whoHand), color: DARK, border: "none", borderRadius: 4,
                        padding: "1px 6px", fontSize: 11, cursor: "text" }}>{whoHand}</button>)}
                  <button type="button" aria-label={`открепить сотрудника: ${whoName}`} title="открепить сотрудника" onClick={() => rewrite(setAuto(text, whoRow))}
                    style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", padding: 0 }}>✕</button>
                </div>
              </div>
            ) : pinBtn(`закрепить сотрудника: ${whoName}`, "🔒", fixHand)}
            <button type="button" aria-expanded={pickPerson} aria-label={`выбрать сотрудника: ${whoName}`}
              onClick={() => setPickPerson((v) => !v)} className="flex items-center gap-2"
              style={{ borderRadius: 5, fontSize: 11.5, padding: "3px 6px", cursor: "pointer", textAlign: "left",
                background: whoPerson ? "#FFD9A0" : "transparent", color: whoPerson ? DARK : C.text, border: `1px solid ${whoPerson ? "#FFD9A0" : C.line}` }}>
              <span style={{ width: 16, textAlign: "center" }}>👤</span>{whoPerson ? whoPerson : "Выбрать сотрудника"}</button>
            {pickPerson && (
              <div role="listbox" aria-label={`сотрудники: ${whoName}`} style={{ maxHeight: 150, overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 5 }}>
                <div role="option" aria-selected={!whoHand && !whoPerson} onClick={() => { rewrite(setAuto(text, whoRow)); setPickPerson(false); }}
                  style={{ padding: "3px 6px", fontSize: 11.5, cursor: "pointer", background: !whoHand && !whoPerson ? `${C.line}88` : "transparent" }}>автоматически</div>
                {procHands.map((h) => (
                  <div key={h} role="option" aria-selected={whoHand === h} onClick={() => { rewrite(setHand(text, whoRow, h)); setPickPerson(false); }}
                    style={{ padding: "3px 6px", fontSize: 11.5, cursor: "pointer", background: whoHand === h ? `${C.line}88` : "transparent" }}>
                    <span style={{ background: handColor(h), color: DARK, borderRadius: 4, padding: "0 5px" }}>{h}</span></div>))}
                {persons.map((pp) => (
                  <div key={pp.id} role="option" aria-selected={whoPerson === pp.name} onClick={() => { rewrite(setPerson(text, whoRow, pp.name)); setPickPerson(false); }}
                    style={{ padding: "3px 6px", fontSize: 11.5, cursor: "pointer", background: whoPerson === pp.name ? `${C.line}88` : "transparent" }}>{pp.name}</div>))}
                {!persons.length && <div style={{ padding: "3px 6px", fontSize: 11, color: C.muted }}>сотрудников с этой должностью нет</div>}
              </div>)}
          </div>
          ) : (
          <div data-res-menu="" aria-label={`меню ресурса ${resName}`} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {resVar ? (
              <div style={{ border: `1px solid ${C.line}`, borderRadius: 5, padding: "3px 6px", fontSize: 11 }}>
                <div className="flex items-center gap-2">
                  <span style={{ width: 16, textAlign: "center" }}>{resRef ? "🔗" : "📌"}</span>
                  {renamingVar && !resRef ? (
                    <input autoFocus defaultValue={resVar.varName} aria-label="имя закреплённого ресурса"
                      style={{ ...S.inp, flex: 1, fontSize: 11, padding: "1px 4px" }}
                      onBlur={(e) => renameVarTo(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { hold.current = false; setRenamingVar(false); inp.current?.focus({ preventScroll: true }); } }} />
                  ) : (
                    <button type="button" aria-label={resRef ? `закреплённый ресурс ${resVar.varName}` : `переименовать закреплённый ресурс ${resVar.varName}`}
                      title={resRef ? "ссылка на закреплённый ресурс" : "нажмите, чтобы переименовать"} disabled={resRef}
                      onClick={() => { if (resRef) return; hold.current = true; setRenamingVar(true); }}
                      style={{ flex: 1, textAlign: "left", background: handColor(resVar.varName), color: DARK, border: "none", borderRadius: 4,
                        padding: "1px 6px", fontSize: 11, cursor: resRef ? "default" : "text" }}>{resVar.varName}</button>)}
                  <button type="button" aria-label={resRef ? `снять выбор ресурса: ${resVar.varName}` : `открепить ресурс: ${res.name}`}
                    title={resRef ? "убрать ссылку" : "открепить ресурс"} onClick={resRef ? dropRef : unpinRes}
                    style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", padding: 0 }}>✕</button>
                </div>
              </div>
            ) : pinBtn(`закрепить ресурс: ${res.name}`, "📌", pinRes)}
            <button type="button" aria-expanded={pickVar} aria-label={`выбрать ресурс: ${resName}`}
              onClick={() => setPickVar((v) => !v)} className="flex items-center gap-2"
              style={{ borderRadius: 5, fontSize: 11.5, padding: "3px 6px", cursor: "pointer", textAlign: "left",
                background: resRef ? handColor(res.varName) : "transparent", color: resRef ? DARK : C.text, border: `1px solid ${resRef ? handColor(res.varName) : C.line}` }}>
              <span style={{ width: 16, textAlign: "center" }}>🔗</span>{resRef ? res.varName : "Выбрать ресурс"}</button>
            {pickVar && (
              <div role="listbox" aria-label={`закреплённые ресурсы: ${resName}`} style={{ maxHeight: 150, overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 5 }}>
                {procVars.filter((v) => !(resVar && !resRef && v === resVar.varName)).map((v) => (
                  <div key={v} role="option" aria-selected={resRef && res.varName === v} onClick={() => useVar(v)}
                    style={{ padding: "3px 6px", fontSize: 11.5, cursor: "pointer", background: resRef && res.varName === v ? `${C.line}88` : "transparent" }}>
                    <span style={{ background: handColor(v), color: DARK, borderRadius: 4, padding: "0 5px" }}>{v}</span></div>))}
                {!procVars.filter((v) => !(resVar && !resRef && v === resVar.varName)).length && (
                  <div style={{ padding: "3px 6px", fontSize: 11, color: C.muted }}>закреплённых ресурсов в этом процессе нет — «Закрепить ресурс» у нужного</div>)}
              </div>)}
            {/* Разделы ресурса — те же вопросы, что в карточке ресурса,
                под спойлерами (владелец, 2026-09-18). */}
            {!resRef && resTrait && onTrait && (<>
              <Fold title="единица" open={fold === "unit"} onToggle={() => setFold(fold === "unit" ? "" : "unit")}
                value={resTrait.unit || "—"}>
                <input defaultValue={resTrait.unit || ""} aria-label={`единица ресурса ${res.name}`} placeholder="штука, час, рубль"
                  style={{ ...S.inp, width: "100%", fontSize: 11.5, padding: "2px 5px" }}
                  onBlur={(e) => onTrait(resTrait.id, { unit: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
              </Fold>
              <Fold title="чем подтверждается" open={fold === "kind"} onToggle={() => setFold(fold === "kind" ? "" : "kind")}
                value={MATERIAL_KINDS.find((k) => k.id === traitKind(resTrait))?.name}>
                <div className="flex flex-wrap gap-2">
                  {MATERIAL_KINDS.map((k) => (
                    <button key={k.id} type="button" aria-pressed={traitKind(resTrait) === k.id}
                      aria-label={`${k.name}: ${res.name}`} onClick={() => onTrait(resTrait.id, { kind: k.id })}
                      style={{ ...btn(traitKind(resTrait) === k.id, traitKind(resTrait) === k.id ? ACC : null), fontSize: 11, padding: "2px 6px" }}>
                      {k.name}</button>))}
                </div>
              </Fold>
              <Fold title="чем считаем" open={fold === "ks"} onToggle={() => setFold(fold === "ks" ? "" : "ks")}
                value={kinds.filter((x) => hasKind(resTrait, x.id)).map((x) => x.sign).join(" ") || "—"}>
                <div className="flex flex-wrap gap-2">
                  {!kinds.length && <span style={{ fontSize: 10.5, color: C.muted }}>классификаций пока нет</span>}
                  {kinds.map((x) => (
                    <button key={x.id} type="button" aria-pressed={hasKind(resTrait, x.id)} aria-label={`${x.name}: ${res.name}`}
                      onClick={() => { const z = toggleKind(resTrait, x.id); onTrait(resTrait.id, { ks: z.ks, k: z.k }); }}
                      style={{ ...btn(hasKind(resTrait, x.id), x.color), fontSize: 11, padding: "2px 6px" }}>
                      {x.sign} {x.name}</button>))}
                </div>
              </Fold>
            </>)}
            {!resRef && (<>
            <input value={opDraft} aria-label={`операция: ${res.name}`} placeholder="сколько / операция"
              style={{ ...S.inp, fontSize: 12, padding: "3px 6px", fontFamily: "ui-monospace, Menlo, monospace" }}
              onFocus={() => { hold.current = true; opFocus.current = true; opAnchor(); }}
              onChange={(e) => opEdit(e.target.value)}
              onBlur={(e) => opDone(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }} />
            <div style={{ fontSize: 10.5, color: dangling || !opDraft.trim() ? WARN : C.muted, lineHeight: 1.35 }}>{opInfo}</div>
            <div role="listbox" aria-label={`операция: варианты`} style={{ maxHeight: 150, overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 5 }}>
              {opItems.map((it) => (
                <div key={`${it.kind}:${it.name}:${it.note || ""}`} role="option" aria-selected={false} onClick={() => opPick(it)}
                  style={{ padding: "3px 6px", fontSize: 11.5, cursor: "pointer" }}>
                  <span style={{ color: C.muted }}>{it.kind} </span>{it.name}{it.note && <span style={{ color: C.muted }}> — {it.note}</span>}</div>))}
              {!opItems.length && <div style={{ padding: "3px 6px", fontSize: 11, color: C.muted }}>введите число</div>}
              {/* Подписи по смыслу: «ресурс» — со схемы, «закреплённый» — из этого процесса, «буква» — ресурс задачи. */}
            </div>
            </>)}
          </div>)}
        </div>)}
    </div>);
}

/* ─────── чип имени под полем ─────── */
const WORD = { asset: "актив", trait: "ресурс", role: "должность" };
function Chip({ name, kind, state, tail = "", open, onOpen, onAccept, acceptWhy, onReject, onRestore, options = [], onReplace, onGo, hypo }) {
  const base = { display: "inline-block", borderRadius: 6, padding: "1px 7px", fontSize: 12, lineHeight: 1.6, verticalAlign: "middle" };
  if (state === "ok") {
    return (
      <button type="button" onClick={onGo} disabled={!onGo} aria-label={`${WORD[kind]} «${name}»: открыть`}
        style={{ ...base, border: `1px solid ${C.line}`, background: C.panel, color: C.text, cursor: onGo ? "pointer" : "default" }}>
        {name}{tail}{hypo && <span style={{ fontSize: 10, color: WARN }}> · гипотеза</span>}
      </button>);
  }
  if (state === "deleted") {
    return (
      <span style={{ ...base, border: `1px solid ${BAD}`, color: BAD }}>
        {name}{tail} — удалён — выберите замену
        <select aria-label={`замена для «${name}»`} value="" onChange={(e) => e.target.value && onReplace(e.target.value)}
          style={{ ...S.inp, width: "auto", display: "inline-block", marginLeft: 6, padding: "1px 4px", fontSize: 11 }}>
          <option value="">— замена —</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </span>);
  }
  if (state === "noasset") {
    return <span style={{ ...base, border: `1px dashed ${BAD}`, color: BAD }} title="чей это ресурс — назовите «Кто:» с должностью актива или «Кому:»/«От кого:»">{name}{tail} — чей?</span>;
  }
  const rejected = state === "rejected";
  return (
    <span style={{ display: "inline" }}>
      <button type="button" onClick={onOpen} aria-expanded={open}
        aria-label={`${rejected ? "отклонённый" : "неизвестный"} ${WORD[kind]} «${name}»`}
        style={{ ...base, cursor: "pointer", border: rejected ? `1px solid ${BAD}` : `1px dashed ${ACC}`,
          color: rejected ? BAD : ACC, background: "transparent" }}>
        {name}{tail}{rejected ? " — отклонено" : ""}</button>
      {open && (
        <span style={{ marginLeft: 4, whiteSpace: "nowrap" }}>
          {onAccept && (
            <button type="button" aria-label={`принять ${WORD[kind]} «${name}»`} disabled={!!acceptWhy} title={acceptWhy || ""}
              style={{ ...btn(true, OK), fontSize: 11, padding: "2px 7px", opacity: acceptWhy ? 0.5 : 1 }}
              onClick={onAccept}>Принять</button>)}
          {onAccept && " "}
          {rejected
            ? <button type="button" aria-label={`вернуть ${WORD[kind]} «${name}»`} style={{ ...btn(false), fontSize: 11, padding: "2px 7px" }} onClick={onRestore}>Вернуть</button>
            : <button type="button" aria-label={`отклонить ${WORD[kind]} «${name}»`} style={{ ...btn(true, BAD), fontSize: 11, padding: "2px 7px" }} onClick={onReject}>Отклонить</button>}
        </span>)}
    </span>);
}

/* ─────── окно выгрузки/загрузки ─────── */
function TextModal({ title, value, onChange, onClose, onLoad }) {
  const [msg, setMsg] = useState("");
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setMsg("скопировано"); } catch { setMsg("выделите текст и скопируйте"); }
  };
  const file = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => onChange(String(r.result || ""));
    r.readAsText(f);
  };
  return (
    <div role="dialog" aria-label={title} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...S.card, width: "min(640px, 100%)", maxHeight: "90vh", display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="flex items-center gap-2"><span style={S.lbl}>{title}</span><span style={{ flex: 1 }} />
          <button type="button" style={{ ...btn(false), fontSize: 11 }} onClick={onClose} aria-label="закрыть окно">✕</button></div>
        <textarea aria-label={`текст: ${title}`} value={value} readOnly={!onLoad} onChange={(e) => onChange?.(e.target.value)}
          style={{ ...S.inp, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, lineHeight: 1.5, minHeight: 260, resize: "vertical" }} />
        <div className="flex flex-wrap items-center gap-2">
          {onLoad ? (<>
            <input type="file" accept=".txt,text/plain" aria-label="файл техпроцесса" onChange={file} style={{ fontSize: 11 }} />
            <button type="button" style={btn(true)} onClick={onLoad}>Загрузить</button>
          </>) : (
            <button type="button" style={btn(true)} onClick={copy}>Скопировать</button>)}
          {msg && <span style={{ fontSize: 11, color: C.muted }}>{msg}</span>}
        </div>
      </div>
    </div>);
}

/* ─────── версии ─────── */
const when = (iso) => { try { return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
/* Задача, которую переписали, — в жёлтой плашке целиком: сперва каким был
   её текст, потом каким стал (владелец, 2026-09-20). */
const PRE = { margin: 0, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, whiteSpace: "pre-wrap" };
function TaskDiff({ added = [], removed = [], changed = [] }) {
  const one = (t, sign) => (<>
    <div style={{ fontSize: 11.5, fontWeight: 600 }}>{t.func ? `${t.func} · ` : ""}{t.name}</div>
    {sign === "±" && (<>
      <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>было</div>
      <pre style={{ ...PRE, ...WAS_STYLE }}>{t.was}</pre>
      <div style={{ fontSize: 10, color: WARN, marginTop: 2 }}>стало</div>
    </>)}
    <pre style={{ ...PRE, color: sign === "±" ? C.text : C.muted }}>{t.text}</pre>
  </>);
  return <DiffBoxes added={added} changed={changed} removed={removed} item={one} />;
}
function Versions({ proc, model, onSave }) {
  const [open, setOpen] = useState(false);
  const [which, setWhich] = useState(null);
  const [note, setNote] = useState("");
  const list = proc.versions || [];
  const last = list[list.length - 1];
  const dirty = (last?.text ?? "") !== proc.text;
  return (
    <div style={{ marginTop: 8 }}>
      <div className="flex items-center gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} aria-label="что изменилось" placeholder="что изменилось"
          style={{ ...S.inp, flex: 1, fontSize: 11.5, padding: "4px 6px" }} />
        <button type="button" style={{ ...btn(dirty), fontSize: 11, padding: "4px 8px" }} disabled={!dirty}
          aria-label="сохранить версию" onClick={() => { onSave(note.trim()); setNote(""); }}>Сохранить версию</button>
      </div>
      {/* «Прошлые версии» — на всю ширину формы (владелец, 2026-09-18). */}
      <button type="button" aria-expanded={open} aria-label="прошлые версии"
        onClick={() => setOpen((v) => !v)}
        style={{ ...btn(false), width: "100%", marginTop: 6, fontSize: 11.5, textAlign: "center" }}>
        {open ? "▾" : "▸"} Прошлые версии{list.length ? ` (${list.length})` : ""}</button>
      {open && (
        <div style={{ marginTop: 6 }}>
          {!list.length && <div style={{ fontSize: 11, color: C.muted }}>Версий пока нет — сохраните первую.</div>}
          {[...list].reverse().map((v, ri) => {
            const i = list.length - 1 - ri;
            const prev = list[i - 1];
            const shown = which === v.id;
            return (
              <div key={v.id} style={{ borderTop: `1px solid ${C.line}`, padding: "6px 0" }}>
                <button type="button" aria-expanded={shown} aria-label={`версия ${when(v.at)}`}
                  onClick={() => setWhich(shown ? null : v.id)}
                  className="flex items-center gap-2"
                  style={{ width: "100%", background: "transparent", border: "none", padding: 0, cursor: "pointer", color: C.text, textAlign: "left" }}>
                  <span style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>{shown ? "▾" : "▸"} {when(v.at)}</span>
                  <span style={{ flex: 1, fontSize: 11.5, color: C.muted, textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{v.note || "—"}</span>
                </button>
                {shown && <TaskDiff {...diffTasks(prev?.text ?? "", v.text, model)} />}
              </div>);
          })}
        </div>)}
    </div>);
}

/* ═══════════════ раздел ═══════════════ */
export default function ProcessPanel({ procs = [], setProcs, entities = [], setEntities,
  traits = [], setTraits, funcs = [], setFuncs, onDropFuncs, kinds = [],
  positions = [], people = [], rolesOf, selected = null, onOpenAsset, onOpenTrait, onOpenWorkers,
  shown: shownProp, onToggle }) {
  const [openChip, setOpenChip] = useState(null);
  const [naming, setNaming] = useState(null);
  const [modal, setModal] = useState(null);   // {proc, mode:"export"|"import", text}
  const [maps, setMaps] = useState(null);    // {proc, mode:"timeline"|"mind"}
  /* Свёрнутые процессы (владелец, 2026-09-19: «процесс должен сворачиваться
     при нажатии на заголовок»): держим id свёрнутых — новый процесс открыт. */
  const [shut, setShut] = useState(() => new Set());
  /* Заголовок: одно нажатие сворачивает, два — правят имя. Сворачиваем НЕ
     сразу, а через четверть секунды: иначе первое нажатие двойного успевает
     свернуть карточку, страница подпрыгивает, и второе нажатие уходит мимо
     (видно на длинном списке процессов). */
  const tap = useRef(null);
  const flip = (id) => setShut((was) => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const headTap = (id, onSecond) => {
    if (tap.current) {
      clearTimeout(tap.current.timer);
      const first = tap.current.id;
      tap.current = null;
      if (first === id) { onSecond(); return; }
    }
    tap.current = { id, timer: setTimeout(() => { tap.current = null; flip(id); }, 260) };
  };
  const [shownOwn, setShownOwn] = useState(false);
  const shown = shownProp ?? shownOwn;
  const toggle = () => (onToggle ? onToggle(!shown) : setShownOwn((v) => !v));
  const model = { entities, traits, positions, people, rolesOf };
  const usedHands = () => allHands(procs, model);
  const involved = procs.filter((p) => usesAsset(p, model, selected));
  const selName = entities.find((e) => e.id === selected)?.name || "";

  /* Одна дверь на все правки: функции процессов пересобираются по
     нынешним текстам (v2), задачи по функциям, которых больше нет, снимаются. */
  const commit = ({ procs: next, entities: e2 = entities, traits: t2 = traits, funcs: f2 = funcs }) => {
    const m = { entities: e2, traits: t2, positions, people, rolesOf };
    const synced = syncProcFuncs(f2, next, m, normalizeFunc, procFuncs);
    setProcs(next);
    if (e2 !== entities) setEntities(e2);
    if (t2 !== traits) setTraits(t2);
    setFuncs(synced);
    const after = new Set(synced.filter((f) => f.proc).map((f) => f.id));
    const gone = funcs.filter((f) => f.proc && !after.has(f.id)).map((f) => f.id);
    if (gone.length && onDropFuncs) onDropFuncs(gone);
  };
  const patch = (id, make) => procs.map((p) => (p.id === id ? make(p) : p));
  /* Старый текст («Актив, Должность, берёт: …») переводится в новый язык
     один раз, при первом показе: по памяти записи о шагах. */
  useEffect(() => {
    if (!procs.some((p) => isV1(p.text))) return;
    commit({ procs: procs.map((p) => (isV1(p.text) ? { ...p, text: fromV1(p.text, resolveProc(p, model).steps) } : p)) });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = () => commit({ procs: [...procs, newProc()] });
  const rename = (p, name) => commit({ procs: patch(p.id, (x) => ({ ...x, name: name.trim() })) });
  const setText = (p, text) => commit({ procs: patch(p.id, (x) => ({ ...x, text: indentText(tidyProcText(text)) })) });
  /* Части процесса — функции: своё поле у каждой (владелец, 2026-09-19).
     Ожидаемый результат — своё поле куска, в тело не входит (владелец,
     2026-09-20): в тексте процесса он встаёт строкой «Результат:» под
     «Функция:», а в поле тела его нет — там ему не к чему привязаться. */
  const setPart = (p, i, patchObj) => {
    const parts = splitProc(p.text).map((s0, j) => {
      if (j !== i) return s0;
      const next = { ...s0, ...patchObj };
      /* Если в новом теле человек написал «Описание:» или «Критерий:»
         руками — поднимаем их в меню, как и всё остальное; написанное
         раньше при этом остаётся (правка тела про него ничего не знает). */
      if (patchObj.body != null) {
        const { body, meta } = liftTaskMeta(patchObj.body);
        next.body = body;
        next.meta = (s0.meta || []).map((m, k) => (meta[k] ? { ...m, ...meta[k] } : m));
        meta.forEach((m, k) => { if (m && !next.meta[k]) next.meta[k] = m; });
      }
      return next;
    });
    setText(p, joinProc(parts));
  };
  /* Описание и критерии задачи: меню задаёт их номером задачи, тело
     приходит оттуда же — с несохранёнными правками поля (владелец,
     2026-09-20). */
  const setTaskMeta = (p, fi, bodyText, ti, patch) => {
    if (!(ti >= 0)) return;
    const parts = splitProc(p.text);
    const part = parts[fi];
    if (!part) return;
    const lifted = liftTaskMeta(bodyText);
    const meta = [...(part.meta || [])];
    meta[ti] = { about: "", checks: [], ...(meta[ti] || {}), ...patch };
    parts[fi] = { ...part, body: lifted.body, meta };
    setText(p, joinProc(parts));
  };
  const addPart = (p) => setText(p, joinProc([...splitProc(p.text), { name: "", result: "", body: "", meta: [] }]));
  const dropPart = (p, i) => setText(p, joinProc(splitProc(p.text).filter((s0, j) => j !== i)));
  /* Описание и прочие поля записи — без пересборки функций: текст не тронут. */
  const setProc = (p, patchObj) => setProcs(patch(p.id, (x) => ({ ...x, ...patchObj })));
  const saveVersion = (p, note, text = p.text) => {
    const v = { id: `v${Date.now().toString(36)}${(p.versions || []).length.toString(36)}`, at: new Date().toISOString(), text, note };
    commit({ procs: patch(p.id, (x) => ({ ...x, versions: [...(x.versions || []), v] })) });
  };
  const setStatus = (p, status) => {
    if (status === "off") {
      const d = dropHypo(p, { entities, traits, funcs });
      commit({ procs: patch(p.id, () => ({ ...d.proc, status })), entities: d.entities, traits: d.traits, funcs: d.funcs });
      return;
    }
    if (issuesOf(p, model).length) return;
    // Принятие — само по себе версия, если текст с прошлой версии менялся.
    const last = (p.versions || [])[(p.versions || []).length - 1];
    const versions = (last?.text ?? "") !== p.text
      ? [...(p.versions || []), { id: `v${Date.now().toString(36)}`, at: new Date().toISOString(), text: p.text, note: status === "on" ? "принято" : "принято гипотетически" }]
      : (p.versions || []);
    commit({ procs: patch(p.id, (x) => ({ ...x, status, versions })) });
  };
  const del = (p) => {
    const d = dropHypo(p, { entities, traits, funcs });
    commit({ procs: procs.filter((x) => x.id !== p.id), entities: d.entities, traits: d.traits, funcs: d.funcs });
  };
  /* Принять неизвестный ресурс — завести его в активе, чей он, с пометкой
     `hypo`. Должности из процесса не заводятся: их даёт владелец в «Правах
     сотрудников» и назначает активу во вкладке «Воркеры». */
  const acceptTrait = (p, it) => {
    setOpenChip(null);
    if (!it.asset?.id) return;
    const t = { id: `t${Date.now().toString(36)}${traits.length.toString(36)}`, e: it.asset.id, ks: [], k: "", l: it.name, unit: "ед.", hypo: true, accepted: false };
    commit({ traits: [...traits, t], procs: patch(p.id, (x) => ({ ...x, hypo: { ...x.hypo, traits: [...x.hypo.traits, t.id] } })) });
  };
  const rejectName = (p, name) => { setOpenChip(null); commit({ procs: patch(p.id, (x) => ({ ...x, missing: { ...x.missing, rejected: [...x.missing.rejected, name] } })) }); };
  const restoreName = (p, name) => { setOpenChip(null); commit({ procs: patch(p.id, (x) => ({ ...x, missing: { ...x.missing, rejected: x.missing.rejected.filter((r) => r.toLowerCase() !== name.toLowerCase()) } })) }); };
  const replace = (p, kind, oldName, id) => {
    const name = kind === "trait" ? traits.find((t) => t.id === id)?.l
      : positions.find((r) => String(r.id) === String(id))?.name || entities.find((e) => e.id === id)?.name;
    if (!name) return;
    setText(p, replaceName(p.text, kind, oldName, name, model));
  };
  const traitOptions = (assetId) => traits.filter((t) => !assetId || t.e === assetId).map((t) => ({ id: t.id, name: t.l }));

  return (
    <div style={{ ...S.card, marginTop: 10 }}>
      <button type="button" aria-expanded={shown} aria-label="технологические процессы" onClick={toggle} className="flex items-center gap-2"
        style={{ width: "100%", background: "transparent", border: "none", padding: 0, cursor: "pointer", color: C.text, textAlign: "left" }}>
        <span style={{ fontSize: 11, color: C.muted }}>{shown ? "▾" : "▸"}</span>
        <span style={S.lbl}>технологические процессы</span>
        <span style={{ fontSize: 10.5, color: C.muted }}>{procs.length}</span>
        {!!selected && !!involved.length && <span style={{ fontSize: 10.5, color: ACC }}>· с активом «{selName}»: {involved.length}</span>}
      </button>
      {shown && (
      <Section title="" addLabel="+ процесс" onAdd={add}
        hint="Строки с метками: «Функция:», «Задача:», «Кто: Должность» (актив подставится сам), «Берёт:», «Отдаёт:», «Кому:». Подсказки — окном над полем; ресурс можно ввести свой."
        empty={procs.length ? null : "Процессов пока нет."}>
        {procs.map((p) => {
          const { funcs: pf } = parseText(p.text, model, p);
          const issues = issuesOf(p, model);
          const can = issues.length === 0;
          const label = procLabel(p);
          const lit = !!selected && usesAsset(p, model, selected);
          const hid = shut.has(p.id);   // свёрнут: виден один заголовок
          const key = (...parts) => `${p.id}:${parts.join(":")}`;
          const traitChip = (it, k) => {
            const st = itemState(it, p, model);
            const tail = it.qtyHi != null && it.qtyHi !== it.qty ? ` ${nm(it.qty)}–${nm(it.qtyHi)}` : it.qty != null && it.qty !== 1 ? ` ${nm(it.qty)}` : "";
            const name = it.ref ? `(${it.var})` : it.name;
            return (
              <React.Fragment key={k}>
                <span aria-label={`буква ${it.letter}: ${name}`} style={{ color: ACC, fontWeight: 700, marginRight: 3 }}>{it.letter}</span>
                <Chip name={name} kind="trait" state={st} tail={tail} hypo={it.trait?.id ? p.hypo.traits.includes(it.trait.id) : false}
                  open={openChip === k} onOpen={() => setOpenChip(openChip === k ? null : k)}
                  onGo={it.trait?.id && onOpenTrait ? () => onOpenTrait(it.trait.id) : null}
                  onAccept={() => acceptTrait(p, it)} acceptWhy={it.asset ? "" : "не понятно, чей ресурс"}
                  onReject={() => rejectName(p, it.name)} onRestore={() => restoreName(p, it.name)}
                  options={traitOptions(it.asset?.id)} onReplace={(id) => replace(p, "trait", it.name, id)} />
                {it.var && !it.ref && <span style={{ fontSize: 10.5, color: C.muted }}> ({it.var})</span>}
              </React.Fragment>);
          };
          const whoChip = (w, k) => {
            const st = whoState(w, p);
            const roles = ROLE_KINDS.filter((r) => w.roles[r]);
            return (
              <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 3, marginRight: 6 }}>
                <Chip name={w.name} kind={w.anyWorker ? "asset" : "role"} state={st}
                  open={openChip === k} onOpen={() => setOpenChip(openChip === k ? null : k)}
                  onGo={w.asset?.id ? () => (w.anyWorker ? onOpenAsset?.(w.asset.id) : onOpenWorkers?.(w.asset.id)) : null}
                  onReject={() => rejectName(p, w.name)} onRestore={() => restoreName(p, w.name)} />
                {w.asset && !w.anyWorker && <span style={{ fontSize: 10.5, color: C.muted }}>{w.asset.name}</span>}
                {roles.map((r) => <span key={r} title={ROLE_WORD[r]} aria-label={`${ROLE_WORD[r]}: ${w.name}`}
                  style={{ fontSize: 10, background: ROLE_COLOR[r], color: DARK, borderRadius: 3, padding: "0 4px" }}>{ICON[r]}</span>)}
                {w.hand && <span aria-label={`переменная ${w.hand}: ${w.name}`} style={{ fontSize: 10, background: handColor(w.hand), color: DARK, borderRadius: 3, padding: "0 4px" }}>{w.hand}</span>}
                {w.person && <span aria-label={`сотрудник ${w.person}: ${w.name}`} style={{ fontSize: 10, background: w.personId ? "#FFD9A0" : BAD, color: DARK, borderRadius: 3, padding: "0 4px" }}>{w.person}</span>}
              </span>);
          };
          return (
            <div key={p.id} data-lit={lit || undefined}
              style={{ background: C.panel2, border: `1px solid ${lit ? ACC : C.line}`, borderRadius: 8, padding: 8, marginBottom: 8,
                borderLeft: `2px solid ${STATUS_TONE[p.status] || C.line}`, boxShadow: lit ? `0 0 0 1px ${ACC}55` : "none" }}>
              {/* Название — в самом верху формы и целиком: одинарное нажатие
                  сворачивает, двойное открывает правку (владелец, 2026-09-19). */}
              <div data-proc-head="" aria-label={`процесс «${label}»`} style={{ marginBottom: 6, cursor: "pointer" }}
                onClick={(e) => { if (e.target.closest("button, input, textarea")) return; headTap(p.id, () => setNaming(p.id)); }}>
                <div className="flex items-start gap-2">
                  <button type="button" aria-expanded={!hid} aria-label={`свернуть процесс «${label}»`}
                    onClick={() => flip(p.id)}
                    style={{ background: "transparent", border: "none", padding: 0, color: C.muted, cursor: "pointer",
                      fontSize: 12, lineHeight: "18px" }}>{hid ? "▸" : "▾"}</button>
                  {naming === p.id ? (
                    <input autoFocus aria-label="название процесса" defaultValue={p.name} placeholder="название процесса"
                      style={{ ...S.inp, flex: 1, fontSize: 13.5, fontWeight: 700, padding: "2px 6px" }}
                      onBlur={(e) => { rename(p, e.target.value); setNaming(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setNaming(null); }} />
                  ) : (
                    <span data-proc-name="" title="двойное нажатие — переименовать"
                      style={{ flex: 1, minWidth: 0, color: p.name ? C.text : C.muted, fontSize: 13.5, fontWeight: 700,
                        lineHeight: 1.3, whiteSpace: "normal", overflowWrap: "anywhere" }}>{label}</span>)}
                  <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436", fontSize: 11, padding: "2px 6px" }}
                    aria-label={`удалить процесс «${label}»`} onClick={() => del(p)}>удалить</button>
                </div>
                <div className="flex items-center gap-2" style={{ marginTop: 2 }}>
                  <span style={{ fontSize: 10.5, color: STATUS_TONE[p.status] || C.muted }}>
                    {PROC_STATUS.find(([id]) => id === p.status)?.[1].toLowerCase()}</span>
                  {lit && <span style={{ fontSize: 10.5, color: ACC }}>· актив «{selName}»</span>}
                </div>
              </div>

              {!hid && (<>
              {/* Описание — над полем ввода процесса (владелец, 2026-09-19). */}
              <textarea value={p.about || ""} aria-label={`описание процесса «${label}»`} rows={2}
                placeholder="описание"
                onChange={(e) => setProc(p, { about: e.target.value })}
                style={{ ...S.inp, width: "100%", fontSize: 11.5, lineHeight: 1.45, marginBottom: 6, resize: "vertical" }} />
              {/* У каждой функции своё поле и своя форма (владелец,
                  2026-09-19): текст режется по строкам «Функция:». */}
              {splitProc(p.text).map((seg, fi, all) => {
                const fKey = `${p.id}:f${fi}`;
                const fHid = shut.has(fKey);
                const fName = seg.name.trim() || "без названия";
                const outer = all.flatMap((o, j) => (j === fi ? [] : varsOf(o.body, model, p)));
                return (
                  <div key={fKey} style={{ borderLeft: `2px solid ${C.line}`, paddingLeft: 8, marginBottom: 8 }}>
                    <div data-func-head="" aria-label={`функция «${fName}»`} style={{ cursor: "pointer" }}
                      onClick={(e) => { if (e.target.closest("button, input, textarea")) return; headTap(fKey, () => setNaming(fKey)); }}>
                      <div className="flex items-start gap-2">
                        <button type="button" aria-expanded={!fHid} aria-label={`свернуть функцию «${fName}»`}
                          onClick={() => flip(fKey)}
                          style={{ background: "transparent", border: "none", padding: 0, color: C.muted, cursor: "pointer",
                            fontSize: 11, lineHeight: "17px" }}>{fHid ? "▸" : "▾"}</button>
                        {naming === fKey ? (
                          <input autoFocus aria-label="название функции процесса" defaultValue={seg.name}
                            style={{ ...S.inp, flex: 1, fontSize: 12.5, fontWeight: 700, padding: "2px 6px" }}
                            onBlur={(e) => { setPart(p, fi, { name: e.target.value }); setNaming(null); }}
                            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setNaming(null); }} />
                        ) : (
                          <span data-func-name="" title="двойное нажатие — переименовать"
                            style={{ flex: 1, minWidth: 0, color: seg.name.trim() ? C.text : C.muted, fontSize: 12.5, fontWeight: 700,
                              lineHeight: 1.3, whiteSpace: "normal", overflowWrap: "anywhere" }}>{fName}</span>)}
                        {all.length > 1 && (
                          <button type="button" aria-label={`удалить функцию «${fName}»`} title="удалить функцию"
                            onClick={() => dropPart(p, fi)}
                            style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", padding: "0 3px", fontSize: 12 }}>✕</button>)}
                      </div>
                    </div>
                    {!fHid && (<>
                      <div className="flex items-center gap-2" style={{ margin: "2px 0 4px" }}>
                        <span style={S.lbl}>ожидаемый результат</span>
                        <input key={seg.result} defaultValue={seg.result} aria-label={`ожидаемый результат функции «${fName}»`}
                          style={{ ...S.inp, flex: 1, fontSize: 11.5, padding: "2px 6px" }}
                          onBlur={(e) => setPart(p, fi, { result: e.target.value.trim() })}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
                      </div>
                      <ProcText value={indentText(seg.body)} model={model} proc={p} label="текст процесса" outerVars={outer}
                        onCommit={(t) => setPart(p, fi, { body: t })} usedHands={usedHands}
                        meta={seg.meta || []} onMeta={(body, ti, patch) => setTaskMeta(p, fi, body, ti, patch)}
                        kinds={kinds} onTrait={(id, patch) => commit({ procs, traits: traits.map((t) => (t.id === id ? { ...t, ...patch } : t)) })} />
                    </>)}
                  </div>);
              })}
              <button type="button" aria-label="добавить функцию процесса" onClick={() => addPart(p)}
                style={{ ...btn(false), fontSize: 11, padding: "3px 8px", marginBottom: 6 }}>+ функция</button>

              {/* Карты процесса — справа под полем (владелец, 2026-09-18). */}
              <div className="flex items-center gap-2" style={{ marginTop: 6, justifyContent: "flex-end" }}>
                <button type="button" aria-label="таймлайн процесса" title="таймлайн: когда идут задачи"
                  onClick={() => setMaps({ proc: p, mode: "timeline" })}
                  style={{ ...btn(false), fontSize: 14, padding: "2px 9px", lineHeight: 1.4 }}>▤</button>
                <button type="button" aria-label="майнд-карта процесса" title="майнд-карта: что куда уходит"
                  onClick={() => setMaps({ proc: p, mode: "mind" })}
                  style={{ ...btn(false), fontSize: 14, padding: "2px 9px", lineHeight: 1.4 }}>⛭</button>
              </div>

              <div className="flex flex-wrap gap-2" style={{ marginTop: 6 }}>
                <button type="button" style={{ ...btn(false), fontSize: 11, padding: "3px 8px" }} aria-label="выгрузить техпроцесс"
                  onClick={() => setModal({ proc: p, mode: "export", text: exportText(p.text) })}>Выгрузить</button>
                <button type="button" style={{ ...btn(false), fontSize: 11, padding: "3px 8px" }} aria-label="загрузить техпроцесс"
                  onClick={() => setModal({ proc: p, mode: "import", text: "" })}>Загрузить</button>
              </div>

              {/* Разбор — под полем: функции, задачи, участники и шаги. */}
              {pf.map((f, fi) => (
                <div key={fi} style={{ marginTop: 8, fontSize: 12, lineHeight: 1.9 }}>
                  <div style={{ fontSize: 11, color: C.muted }}>функция: <span style={{ color: C.text }}>{f.name || `без названия (${f.tasks[0]?.name || "…"})`}</span></div>
                  {f.tasks.map((t, ti) => (
                    <div key={ti} style={{ paddingLeft: 8, borderLeft: `2px solid ${C.line}`, marginTop: 4 }}>
                      <div style={{ fontSize: 11, color: C.muted }}>задача {ti + 1}: <span style={{ color: C.text }}>{t.name || "без названия"}</span></div>
                      {t.branches.map((b, bi) => (
                        <div key={bi}>
                          {(b.cond || b.isElse) && <div style={{ fontSize: 11, color: WARN }}>{b.isElse ? "иначе" : `если ${b.cond}`}</div>}
                          {!!b.who.length && <div>{b.who.map((w, wi) => whoChip(w, key(fi, ti, bi, "who", wi)))}</div>}
                          {b.steps.map((s, si) => (
                            <div key={si}>
                              <span style={{ color: C.muted }}>{s.kind === "take" ? "берёт " : "отдаёт "}</span>
                              {s.items.map((it, j) => <React.Fragment key={j}>{j ? ", " : ""}{traitChip(it, key(fi, ti, bi, si, j))}</React.Fragment>)}
                              {!!s.or.length && <span style={{ color: C.muted }}> или </span>}
                              {s.or.map((it, j) => <React.Fragment key={`o${j}`}>{j ? ", " : ""}{traitChip(it, key(fi, ti, bi, si, "or", j))}</React.Fragment>)}
                              {(s.to || s.from) && <span style={{ color: C.muted }}> {s.to ? "→" : "←"} {(s.to || s.from).asset?.name || (s.to || s.from).name}</span>}
                            </div>))}
                        </div>))}
                    </div>))}
                </div>))}

              {!!issues.length && !!p.text.trim() && (
                <div style={{ fontSize: 10.5, color: BAD, marginTop: 6, lineHeight: 1.5 }}>{issues.map((w, i) => <div key={i}>{w}</div>)}</div>)}

              <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
                {PROC_STATUS.map(([id, name]) => {
                  const on = p.status === id;
                  const locked = id !== "off" && !can;
                  return (
                    <button key={id} aria-pressed={on} disabled={locked} title={locked ? issues[0] : ""}
                      style={{ ...btn(on, STATUS_TONE[id] || undefined), fontSize: 11, opacity: locked ? 0.5 : 1, cursor: locked ? "default" : "pointer" }}
                      onClick={() => !on && setStatus(p, id)}>{name}</button>);
                })}
              </div>
              <Versions proc={p} model={model} onSave={(note) => saveVersion(p, note)} />
              </>)}
            </div>);
        })}
      </Section>)}
      {maps && (<ProcMaps mode={maps.mode} proc={maps.proc} model={model} onClose={() => setMaps(null)} />)}
      {modal && (
        <TextModal title={modal.mode === "export" ? "выгрузка техпроцесса" : "загрузка техпроцесса"}
          value={modal.text} onClose={() => setModal(null)}
          onChange={modal.mode === "import" ? (t) => setModal({ ...modal, text: t }) : undefined}
          onLoad={modal.mode === "import" ? () => { setText(modal.proc, importText(modal.text)); setModal(null); } : undefined} />)}
    </div>);
}
