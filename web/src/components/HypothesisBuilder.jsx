import React, { useMemo, useRef, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, nm, NumField, TxtField } from "./ui.jsx";
import { PER, unitOf } from "../lib/sim.js";
import {
  OPS, REPEAT_WHEN, arrowEnds, condShown, exprGaps, exprText, exprToEdges,
  newToken, readExpr,
} from "../lib/hexpr.js";

/* ════════════════════════════════════════════════════════════════
   ГИПОТЕЗЫ · одно поле, палитра под ним

   Поле одно, но набирается не буквами: элементы кладутся из палитры под
   ним — щелчком в позицию курсора или перетаскиванием в нужное место.
   Щелчок по уже вставленному элементу открывает его параметры: у ресурса
   это какой именно ресурс, у стрелки — восемь полей исполнения, которые в
   строку текста не помещаются.

   Раскладывается всё в обычные стрелки модели — см. lib/hexpr.js.
   ════════════════════════════════════════════════════════════════ */

const chip = (bg, col) => ({
  display: "inline-flex", alignItems: "center", gap: 4,
  background: bg, border: `1px solid ${col}66`, color: col,
  borderRadius: 6, padding: "3px 7px", fontSize: 12, cursor: "pointer",
  whiteSpace: "nowrap", userSelect: "none",
});

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
        В выражение подставится текущее значение этого ресурса. Если он стоит
        слева от стрелки — он же и тратится на движение.
      </div>
      <button style={{ ...btn(false), marginTop: 8, color: BAD, borderColor: "#5A2436" }}
        onClick={onDelete}>Убрать из выражения</button>
    </div>);
}

function OpParams({ tok, onChange, onDelete }) {
  const info = OPS.find((o) => o.id === tok.op);
  return (
    <div>
      <div style={S.lbl}>оператор</div>
      <div className="flex flex-wrap gap-2" style={{ margin: "5px 0 6px" }}>
        {OPS.map((o) => (
          <button key={o.id} style={btn(tok.op === o.id)}
            onClick={() => onChange({ op: o.id })}>{o.name}</button>))}
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>{info?.hint}</div>
      {tok.op === "for" && (
        <div className="flex flex-wrap gap-2"
          style={{ alignItems: "center", marginTop: 8 }}>
          <span style={{ fontSize: 12, color: C.muted }}>сколько раз</span>
          <NumField value={tok.times} style={{ flex: "0 1 80px" }}
            onCommit={(v) => onChange({ times: Math.max(1, Math.round(v || 1)) })} />
          <span style={{ fontSize: 10.5, color: C.muted, flex: "1 1 140px" }}>
            столько же копий задачи появится в списке</span>
        </div>)}
      <button style={{ ...btn(false), marginTop: 8, color: BAD, borderColor: "#5A2436" }}
        onClick={onDelete}>Убрать из выражения</button>
    </div>);
}

export function ArrowParams({ tok, ends, traits, onChange, onDelete }) {
  const src = traits.find((t) => t.id === ends.from);
  const dst = traits.find((t) => t.id === ends.to);
  const unit = dst ? String(unitOf(dst)).split("/")[0] : "единиц";
  const perN = PER[tok.per] ?? 1;
  return (
    <div>
      <div style={S.lbl}>движение{dst ? ` в «${dst.l}»` : ""}</div>
      <div style={{ fontSize: 11, color: C.muted, margin: "4px 0 8px", lineHeight: 1.5 }}>
        {src ? `Тратит «${src.l}».` : "Ничего не тратит: величина приходит извне модели."}
        {" "}Концы стрелки — это соседние ресурсы в выражении; чтобы поменять
        их, переставь ресурсы, а не стрелку.
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
          Следующий раз откроется, когда отчёт по предыдущему разу принят —
          задача уходит на проверку, а не сразу в «Готово».
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
        onClick={onDelete}>Убрать из выражения</button>
    </div>);
}

/* ─────── поле выражения ─────── */

