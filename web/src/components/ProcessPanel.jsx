import React, { useEffect, useRef, useState } from "react";
import { C, OK, WARN, BAD, ACC, NEU, S, btn, nm } from "./ui.jsx";
import { Section } from "./AssetPanel.jsx";
import { normalizeFunc } from "../lib/funcs.js";
import { PROC_STATUS, dropHypo, newProc, procLabel, resolveProc, syncProcFuncs } from "../lib/process.js";
import { HINT, ICON, ROLE_KINDS, ROLE_WORD, diffTasks, exportText, fromV1, hintAt, importText, isV1,
  issuesOf, itemState, labelOf, paintOf, parseText, peopleOfPosition, procFuncs, replaceName, setAuto, setHand, setPerson,
  suggest, toggleRole, usesAsset, whoState } from "../lib/proc2.js";
import { allHands, handColor, newHandName } from "../lib/hands.js";

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

/* ─────── подложка ───────
   Плашка — без отступов: цвет и кольцо `box-shadow` вокруг слова, чтобы
   буквы подложки и поля не разъезжались (отступы сдвинули бы текст). */
const plate = (bg, fg = DARK, ring = "") => ({ background: bg, color: fg, borderRadius: 5,
  boxShadow: `0 0 0 3px ${bg}${ring ? `, 0 0 0 4px ${ring}` : ""}` });
