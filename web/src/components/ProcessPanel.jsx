import React, { useEffect, useRef, useState } from "react";
import { C, OK, WARN, BAD, ACC, NEU, S, btn, nm } from "./ui.jsx";
import { Section } from "./AssetPanel.jsx";
import { normalizeFunc } from "../lib/funcs.js";
import { HINT_WORD, MARK_GIVE, MARK_TAKE, PROC_STATUS, canAcceptProc, dropHypo, hintAt, newProc, paintOf,
  procIssues, procLabel, procUsesAsset, replaceName, resolveProc, stateOf, suggestNames,
  syncProcFuncs } from "../lib/process.js";

/* ════════════════════════════════════════════════════════════════
   ТЕХНОЛОГИЧЕСКИЙ ПРОЦЕСС · раздел на «Управлении»

   Владелец: «я буквально должен вводить текст, а он должен выдавать
   подсказки»; «как она была полем ввода, так должна и остаться;
   подсказки должны быть видны только как всплывающее окно; имя сущности
   человек должен иметь возможность ввести сам или выбрать из выпадающего
   списка» (2026-09-13). Порядок слов в строке — его: актив, должность,
   откуда берёт и что, куда отдаёт и что.

   Поэтому здесь ТЕКСТ — строка на шаг — и всплывающее окно у поля
   (`ProcText`): что ожидается на месте курсора и список имён; выбрать —
   нажатием или Enter, ввести своё — просто набрать. Разбор (lib/process.js)
   стоит под полем построчно: найденное — чипами (нажатие открывает
   карточку сущности), ненайденное — пунктиром, и по нажатию на пунктир
   человек решает, принять это как новую сущность или отклонить.

   Все правки идут через одну дверь (`commit`): процесс, его функции и
   заведённые им сущности меняются одним заходом — в историю правок ложится
   один шаг, и «отменить» возвращает всё разом, а не по частям.
   ════════════════════════════════════════════════════════════════ */

const WORD = { asset: "актив", trait: "ресурс", role: "должность" };
const STATUS_TONE = { off: null, hypo: WARN, on: OK };

/* ─── текст со всплывающими подсказками ───
   Окно стоит под полем, пока поле в фокусе: заголовок — что ожидается,
   ниже — имена. Стрелки и Enter выбирают, Escape закрывает, `onMouseDown`
   с `preventDefault` держит фокус в поле — выбор из списка это часть
   набора, не его конец. Набранное своё имя остаётся как есть. */
/* ─────── красные метки прямо в поле ───────

   Владелец (2026-09-15): «пропущенные при вводе сущности должны
   вставляться в это поле в виде красных меток». В textarea цвет слову не
   задать, поэтому под ним лежит подложка с тем же текстом тем же шрифтом
   и с теми же отступами: текст подложки прозрачный, а под ненайденными,
   отклонёнными и удалёнными именами — красная подсветка и черта. Что в
   строке пропущено (ошибка строения — «у X не назван ресурс»), стоит
   красной меткой у правого края строки; она позиционирована абсолютно и
   на перенос строк не влияет, поэтому текст подложки и поля не
   расходятся. Само поле над подложкой, с прозрачным фоном. */
const DARK = "#0E1420";
const PURPLE = "#C9A0FF";
/* Плашка — подложка без отступов: цвет и кольцо `box-shadow` вокруг слова,
   чтобы буквы подложки и поля не разъезжались (отступы сдвинули бы текст). */
const plate = (bg, fg = DARK, ring = "") => ({ background: bg, color: fg, borderRadius: 5,
  boxShadow: `0 0 0 3px ${bg}${ring ? `, 0 0 0 4px ${ring}` : ""}` });
