import React, { useMemo, useRef, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, nm, NumField, TxtField } from "./ui.jsx";
import { PER, unitOf } from "../lib/sim.js";
import {
  OPS, REPEAT_WHEN, arrowEnds, condShown, exprGaps, exprText, exprToEdges,
  lineText, newLine, newToken, opName, readProgram,
} from "../lib/hexpr.js";

/* ════════════════════════════════════════════════════════════════
   ГИПОТЕЗЫ · построчный конструктор

   Строка начинается с оператора и дальше набирается из палитры: элементы
   кладутся щелчком в позицию курсора или перетаскиванием. Щелчок по
   поставленному элементу открывает его параметры — у движения их восемь,
   и в строку текста они не помещаются.

   Что во что превращается — в lib/hexpr.js; здесь только набор.
   ════════════════════════════════════════════════════════════════ */

const chip = (bg, col) => ({
  display: "inline-flex", alignItems: "center", gap: 4,
  background: bg, border: `1px solid ${col}66`, color: col,
  borderRadius: 6, padding: "3px 7px", fontSize: 12, cursor: "pointer",
  whiteSpace: "nowrap", userSelect: "none",
});

const OP_COLOR = {
  if: "#C792EA", then: OK, else: WARN, while: "#C792EA",
  repeat: "#C792EA", for: "#C792EA", break: BAD, continue: ACC,
};

/* ─────── параметры выделенного элемента ─────── */

function ResParams({ tok, traits, entities, kindOf, onChange, onDelete }) {
  return (
    <div>
      <div style={S.lbl}>какой ресурс подставить</div>
      <select style={{ ...S.inp, marginTop: 5 }} value={tok.trait || ""}
        onChange={(e) => onChange({ trait: e.target.value })}>
        <option value="">— выбери ресурс —</option>
        {entities.map((en) => (
          <optgroup key={en.id} label={en.name}>
            {traits.filter((t) => t.e === en.id).map((t) => (
              <option key={t.id} value={t.id}>
                {kindOf(t.k).sign} {t.l} · {unitOf(t)}</option>))}
          </optgroup>))}
      </select>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
        В выражение подставится текущее значение этого ресурса. Слева от
        стрелки он же и тратится.
      </div>
      <button style={{ ...btn(false), marginTop: 8, color: BAD, borderColor: "#5A2436" }}
        onClick={onDelete}>Убрать из строки</button>
    </div>);
}

function EntParams({ tok, entities, onChange, onDelete }) {
  return (
    <div>
      <div style={S.lbl}>по ресурсам какого актива идти</div>
      <select style={{ ...S.inp, marginTop: 5 }} value={tok.entity || ""}
        onChange={(e) => onChange({ entity: e.target.value })}>
        <option value="">— выбери актив —</option>
        {entities.map((en) => (<option key={en.id} value={en.id}>{en.name}</option>))}
      </select>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
        Тело цикла повторится по разу на каждый ресурс этого актива, и
        «значение …» в каждом повторе укажет на свой.
      </div>
      <button style={{ ...btn(false), marginTop: 8, color: BAD, borderColor: "#5A2436" }}
        onClick={onDelete}>Убрать из строки</button>
    </div>);
}

