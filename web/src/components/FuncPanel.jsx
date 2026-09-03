import React, { useState } from "react";
import { C, OK, BAD, ACC, WARN, S, btn, nm } from "./ui.jsx";
import { DUR_UNITS, checkFunc, fromHours, hoursOf, newFunc, newPort, okRange,
  rangeText, runHours, runQty, workersOf } from "../lib/funcs.js";
import { Mark } from "./Modal.jsx";

/* ════════════════════════════════════════════════════════════════
   ФУНКЦИИ АКТИВА · редактор

   Актив — это его воркеры, его функции и его ресурсы. Воркеры (исполнители
   и проверяющие) выполняют функции; функции потребляют и передают ресурсы.

   У функции ровно две формы, а не три: что берёт и что выдаёт. Прежняя
   третья — «передаёт другим» — была лишней: передача это и есть выход,
   только ресурсом чужого актива. Два места, где задаётся одно и то же,
   неминуемо разошлись бы, и человек не знал бы, какому верить.

   Сколько берётся и сколько выдаётся — вилка, а не число: сначала
   закладывается гипотеза, потом её уточняют реальные выполнения. План
   показан жёлтым, среднее по фактам — зелёным рядом. Выдавать одно за
   другое нельзя, поэтому и цвета разные.

   Время одно на функцию: выполнение либо случилось целиком, либо нет.
   ════════════════════════════════════════════════════════════════ */

const Num = ({ value, onChange, label, style }) => (
  <input type="number" value={value} aria-label={label}
    onChange={(e) => onChange(e.target.value)}
    style={{ ...S.inp, width: 64, padding: "4px 6px", fontSize: 12, ...style }} />
);

/** План жёлтым, а когда есть выполнения — зелёное среднее рядом. */
export function Fact({ plan, fact, unit = "", title = "план" }) {
  return (
    <span style={{ fontSize: 11 }}>
      <span style={{ color: WARN }} title={`${title}: столько заложено`}>{plan}</span>
      {fact != null && (
        <span style={{ color: OK }} title="факт: среднее арифметическое по выполнениям">
          {" · факт "}{nm(fact)}{unit ? ` ${unit}` : ""}</span>)}
    </span>);
}

/** Срок функции: план жёлтым, среднее по выполнениям — зелёным. */
export function Timing({ func, runs = [] }) {
  const avg = runHours(runs);
  const plan = hoursOf(func);
  const as = avg == null ? null : fromHours(avg);
  return (
    <span style={{ fontSize: 11 }}>
      <span style={{ color: WARN }} title="план: столько заложено на одно выполнение">
        {nm(func.dur)} {func.durUnit}</span>
      {as && (
        <span style={{ color: OK }}
          title={`факт: среднее по ${runs.filter((r) => Number(r?.hours) > 0).length} выполнениям`}>
          {" · факт "}{nm(as.dur)} {as.durUnit}
          {plan > 0 && avg > plan ? " (дольше плана)" : ""}</span>)}
    </span>);
}

