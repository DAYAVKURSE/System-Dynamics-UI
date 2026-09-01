import React, { useMemo, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, nm, NumField, TxtField } from "./ui.jsx";
import { PER, unitOf, isFlow } from "../lib/sim.js";

/* ════════════════════════════════════════════════════════════════
   ГИПОТЕЗЫ · составление и применение

   Стрелка в модели — это уже разложенная гипотеза: у неё есть источник,
   приёмник, интенсивность, периодичность и условия. Но заводилась она
   наизнанку: сначала пустая стрелка «от актива», потом в её карточке по
   одному дописывались недостающие поля, и до последнего клика в модели
   жила стрелка, которая ничего не переносит.

   Здесь гипотеза сначала формулируется целиком — «актив А тратит ресурс Х,
   и это даёт активу Б столько-то ресурса Y за период» — и только потом
   раскладывается в конкретное движение. До применения гипотеза лежит
   черновиком: на расчёт не влияет, но не теряется.
   ════════════════════════════════════════════════════════════════ */

export const newHypo = (from) => ({
  id: "h" + Date.now() + Math.random().toString(36).slice(2, 6),
  from: from || "", fromTrait: "", to: "", toTrait: "",
  gives: 0, per: "мес", sign: 1, basis: "hypo", carrier: "", note: "",
});

/** Чего гипотезе не хватает, чтобы стать движением. Пустой массив — готова. */
export function hypoGaps(h, traits) {
  const gaps = [];
  const target = traits.find((t) => t.id === h.toTrait);
  if (!h.from) gaps.push("не выбран актив-источник");
  if (!h.to) gaps.push("не выбран актив-приёмник");
  if (!h.toTrait) gaps.push("не выбран ресурс, который пополняется");
  else if (target && h.to && target.e !== h.to) gaps.push("ресурс не из выбранного актива");
  if (h.fromTrait && h.fromTrait === h.toTrait) gaps.push("ресурс не может течь сам в себя");
  if (!(Math.abs(Number(h.gives)) > 0)) gaps.push("не указано, сколько переносится");
  return gaps;
}

/** Раскладывает гипотезу в движение — ровно те поля, что есть у стрелки. */
export function hypoToEdge(h) {
  return {
    id: "e" + Date.now() + Math.random().toString(36).slice(2, 6),
    from: h.from, to: h.toTrait, fromTrait: h.fromTrait || null,
    carrier: h.carrier || "", gives: Math.abs(Number(h.gives)) || 0,
    per: h.per || "мес", sign: Number(h.sign) < 0 ? -1 : 1,
    conds: [], note: h.note || "", basis: h.basis === "fact" ? "fact" : "hypo",
  };
}

/** Гипотеза словами — та же фраза и в конструкторе, и в списке черновиков. */
export function hypoSentence(h, traits, entities) {
  const en = (id) => entities.find((e) => e.id === id)?.name;
  const tr = (id) => traits.find((t) => t.id === id);
  const target = tr(h.toTrait), src = tr(h.fromTrait);
  const amount = Math.abs(Number(h.gives)) || 0;
  const unit = target ? String(unitOf(target)).split("/")[0] : "единиц";
  const verb = Number(h.sign) < 0 ? "убирает" : "приносит";
  const cost = src
    ? `тратит «${src.l}»`
    : "ничего не тратит (величина приходит извне модели)";
  return `«${en(h.from) || "актив"}» ${cost} — и это ${verb} `
    + `${nm(amount)} ${unit} в «${target ? target.l : "ресурс"}» `
    + `актива «${en(h.to) || "актив"}», раз в ${h.per}.`;
}