export function ArrowParams({ tok, ends, traits, elemName, onChange, onDelete }) {
  const nameOf = (id) => (id === "@elem"
    ? `значение ${elemName || "element"}` : traits.find((t) => t.id === id)?.l);
  const src = ends.from ? nameOf(ends.from) : null;
  const dst = ends.to ? nameOf(ends.to) : null;
  const target = traits.find((t) => t.id === ends.to);
  const unit = target ? String(unitOf(target)).split("/")[0] : "единиц";
  const perN = PER[tok.per] ?? 1;
  return (
    <div>
      <div style={S.lbl}>движение{dst ? ` в «${dst}»` : ""}</div>
      <div style={{ fontSize: 11, color: C.muted, margin: "4px 0 8px", lineHeight: 1.5 }}>
        {src ? `Тратит «${src}».` : "Ничего не тратит: величина приходит извне модели."}
        {" "}Концы стрелки — соседние элементы строки; чтобы поменять их,
        переставь их, а не стрелку.
      </div>

      <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: C.muted }}>за раз переносит</span>
        <NumField value={tok.gives} style={{ flex: "0 1 84px" }}
          onCommit={(v) => onChange({ gives: v ?? 0 })} />
        <span style={{ fontSize: 12, color: C.muted }}>{unit}</span>
        <button style={btn(true, Number(tok.sign) > 0 ? OK : BAD)}
          onClick={() => onChange({ sign: Number(tok.sign) > 0 ? -1 : 1 })}>
          {Number(tok.sign) > 0 ? "катализирует" : "купирует"}</button>
      </div>

      <div style={S.lbl}>за какое время это движение должно быть произведено</div>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center", margin: "5px 0 4px" }}>
        <select style={{ ...S.inp, flex: "0 1 110px" }} value={tok.per}
          onChange={(e) => onChange({ per: e.target.value })}>
          {Object.keys(PER).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span style={{ fontSize: 10.5, color: C.muted, flex: "1 1 150px" }}>
          {perN !== 1
            ? `за месяц это ${nm(perN)} раз — до ${nm(Math.abs(Number(tok.gives) || 0) * perN)} ${unit}`
            : "один раз за месяц"}</span>
      </div>

      <div className="flex flex-wrap gap-2" style={{ marginBottom: 8 }}>
        <div style={{ flex: "1 1 150px" }}>
          <div style={S.lbl}>начало</div>
          <input type="datetime-local" style={S.inp} value={tok.start || ""}
            onChange={(e) => onChange({ start: e.target.value })} />
        </div>
        <div style={{ flex: "1 1 150px" }}>
          <div style={S.lbl}>конец</div>
          <input type="datetime-local" style={S.inp} value={tok.end || ""}
            onChange={(e) => onChange({ end: e.target.value })} />
        </div>
      </div>

      <label className="flex items-center gap-2"
        style={{ fontSize: 11.5, marginBottom: 8, cursor: "pointer", lineHeight: 1.5 }}>
        <input type="checkbox" checked={!!tok.report} style={{ accentColor: ACC }}
          onChange={(e) => onChange({ report: e.target.checked })} />
        <span>следующий элемент получает отчёт от предыдущего</span>
      </label>

      <div style={S.lbl}>когда можно повторять</div>
      <select style={{ ...S.inp, margin: "5px 0 4px" }} value={tok.repeat}
        onChange={(e) => onChange({ repeat: e.target.value })}>
        {REPEAT_WHEN.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      {tok.repeat === "every" && (
        <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: C.muted }}>раз в</span>
          <select style={{ ...S.inp, flex: "0 1 110px" }} value={tok.everyPer}
            onChange={(e) => onChange({ everyPer: e.target.value })}>
            {Object.keys(PER).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>)}
      {tok.repeat === "approved" && (
        <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 4, lineHeight: 1.5 }}>
          Следующий раз откроется, когда отчёт по предыдущему принят — задача
          уходит на проверку, а не сразу в «Готово».
        </div>)}

      <div style={{ ...S.lbl, marginTop: 8 }}>в сколько потоков</div>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center", margin: "5px 0 4px" }}>
        <button style={btn(Number(tok.threads) <= 1)}
          onClick={() => onChange({ threads: 1 })}>в один</button>
        <button style={btn(Number(tok.threads) > 1)}
          onClick={() => onChange({ threads: Math.max(2, Number(tok.threads) || 2) })}>
          в несколько</button>
        {Number(tok.threads) > 1 && (
          <NumField value={tok.threads} style={{ flex: "0 1 80px" }}
            onCommit={(v) => onChange({ threads: Math.max(1, Math.round(v || 1)) })} />)}
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
        Столько копий задачи появится в списке — по одной на поток.
      </div>

      <div style={{ ...S.lbl, marginTop: 8 }}>как назвать движение</div>
      <TxtField value={tok.carrier || ""} placeholder="например: звонки рефералам"
        style={{ marginTop: 5 }} onCommit={(v) => onChange({ carrier: v })} />

      <button style={{ ...btn(false), marginTop: 8, color: BAD, borderColor: "#5A2436" }}
        onClick={onDelete}>Убрать из строки</button>
    </div>);
}

