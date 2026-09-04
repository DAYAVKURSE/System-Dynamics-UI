import React, { useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, durText, nm, NumField } from "./ui.jsx";
import { DUE_IN, DUE_ON, RATES, WEEK, newCost, newGoal, checkGoal, goalText, planGoal,
  rateOf } from "../lib/goals.js";
import { DUR_UNITS } from "../lib/funcs.js";

/* ════════════════════════════════════════════════════════════════
   ЦЕЛИ — В ПРОГНОЗЕ, А НЕ В РЕСУРСЕ

   Раньше цель была полем ресурса: «сколько нужно». Одно число. Но цель,
   которую ставит человек, звучит иначе: «хочу выйти на одного клиента в
   неделю через месяц, тратя час в день». Здесь три вещи, которых у числа
   не было, — темп, срок и цена, — и без них цель не проверяема: непонятно,
   что считать выполнением и во что оно обходится.

   ─── что показывает форма ───

   Ровно то, что человек задал, и ровно то, что из этого следует по модели:

   · сколько ресурса это требует в месяц;
   · сколько выполнений каких функций и сколько человеко-часов;
   · влезает ли это в названный бюджет времени — и если нет, чего не хватает;
   · успевает ли первый результат к сроку;
   · держится ли темп вообще: цикл длиннее периода означает, что «раз в
     неделю» не выйдет, сколько ни старайся;
   · во что цель обходится по другим ресурсам — названное человеком рядом с
     посчитанным по модели.

   Расхождение между «я думал» и «выходит» и есть главное, ради чего это
   считается. Показывать одно вместо другого нельзя: первое — намерение,
   второе — следствие модели, и путать их значит терять и то и другое.
   ════════════════════════════════════════════════════════════════ */

const Fig = ({ label, value, color, hint }) => (
  <div style={{ flex: "1 1 130px", background: C.panel2, border: `1px solid ${C.line}`,
    borderRadius: 8, padding: "7px 9px" }}>
    <div style={{ fontSize: 14.5, fontWeight: 700, color: color || C.text }}>{value}</div>
    <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.4 }}>{label}</div>
    {hint && <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.4 }}>{hint}</div>}
  </div>
);

const Row = ({ label, children, wide }) => (
  <div style={{ flex: wide ? "1 1 100%" : "1 1 130px", minWidth: 0 }}>
    <div style={S.lbl}>{label}</div>
    {children}
  </div>
);

const sel = { ...S.inp, padding: "6px 7px", fontSize: 12 };
const hoursText = (h) => `${nm(Math.round(h * 10) / 10)} ч`;