const SIDE = { take: ACC, give: OK };
function spanStyle(k) {
  const bad = k.state === "unknown" || k.state === "rejected" || k.state === "deleted";
  if (k.kind === "mark") return { color: C.muted };
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
/* Круглая скобка стороны: две дуги по краям, абсолютно позиционированные,
   на текст не влияют; внутри — лёгкая подложка цвета стороны. */
function Bracket({ side, children }) {
  const c = SIDE[side] || ACC;
  /* Дуги привязаны к якорям нулевой ширины в начале и в конце: якорь
     стоит в своей строке, и при переносе содержимого на две строки дуга
     не растягивается на обе (владелец, 2026-09-18). */
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
function Backdrop({ text, paint, style }) {
  const lines = String(text || "").split("\n");
  const byRow = new Map(paint.map((r) => [r.row, r]));
  /* Кусок строки [from, to) с плашками слов внутри него. */
  const piece = (ln, from, to, spans, lead, key) => {
    const out = [];
    let at = from;
    spans.filter((k) => k.start + lead >= from && k.end + lead <= to).forEach((k, j) => {
      const s0 = k.start + lead, e0 = k.end + lead;
      if (s0 > at) out.push(<span key={`${key}t${j}`}>{ln.slice(at, s0)}</span>);
      const bad = k.state && k.state !== "ok" && k.state !== "empty";
      out.push(<span key={`${key}m${j}`} data-kind={k.kind} data-side={k.side || undefined}
        data-mark={bad ? k.state : (k.exprError ? "expr" : undefined)}
        title={k.exprError || (bad ? k.state : undefined)} style={spanStyle(k)}>{ln.slice(s0, e0)}</span>);
      at = e0;
    });
    if (to > at) out.push(<span key={`${key}r`}>{ln.slice(at, to)}</span>);
    return out;
  };
  return (
    <div aria-hidden="true" data-proc-backdrop="" style={{ ...style, position: "absolute", inset: 0,
      color: C.text, pointerEvents: "none", overflow: "hidden", whiteSpace: "pre-wrap",
      wordBreak: "break-word", borderColor: "transparent", background: "transparent" }}>
      {lines.map((ln, i) => {
        const r = byRow.get(i);
        const lead = ln.length - ln.trimStart().length;
        const parts = [];
        let at = 0;
        // Скобки сторон — по порядку; слова внутри скобки рисуются внутри неё.
        (r?.brackets || []).forEach((b, j) => {
          const s0 = b.start + lead, e0 = b.end + lead;
          if (s0 > at) parts.push(...piece(ln, at, s0, r.spans, lead, `p${j}`));
          parts.push(<Bracket key={`b${j}`} side={b.side}>{piece(ln, s0, e0, r.spans, lead, `i${j}`)}</Bracket>);
          at = e0;
        });
        parts.push(...piece(ln, at, ln.length, r?.spans || [], lead, "z"));
        return (
          <div key={i} style={{ position: "relative", minHeight: "1.9em" }}>
            {parts}{"\u200b"}
            {r?.error && (
              <span data-mark="error" style={{ position: "absolute", right: 0, top: 0, color: BAD,
                fontSize: 10, lineHeight: "1.9em", background: C.ink, padding: "0 4px",
                maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                ← {r.error}</span>)}
          </div>);
      })}
    </div>);
}

function ProcText({ value = "", model, proc, onCommit, label }) {
  const [text, setText] = useState(value);
  const [focus, setFocus] = useState(false);
  const [pick, setPick] = useState(null);   // { kind, start, query, assetName, at }
  const [cursor, setCursor] = useState(0);
  const inp = useRef(null);
  const back = useRef(null);
  const paint = paintOf(text, model, proc);
  // Межстрочный интервал шире обычного: плашкам и скобкам нужен воздух.
  const field = { ...S.inp, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12,
    lineHeight: 1.9, boxSizing: "border-box" };
  // Снаружи поменяли (загрузили модель, поставили замену) — а мы не в
  // фокусе: показываем новое.
  useEffect(() => { if (!focus) setText(value); }, [value, focus]);

  const items = pick ? suggestNames(pick, model, proc) : [];
  const place = (v, at) => {
    const h = hintAt(v, at, model);
    setPick({ ...h, at });
    setCursor(0);
  };
  const onChange = (e) => {
    const v = e.target.value;
    setText(v);
    place(v, e.target.selectionStart ?? v.length);
  };
  const onMove = (e) => place(text, e.target.selectionStart ?? text.length);
  /* Подсказка вставляет имя и то, что после него идёт всегда: запятую с
     пробелом; у метки — пробел. Иначе выбор из списка заканчивался бы
     ровно там, где человеку снова надо набирать. */
  const choose = (it) => {
    if (!pick) return;
    /* После РЕСУРСА — пробел, а не запятая (владелец, 2026-09-15: «запятая
       ставится после ввода ресурса, а не выходит предложение ввести
       количество»): окно сразу переходит к «сколько». Запятую к
       следующему ресурсу ставит пункт «дальше →» или сам человек. */
    const suffix = it.suffix ?? (it.mark ? " " : pick.kind === "trait" ? " " : ", ");
    // Знак у количества вставляется в место курсора, буква и имя — вместо
    // слова у курсора, недописанное имя ресурса — с самого имени.
    const from = it.insert ? pick.at : it.whole && pick.nameStart != null ? pick.nameStart : pick.start;
    let head = it.trimBefore ? text.slice(0, from).replace(/[ \t]+$/, "") : text.slice(0, from);
    /* Метка «берёт:»/«отдаёт:» — с новой строки, если в этой уже что-то
       есть (владелец, 2026-09-16: строки по смыслу): запятая и пробелы
       перед ней убираются. */
    if (it.mark) {
      const rowStart = head.lastIndexOf("\n") + 1;
      if (head.slice(rowStart).trim()) head = `${head.replace(/[,\s]+$/, "")}\n`;
    }
    const put = it.text ?? it.name;
    const next = `${head}${put}${suffix}${text.slice(pick.at)}`;
    const caret = head.length + put.length + suffix.length;
    setText(next);
    setTimeout(() => {
      inp.current?.focus();
      inp.current?.setSelectionRange(caret, caret);
      place(next, caret);
    }, 0);
  };
  const onKey = (e) => {
    if (!pick) return;
    if (e.key === "Escape") { setPick(null); return; }
    if (!items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => (c + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => (c - 1 + items.length) % items.length); }
    else if (e.key === "Tab") { e.preventDefault(); choose(items[cursor]); }
    else if (e.key === "Enter" && pick.kind !== "qty" && pick.query && items[cursor]
      && items[cursor].name.toLowerCase().startsWith(pick.query.toLowerCase())) {
      // Enter выбирает только когда набранное — начало подсказки; иначе
      // это перевод строки, следующий шаг. У количества Enter — всегда
      // перевод строки: «45-55% A» и Enter не должны подставлять букву.
      e.preventDefault(); choose(items[cursor]);
    }
  };
  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "relative", background: C.ink, borderRadius: field.borderRadius }}>
        <Backdrop text={text} paint={paint} style={field} />
        {/* Текст поля прозрачный: слова рисует подложка — плашками; курсор
            и выделение остаются у поля. Подсказка-заполнитель — своим
            серым (см. <style> ниже), иначе она тоже стала бы прозрачной. */}
        <style>{`textarea[data-proc-text]::placeholder{color:${NEU};opacity:1}`}</style>
        <textarea ref={inp} value={text} aria-label={label} data-proc-text=""
          rows={Math.max(3, text.split("\n").length + 1)}
          placeholder={`Актив, Должность\n${MARK_TAKE} Откуда, Что 2\n${MARK_GIVE} Куда, Что 50% A`}
          style={{ ...field, resize: "vertical", position: "relative", zIndex: 1,
            background: "transparent", color: "transparent", caretColor: C.text, display: "block" }}
          onScroll={(e) => { if (back.current) back.current.scrollTop = e.target.scrollTop; }}
          onFocus={(e) => { setFocus(true); place(text, e.target.selectionStart ?? text.length); }}
          onBlur={() => { setFocus(false); setPick(null); if (text !== value) onCommit(text); }}
          onChange={onChange} onKeyUp={onMove} onClick={onMove} onKeyDown={onKey} />
      </div>
      {/* Окно — НАД полем (владелец, 2026-09-18: «подсказка загораживает
          поле ввода»), в спокойных цветах панели. */}
      {pick && focus && (
        <div role="dialog" aria-label="подсказка процесса"
          onMouseDown={(e) => e.preventDefault()}
          style={{ position: "absolute", left: 0, right: 0, bottom: "100%", zIndex: 20,
            background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6,
            boxShadow: "0 -6px 20px rgba(0,0,0,.35)", marginBottom: 4 }}>
          <div style={{ padding: "5px 8px", fontSize: 10.5, color: C.muted,
            borderBottom: `1px solid ${C.line}` }}>
            ожидается: {HINT_WORD[pick.kind]}
            {pick.kind === "trait" && pick.assetName ? ` из «${pick.assetName}»` : ""}
            {pick.kind === "trait" ? " · после имени через пробел — сколько" : ""}
            {pick.kind === "qty" && pick.traitName ? ` — для «${pick.traitName}»` : ""}
            <span style={{ color: C.muted }}> · выберите или введите своё; Tab — подставить</span>
          </div>
          <div role="listbox" aria-label="подсказки процесса"
            style={{ maxHeight: 160, overflowY: "auto" }}>
            {items.map((it, i) => (
              <div key={`${it.kind}:${it.name}`} role="option" aria-selected={i === cursor}
                onMouseDown={(e) => { e.preventDefault(); choose(it); }}
                style={{ padding: "5px 8px", fontSize: 12, cursor: "pointer",
                  background: i === cursor ? ACC + "22" : "transparent" }}>
                <span style={{ color: C.muted }}>{it.kind} </span>{it.name}
                {it.note && <span style={{ color: C.muted }}> — {it.note}</span>}
                {it.fresh && <span style={{ fontSize: 10, color: WARN }}> · новое</span>}
              </div>))}
            {!items.length && (
              <div style={{ padding: "5px 8px", fontSize: 11, color: C.muted }}>
                {pick.kind === "qty" ? "число, диапазон 45-55, «50% A», «20% @ресурс»"
                  : pick.query ? `«${pick.query}» — новое имя: примите его под полем после набора; через пробел — сколько` : "список пуст — введите своё имя"}
              </div>)}
          </div>
        </div>)}
    </div>);
}

/* ─── одно имя из строки ───
   Четыре состояния — четыре вида. Найденное — чип, нажатие открывает его
   карточку. Неизвестное — пунктир: это ещё не ошибка, а вопрос, и нажатие
   его задаёт. Отклонённое и удалённое — красные: первое ждёт правки
   строки, второе — замены. */
function Chip({ item, kind, state, qty, qtyHi, hypo, open, onOpen, onAccept, acceptWhy, onReject,
  onRestore, options = [], onReplace, onGo }) {
  const name = item?.name || "";
  // Количество: число или «от–до», когда операция дала диапазон.
  const tail = qtyHi != null && qtyHi !== qty ? ` ${nm(qty)}–${nm(qtyHi)}`
    : qty != null && qty !== 1 ? ` ${nm(qty)}` : "";
  const base = { display: "inline-block", borderRadius: 6, padding: "1px 7px", fontSize: 12,
    lineHeight: 1.6, verticalAlign: "middle" };
  if (state === "ok") {
    return (
      <button type="button" onClick={onGo} disabled={!onGo}
        aria-label={`${WORD[kind]} «${name}»: открыть`}
        title={onGo ? "открыть карточку" : ""}
        style={{ ...base, border: `1px solid ${C.line}`, background: C.panel, color: C.text,
          cursor: onGo ? "pointer" : "default" }}>
        {name}{tail}
        {hypo && <span style={{ fontSize: 10, color: WARN }}> · гипотеза</span>}
      </button>);
  }
  if (state === "deleted") {
    return (
      <span style={{ ...base, border: `1px solid ${BAD}`, color: BAD }}>
        {name}{tail} — удалён — выберите замену
        <select aria-label={`замена для «${name}»`} value=""
          onChange={(e) => e.target.value && onReplace(e.target.value)}
          style={{ ...S.inp, width: "auto", display: "inline-block", marginLeft: 6,
            padding: "1px 4px", fontSize: 11 }}>
          <option value="">— замена —</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </span>);
  }
  const rejected = state === "rejected";
  return (
    <span style={{ display: "inline" }}>
      <button type="button" onClick={onOpen} aria-expanded={open}
        aria-label={`${rejected ? "отклонённый" : "неизвестный"} ${WORD[kind]} «${name}»`}
        style={{ ...base, cursor: "pointer",
          border: rejected ? `1px solid ${BAD}` : `1px dashed ${ACC}`,
          color: rejected ? BAD : ACC, background: "transparent" }}>
        {name}{tail}{rejected ? " — отклонено" : ""}</button>
      {open && (
        <span style={{ marginLeft: 4, whiteSpace: "nowrap" }}>
          <button type="button" aria-label={`принять ${WORD[kind]} «${name}»`}
            disabled={!!acceptWhy} title={acceptWhy || ""}
            style={{ ...btn(true, OK), fontSize: 11, padding: "2px 7px",
              opacity: acceptWhy ? 0.5 : 1 }}
            onClick={onAccept}>Принять</button>
          {" "}
          {rejected
            ? <button type="button" aria-label={`вернуть ${WORD[kind]} «${name}»`}
              style={{ ...btn(false), fontSize: 11, padding: "2px 7px" }}
              onClick={onRestore}>Вернуть</button>
            : <button type="button" aria-label={`отклонить ${WORD[kind]} «${name}»`}
              style={{ ...btn(true, BAD), fontSize: 11, padding: "2px 7px" }}
              onClick={onReject}>Отклонить</button>}
        </span>)}
    </span>);
}

export default function ProcessPanel({ procs = [], setProcs, entities = [], setEntities,
  traits = [], setTraits, funcs = [], setFuncs, onDropFuncs, makeEntity,
  positions = [], onAddPosition, selected = null, onOpenAsset, onOpenTrait, onOpenWorkers,
  shown: shownProp, onToggle }) {
  // Какой пунктирный чип раскрыт: «процесс:строка:вид:имя».
  const [openChip, setOpenChip] = useState(null);
  const [naming, setNaming] = useState(null);   // какой процесс сейчас называют
  /* Спойлер (2026-09-13): форма стоит первой на «Управлении», но до нажатия
     скрывает процессы — иначе она заслоняла бы карточку актива. Открыт ли
     он, помнит `SystemModel`; без такого пропа — своё состояние. */
  const [shownOwn, setShownOwn] = useState(false);
  const shown = shownProp ?? shownOwn;
  const toggle = () => (onToggle ? onToggle(!shown) : setShownOwn((v) => !v));
  const involved = procs.filter((p) => procUsesAsset(p, selected));
  const selName = entities.find((e) => e.id === selected)?.name || "";
  // Последние процессы — для правок, приходящих с сервера (новая должность).
  const procsRef = useRef(procs); procsRef.current = procs;

  const model = { entities, traits, positions };
  /* Одна дверь на все правки. `steps` пересчитываются каждый раз — они
     память записи о найденных id, и устаревать им нельзя; функции
     процессов пересобираются по нынешним текстам и статусам; задачи по
     функциям, которых больше нет, снимаются. */
  const commit = ({ procs: next, entities: e2 = entities, traits: t2 = traits,
    funcs: f2 = funcs }) => {
    const m = { entities: e2, traits: t2, positions };
    const withSteps = next.map((p) => ({ ...p, steps: resolveProc(p, m).steps }));
    const synced = syncProcFuncs(f2, withSteps, m, normalizeFunc);
    setProcs(withSteps);
    if (e2 !== entities) setEntities(e2);
    if (t2 !== traits) setTraits(t2);
    setFuncs(synced);
    const after = new Set(synced.filter((f) => f.proc).map((f) => f.id));
    const gone = funcs.filter((f) => f.proc && !after.has(f.id)).map((f) => f.id);
    if (gone.length && onDropFuncs) onDropFuncs(gone);
  };
  const patchIn = (list, id, make) => list.map((p) => (p.id === id ? make(p) : p));
  const patch = (id, make) => patchIn(procs, id, make);

  const add = () => commit({ procs: [...procs, newProc()] });
  const rename = (p, name) => commit({ procs: patch(p.id, (x) => ({ ...x, name: name.trim() })) });
  const setText = (p, text) => commit({ procs: patch(p.id, (x) => ({ ...x, text })) });
  /* «Не принято» — функций от процесса нет, и его гипотезы уходят со
     схемы: без процесса они ничьи. Задачи по его функциям — тоже. */
  const setStatus = (p, status) => {
    if (status === "off") {
      const d = dropHypo(p, { entities, traits, funcs });
      commit({ procs: patch(p.id, () => ({ ...d.proc, status })), entities: d.entities,
        traits: d.traits, funcs: d.funcs });
      return;
    }
    if (!canAcceptProc(p, model)) return;
    commit({ procs: patch(p.id, (x) => ({ ...x, status })) });
  };
  const del = (p) => {
    const d = dropHypo(p, { entities, traits, funcs });
    commit({ procs: procs.filter((x) => x.id !== p.id), entities: d.entities,
      traits: d.traits, funcs: d.funcs });
  };
  /* Принять неизвестное — завести его: актив рядом с существующими,
     ресурс — в названном активе пары, оба с пометкой `hypo` (ресурс к
     тому же не принят — принимает его человек в карточке). Должность —
     запись организации: уезжает на сервер, и разбор находит её, когда
     список должностей перечитан. */
  const acceptName = (p, kind, item, assetId) => {
    setOpenChip(null);
    if (kind === "asset") {
      const e = { ...makeEntity(item.name), hypo: true };
      commit({ entities: [...entities, e],
        procs: patch(p.id, (x) => ({ ...x,
          hypo: { ...x.hypo, entities: [...x.hypo.entities, e.id] } })) });
      return;
    }
    if (kind === "role") {
      if (!onAddPosition) return;
      Promise.resolve(onAddPosition(item.name)).then((r) => {
        if (!r || r.id == null) return;
        commit({ procs: patchIn(procsRef.current, p.id, (x) => ({ ...x,
          hypo: { ...x.hypo, roles: [...x.hypo.roles, r.id] } })) });
      }).catch(() => {});
      return;
    }
    const t = { id: `t${Date.now().toString(36)}${traits.length.toString(36)}`, e: assetId,
      ks: [], k: "", l: item.name, unit: "ед.", hypo: true, accepted: false };
    commit({ traits: [...traits, t],
      procs: patch(p.id, (x) => ({ ...x,
        hypo: { ...x.hypo, traits: [...x.hypo.traits, t.id] } })) });
  };
  const rejectName = (p, name) => {
    setOpenChip(null);
    commit({ procs: patch(p.id, (x) => ({ ...x,
      missing: { ...x.missing, rejected: [...x.missing.rejected, name] } })) });
  };
  const restoreName = (p, name) => {
    setOpenChip(null);
    commit({ procs: patch(p.id, (x) => ({ ...x,
      missing: { ...x.missing,
        rejected: x.missing.rejected.filter((r) => r.toLowerCase() !== name.toLowerCase()) } })) });
  };
  /* Замена удалённого — правка текста: имя в строке меняется на выбранное,
     и дальше всё идёт своим чередом. Текст — единственный источник, и
     подменять id мимо него значило бы завести второй. */
  const replace = (p, kind, oldName, id) => {
    const name = kind === "asset" ? entities.find((e) => e.id === id)?.name
      : kind === "role" ? positions.find((r) => String(r.id) === String(id))?.name
        : traits.find((t) => t.id === id)?.l;
    if (!name) return;
    setText(p, replaceName(p.text, kind, oldName, name));
  };

  const assetOptions = entities.map((e) => ({ id: e.id, name: e.name }));
  const roleOptions = positions.map((r) => ({ id: r.id, name: r.name }));
  const traitOptions = (assetId) => traits.filter((t) => !assetId || t.e === assetId)
    .map((t) => ({ id: t.id, name: t.l }));

  return (
    <div style={{ ...S.card, marginTop: 10 }}>
      <button type="button" aria-expanded={shown} aria-label="технологические процессы"
        onClick={toggle} className="flex items-center gap-2"
        style={{ width: "100%", background: "transparent", border: "none", padding: 0,
          cursor: "pointer", color: C.text, textAlign: "left" }}>
        <span style={{ fontSize: 11, color: C.muted }}>{shown ? "▾" : "▸"}</span>
        <span style={S.lbl}>технологические процессы</span>
        <span style={{ fontSize: 10.5, color: C.muted }}>{procs.length}</span>
        {!!selected && !!involved.length && (
          <span style={{ fontSize: 10.5, color: ACC }}>
            · с активом «{selName}»: {involved.length}</span>)}
      </button>
      {shown && (
      <Section title="" addLabel="+ процесс" onAdd={add}
        hint={`Строка — шаг: «Актив, Должность, ${MARK_TAKE} Откуда, Что 2, ${MARK_GIVE} Куда, Что». Подсказки — окном у поля по мере набора; имя можно ввести своё. Нажатие на найденное открывает его карточку ниже.`}
        empty={procs.length ? null : "Процессов пока нет."}>
        {procs.map((p) => {
          const { steps } = resolveProc(p, model);
          const issues = procIssues(p, model);
          const can = issues.length === 0;
          const label = procLabel(p);
          const lit = !!selected && procUsesAsset(p, selected);
          const key = (s, kind, name) => `${p.id}:${s.line}:${kind}:${name}`;
          return (
            <div key={p.id} data-lit={lit || undefined}
              style={{ background: C.panel2, border: `1px solid ${lit ? ACC : C.line}`,
                borderRadius: 8, padding: 8, marginBottom: 8,
                borderLeft: `2px solid ${STATUS_TONE[p.status] || C.line}`,
                boxShadow: lit ? `0 0 0 1px ${ACC}55` : "none" }}>
              {lit && (
                <div style={{ fontSize: 10.5, color: ACC, marginBottom: 4 }}>
                  задействует выбранный актив «{selName}»</div>)}
              <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                <span style={S.lbl}>процесс</span>
                {/* Название — по нажатию справа от слова «процесс»: поле
                    становится редактируемым, Enter или уход — записывает. */}
                {naming === p.id ? (
                  <input autoFocus aria-label="название процесса" defaultValue={p.name}
                    placeholder="название процесса"
                    style={{ ...S.inp, flex: 1, fontSize: 12.5, fontWeight: 600, padding: "3px 6px" }}
                    onBlur={(e) => { rename(p, e.target.value); setNaming(null); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setNaming(null);
                    }} />
                ) : (
                  <button type="button" aria-label={`назвать процесс «${label}»`}
                    title="нажмите, чтобы назвать процесс" onClick={() => setNaming(p.id)}
                    style={{ flex: 1, minWidth: 0, textAlign: "left", background: "transparent",
                      border: "none", padding: 0, color: p.name ? C.text : C.muted, fontSize: 12.5,
                      fontWeight: 600, cursor: "text", overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {label}</button>)}
                <span style={{ fontSize: 10.5, color: STATUS_TONE[p.status] || C.muted,
                  whiteSpace: "nowrap" }}>
                  {PROC_STATUS.find(([id]) => id === p.status)?.[1].toLowerCase()}</span>
                <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436",
                  fontSize: 11, padding: "2px 6px" }}
                  aria-label={`удалить процесс «${label}»`} onClick={() => del(p)}>удалить</button>
              </div>

              <ProcText value={p.text} model={model} proc={p}
                label="текст процесса" onCommit={(t) => setText(p, t)} />

              {/* Разбор построчно — под полем, там же, где набирают. */}
              {steps.map((s, si) => {
                const chip = (it, kind, qty, assetId, assetOk = true, qtyHi = null) => {
                  const st = stateOf(it, kind, model, p);
                  const k = key(s, kind, it.name);
                  const hypo = kind === "asset" ? p.hypo.entities.includes(it.id)
                    : kind === "role" ? p.hypo.roles.includes(String(it.id))
                      : p.hypo.traits.includes(it.id);
                  const go = kind === "asset" ? (onOpenAsset ? () => onOpenAsset(it.id) : null)
                    : kind === "trait" ? (onOpenTrait ? () => onOpenTrait(it.id) : null)
                      : (onOpenWorkers && s.asset?.id ? () => onOpenWorkers(s.asset.id) : null);
                  return (
                    <Chip item={it} kind={kind} state={st} qty={qty} qtyHi={qtyHi} hypo={hypo}
                      open={openChip === k}
                      onOpen={() => setOpenChip(openChip === k ? null : k)}
                      onGo={go}
                      onAccept={() => acceptName(p, kind, it, assetId)}
                      acceptWhy={kind === "trait" && !assetOk ? "сначала примите актив"
                        : kind === "role" && !onAddPosition ? "должности заводит владелец на сервере" : ""}
                      onReject={() => rejectName(p, it.name)}
                      onRestore={() => restoreName(p, it.name)}
                      options={kind === "asset" ? assetOptions : kind === "role" ? roleOptions
                        : traitOptions(assetId)}
                      onReplace={(id) => replace(p, kind, it.name, id)} />);
                };
                const pair = (x, j) => {
                  const aOk = stateOf(x.asset, "asset", model, p) === "ok";
                  return (
                    <React.Fragment key={j}>{j ? ", " : ""}
                      {/* Буква ресурса — ею на него ссылаются операции строки. */}
                      <span aria-label={`буква ${x.letter}: ${x.trait?.name || ""}`}
                        style={{ color: ACC, fontWeight: 700, marginRight: 3 }}>{x.letter}</span>
                      {chip(x.asset, "asset")}
                      <span style={{ color: C.muted }}> → </span>
                      {chip(x.trait, "trait", x.qty, x.asset?.id, aOk, x.qtyHi)}
                    </React.Fragment>);
                };
                return (
                  <div key={s.line} style={{ marginTop: 6, fontSize: 12, lineHeight: 1.9 }}>
                    {/* Номер шага по порядку, а не номер строки: шаг может занимать несколько строк. */}
                    <span style={{ color: C.muted, marginRight: 6 }}>{si + 1}.</span>
                    {s.error
                      ? <span style={{ color: BAD }}>{s.text} — {s.error}</span>
                      : <>
                        {chip(s.asset, "asset")}
                        {s.role && <> <span style={{ color: C.muted }}>·</span> {chip(s.role, "role")}</>}
                        {!!s.takes.length && <span style={{ color: C.muted }}> берёт </span>}
                        {s.takes.map(pair)}
                        {!!s.gives.length && <span style={{ color: C.muted }}> отдаёт </span>}
                        {s.gives.map(pair)}
                      </>}
                  </div>);
              })}

              {!!issues.length && !!p.text.trim() && (
                <div style={{ fontSize: 10.5, color: BAD, marginTop: 6, lineHeight: 1.5 }}>
                  {issues.map((w, i) => <div key={i}>{w}</div>)}
                </div>)}

              {/* Три состояния, одно нажатие. Принять — гипотетически или
                  насовсем — нельзя, пока в строках есть неизвестное,
                  отклонённое или удалённое: подсказка говорит, что сперва. */}
              <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
                {PROC_STATUS.map(([id, name]) => {
                  const on = p.status === id;
                  const locked = id !== "off" && !can;
                  return (
                    <button key={id} aria-pressed={on} disabled={locked}
                      title={locked ? issues[0] : ""}
                      style={{ ...btn(on, STATUS_TONE[id] || undefined), fontSize: 11,
                        opacity: locked ? 0.5 : 1, cursor: locked ? "default" : "pointer" }}
                      onClick={() => !on && setStatus(p, id)}>{name}</button>);
                })}
              </div>
            </div>);
        })}
      </Section>)}
    </div>);
}