/* ─────── одна строка ─────── */

function Line({ line, active, caret, traits, entities, sel, elemName,
  onFocus, onCaret, onPick, onText, onDrop, onOp, onElem, onDelete, onMove }) {
  const nameOf = (id) => traits.find((t) => t.id === id)?.l;
  const entName = (id) => entities.find((e) => e.id === id)?.name;
  const [over, setOver] = useState(null);
  const opCol = OP_COLOR[line.op] || ACC;

  const Gap = ({ at }) => (
    <span
      onClick={() => { onFocus(); onCaret(at); }}
      onDragOver={(e) => { e.preventDefault(); setOver(at); }}
      onDragLeave={() => setOver((o) => (o === at ? null : o))}
      onDrop={(e) => { e.preventDefault(); setOver(null); onDrop(e, at); }}
      title="сюда встанет следующий элемент"
      style={{
        display: "inline-block", width: over === at ? 14 : 8, minHeight: 22,
        cursor: "text", borderRadius: 3,
        background: over === at ? ACC : "transparent",
        borderLeft: (active && caret === at && over !== at)
          ? `2px solid ${ACC}` : "2px solid transparent",
      }} />);

  return (
    <div className="flex" role="group" aria-label={`строка ${opName(line.op)}`}
      style={{ alignItems: "flex-start", gap: 6, padding: "3px 4px",
        background: active ? C.panel2 : "transparent", borderRadius: 6 }}
      onClick={onFocus}>
      {/* Оператор — начало строки и её смысл, поэтому он не элемент
          выражения, а свойство строки: пустой строки без оператора не бывает. */}
      <button onClick={(e) => { e.stopPropagation(); onOp(); }}
        title={OPS.find((o) => o.id === line.op)?.hint}
        style={{ ...chip(C.panel, opCol), fontWeight: 700, flex: "0 0 auto",
          minWidth: 78, justifyContent: "center" }}>
        {opName(line.op)}</button>

      {line.op === "for" ? (
        <div className="flex flex-wrap" style={{ alignItems: "center", gap: 4, flex: 1 }}>
          <input value={line.elem || ""} placeholder="element"
            onChange={(e) => onElem(e.target.value)}
            onFocus={onFocus}
            style={{ width: `${Math.max(7, (line.elem || "").length + 1)}ch`,
              background: "transparent", border: "none", borderBottom: `1px dashed ${ACC}66`,
              outline: "none", color: ACC, fontSize: 12.5, padding: "2px 1px" }} />
          <span style={{ fontSize: 12, color: C.muted }}>в</span>
          <Gap at={0} />
          {line.tokens.map((t, i) => (
            <React.Fragment key={t.id}>
              <span onClick={(e) => { e.stopPropagation(); onPick(t.id); }}
                style={{ ...chip(C.ink, t.entity ? ACC : WARN),
                  outline: sel === t.id ? `2px solid ${ACC}` : "none" }}>
                «{t.entity ? entName(t.entity) : "актив?"}»</span>
              <Gap at={i + 1} />
            </React.Fragment>))}
        </div>
      ) : (
        <div className="flex flex-wrap" style={{ alignItems: "center", gap: 2, flex: 1,
          minHeight: 26 }}>
          <Gap at={0} />
          {line.tokens.map((t, i) => {
            const on = sel === t.id;
            const pick = (e) => { e.stopPropagation(); onPick(t.id); onCaret(i + 1); };
            let body;
            if (t.kind === "res") {
              const n = nameOf(t.trait);
              body = (<span onClick={pick}
                style={{ ...chip(C.ink, n ? ACC : WARN),
                  outline: on ? `2px solid ${ACC}` : "none" }}>
                {n ? `[${n}]` : "[ресурс?]"}</span>);
            } else if (t.kind === "elem") {
              body = (<span onClick={pick}
                style={{ ...chip(C.ink, "#FF9E64"), outline: on ? `2px solid ${ACC}` : "none" }}>
                значение {elemName || "element"}</span>);
            } else if (t.kind === "ent") {
              body = (<span onClick={pick}
                style={{ ...chip(C.ink, t.entity ? ACC : WARN),
                  outline: on ? `2px solid ${ACC}` : "none" }}>
                «{t.entity ? entName(t.entity) : "актив?"}»</span>);
            } else if (t.kind === "arrow") {
              const ends = arrowEnds(line.tokens, i);
              const ok = !!ends.to && Math.abs(Number(t.gives)) > 0;
              body = (<span onClick={pick}
                style={{ ...chip(C.ink, ok ? OK : WARN), fontWeight: 700,
                  outline: on ? `2px solid ${ACC}` : "none" }}>
                →{Math.abs(Number(t.gives)) > 0 ? ` ${nm(Math.abs(Number(t.gives)))}` : ""}
                {Number(t.threads) > 1 ? ` ×${t.threads}` : ""}</span>);
            } else {
              body = (<input value={t.text} placeholder="…"
                onChange={(e) => onText(t.id, e.target.value)}
                onFocus={() => { onFocus(); onPick(null); onCaret(i + 1); }}
                style={{ width: `${Math.max(2, (t.text || "").length + 1)}ch`,
                  background: "transparent", border: "none", outline: "none",
                  color: C.text, fontSize: 12.5,
                  fontFamily: "ui-monospace, Menlo, monospace", padding: "3px 2px" }} />);
            }
            return (<React.Fragment key={t.id}>{body}<Gap at={i + 1} /></React.Fragment>);
          })}
          {!line.tokens.length && (
            <span style={{ fontSize: 11, color: C.muted }}>
              {line.op === "break" || line.op === "continue" || line.op === "repeat"
                ? "" : "пусто"}</span>)}
        </div>
      )}

      {/* Значок сам по себе ничего не сообщает — ни человеку с экранным
          диктором, ни тесту; подпись отдельно. */}
      <div className="flex" style={{ gap: 2, flex: "0 0 auto" }}>
        <button aria-label="выше" title="выше" style={{ ...btn(false), padding: "2px 6px" }}
          onClick={(e) => { e.stopPropagation(); onMove(-1); }}>↑</button>
        <button aria-label="ниже" title="ниже" style={{ ...btn(false), padding: "2px 6px" }}
          onClick={(e) => { e.stopPropagation(); onMove(1); }}>↓</button>
        <button aria-label="удалить строку" title="удалить строку"
          style={{ ...btn(false), padding: "2px 6px", color: BAD }}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}>✕</button>
      </div>
    </div>);
}