/** Одна цель: чем она задана и что из неё следует. */
function Goal({ goal, traits, model, runsOf, onSet, onDel, open, onToggle }) {
  const traitName = (id) => traits.find((t) => t.id === id)?.l || "ресурс не выбран";
  const ready = checkGoal(goal, traits);
  const plan = ready ? planGoal(model, goal, { runsOf }) : null;
  const up = (patch) => onSet(goal.id, patch);
  const rate = rateOf(goal.rate);
  const unit = traits.find((t) => t.id === goal.trait)?.unit || "";
  const free = traits.filter((t) => t.id !== goal.trait
    && !(goal.costs || []).some((c) => c.trait === t.id));

  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8,
      padding: 9, marginBottom: 6 }}>
      {/* Заголовок — сама цель словами. Названия у цели нет и не нужно:
          «1 клиент в неделю через месяц» и есть её имя. */}
      <div className="flex items-center gap-2">
        <button style={{ ...btn(false), fontSize: 11, padding: "2px 6px" }}
          aria-label={`${open ? "свернуть" : "развернуть"} цель`}
          onClick={onToggle}>{open ? "▾" : "▸"}</button>
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, minWidth: 0 }}>
          {ready ? goalText(goal, traitName) : "цель не задана: выберите ресурс и количество"}
        </span>
        <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436",
          fontSize: 11, padding: "2px 6px" }} aria-label="удалить цель"
          onClick={() => onDel(goal.id)}>удалить</button>
      </div>
      {open && (<>

      {/* ─── ЧТО ─── */}
      <div style={{ ...S.lbl, marginTop: 6 }}>что должно быть</div>
      <div className="flex flex-wrap gap-2" style={{ marginTop: 4 }}>
        <Row label="ресурс">
          <select style={sel} value={goal.trait} aria-label="ресурс цели"
            onChange={(e) => up({ trait: e.target.value })}>
            <option value="">— выберите —</option>
            {traits.map((t) => (<option key={t.id} value={t.id}>{t.l}</option>))}
          </select>
        </Row>
        <Row label="сколько">
          <NumField value={goal.qty} aria-label="сколько ресурса"
            onCommit={(v) => up({ qty: v ?? 0 })} />
        </Row>
        <Row label="как часто">
          <select style={sel} value={goal.rate} aria-label="темп цели"
            onChange={(e) => up({ rate: e.target.value })}>
            {RATES.map((r) => (<option key={r.id} value={r.id}>{r.name}</option>))}
          </select>
        </Row>
      </div>

      {/* ─── КОГДА ─── */}
      <div style={{ ...S.lbl, marginTop: 10 }}>к какому сроку</div>
      <div className="flex flex-wrap gap-2" style={{ marginTop: 4, alignItems: "flex-end" }}>
        <div className="flex gap-2">
          <button style={{ ...btn(goal.dueKind === DUE_IN), fontSize: 11, padding: "5px 9px" }}
            onClick={() => up({ dueKind: DUE_IN })}>через</button>
          <button style={{ ...btn(goal.dueKind === DUE_ON), fontSize: 11, padding: "5px 9px" }}
            onClick={() => up({ dueKind: DUE_ON })}>к дате</button>
        </div>
        {goal.dueKind === DUE_IN ? (<>
          <Row label="сколько">
            <NumField value={goal.dueIn} aria-label="через сколько"
              onCommit={(v) => up({ dueIn: v ?? 0 })} />
          </Row>
          <Row label="единица">
            <select style={sel} value={goal.dueUnit} aria-label="единица срока"
              onChange={(e) => up({ dueUnit: e.target.value })}>
              {Object.keys(DUR_UNITS).map((u) => (<option key={u} value={u}>{u}</option>))}
            </select>
          </Row>
        </>) : (
          <Row label="дата" wide>
            <input type="date" style={sel} value={goal.dueOn || ""} aria-label="дата цели"
              onChange={(e) => up({ dueOn: e.target.value })} />
          </Row>)}
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
        Срок — про выход на темп, а не про первый результат: «через месяц»
        значит, что через месяц темп уже держится.
      </div>

      {/* ─── ПО КАКИМ ДНЯМ ─── */}
      <div style={{ ...S.lbl, marginTop: 10 }}>по каким дням идёт работа</div>
      <div className="flex flex-wrap gap-2" style={{ marginTop: 4 }}>
        {WEEK.map((d) => {
          const on = (goal.days || []).includes(d.id);
          return (
            <button key={d.id} aria-label={`день ${d.short}`}
              style={{ ...btn(on), fontSize: 11, padding: "4px 8px" }}
              onClick={() => up({ days: on ? goal.days.filter((x) => x !== d.id)
                : [...(goal.days || []), d.id] })}>{d.short}</button>);
        })}
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
        {goal.days?.length
          ? `${goal.days.length} дн в неделю — по ним и считается бюджет времени.`
          : "Ничего не выбрано — значит все дни."}
      </div>

      {/* ─── ЦЕНА ─── */}
      <div style={{ ...S.lbl, marginTop: 10 }}>какой ценой</div>
      <div className="flex flex-wrap gap-2" style={{ marginTop: 4 }}>
        <Row label="времени">
          <NumField value={goal.hours} aria-label="сколько времени"
            onCommit={(v) => up({ hours: v ?? 0 })} />
        </Row>
        <Row label="за период">
          <select style={sel} value={goal.hoursPer} aria-label="период времени"
            onChange={(e) => up({ hoursPer: e.target.value })}>
            {RATES.filter((r) => r.hours).map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>))}
          </select>
        </Row>
      </div>
      {(goal.costs || []).map((c) => (
        <div key={c.id} className="flex items-center gap-2" style={{ marginTop: 5 }}>
          <span style={{ flex: 1, fontSize: 12, minWidth: 0 }}>{traitName(c.trait)}</span>
          <NumField value={c.qty} style={{ width: 74 }}
            aria-label={`затраты ${traitName(c.trait)}`}
            onCommit={(v) => up({ costs: goal.costs.map((x) => (x.id === c.id
              ? { ...x, qty: v ?? 0 } : x)) })} />
          <button style={{ ...btn(false), fontSize: 11, padding: "2px 6px", color: BAD }}
            aria-label={`убрать затрату ${traitName(c.trait)}`}
            onClick={() => up({ costs: goal.costs.filter((x) => x.id !== c.id) })}>×</button>
        </div>))}
      {free.length > 0 && (
        <select value="" aria-label="добавить затрату ресурса"
          style={{ ...sel, marginTop: 5 }}
          onChange={(e) => { if (e.target.value) {
            up({ costs: [...(goal.costs || []), newCost(e.target.value)] }); } }}>
          <option value="">+ затрата другого ресурса…</option>
          {free.map((t) => (<option key={t.id} value={t.id}>{t.l}</option>))}
        </select>)}

      {/* ─── ЧТО ИЗ ЭТОГО СЛЕДУЕТ ─── */}
      {plan && <Verdict plan={plan} unit={unit} traits={traits} />}
      </>)}
    </div>);
}