function Field({ tokens, caret, setCaret, sel, setSel, traits, kindOf, onDrop, onText }) {
  const nameOf = (id) => traits.find((t) => t.id === id)?.l;
  const [over, setOver] = useState(null);
  // Щель между элементами: и место курсора, и мишень для перетаскивания.
  const Gap = ({ at }) => (
    <span
      onClick={() => { setCaret(at); setSel(null); }}
      onDragOver={(e) => { e.preventDefault(); setOver(at); }}
      onDragLeave={() => setOver((o) => (o === at ? null : o))}
      onDrop={(e) => { e.preventDefault(); setOver(null); onDrop(e, at); }}
      title="сюда встанет следующий элемент"
      style={{
        display: "inline-block", width: over === at ? 14 : 8, alignSelf: "stretch",
        minHeight: 24, cursor: "text", borderRadius: 3,
        background: over === at ? ACC : (caret === at ? ACC + "cc" : "transparent"),
        borderLeft: caret === at && over !== at ? `2px solid ${ACC}` : "2px solid transparent",
      }} />);

  return (
    <div className="flex flex-wrap" role="group" aria-label="выражение гипотезы"
      style={{
      alignItems: "center", gap: 2, minHeight: 46, padding: 6,
      background: C.ink, border: `1px solid ${caret != null ? ACC + "88" : C.line}`,
      borderRadius: 8, lineHeight: 1.8,
    }}>
      <Gap at={0} />
      {tokens.map((t, i) => {
        const on = sel === t.id;
        const pick = () => { setSel(on ? null : t.id); setCaret(i + 1); };
        let body = null;
        if (t.kind === "res") {
          const n = nameOf(t.trait);
          body = (
            <span key={t.id} onClick={pick}
              style={{ ...chip(C.panel2, n ? ACC : WARN), outline: on ? `2px solid ${ACC}` : "none" }}>
              {n ? `[${n}]` : "[ресурс?]"}</span>);
        } else if (t.kind === "op") {
          const o = OPS.find((x) => x.id === t.op);
          body = (
            <span key={t.id} onClick={pick}
              style={{ ...chip(C.panel2, "#C792EA"), fontWeight: 700,
                outline: on ? `2px solid ${ACC}` : "none" }}>
              {t.op === "for" ? `повторить ${t.times}×` : (o?.name || t.op)}</span>);
        } else if (t.kind === "arrow") {
          const ends = arrowEnds(tokens, i);
          const ok = !!ends.to && Math.abs(Number(t.gives)) > 0;
          body = (
            <span key={t.id} onClick={pick}
              style={{ ...chip(C.panel2, ok ? OK : WARN), fontWeight: 700,
                outline: on ? `2px solid ${ACC}` : "none" }}>
              →{Math.abs(Number(t.gives)) > 0 ? ` ${nm(Math.abs(Number(t.gives)))}` : ""}
              {Number(t.threads) > 1 ? ` ×${t.threads}` : ""}</span>);
        } else {
          body = (
            <input key={t.id} value={t.text} placeholder="…"
              onChange={(e) => onText(t.id, e.target.value)}
              onFocus={() => { setSel(null); setCaret(i + 1); }}
              style={{
                width: `${Math.max(2, (t.text || "").length + 1)}ch`,
                background: "transparent", border: "none", outline: "none",
                color: C.text, fontSize: 12.5, fontFamily: "ui-monospace, monospace",
                padding: "3px 2px",
              }} />);
        }
        return (<React.Fragment key={t.id}>{body}<Gap at={i + 1} /></React.Fragment>);
      })}
      {!tokens.length && (
        <span style={{ fontSize: 11.5, color: C.muted }}>
          пусто — возьми элемент из палитры ниже</span>)}
    </div>);
}

/* ─────── конструктор целиком ─────── */