function spanStyle(k) {
  const bad = k.state === "unknown" || k.state === "rejected" || k.state === "deleted" || k.state === "noasset";
  if (k.kind === "mark") return { color: C.muted };
  if (k.kind === "func") return { color: C.text, borderBottom: `2px solid ${C.line}` };
  if (k.kind === "task") return { color: C.text, borderBottom: `1px solid ${C.line}` };
  if (k.kind === "cond") return { color: WARN };
  if (k.kind === "roles") {
    const one = k.roles.length === 1 ? k.roles[0] : null;
    return one ? plate(ROLE_COLOR[one]) : plate(C.panel2, C.muted, C.line);
  }
  if (k.kind === "hand") return plate(handColor(k.hand));
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
function Backdrop({ text, paint, style, noteGap = 0, activeRow = -1, backRef = null }) {
  const lines = String(text || "").split("\n");
  const byRow = new Map(paint.map((r) => [r.row, r]));
  const piece = (ln, from, to, spans, key) => {
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
      out.push(<span key={`${key}m${j}`} data-kind={k.kind} data-side={k.side || undefined}
        data-mark={bad ? k.state : (k.exprError ? "expr" : undefined)}
        title={k.exprError || (k.kind === "roles" ? k.roles.map((r) => ROLE_WORD[r]).join(", ") : k.kind === "hand" ? `переменная сотрудника: ${k.hand}` : k.kind === "person" ? (k.known ? "именно этот сотрудник" : "нет такого сотрудника") : bad ? k.state : undefined)}
        style={wrap ? {} : spanStyle(k)}>
        {wrap ? (<>
          <span style={{ color: "transparent" }}>{raw.slice(0, wrap[0])}</span>
          <span style={spanStyle(k)}>{inner}</span>
          {wrap[1] ? <span style={{ color: "transparent" }}>{raw.slice(raw.length - wrap[1])}</span> : null}
        </>) : raw}</span>);
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
          if (b.start > at) parts.push(...piece(ln, at, b.start, r.spans, `p${j}`));
          parts.push(<Bracket key={`b${j}`} side={b.side}>{piece(ln, b.start, b.end, r.spans, `i${j}`)}</Bracket>);
          at = b.end;
        });
        parts.push(...piece(ln, at, ln.length, r?.spans || [], "z"));
        return (
          <div key={i} style={{ position: "relative", minHeight: `${LINE_H}em` }}>
            {parts}{"​"}
            {/* Пометка актива справа у «Кто:» (владелец, 2026-09-18). */}
            {r?.note && (
              <span data-note={r.note} style={{ position: "absolute", right: 4 + (i === activeRow ? noteGap : 0), top: 0, color: C.muted,
                fontSize: 10, lineHeight: `${LINE_H}em`, background: C.ink, padding: "0 5px", borderRadius: 4,
                border: `1px solid ${C.line}`, whiteSpace: "nowrap", maxWidth: "45%", overflow: "hidden", textOverflow: "ellipsis" }}>
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

/* ─────── поле с подсказками ─────── */
function ProcText({ value = "", model, proc, onCommit, label, usedHands = () => new Set() }) {
  const [text, setText] = useState(value);
  const [focus, setFocus] = useState(false);
  const [pick, setPick] = useState(null);   // подсказка у курсора + at
  const [cursor, setCursor] = useState(0);
  const [caretRow, setCaretRow] = useState(-1);
  const inp = useRef(null);
  const back = useRef(null);
  /* Прокрутка поля (владелец, 2026-09-18): пока поле в фокусе, его высота
     ограничена и включается собственная прокрутка; подложка и меню
     участника сдвигаются вместе с текстом. */
  const [scrollTop, setScrollTop] = useState(0);
  const paint = paintOf(text, model, proc);
  const field = { ...S.inp, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12,
    lineHeight: LINE_H, boxSizing: "border-box" };
  useEffect(() => { if (!focus) setText(value); }, [value, focus]);

  const items = pick ? suggest(pick, model, proc) : [];
  const place = (v, at) => {
    const h = hintAt(v, at, model);
    setPick({ ...h, at });
    setCursor(0);
    setCaretRow(v.slice(0, at).split("\n").length - 1);
  };
  const apply = (next, caret) => {
    setText(next);
    setTimeout(() => {
      inp.current?.focus();
      inp.current?.setSelectionRange(caret, caret);
      place(next, caret);
    }, 0);
  };
  const onChange = (e) => { const v = e.target.value; setText(v); place(v, e.target.selectionStart ?? v.length); };
  const onMove = (e) => place(text, e.target.selectionStart ?? text.length);
  /* Подстановка: пункт несёт `suffix` (что после), `insert` (вставить у
     курсора, не заменяя набранное), `text` (что вставить вместо имени),
     `trimBefore` (убрать пробелы перед), `caretBack` (курсор внутрь). */
  const choose = (it) => {
    if (!pick || it.info) return;
    const suffix = it.suffix ?? ", ";
    const from = it.insert ? pick.at : pick.start;
    const head = it.trimBefore ? text.slice(0, from).replace(/[ \t]+$/, "") : text.slice(0, from);
    const put = it.text ?? it.name;
    const next = `${head}${put}${suffix}${text.slice(pick.at)}`;
    apply(next, head.length + put.length + suffix.length - (it.caretBack || 0));
  };
  const onKey = (e) => {
    if (!pick) return;
    if (e.key === "Escape") { setPick(null); return; }
    if (!items.length) return;
    const list = items.filter((i) => !i.info);
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => (c + 1) % list.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => (c - 1 + list.length) % list.length); }
    else if (e.key === "Tab") { e.preventDefault(); if (list[cursor]) choose(list[cursor]); }
    else if (e.key === "Enter" && pick.kind !== "qty" && pick.kind !== "name" && pick.query && list[cursor]
      && !list[cursor].insert && list[cursor].name.toLowerCase().startsWith(pick.query.toLowerCase())) {
      e.preventDefault(); choose(list[cursor]);
    }
  };
  /* Меню у выделенной должности (владелец, 2026-09-18): строка «Кто:», где
     стоит курсор. Столбиком: три роли с названиями, «Зафиксировать
     сотрудника» (рука — переменная из двух слов) и «Выбрать сотрудника»
     (автоматически / зафиксированные переменные / сотрудники должности).
     Каждое нажатие правит текст — единственный источник. */
  const rowLine = caretRow >= 0 ? text.split("\n")[caretRow] || "" : "";
  const whoRow = focus && caretRow >= 0 && labelOf(rowLine)?.kind === "who" ? caretRow : -1;
  const whoSpan = whoRow >= 0 ? paint.find((r) => r.row === whoRow)?.spans : null;
  const whoName = whoSpan?.find((k) => k.kind === "role" || k.kind === "asset")?.name || "";
  const whoHand = whoSpan?.find((k) => k.kind === "hand")?.hand || null;
  const whoPerson = whoSpan?.find((k) => k.kind === "person")?.person || null;
  const [pickPerson, setPickPerson] = useState(false);
  const [renamingHand, setRenamingHand] = useState(false);
  /* Пока правят имя переменной, фокус уходит из поля в строку ввода — меню
     при этом не закрывается (`hold`), а после правки фокус возвращается. */
  const hold = useRef(false);
  const roleOn = (role) => rowLine.includes(ICON[role]);
  const rewrite = (next) => {
    const caret = Math.min(inp.current?.selectionStart ?? next.length, next.length);
    setText(next); onCommit(next);
    setTimeout(() => { inp.current?.focus(); inp.current?.setSelectionRange(caret, caret); place(next, caret); }, 0);
  };
  const toggle = (role) => rewrite(toggleRole(text, whoRow, role));
  const fixHand = () => rewrite(setHand(text, whoRow, newHandName(usedHands())));
  const renameHand = (name) => {
    const n = String(name || "").trim().toLowerCase();
    hold.current = false;
    setRenamingHand(false);
    if (!n || n === whoHand) { setTimeout(() => inp.current?.focus(), 0); return; }
    if ([...usedHands()].some((h) => h === n) && n !== whoHand) { setTimeout(() => inp.current?.focus(), 0); return; }
    // Переименовать — во всех строках этого процесса, где стоит эта рука.
    const re = new RegExp(`\\{\\s*${whoHand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}`, "gi");
    rewrite(text.replace(re, `{${n}}`));
  };
  const procHands = [...new Set(paint.flatMap((r) => r.spans.filter((k) => k.kind === "hand" && k.hand).map((k) => k.hand)))];
  const persons = whoRow >= 0 ? peopleOfPosition(whoName, model) : [];
  const header = pick ? `${HINT[pick.kind] || ""}${pick.kind === "trait" && pick.asset ? ` — ресурсы «${pick.asset.name}»` : ""}${pick.kind === "qty" && pick.traitName ? ` — для «${pick.traitName}»` : ""}` : "";
  return (
    <div style={{ position: "relative" }}>
      {pick && focus && (
        <div role="dialog" aria-label="подсказка процесса"
          onMouseDown={(e) => e.preventDefault()}
          style={{ position: "absolute", left: 0, right: 0, bottom: "100%", zIndex: 20,
            background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6,
            boxShadow: "0 -6px 20px rgba(0,0,0,.35)", marginBottom: 4 }}>
          <div style={{ padding: "5px 8px", fontSize: 10.5, color: C.muted, borderBottom: `1px solid ${C.line}` }}>
            {header}<span style={{ opacity: 0.7 }}> · Tab — подставить</span>
          </div>
          <div role="listbox" aria-label="подсказки процесса" style={{ maxHeight: 150, overflowY: "auto" }}>
            {items.filter((i) => !i.info).map((it, i) => (
              <div key={`${it.kind}:${it.name}:${it.note || ""}`} role="option" aria-selected={i === cursor}
                onMouseDown={(e) => { e.preventDefault(); choose(it); }}
                style={{ padding: "4px 8px", fontSize: 12, cursor: "pointer",
                  background: i === cursor ? `${C.line}88` : "transparent" }}>
                <span style={{ color: C.muted }}>{it.kind} </span>{it.name}
                {it.note && <span style={{ color: C.muted }}> — {it.note}</span>}
              </div>))}
            {items.filter((i) => i.info).map((it, i) => (
              <div key={`info${i}`} style={{ padding: "4px 8px", fontSize: 11, color: C.muted }}>{it.note}</div>))}
            {!items.length && (
              <div style={{ padding: "4px 8px", fontSize: 11, color: C.muted }}>
                {pick.query ? `«${pick.query}» — своё имя; после ввода нажмите Tab на «↵» или перейдите на новую строку` : "введите своё"}
              </div>)}
          </div>
        </div>)}
      <div style={{ position: "relative", background: C.ink, borderRadius: field.borderRadius }}>
        <Backdrop text={text} paint={paint} style={field} activeRow={whoRow} noteGap={whoRow >= 0 ? 190 : 0} backRef={back} />
        <style>{`textarea[data-proc-text]::placeholder{color:${NEU};opacity:1}`}</style>
        <textarea ref={inp} value={text} aria-label={label} data-proc-text=""
          rows={Math.max(4, text.split("\n").length + 1)}
          placeholder={`Задача: название\nКто: Должность ✎ ⚙\nБерёт: ресурс 2\nОтдаёт: ресурс 50% A\nКому: Должность`}
          style={{ ...field, resize: "vertical", position: "relative", zIndex: 1,
            background: "transparent", color: "transparent", caretColor: C.text, display: "block",
            maxHeight: focus ? "45vh" : undefined, overflowY: focus ? "auto" : undefined }}
          onScroll={(e) => { const t = e.target.scrollTop; if (back.current) back.current.scrollTop = t; setScrollTop(t); }}
          onFocus={(e) => { setFocus(true); place(text, e.target.selectionStart ?? text.length); }}
          onBlur={() => { if (hold.current) return; setFocus(false); setPick(null); setCaretRow(-1); setScrollTop(0); if (text !== value) onCommit(text); }}
          onChange={onChange} onKeyUp={onMove} onClick={onMove} onKeyDown={onKey} />
        {whoRow >= 0 && (
          <div data-role-buttons="" onMouseDown={(e) => { if (e.target.tagName !== "INPUT") e.preventDefault(); }}
            aria-label={`меню участника ${whoName}`}
            style={{ position: "absolute", right: 6, top: 7 + whoRow * LINE_H * 12 - scrollTop, zIndex: 3, display: "flex", flexDirection: "column", gap: 2,
              width: 180, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: 4, boxShadow: "0 6px 20px rgba(0,0,0,.35)" }}>
            {ROLE_KINDS.map((role) => (
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
                    <input autoFocus defaultValue={whoHand} aria-label="имя переменной сотрудника"
                      style={{ ...S.inp, flex: 1, fontSize: 11, padding: "1px 4px" }}
                      onBlur={(e) => renameHand(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { hold.current = false; setRenamingHand(false); inp.current?.focus(); } }} />
                  ) : (
                    <button type="button" aria-label={`переименовать переменную ${whoHand}`} title="нажмите, чтобы переименовать"
                      onClick={() => { hold.current = true; setRenamingHand(true); }}
                      style={{ flex: 1, textAlign: "left", background: handColor(whoHand), color: DARK, border: "none", borderRadius: 4,
                        padding: "1px 6px", fontSize: 11, cursor: "text" }}>{whoHand}</button>)}
                  <button type="button" aria-label={`снять фиксацию: ${whoName}`} title="снять фиксацию" onClick={() => rewrite(setAuto(text, whoRow))}
                    style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", padding: 0 }}>✕</button>
                </div>
              </div>
            ) : (
              <button type="button" aria-label={`зафиксировать сотрудника: ${whoName}`} onClick={fixHand} className="flex items-center gap-2"
                style={{ borderRadius: 5, fontSize: 11.5, padding: "3px 6px", cursor: "pointer", textAlign: "left", background: "transparent",
                  color: C.text, border: `1px solid ${C.line}` }}>
                <span style={{ width: 16, textAlign: "center" }}>🔒</span>Зафиксировать сотрудника</button>)}
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
          </div>)}
      </div>
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
function TaskDiff({ added, removed }) {
  const box = (sign, list, color, label) => (
    <fieldset aria-label={label} style={{ border: `1px solid ${color}`, borderRadius: 8, padding: "4px 8px 8px", margin: 0, minWidth: 0 }}>
      <legend style={{ color, fontWeight: 700, fontSize: 12, padding: "0 4px" }}>{sign}</legend>
      {!list.length && <div style={{ fontSize: 11, color: C.muted }}>ничего</div>}
      {list.map((t, i) => (
        <div key={i} style={{ marginTop: i ? 6 : 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600 }}>{t.func ? `${t.func} · ` : ""}{t.name}</div>
          <pre style={{ margin: 0, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, whiteSpace: "pre-wrap", color: C.muted }}>{t.text}</pre>
        </div>))}
    </fieldset>);
  return (
    <div className="flex flex-wrap gap-2" style={{ marginTop: 6 }}>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>{box("+", added, OK, "добавлено или изменено")}</div>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>{box("−", removed, BAD, "убрано или заменено")}</div>
    </div>);
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
  traits = [], setTraits, funcs = [], setFuncs, onDropFuncs,
  positions = [], people = [], rolesOf, selected = null, onOpenAsset, onOpenTrait, onOpenWorkers,
  shown: shownProp, onToggle }) {
  const [openChip, setOpenChip] = useState(null);
  const [naming, setNaming] = useState(null);
  const [modal, setModal] = useState(null);   // {proc, mode:"export"|"import", text}
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
  const setText = (p, text) => commit({ procs: patch(p.id, (x) => ({ ...x, text })) });
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
              {lit && <div style={{ fontSize: 10.5, color: ACC, marginBottom: 4 }}>задействует выбранный актив «{selName}»</div>}
              <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                <span style={S.lbl}>процесс</span>
                {naming === p.id ? (
                  <input autoFocus aria-label="название процесса" defaultValue={p.name} placeholder="название процесса"
                    style={{ ...S.inp, flex: 1, fontSize: 12.5, fontWeight: 600, padding: "3px 6px" }}
                    onBlur={(e) => { rename(p, e.target.value); setNaming(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setNaming(null); }} />
                ) : (
                  <button type="button" aria-label={`назвать процесс «${label}»`} title="нажмите, чтобы назвать процесс" onClick={() => setNaming(p.id)}
                    style={{ flex: 1, minWidth: 0, textAlign: "left", background: "transparent", border: "none", padding: 0, color: p.name ? C.text : C.muted,
                      fontSize: 12.5, fontWeight: 600, cursor: "text", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</button>)}
                <span style={{ fontSize: 10.5, color: STATUS_TONE[p.status] || C.muted, whiteSpace: "nowrap" }}>
                  {PROC_STATUS.find(([id]) => id === p.status)?.[1].toLowerCase()}</span>
                <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436", fontSize: 11, padding: "2px 6px" }}
                  aria-label={`удалить процесс «${label}»`} onClick={() => del(p)}>удалить</button>
              </div>

              <ProcText value={p.text} model={model} proc={p} label="текст процесса" onCommit={(t) => setText(p, t)} usedHands={usedHands} />

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
            </div>);
        })}
      </Section>)}
      {modal && (
        <TextModal title={modal.mode === "export" ? "выгрузка техпроцесса" : "загрузка техпроцесса"}
          value={modal.text} onClose={() => setModal(null)}
          onChange={modal.mode === "import" ? (t) => setModal({ ...modal, text: t }) : undefined}
          onLoad={modal.mode === "import" ? () => { setText(modal.proc, importText(modal.text)); setModal(null); } : undefined} />)}
    </div>);
}