/* ─────── конструктор целиком ─────── */

export default function HypothesisBuilder({ entities, traits, kindOf, hypos, setHypos,
  onApply }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState([]);
  const [activeLine, setActiveLine] = useState(null);
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(null);
  const [openEnt, setOpenEnt] = useState(null);
  const dragged = useRef(null);

  const gaps = useMemo(() => (lines.length ? exprGaps(lines, traits, entities) : []),
    [lines, traits, entities]);
  const ready = lines.length > 0 && !gaps.length;
  const prog = useMemo(() => readProgram(lines, { entities, traits }),
    [lines, entities, traits]);

  const li = lines.findIndex((l) => l.id === activeLine);
  const cur = li >= 0 ? lines[li] : null;
  const selTok = cur ? cur.tokens.find((t) => t.id === sel) : null;
  const selIdx = cur && selTok ? cur.tokens.indexOf(selTok) : -1;
  // Имя элемента — от ближайшего «для» выше по программе.
  const elemName = useMemo(() => {
    for (let k = (li < 0 ? lines.length : li); k >= 0; k--) {
      if (lines[k]?.op === "for") return lines[k].elem || "element";
    }
    return "element";
  }, [lines, li]);

  const patchLine = (id, p) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const addLine = (op) => {
    const l = newLine(op);
    setLines((ls) => {
      const at = li >= 0 ? li + 1 : ls.length;
      return [...ls.slice(0, at), l, ...ls.slice(at)];
    });
    setActiveLine(l.id); setCaret(0); setSel(null);
  };
  const delLine = (id) => {
    setLines((ls) => ls.filter((l) => l.id !== id));
    if (activeLine === id) { setActiveLine(null); setSel(null); }
  };
  const moveLine = (id, dir) => setLines((ls) => {
    const i = ls.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ls.length) return ls;
    const n = [...ls]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const cycleOp = (id) => setLines((ls) => ls.map((l) => {
    if (l.id !== id) return l;
    const i = OPS.findIndex((o) => o.id === l.op);
    const next = OPS[(i + 1) % OPS.length];
    return { ...l, op: next.id, elem: next.id === "for" ? (l.elem || "element") : l.elem };
  }));

  const insert = (tok, at = caret) => {
    // Элементу нужна строка: без оператора в начале строки не бывает.
    let target = activeLine;
    if (!target) { const l = newLine("then"); setLines((ls) => [...ls, l]); target = l.id;
      setActiveLine(l.id); at = 0; }
    setLines((ls) => ls.map((l) => (l.id !== target ? l
      : { ...l, tokens: [...l.tokens.slice(0, at), tok, ...l.tokens.slice(at)] })));
    setCaret(at + 1);
    setSel(tok.kind === "text" ? null : tok.id);
  };
  const patchTok = (id, p) => setLines((ls) => ls.map((l) => (l.id !== activeLine ? l
    : { ...l, tokens: l.tokens.map((t) => (t.id === id ? { ...t, ...p } : t)) })));
  const delTok = (id) => {
    setLines((ls) => ls.map((l) => (l.id !== activeLine ? l
      : { ...l, tokens: l.tokens.filter((t) => t.id !== id) })));
    setSel(null);
  };

  const startDrag = (make) => (e) => {
    dragged.current = make;
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", "hypo-token");
  };
  const Pal = ({ make, color, title, children, onLine }) => (
    <button draggable={!onLine} onDragStart={onLine ? undefined : startDrag(make)}
      onDragEnd={() => { dragged.current = null; }}
      title={title} onClick={() => (onLine ? onLine() : insert(make()))}
      style={{ ...btn(false), borderColor: color + "66", color,
        cursor: onLine ? "pointer" : "grab" }}>
      {children}</button>);

  const reset = () => { setLines([]); setActiveLine(null); setCaret(0); setSel(null); };
  const applyNow = () => {
    if (!ready) return;
    exprToEdges(lines, traits, entities).forEach(onApply);
    reset(); setOpen(false);
  };
  const keep = () => {
    setHypos((p) => [...p, { id: "h" + Date.now().toString(36), lines }]);
    reset(); setOpen(false);
  };

  return (
    <div style={{ ...S.card, marginBottom: 10 }}>
      <div className="flex items-center gap-2">
        <span style={S.lbl}>гипотезы</span>
        <span style={{ flex: 1 }} />
        <button style={btn(open)} onClick={() => setOpen((v) => !v)}>
          {open ? "свернуть" : "+ составить гипотезу"}</button>
      </div>

      {!open && !hypos.length && (
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
          Гипотеза пишется строками: каждая начинается с оператора —
          «если», «то», «пока», «для» — и дальше набирается из палитры.
        </div>)}

      {open && (
        <div style={{ marginTop: 8 }}>
          <div style={S.lbl}>программа</div>
          <div role="group" aria-label="строки гипотезы"
            style={{ margin: "5px 0 6px", padding: 5, background: C.ink,
              border: `1px solid ${C.line}`, borderRadius: 8 }}>
            {!lines.length && (
              <div style={{ fontSize: 11.5, color: C.muted, padding: 6 }}>
                Пусто. Начните строкой: «если», «то», «пока», «для».</div>)}
            {lines.map((l) => (
              <Line key={l.id} line={l} active={l.id === activeLine} caret={caret}
                traits={traits} entities={entities} elemName={elemName}
                sel={l.id === activeLine ? sel : null}
                onFocus={() => { if (activeLine !== l.id) { setActiveLine(l.id);
                  setSel(null); setCaret(l.tokens.length); } }}
                onCaret={setCaret} onPick={(id) => setSel((s) => (s === id ? null : id))}
                onText={(id, v) => patchTok(id, { text: v })}
                onDrop={(_e, at) => { if (!dragged.current) return;
                  setActiveLine(l.id); insert(dragged.current(), at); dragged.current = null; }}
                onOp={() => cycleOp(l.id)}
                onElem={(v) => patchLine(l.id, { elem: v })}
                onDelete={() => delLine(l.id)}
                onMove={(d) => moveLine(l.id, d)} />))}
          </div>

          <div style={S.lbl}>добавить строку</div>
          <div className="flex flex-wrap gap-2" style={{ margin: "5px 0 8px" }}>
            {OPS.map((o) => (
              <Pal key={o.id} color={OP_COLOR[o.id] || ACC} title={o.hint}
                onLine={() => addLine(o.id)}>{o.name}</Pal>))}
          </div>
          <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
            Строка встанет под текущей. Оператор строки меняется нажатием на
            него. Элементы из палитры ниже кладутся туда, где курсор (синяя
            черта), или перетаскиванием.
          </div>

          <div style={S.lbl}>ресурсы по активам</div>
          <div style={{ margin: "5px 0 8px" }}>
            {!traits.length && <span style={{ fontSize: 11, color: C.muted }}>
              Ресурсов ещё нет — заведи их выше, на схеме.</span>}
            {entities.map((en) => {
              const own = traits.filter((t) => t.e === en.id);
              const on = openEnt === en.id;
              return (
                <div key={en.id} style={{ marginBottom: 4 }}>
                  {/* Ресурсы под спойлером актива: при десятке активов
                      сплошной список кнопок длиннее самой программы. */}
                  <button onClick={() => setOpenEnt(on ? null : en.id)}
                    style={{ ...btn(on), borderColor: en.color || C.line,
                      color: on ? C.ink : (en.color || C.text),
                      background: on ? (en.color || ACC) : C.panel2, width: "100%",
                      textAlign: "left" }}>
                    {on ? "▾" : "▸"} {en.name}
                    <span style={{ opacity: 0.7 }}> · {own.length}</span>
                  </button>
                  {on && (
                    <div className="flex flex-wrap gap-2" style={{ padding: "6px 0 2px 10px" }}>
                      {!own.length && <span style={{ fontSize: 11, color: C.muted }}>
                        У этого актива нет ресурсов.</span>}
                      {own.map((t) => (
                        <Pal key={t.id} color={kindOf(t.k).color} title={unitOf(t)}
                          make={() => newToken("res", { trait: t.id })}>
                          {kindOf(t.k).sign} {t.l}</Pal>))}
                      <Pal color={ACC} title={`актив «${en.name}» — для строки «для»`}
                        make={() => newToken("ent", { entity: en.id })}>
                        «{en.name}»</Pal>
                    </div>)}
                </div>);})}
          </div>

          <div style={S.lbl}>движение, элемент цикла, сравнения и числа</div>
          <div className="flex flex-wrap gap-2" style={{ margin: "5px 0 8px" }}>
            <Pal color={OK} make={() => newToken("arrow")}
              title="стрелка между соседними элементами строки">→ стрелка</Pal>
            <Pal color="#FF9E64" make={() => newToken("elem")}
              title="значение текущего элемента цикла «для»">значение {elemName}</Pal>
            {[">", "<", "≥", "≤", "=", "≠", "+", "−", "*", "/", "(", ")"].map((c) => (
              <Pal key={c} color={C.muted}
                make={() => newToken("text", { text: c === "−" ? "-" : c })}>{c}</Pal>))}
            <Pal color={ACC} make={() => newToken("text", { text: "" })}
              title="пустое поле — впиши число">123 число</Pal>
          </div>

          {selTok && (
            <div style={{ background: C.panel2, border: `1px solid ${ACC}66`,
              borderRadius: 8, padding: 9, marginBottom: 8 }}>
              {selTok.kind === "res" && (
                <ResParams tok={selTok} traits={traits} entities={entities} kindOf={kindOf}
                  onChange={(p) => patchTok(selTok.id, p)} onDelete={() => delTok(selTok.id)} />)}
              {selTok.kind === "ent" && (
                <EntParams tok={selTok} entities={entities}
                  onChange={(p) => patchTok(selTok.id, p)} onDelete={() => delTok(selTok.id)} />)}
              {selTok.kind === "elem" && (
                <div>
                  <div style={S.lbl}>значение элемента цикла</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
                    Подставляет ресурс, на котором сейчас идёт цикл «для».
                    Вне цикла подставлять нечего.
                  </div>
                  <button style={{ ...btn(false), marginTop: 8, color: BAD,
                    borderColor: "#5A2436" }}
                    onClick={() => delTok(selTok.id)}>Убрать из строки</button>
                </div>)}
              {selTok.kind === "arrow" && (
                <ArrowParams tok={selTok} ends={arrowEnds(cur.tokens, selIdx)} traits={traits}
                  elemName={elemName}
                  onChange={(p) => patchTok(selTok.id, p)} onDelete={() => delTok(selTok.id)} />)}
            </div>)}

          <div style={{ background: C.ink, border: `1px solid ${C.line}`,
            borderRadius: 6, padding: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 11.5, lineHeight: 1.6, whiteSpace: "pre-wrap",
              fontFamily: "ui-monospace, Menlo, monospace",
              color: lines.length ? C.text : C.muted }}>
              {lines.length ? exprText(lines, traits, entities) : "программа пустая"}</div>
            {!!gaps.length && (
              <div style={{ fontSize: 11, color: WARN, marginTop: 6, lineHeight: 1.5 }}>
                Разложить нельзя: {gaps.join("; ")}.</div>)}
            {ready && (
              <div style={{ fontSize: 11, color: OK, marginTop: 6, lineHeight: 1.5 }}>
                {prog.steps.filter((s) => !s.dead && s.arrows.length).map((s, i) => (
                  <div key={i}>
                    {s.arrows.length} движ. {s.conds.length
                      ? `при ${s.conds.map((c) => condShown(c, traits)).join(" и ")}`
                      : "без условий"}
                  </div>))}
              </div>)}
          </div>

          <div className="flex flex-wrap gap-2">
            <button style={btn(true)} disabled={!ready} onClick={applyNow}>
              Разложить в движения</button>
            <button style={btn(false)} disabled={!lines.length} onClick={keep}>
              Отложить черновиком</button>
            <span style={{ flex: 1 }} />
            <button style={btn(false)} onClick={() => { reset(); setOpen(false); }}>
              Отмена</button>
          </div>
        </div>)}

      {!!hypos.length && (
        <div style={{ marginTop: 9 }}>
          <div style={S.lbl}>отложенные гипотезы — на расчёт не влияют</div>
          {hypos.map((hy) => {
            const hl = hy.lines || [];
            const gp = hl.length ? exprGaps(hl, traits, entities) : ["пустая программа"];
            return (
              <div key={hy.id} style={{ background: C.panel2,
                border: `1px solid ${C.line}`, borderRadius: 8, padding: 8, marginTop: 6 }}>
                <div style={{ fontSize: 11, lineHeight: 1.6, whiteSpace: "pre-wrap",
                  fontFamily: "ui-monospace, Menlo, monospace" }}>
                  {hl.length ? exprText(hl, traits, entities) : "пустая программа"}</div>
                <div className="flex flex-wrap gap-2"
                  style={{ marginTop: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 10.5, flex: "1 1 160px",
                    color: gp.length ? BAD : C.muted }}>
                    {gp.length ? `разложить нельзя: ${gp.join("; ")}` : "готова — можно раскладывать"}</span>
                  <button style={btn(false)} disabled={!!gp.length}
                    onClick={() => {
                      exprToEdges(hl, traits, entities).forEach(onApply);
                      setHypos((p) => p.filter((x) => x.id !== hy.id));
                    }}>Разложить</button>
                  <button style={btn(false)}
                    onClick={() => { setLines(hl); setActiveLine(null); setSel(null);
                      setOpen(true); setHypos((p) => p.filter((x) => x.id !== hy.id)); }}>
                    Править</button>
                  <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
                    onClick={() => setHypos((p) => p.filter((x) => x.id !== hy.id))}>✕</button>
                </div>
              </div>);})}
        </div>)}
    </div>);
}