/** Кто выполняет и кто принимает — по человеку на нажатие. */
function People({ title, ids, people, nameOf, onToggle }) {
  return (
    <div style={{ marginTop: 6 }}>
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

/**
 * Список входов или выходов: ресурс, вилка «сколько» и факт рядом.
 *
 * Ресурс чужого актива в выходах и означает передачу: функция отдала своё
 * наружу. Поэтому чужие ресурсы не спрятаны, а подписаны активом —
 * иначе два одноимённых ресурса разных активов было бы не различить.
 */
function Ports({ kind, title, hint, list, own, others, assetName, traitName, runs,
  onAdd, onSet, onDel }) {
  const [pick, setPick] = useState("");
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ ...S.lbl, marginBottom: 4 }}>{title}</div>
      {list.length === 0 && (
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{hint}</div>)}
      {list.map((p) => {
        const foreign = !own.some((t) => t.id === p.trait);
        const at = others.find((t) => t.id === p.trait);
        return (
          <div key={p.id} style={{ border: `1px solid ${okRange(p) ? C.line : BAD}`,
            borderRadius: 6, padding: 7, marginBottom: 5 }}>
            <div className="flex items-center gap-2">
              <span style={{ flex: 1, fontSize: 12 }}>
                {traitName(p.trait)}
                {foreign && (
                  <span style={{ color: ACC, fontSize: 11 }}>
                    {kind === "gives" ? " → в актив " : " ← из актива "}
                    «{at ? assetName(at.e) : "?"}»</span>)}
              </span>
              <button style={{ ...btn(false), fontSize: 11, padding: "2px 6px", color: BAD }}
                aria-label={`убрать ${kind === "gives" ? "выход" : "вход"} ${traitName(p.trait)}`}
                onClick={() => onDel(p.id)}>×</button>
            </div>
            <div className="flex items-center gap-2" style={{ marginTop: 5, flexWrap: "wrap" }}>
              <span style={S.lbl}>от</span>
              <Num value={p.lo} label={`сколько минимум ${traitName(p.trait)}`}
                onChange={(v) => onSet(p.id, { lo: Number(v) || 0 })} />
              <span style={S.lbl}>до</span>
              <Num value={p.hi} label={`сколько максимум ${traitName(p.trait)}`}
                onChange={(v) => onSet(p.id, { hi: Number(v) || 0 })} />
              <span style={{ flex: 1 }} />
              <Fact plan={rangeText(p)} fact={runQty(runs, kind, p.trait)} />
            </div>
          </div>);
      })}
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
        {own.filter((t) => !list.some((p) => p.trait === t.id)).map((t) => (
          <button key={t.id} style={{ ...btn(false), fontSize: 11, padding: "3px 7px" }}
            onClick={() => onAdd(t.id)}>
            + {kind === "gives" ? "выдаёт" : "берёт"} «{t.l}»</button>))}
        {others.length > 0 && (
          <select value={pick} aria-label={kind === "gives"
            ? "передать ресурс в другой актив" : "взять ресурс из другого актива"}
            onChange={(e) => { if (e.target.value) { onAdd(e.target.value); setPick(""); } }}
            style={{ ...S.inp, width: "auto", padding: "4px 6px", fontSize: 11 }}>
            <option value="">
              {kind === "gives" ? "+ передать в другой актив…" : "+ взять из другого актива…"}
            </option>
            {others.filter((t) => !list.some((p) => p.trait === t.id)).map((t) => (
              <option key={t.id} value={t.id}>{assetName(t.e)} · {t.l}</option>))}
          </select>)}
      </div>
    </div>);
}

