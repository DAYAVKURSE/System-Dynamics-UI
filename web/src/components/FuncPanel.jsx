import React, { useState } from "react";
import { C, OK, BAD, ACC, WARN, S, btn, nm } from "./ui.jsx";
import { DUR_UNITS, avgHours, checkFlow, checkFunc, fromHours, hoursOf, newFlow, newFunc,
  newGive, rangeText } from "../lib/funcs.js";
import { Mark } from "./Modal.jsx";

/* ════════════════════════════════════════════════════════════════
   ФУНКЦИОНАЛЬНЫЕ ЭЛЕМЕНТЫ АКТИВА · редактор

   Ресурс — то, что есть; функциональный элемент — то, что его
   преобразует. Здесь задаётся его рецепт: какие ресурсы берёт, какие
   выдаёт, в каких количествах и за какое время.

   Выход — это ФУНКЦИЯ элемента, и у каждой свои срок, ответственные и
   проверяющие: один и тот же дизайнер делает и макет, и баннер, но
   сроки у них разные и принимают их разные люди.

   Про цвет времени. Пока функция не выполнялась ни разу, срок показан
   жёлтым: это обещание, а не измерение. Как только появились закрытые
   циклы, рядом встаёт зелёное среднее — то, сколько выходит на самом
   деле. Выдавать план за факт нельзя, поэтому и цвета разные.
   ════════════════════════════════════════════════════════════════ */

const Num = ({ value, onChange, style }) => (
  <input type="number" value={value} onChange={(e) => onChange(e.target.value)}
    style={{ ...S.inp, width: 72, padding: "4px 6px", fontSize: 12, ...style }} />
);

/** Срок функции: план жёлтым, а когда есть факт — зелёное среднее рядом. */
export function Timing({ give, cycles = [] }) {
  const avg = avgHours(cycles);
  const plan = hoursOf(give);
  const as = avg == null ? null : fromHours(avg);
  return (
    <span style={{ fontSize: 11 }}>
      <span style={{ color: WARN }} title="план: столько заложено на одно выполнение">
        {nm(give.dur)} {give.durUnit}</span>
      {as && (
        <span style={{ color: OK }}
          title={`факт: среднее по ${cycles.filter((c) => Number(c) > 0).length} выполнениям`}>
          {" · факт "}{nm(as.dur)} {as.durUnit}
          {plan > 0 && avg > plan ? " (дольше плана)" : ""}</span>)}
    </span>);
}

/** Кто делает и кто принимает — по человеку на нажатие. */
function People({ title, ids, people, nameOf, onToggle }) {
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ ...S.lbl, marginBottom: 3 }}>{title}</div>
      <div className="flex flex-wrap gap-2">
        {people.length === 0 && (
          <span style={{ fontSize: 11, color: C.muted }}>
            людей ещё нет — заведите их во вкладке «Люди и роли»</span>)}
        {people.map((p) => {
          const on = ids.includes(p.id);
          return (
            <button key={p.id} style={{ ...btn(on, on ? ACC : null), fontSize: 11,
              padding: "3px 7px" }} onClick={() => onToggle(p.id)}>
              {nameOf ? nameOf(p.id) : (p.name || p.id)}</button>);
        })}
      </div>
    </div>);
}