/** Что модель отвечает на цель: цифры, а не «похоже, получится». */
function Verdict({ plan, unit, traits }) {
  const nameOf = (id) => traits.find((t) => t.id === id)?.l || id;
  const both = (a, b, f) => (Math.round(a) === Math.round(b) ? f(a) : `${f(a)} – ${f(b)}`);
  if (!plan.ok) {
    return (
      <div style={{ fontSize: 11.5, color: BAD, marginTop: 10, lineHeight: 1.6 }}>
        {plan.missing.length
          ? `Цель недостижима: ресурс «${nameOf(plan.missing[0])}» не выдаёт ни одна функция.`
          : plan.looped
            ? "Цепочка замкнулась сама на себя: ресурс нужен, чтобы получить этот же ресурс."
            : "Ни одна функция не выдаёт этот ресурс — производить его нечем."}
      </div>);
  }
  const budgetName = plan.rate.hours ? "в месяц" : "за весь срок";
  return (<div style={{ marginTop: 10 }}>
    <div style={S.lbl}>что из этого следует</div>
    <div className="flex flex-wrap gap-2" style={{ marginTop: 5 }}>
      {plan.perMonth != null && (
        <Fig label={`${unit || "ед."} в месяц по этому темпу`}
          value={nm(Math.round(plan.perMonth * 10) / 10)} />)}
      <Fig label={`работы ${budgetName}`} color={WARN}
        value={both(plan.lo.workHours, plan.hi.workHours, durText)} />
      <Fig label="выполнений функций"
        value={both(plan.lo.runs, plan.hi.runs, (v) => nm(Math.round(v)))} />
      <Fig label="самая длинная цепочка" color={ACC} value={durText(plan.readyHours)} />
    </div>

    {plan.oneSided && (
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
        Это по {plan.sureOk ? "нижней" : "верхней"} границе вилок: по
        {plan.sureOk ? " верхней" : " нижней"} цель не достигается вовсе.
        Называть два числа, когда модель даёт одно, нельзя.
      </div>)}

    {plan.budget != null && (
      <div style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.6,
        color: plan.fits ? OK : plan.fitsSure ? WARN : BAD }}>
        {plan.fits
          ? `Влезает в бюджет: нужно ${hoursText(plan.work.hi)} ${budgetName}, а есть ${hoursText(plan.budget)}.`
          : plan.fitsSure
            ? `Влезает не наверняка: по осторожной оценке нужно ${hoursText(plan.work.lo)}, по щедрой — ${hoursText(plan.work.hi)}, а есть ${hoursText(plan.budget)} ${budgetName}.`
            : `Не влезает: нужно ${hoursText(plan.work.lo)} ${budgetName}, а названо ${hoursText(plan.budget)}. Не хватает ${hoursText(plan.work.lo - plan.budget)}.`}
      </div>)}

    {plan.due != null && (
      <div style={{ fontSize: 11.5, marginTop: 5, lineHeight: 1.6,
        color: plan.ready ? OK : BAD }}>
        {plan.ready
          ? `Успевает: первый результат через ${durText(plan.readyHours)}, а срок через ${durText(plan.due)}.`
          : `Не успевает: первый результат через ${durText(plan.readyHours)}, а срок через ${durText(plan.due)}.`}
        {plan.dueOn && (
          <span style={{ color: C.muted }}>
            {" "}Срок — {plan.dueOn.toLocaleDateString("ru-RU")}.</span>)}
      </div>)}

    {plan.cycle != null && (
      <div style={{ fontSize: 11.5, marginTop: 5, lineHeight: 1.6,
        color: plan.cycle ? OK : BAD }}>
        {plan.cycle
          ? `Темп держится: один круг занимает ${durText(plan.readyHours)}, а период — ${plan.rate.name}.`
          : `Темп не держится: один круг занимает ${durText(plan.readyHours)} — это дольше, чем «${plan.rate.name}». Сколько ни старайся, результат не успеет созреть.`}
      </div>)}

    {(plan.costs.length > 0 || plan.extra.length > 0) && (<>
      <div style={{ ...S.lbl, marginTop: 10 }}>цена по ресурсам</div>
      {plan.costs.map((c) => {
        const off = c.qty > 0 && Math.abs(c.real - c.qty) / c.qty > 0.05;
        return (
          <div key={c.id} className="flex items-center gap-2"
            style={{ fontSize: 11.5, padding: "3px 0", borderTop: `1px solid ${C.line}` }}>
            <span style={{ flex: 1, minWidth: 0 }}>{c.name}</span>
            <span style={{ color: C.muted }}>назвали {nm(c.qty)}</span>
            <span style={{ color: off ? WARN : OK }}>
              по модели {nm(Math.round(c.real * 10) / 10)}</span>
          </div>);
      })}
      {plan.extra.map((c) => (
        <div key={c.trait} className="flex items-center gap-2"
          style={{ fontSize: 11.5, padding: "3px 0", borderTop: `1px solid ${C.line}` }}>
          <span style={{ flex: 1, minWidth: 0 }}>{c.name}</span>
          <span style={{ color: WARN }}>уйдёт ещё {nm(Math.round(c.real * 10) / 10)}</span>
        </div>))}
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
        Слева — то, что вы назвали ценой, справа — то, что выходит по
        модели. Расхождение здесь и есть самое полезное: значит либо цена
        занижена, либо модель собрана не так, как вы думали.
      </div>
    </>)}
  </div>);
}