export default function FuncPanel({
  entityId, funcs, setFuncs, traits, entities = [], people = [], nameOf, runsOf, onWhy,
}) {
  const mine = funcs.filter((f) => f.e === entityId);
  const [open, setOpen] = useState(null);
  const own = traits.filter((t) => t.e === entityId);
  const others = traits.filter((t) => t.e !== entityId);
  const traitName = (id) => traits.find((t) => t.id === id)?.l || "(ресурс удалён)";
  const assetName = (id) => entities.find((e) => e.id === id)?.name || "другой актив";
  const workers = workersOf(funcs, entityId);

  const up = (id, make) => setFuncs((p) => p.map((f) => (f.id === id ? make(f) : f)));
  const upPort = (id, kind, pid, patch) => up(id, (f) => ({
    ...f, [kind]: f[kind].map((p) => (p.id === pid ? { ...p, ...patch } : p)),
  }));
  const togglePerson = (id, kind, pid) => up(id, (f) => ({
    ...f, [kind]: f[kind].includes(pid) ? f[kind].filter((z) => z !== pid) : [...f[kind], pid],
  }));

  const add = () => {
    const f = newFunc(entityId);
    setFuncs((p) => [...p, f]);
    setOpen(f.id);
  };

  const names = (ids) => (ids.length
    ? ids.map((id) => (nameOf ? nameOf(id) : id)).join(", ")
    : "никого");

  return (
    <div style={{ marginTop: 12 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
        <span style={S.lbl}>функции актива</span>
        <span style={{ flex: 1 }} />
        <button style={{ ...btn(false), fontSize: 11, padding: "3px 8px" }} onClick={add}>
          + функция</button>
      </div>

      {/* Воркеры актива — не отдельный список, а те, кто назначен на его
          функции. Отдельный расходился бы с назначениями в первый день. */}
      <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, marginBottom: 8 }}>
        воркеры актива · исполнители: {names(workers.owners)}
        {" · проверяющие: "}{names(workers.reviewers)}
      </div>

      {mine.length === 0 && (
        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, marginBottom: 8 }}>
          Функций пока нет. Функция берёт несколько ресурсов и выдаёт несколько
          других — и может передавать их в другие активы. Сколько берёт и сколько
          выдаёт — диапазон: сначала закладывается, потом уточняется реальными
          выполнениями.
        </div>)}

      {mine.map((f) => {
        const isOpen = open === f.id;
        const runs = runsOf ? runsOf(f.id) : [];
        return (
          <div key={f.id} style={{ background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: 8, padding: 8, marginBottom: 6 }}>
            <div className="flex items-center gap-2">
              <button style={{ ...btn(false), fontSize: 11, padding: "2px 6px" }}
                onClick={() => setOpen(isOpen ? null : f.id)}
                aria-label={isOpen ? "свернуть функцию" : "развернуть функцию"}>
                {isOpen ? "▾" : "▸"}</button>
              <input value={f.name} onChange={(e) => up(f.id, (x) => ({ ...x, name: e.target.value }))}
                aria-label="название функции"
                style={{ ...S.inp, flex: 1, padding: "4px 6px", fontSize: 12.5, fontWeight: 600 }} />
              <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436",
                fontSize: 11, padding: "2px 6px" }}
                onClick={() => { setFuncs((p) => p.filter((x) => x.id !== f.id)); setOpen(null); }}>
                удалить</button>
            </div>
            <div style={{ marginTop: 2 }}>
              <Mark text="функция" ok={checkFunc(f, { traits }).ok}
                onWhy={() => onWhy && onWhy(f.id)} />
            </div>
            {/* Свёрнутая функция всё равно говорит главное: что берёт, что
                выдаёт и за сколько. Разворачивать ради этого не нужно. */}
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
              {f.takes.length ? f.takes.map((t) => traitName(t.trait)).join(", ") : "ничего не берёт"}
              {" → "}
              {f.gives.length ? f.gives.map((g) => traitName(g.trait)).join(", ") : "ничего не выдаёт"}
              {" · "}<Timing func={f} runs={runs} />
            </div>

            {isOpen && (
              <div style={{ marginTop: 4 }}>
                <Ports kind="takes" title="берёт" list={f.takes} own={own} others={others}
                  hint="Функция ничего не берёт — значит и преобразовывать ей нечего."
                  assetName={assetName} traitName={traitName} runs={runs}
                  onAdd={(tid) => up(f.id, (x) => ({ ...x, takes: [...x.takes, newPort(tid)] }))}
                  onSet={(pid, patch) => upPort(f.id, "takes", pid, patch)}
                  onDel={(pid) => up(f.id, (x) => ({
                    ...x, takes: x.takes.filter((p) => p.id !== pid) }))} />

                <Ports kind="gives" title="выдаёт" list={f.gives} own={own} others={others}
                  hint="Функция ничего не выдаёт — значит она ничего не производит."
                  assetName={assetName} traitName={traitName} runs={runs}
                  onAdd={(tid) => up(f.id, (x) => ({ ...x, gives: [...x.gives, newPort(tid)] }))}
                  onSet={(pid, patch) => upPort(f.id, "gives", pid, patch)}
                  onDel={(pid) => up(f.id, (x) => ({
                    ...x, gives: x.gives.filter((p) => p.id !== pid) }))} />

                <div className="flex items-center gap-2" style={{ marginTop: 10,
                  flexWrap: "wrap" }}>
                  <span style={S.lbl}>выполняется за</span>
                  <Num value={f.dur} label="время одного выполнения"
                    onChange={(v) => up(f.id, (x) => ({ ...x, dur: Number(v) || 0 }))} />
                  <select value={f.durUnit} aria-label="единица времени функции"
                    onChange={(e) => up(f.id, (x) => ({ ...x, durUnit: e.target.value }))}
                    style={{ ...S.inp, width: "auto", padding: "4px 6px", fontSize: 12 }}>
                    {Object.keys(DUR_UNITS).map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <span style={{ flex: 1 }} />
                  <Timing func={f} runs={runs} />
                </div>

                <People title="исполнители" ids={f.owners} people={people} nameOf={nameOf}
                  onToggle={(pid) => togglePerson(f.id, "owners", pid)} />
                <People title="проверяющие" ids={f.reviewers} people={people} nameOf={nameOf}
                  onToggle={(pid) => togglePerson(f.id, "reviewers", pid)} />
              </div>)}
          </div>);
      })}
    </div>);
}