export default function FuncPanel({
  entityId, funcs, setFuncs, flows = [], setFlows, traits, people = [], nameOf, cyclesOf,
  onWhy, onWhyFlow,
}) {
  const mine = funcs.filter((f) => f.e === entityId);
  const [open, setOpen] = useState(null);
  const own = traits.filter((t) => t.e === entityId);
  const traitName = (id) => traits.find((t) => t.id === id)?.l || "(ресурс удалён)";

  const up = (id, make) => setFuncs((p) => p.map((f) => (f.id === id ? make(f) : f)));
  const upGive = (id, gid, make) => up(id, (f) => ({
    ...f, gives: f.gives.map((g) => (g.id === gid ? make(g) : g)),
  }));
  const upFlow = (id, patch) => setFlows((p) => p.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  const add = () => {
    const f = newFunc(entityId);
    setFuncs((p) => [...p, f]);
    setOpen(f.id);
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
        <span style={S.lbl}>функциональные элементы</span>
        <span style={{ flex: 1 }} />
        <button style={{ ...btn(false), fontSize: 11, padding: "3px 8px" }} onClick={add}>
          + элемент</button>
      </div>

      {mine.length === 0 && (
        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, marginBottom: 8 }}>
          Элементов пока нет. Функциональный элемент — это то, что преобразует
          ресурсы актива: берёт одни и выдаёт другие, и на это уходит время.
        </div>)}

      {mine.map((f) => {
        const isOpen = open === f.id;
        return (
          <div key={f.id} style={{ background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: 8, padding: 8, marginBottom: 6 }}>
            <div className="flex items-center gap-2">
              <button style={{ ...btn(false), fontSize: 11, padding: "2px 6px" }}
                onClick={() => setOpen(isOpen ? null : f.id)}
                aria-label={isOpen ? "свернуть элемент" : "развернуть элемент"}>
                {isOpen ? "▾" : "▸"}</button>
              <input value={f.name} onChange={(e) => up(f.id, (x) => ({ ...x, name: e.target.value }))}
                aria-label="название элемента"
                style={{ ...S.inp, flex: 1, padding: "4px 6px", fontSize: 12.5, fontWeight: 600 }} />
              <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436",
                fontSize: 11, padding: "2px 6px" }}
                onClick={() => { setFuncs((p) => p.filter((x) => x.id !== f.id)); setOpen(null); }}>
                удалить</button>
            </div>
            <div style={{ marginTop: 2 }}>
              <Mark text="функциональный элемент" ok={checkFunc(f, { traits }).ok}
                onWhy={() => onWhy && onWhy(f.id)} />
            </div>
            {/* Свёрнутый элемент всё равно говорит главное: что берёт, что
                выдаёт и за сколько. Разворачивать ради этого не нужно. */}
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
              {f.takes.length ? f.takes.map((t) => traitName(t.trait)).join(", ") : "ничего не берёт"}
              {" → "}
              {f.gives.length ? f.gives.map((g) => traitName(g.trait)).join(", ") : "ничего не выдаёт"}
            </div>

            {isOpen && (
              <div style={{ marginTop: 8 }}>
                <div style={{ ...S.lbl, marginBottom: 4 }}>берёт</div>
                {f.takes.map((t, i) => (
                  <div key={`${t.trait}-${i}`} className="flex items-center gap-2"
                    style={{ marginBottom: 4 }}>
                    <span style={{ flex: 1, fontSize: 12 }}>{traitName(t.trait)}</span>
                    <Num value={t.qty} onChange={(v) => up(f.id, (x) => ({
                      ...x, takes: x.takes.map((y, j) => (j === i ? { ...y, qty: Number(v) || 0 } : y)),
                    }))} />
                    <button style={{ ...btn(false), fontSize: 11, padding: "2px 6px", color: BAD }}
                      aria-label={`убрать вход ${traitName(t.trait)}`}
                      onClick={() => up(f.id, (x) => ({
                        ...x, takes: x.takes.filter((_, j) => j !== i) }))}>×</button>
                  </div>))}
                <div className="flex flex-wrap gap-2" style={{ marginBottom: 8 }}>
                  {own.filter((t) => !f.takes.some((x) => x.trait === t.id)).map((t) => (
                    <button key={t.id} style={{ ...btn(false), fontSize: 11, padding: "3px 7px" }}
                      onClick={() => up(f.id, (x) => ({ ...x, takes: [...x.takes, { trait: t.id, qty: 1 }] }))}>
                      + берёт «{t.l}»</button>))}
                </div>

                <div style={{ ...S.lbl, marginBottom: 4 }}>выдаёт — это и есть его функции</div>
                {f.gives.map((g) => (
                  <div key={g.id} style={{ border: `1px solid ${C.line}`, borderRadius: 6,
                    padding: 7, marginBottom: 6 }}>
                    <div className="flex items-center gap-2">
                      <span style={{ flex: 1, fontSize: 12 }}>{traitName(g.trait)}</span>
                      <Num value={g.qty} onChange={(v) => upGive(f.id, g.id, (y) => ({
                        ...y, qty: Number(v) || 0 }))} />
                      <button style={{ ...btn(false), fontSize: 11, padding: "2px 6px", color: BAD }}
                        aria-label={`убрать выход ${traitName(g.trait)}`}
                        onClick={() => up(f.id, (x) => ({
                          ...x, gives: x.gives.filter((y) => y.id !== g.id) }))}>×</button>
                    </div>
                    <div className="flex items-center gap-2" style={{ marginTop: 5,
                      alignItems: "center", display: "flex" }}>
                      <span style={S.lbl}>за</span>
                      <Num value={g.dur} onChange={(v) => upGive(f.id, g.id, (y) => ({
                        ...y, dur: Number(v) || 0 }))} style={{ width: 60 }} />
                      <select value={g.durUnit} aria-label={`единица времени для ${traitName(g.trait)}`}
                        onChange={(e) => upGive(f.id, g.id, (y) => ({ ...y, durUnit: e.target.value }))}
                        style={{ ...S.inp, width: "auto", padding: "4px 6px", fontSize: 12 }}>
                        {Object.keys(DUR_UNITS).map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                      <span style={{ flex: 1 }} />
                      <Timing give={g} cycles={cyclesOf ? cyclesOf(f.id, g.id) : []} />
                    </div>
                    <People title="делают" ids={g.owners} people={people} nameOf={nameOf}
                      onToggle={(pid) => upGive(f.id, g.id, (y) => ({
                        ...y, owners: y.owners.includes(pid)
                          ? y.owners.filter((z) => z !== pid) : [...y.owners, pid] }))} />
                    <People title="проверяют" ids={g.reviewers} people={people} nameOf={nameOf}
                      onToggle={(pid) => upGive(f.id, g.id, (y) => ({
                        ...y, reviewers: y.reviewers.includes(pid)
                          ? y.reviewers.filter((z) => z !== pid) : [...y.reviewers, pid] }))} />
                  </div>))}
                <div className="flex flex-wrap gap-2">
                  {own.filter((t) => !f.gives.some((x) => x.trait === t.id)).map((t) => (
                    <button key={t.id} style={{ ...btn(false), fontSize: 11, padding: "3px 7px" }}
                      onClick={() => up(f.id, (x) => ({ ...x, gives: [...x.gives, newGive(t.id, 1)] }))}>
                      + выдаёт «{t.l}»</button>))}
                </div>

                {/* ─── стрелки к другим элементам ───

                    Стрелка идёт от элемента к элементу и несёт ресурс:
                    источник отдаёт, приёмник принимает. Ресурс сам себя не
                    передаёт — потому в самих ресурсах связь больше и не
                    задаётся.

                    Значение — вилка, а не число: это гипотеза о том,
                    насколько ресурс потратится или пополнится, когда работа
                    будет выполнена. Факт появится при сдаче задачи. */}
                <div style={{ ...S.lbl, margin: "10px 0 4px" }}>передаёт другим элементам</div>
                {flows.filter((w) => w.from === f.id).map((w) => {
                  const good = checkFlow(w, { funcs, traits }).ok;
                  return (
                    <div key={w.id} style={{ border: `1px solid ${good ? C.line : BAD}`,
                      borderRadius: 6, padding: 7, marginBottom: 6 }}>
                      <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
                        <select value={w.trait} aria-label="какой ресурс несёт стрелка"
                          onChange={(e) => upFlow(w.id, { trait: e.target.value })}
                          style={{ ...S.inp, width: "auto", padding: "4px 6px", fontSize: 12 }}>
                          <option value="">— ресурс —</option>
                          {traits.map((t) => <option key={t.id} value={t.id}>{t.l}</option>)}
                        </select>
                        <span style={{ fontSize: 12, color: C.muted }}>→</span>
                        <select value={w.to} aria-label="в какой элемент"
                          onChange={(e) => upFlow(w.id, { to: e.target.value })}
                          style={{ ...S.inp, width: "auto", padding: "4px 6px", fontSize: 12 }}>
                          <option value="">— элемент —</option>
                          {funcs.filter((x) => x.id !== f.id)
                            .map((x) => <option key={x.id} value={x.id}>{x.name || "без названия"}</option>)}
                        </select>
                        <span style={{ flex: 1 }} />
                        <button style={{ ...btn(false), fontSize: 11, padding: "2px 6px", color: BAD }}
                          aria-label="убрать стрелку"
                          onClick={() => setFlows((p) => p.filter((y) => y.id !== w.id))}>×</button>
                      </div>
                      <div className="flex items-center gap-2" style={{ marginTop: 5 }}>
                        <span style={S.lbl}>от</span>
                        <Num value={w.lo} onChange={(v) => upFlow(w.id, { lo: Number(v) || 0 })} />
                        <span style={S.lbl}>до</span>
                        <Num value={w.hi} onChange={(v) => upFlow(w.id, { hi: Number(v) || 0 })} />
                        <span style={{ fontSize: 11, color: C.muted, flex: 1 }}>
                          {rangeText(w)} · гипотеза, факт — при сдаче задачи</span>
                        {!good && (
                          <button aria-label="почему стрелка не годится"
                            onClick={() => onWhyFlow && onWhyFlow()}
                            style={{ width: 15, height: 15, lineHeight: "13px", padding: 0,
                              borderRadius: "50%", background: "transparent", color: BAD,
                              border: `1px solid ${BAD}`, fontSize: 10, cursor: "pointer" }}>?</button>)}
                      </div>
                    </div>);
                })}
                <button style={{ ...btn(false), fontSize: 11, padding: "3px 7px" }}
                  onClick={() => setFlows((p) => [...p, newFlow(f.id, "", "")])}>
                  + стрелка от этого элемента</button>
              </div>)}
          </div>);
      })}
    </div>);
}