export default function HypothesisBuilder({ entities, traits, kindOf, hypos, setHypos,
  onApply, defaultFrom }) {
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(() => newHypo(defaultFrom));
  const up = (patch) => setH((p) => ({ ...p, ...patch }));

  const target = traits.find((t) => t.id === h.toTrait);
  const gaps = useMemo(() => hypoGaps(h, traits), [h, traits]);
  const ready = !gaps.length;
  // Ресурсы источника: тратить актив может только своё.
  const srcTraits = traits.filter((t) => t.e === h.from);
  const dstTraits = traits.filter((t) => t.e === h.to);
  const perN = PER[h.per] ?? 1;

  const apply = (hy) => { onApply(hypoToEdge(hy)); };
  const applyDraft = () => {
    if (!ready) return;
    apply(h);
    setH(newHypo(h.from));
    setOpen(false);
  };
  const keepDraft = () => {
    setHypos((p) => [...p, { ...h }]);
    setH(newHypo(h.from));
    setOpen(false);
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
          Гипотеза — это предположение вида «если актив тратит вот это, то вон
          там прибавится вот столько». Составь её целиком одной формой, и она
          разложится в стрелку на схеме.
        </div>)}

      {open && (
        <div style={{ background: C.panel2, border: `1px solid ${C.line}`,
          borderRadius: 8, padding: 9, marginTop: 8 }}>
          <div style={S.lbl}>откуда — актив и его ресурс</div>
          <div className="flex flex-wrap gap-2" style={{ margin: "5px 0 9px" }}>
            <select style={{ ...S.inp, flex: "1 1 150px" }} value={h.from}
              onChange={(e) => up({ from: e.target.value, fromTrait: "" })}>
              <option value="">— актив-источник —</option>
              {entities.map((en) => (
                <option key={en.id} value={en.id}>{en.name}</option>))}
            </select>
            <select style={{ ...S.inp, flex: "1 1 150px" }} value={h.fromTrait}
              disabled={!h.from}
              onChange={(e) => up({ fromTrait: e.target.value })}>
              <option value="">— ниоткуда: величина появляется —</option>
              {srcTraits.map((t) => (
                <option key={t.id} value={t.id}>
                  {kindOf(t.k).sign} {t.l} · {unitOf(t)}</option>))}
            </select>
          </div>

          <div style={S.lbl}>куда — актив и его ресурс</div>
          <div className="flex flex-wrap gap-2" style={{ margin: "5px 0 9px" }}>
            <select style={{ ...S.inp, flex: "1 1 150px" }} value={h.to}
              onChange={(e) => up({ to: e.target.value, toTrait: "" })}>
              <option value="">— актив-приёмник —</option>
              {entities.map((en) => (
                <option key={en.id} value={en.id}>{en.name}</option>))}
            </select>
            <select style={{ ...S.inp, flex: "1 1 150px" }} value={h.toTrait}
              disabled={!h.to}
              onChange={(e) => up({ toTrait: e.target.value })}>
              <option value="">— ресурс, который пополняется —</option>
              {dstTraits.map((t) => (
                <option key={t.id} value={t.id}>
                  {kindOf(t.k).sign} {t.l} · {unitOf(t)}</option>))}
            </select>
          </div>

          <div style={S.lbl}>сколько и как часто</div>
          <div className="flex flex-wrap gap-2"
            style={{ margin: "5px 0 4px", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: C.muted }}>за попытку</span>
            <NumField value={h.gives} style={{ flex: "0 1 90px" }}
              onCommit={(v) => up({ gives: v ?? 0 })} />
            <span style={{ fontSize: 12, color: C.muted }}>
              {target ? String(unitOf(target)).split("/")[0] : "единиц"}, попытка каждый</span>
            <select style={{ ...S.inp, flex: "0 1 96px" }} value={h.per}
              onChange={(e) => up({ per: e.target.value })}>
              {Object.keys(PER).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button style={btn(true, Number(h.sign) > 0 ? OK : BAD)}
              onClick={() => up({ sign: Number(h.sign) > 0 ? -1 : 1 })}>
              {Number(h.sign) > 0 ? "катализирует" : "купирует"}</button>
          </div>
          <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 9, lineHeight: 1.5 }}>
            {perN !== 1
              ? `За месяц это ${nm(perN)} попыток — до ${nm(Math.abs(Number(h.gives) || 0) * perN)} ${target ? String(unitOf(target)).split("/")[0] : "единиц"} в месяц, если источник потянет.`
              : "Одна попытка в месяц."}
          </div>

          <div className="flex flex-wrap gap-2" style={{ marginBottom: 9, alignItems: "center" }}>
            <button style={btn(true, h.basis === "fact" ? OK : WARN)}
              onClick={() => up({ basis: h.basis === "fact" ? "hypo" : "fact" })}>
              {h.basis === "fact" ? "◆ факт" : "◇ гипотеза"}</button>
            <span style={{ fontSize: 11, color: C.muted, flex: "1 1 180px" }}>
              {h.basis === "fact"
                ? "точный расчёт — не зависит от поведения людей"
                : "предположение о поведении — может не сбыться"}</span>
          </div>

          <div style={S.lbl}>как назвать движение</div>
          <TxtField value={h.carrier} placeholder="например: звонки рефералам"
            style={{ marginBottom: 9 }} onCommit={(v) => up({ carrier: v })} />

          <div style={{ background: C.ink, border: `1px solid ${C.line}`,
            borderRadius: 6, padding: 8, marginBottom: 9 }}>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: ready ? C.text : C.muted }}>
              {hypoSentence(h, traits, entities)}</div>
            {!ready && (
              <div style={{ fontSize: 11, color: WARN, marginTop: 5, lineHeight: 1.5 }}>
                Чтобы разложить в движение, не хватает: {gaps.join("; ")}.</div>)}
            {ready && (
              <div style={{ fontSize: 11, color: OK, marginTop: 5, lineHeight: 1.5 }}>
                Разложится в стрелку «{entities.find((e) => e.id === h.from)?.name}» →
                «{target?.l}». Условия переноса задаются потом, в карточке стрелки.</div>)}
          </div>

          <div className="flex flex-wrap gap-2">
            <button style={btn(true)} disabled={!ready} onClick={applyDraft}>
              Разложить в движение</button>
            <button style={btn(false)} disabled={!ready} onClick={keepDraft}>
              Отложить черновиком</button>
            <span style={{ flex: 1 }} />
            <button style={btn(false)}
              onClick={() => { setH(newHypo(h.from)); setOpen(false); }}>Отмена</button>
          </div>
        </div>)}

      {!!hypos.length && (
        <div style={{ marginTop: 9 }}>
          <div style={S.lbl}>отложенные гипотезы — на расчёт не влияют</div>
          {hypos.map((hy) => {
            const gp = hypoGaps(hy, traits);
            return (
              <div key={hy.id} style={{ background: C.panel2,
                border: `1px solid ${C.line}`, borderRadius: 8,
                padding: 8, marginTop: 6 }}>
                <div style={{ fontSize: 11.5, lineHeight: 1.6 }}>
                  <span style={{ color: hy.basis === "fact" ? OK : WARN }}>
                    {hy.basis === "fact" ? "◆ " : "◇ "}</span>
                  {hy.carrier ? <b>{hy.carrier}: </b> : null}
                  {hypoSentence(hy, traits, entities)}
                </div>
                <div className="flex flex-wrap gap-2" style={{ marginTop: 6,
                  alignItems: "center" }}>
                  {gp.length
                    ? <span style={{ fontSize: 10.5, color: BAD, flex: "1 1 160px" }}>
                        разложить нельзя: {gp.join("; ")}</span>
                    : <span style={{ fontSize: 10.5, color: C.muted, flex: "1 1 160px" }}>
                        готова — можно разложить в движение</span>}
                  <button style={btn(false)} disabled={!!gp.length}
                    onClick={() => { apply(hy);
                      setHypos((p) => p.filter((x) => x.id !== hy.id)); }}>
                    Разложить</button>
                  <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
                    onClick={() => setHypos((p) => p.filter((x) => x.id !== hy.id))}>
                    ✕</button>
                </div>
              </div>);})}
        </div>)}
    </div>);
}