export default function HypothesisBuilder({ entities, traits, kindOf, hypos, setHypos,
  onApply }) {
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState([]);
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(null);
  const dragged = useRef(null);

  const gaps = useMemo(() => exprGaps(tokens, traits), [tokens, traits]);
  const ready = tokens.length > 0 && !gaps.length;
  const parts = useMemo(() => readExpr(tokens), [tokens]);
  const selTok = tokens.find((t) => t.id === sel) || null;
  const selIdx = tokens.findIndex((t) => t.id === sel);

  const insert = (tok, at = caret) => {
    setTokens((p) => [...p.slice(0, at), tok, ...p.slice(at)]);
    setCaret(at + 1);
    // Только что вставленный элемент сразу открыт: у ресурса и стрелки без
    // параметров всё равно нет смысла, а искать их вторым щелчком — лишнее.
    setSel(tok.kind === "text" ? null : tok.id);
  };
  const patch = (id, p) => setTokens((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const remove = (id) => {
    setTokens((ts) => ts.filter((t) => t.id !== id));
    setSel(null);
  };

  const startDrag = (make) => (e) => {
    dragged.current = make;
    e.dataTransfer.effectAllowed = "copy";
    // Без данных Safari отменяет перетаскивание ещё до dragover.
    e.dataTransfer.setData("text/plain", "hypo-token");
  };
  const dropAt = (_e, at) => {
    if (!dragged.current) return;
    insert(dragged.current(), at);
    dragged.current = null;
  };

  // Кнопка палитры: щелчок кладёт в позицию курсора, перетаскивание — куда бросили.
  const Pal = ({ make, color, title, children }) => (
    <button draggable onDragStart={startDrag(make)} onDragEnd={() => { dragged.current = null; }}
      title={title} onClick={() => insert(make())}
      style={{ ...btn(false), borderColor: color + "66", color, cursor: "grab" }}>
      {children}</button>);

  const reset = () => { setTokens([]); setCaret(0); setSel(null); };
  const applyNow = () => {
    if (!ready) return;
    exprToEdges(tokens, traits).forEach(onApply);
    reset(); setOpen(false);
  };
  const keep = () => {
    setHypos((p) => [...p, { id: "h" + Date.now().toString(36), tokens }]);
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
          Гипотеза пишется одним выражением: ресурсы, условия и стрелки-движения
          между ресурсами. Раскладывается в стрелки на схеме.
        </div>)}

      {open && (
        <div style={{ marginTop: 8 }}>
          <div style={S.lbl}>выражение</div>
          <div style={{ margin: "5px 0 6px" }}>
            <Field tokens={tokens} caret={caret} setCaret={setCaret} sel={sel} setSel={setSel}
              traits={traits} kindOf={kindOf} onDrop={dropAt}
              onText={(id, v) => patch(id, { text: v })} />
          </div>
          <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
            Нажми на элемент палитры — он встанет туда, где курсор (синяя
            черта). Или перетащи его в нужное место. Щелчок по уже
            поставленному элементу открывает его параметры.
          </div>

          <div style={S.lbl}>ресурсы</div>
          <div className="flex flex-wrap gap-2" style={{ margin: "5px 0 8px" }}>
            {!traits.length && <span style={{ fontSize: 11, color: C.muted }}>
              Ресурсов ещё нет — заведи их выше, на схеме.</span>}
            {entities.map((en) => traits.filter((t) => t.e === en.id).map((t) => (
              <Pal key={t.id} color={kindOf(t.k).color} title={`${en.name} · ${unitOf(t)}`}
                make={() => newToken("res", { trait: t.id })}>
                {kindOf(t.k).sign} {t.l}</Pal>)))}
          </div>

          <div style={S.lbl}>движение</div>
          <div className="flex flex-wrap gap-2" style={{ margin: "5px 0 8px" }}>
            <Pal color={OK} make={() => newToken("arrow")}
              title="стрелка между соседними ресурсами">→ стрелка</Pal>
          </div>

          <div style={S.lbl}>операторы</div>
          <div className="flex flex-wrap gap-2" style={{ margin: "5px 0 8px" }}>
            {OPS.map((o) => (
              <Pal key={o.id} color="#C792EA" title={o.hint}
                make={() => newToken("op", { op: o.id })}>{o.name}</Pal>))}
          </div>

          <div style={S.lbl}>сравнения, числа и скобки</div>
          <div className="flex flex-wrap gap-2" style={{ margin: "5px 0 8px" }}>
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
                  onChange={(p) => patch(selTok.id, p)} onDelete={() => remove(selTok.id)} />)}
              {selTok.kind === "op" && (
                <OpParams tok={selTok} onChange={(p) => patch(selTok.id, p)}
                  onDelete={() => remove(selTok.id)} />)}
              {selTok.kind === "arrow" && (
                <ArrowParams tok={selTok} ends={arrowEnds(tokens, selIdx)} traits={traits}
                  onChange={(p) => patch(selTok.id, p)} onDelete={() => remove(selTok.id)} />)}
            </div>)}

          <div style={{ background: C.ink, border: `1px solid ${C.line}`,
            borderRadius: 6, padding: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: tokens.length ? C.text : C.muted }}>
              {tokens.length ? exprText(tokens, traits) : "выражение пустое"}</div>
            {!!gaps.length && (
              <div style={{ fontSize: 11, color: WARN, marginTop: 5, lineHeight: 1.5 }}>
                Разложить нельзя: {gaps.join("; ")}.</div>)}
            {ready && (
              <div style={{ fontSize: 11, color: OK, marginTop: 5, lineHeight: 1.5 }}>
                {parts.map((p, i) => (
                  <div key={i}>
                    {p.arrows.length} движ. {p.cond
                      ? `при условии ${condShown(p.cond, traits)}`
                      : "без условий"}
                    {p.times > 1 ? ` · повторов: ${p.times}` : ""}
                  </div>))}
              </div>)}
          </div>

          <div className="flex flex-wrap gap-2">
            <button style={btn(true)} disabled={!ready} onClick={applyNow}>
              Разложить в движения</button>
            <button style={btn(false)} disabled={!tokens.length} onClick={keep}>
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
            const gp = exprGaps(hy.tokens, traits);
            return (
              <div key={hy.id} style={{ background: C.panel2,
                border: `1px solid ${C.line}`, borderRadius: 8, padding: 8, marginTop: 6 }}>
                <div style={{ fontSize: 11.5, lineHeight: 1.6 }}>
                  {exprText(hy.tokens, traits) || "пустое выражение"}</div>
                <div className="flex flex-wrap gap-2"
                  style={{ marginTop: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 10.5, flex: "1 1 160px",
                    color: gp.length ? BAD : C.muted }}>
                    {gp.length ? `разложить нельзя: ${gp.join("; ")}` : "готова — можно раскладывать"}</span>
                  <button style={btn(false)} disabled={!!gp.length}
                    onClick={() => {
                      exprToEdges(hy.tokens, traits).forEach(onApply);
                      setHypos((p) => p.filter((x) => x.id !== hy.id));
                    }}>Разложить</button>
                  <button style={btn(false)}
                    onClick={() => { setTokens(hy.tokens); setCaret(hy.tokens.length);
                      setSel(null); setOpen(true);
                      setHypos((p) => p.filter((x) => x.id !== hy.id)); }}>
                    Править</button>
                  <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
                    onClick={() => setHypos((p) => p.filter((x) => x.id !== hy.id))}>✕</button>
                </div>
              </div>);})}
        </div>)}
    </div>);
}