/**
 * Список целей. Живёт в «Прогнозе»: цель — это вопрос к будущему модели, а
 * не свойство ресурса.
 */
export default function GoalsPanel({ goals, setGoals, traits, model, runsOf }) {
  const [open, setOpen] = useState(null);
  const set = (id, patch) => setGoals((p) => p.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const del = (id) => { setGoals((p) => p.filter((g) => g.id !== id)); setOpen(null); };
  const add = () => {
    const g = newGoal(traits[0]?.id || "");
    setGoals((p) => [...p, g]);
    setOpen(g.id);
  };
  return (
    <div style={{ ...S.card, marginBottom: 10 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
        <span style={S.lbl}>цели</span>
        <span style={{ flex: 1 }} />
        <button style={btn(false)} onClick={add} disabled={!traits.length}>+ цель</button>
      </div>
      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, marginBottom: 8 }}>
        Цель — это не число у ресурса, а намерение: сколько, чего, к какому
        сроку, каким темпом и какой ценой. Модель отвечает на неё тем, что
        из неё следует: сколько работы, успеет ли и во что обойдётся.
      </div>
      {!goals.length && (
        <div style={{ fontSize: 11.5, color: C.muted }}>
          {traits.length ? "Целей пока нет." : "Сначала заведите ресурсы — цель ставится по ресурсу."}
        </div>)}
      {goals.map((g) => (
        <Goal key={g.id} goal={g} traits={traits} model={model} runsOf={runsOf}
          onSet={set} onDel={del}
          open={open === g.id} onToggle={() => setOpen(open === g.id ? null : g.id)} />))}
    </div>);
}
