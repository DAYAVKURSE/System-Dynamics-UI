import React, { useState } from "react";
import { C, OK, BAD, ACC, WARN, S, btn, nm, NumField, TxtField } from "./ui.jsx";
import { DUR_UNITS, WORKER_KINDS, checkFunc, checkTrait, everyOf, fromHours,
  hoursOf, newFunc, newGive, newPort, okRange, rangeText, runHours,
  runQty } from "../lib/funcs.js";
import { Mark } from "./Modal.jsx";
import { byRating, shortStat, statsOf } from "../lib/workers.js";

/* ════════════════════════════════════════════════════════════════
   КАРТОЧКА АКТИВА · воркеры, функции, ресурсы

   Актив состоит из трёх вещей, и в интерфейсе они устроены ОДИНАКОВО: три
   вкладки одного вида, в каждой — список одинаковых карточек и кнопка «+».
   Разные на вид формы для трёх равноправных частей заставляли бы каждый раз
   заново разбираться, где что, — хотя вопрос всегда один: что здесь есть и
   как это добавить.

   Вкладки, а не три списка подряд: части равноправны, и ни одна из них не
   должна быть «той, до которой надо долистать».

   · воркеры — постановщики, исполнители и проверяющие актива, его люди;
   · функции — то, что эти люди выполняют;
   · ресурсы — то, что функции потребляют и передают.

   Порядок именно такой: сначала люди, потом их работа, потом то, с чем
   она работает.
   ════════════════════════════════════════════════════════════════ */

/* ─── общая грамматика всех трёх разделов ─── */

export function Section({ title, hint, addLabel, onAdd, empty, children, count }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
        <span style={S.lbl}>{title}</span>
        {count != null && <span style={{ fontSize: 10.5, color: C.muted }}>{count}</span>}
        <span style={{ flex: 1 }} />
        {onAdd && (
          <button style={{ ...btn(false), fontSize: 11, padding: "3px 8px" }} onClick={onAdd}>
            {addLabel}</button>)}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, marginBottom: 8 }}>
          {hint}</div>)}
      {empty && (
        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, marginBottom: 8 }}>
          {empty}</div>)}
      {children}
    </div>);
}

/** Одна карточка раздела: заголовок, подпись строения, раскрытая часть. */
export function Card({ title, onTitle, titleLabel, mark, summary, open, onToggle,
  onDelete, children }) {
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8,
      padding: 8, marginBottom: 6 }}>
      <div className="flex items-center gap-2">
        <button style={{ ...btn(false), fontSize: 11, padding: "2px 6px" }}
          onClick={onToggle} aria-label={open ? `свернуть ${titleLabel}` : `развернуть ${titleLabel}`}>
          {open ? "▾" : "▸"}</button>
        <TxtField value={title} onCommit={onTitle}
          style={{ flex: 1, padding: "4px 6px", fontSize: 12.5, fontWeight: 600 }}
          aria-label={`название ${titleLabel}`} />
        <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436",
          fontSize: 11, padding: "2px 6px" }} onClick={onDelete}>удалить</button>
      </div>
      {mark && <div style={{ marginTop: 2 }}>{mark}</div>}
      {summary && (
        <div style={{ fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
          {summary}</div>)}
      {open && <div style={{ marginTop: 4 }}>{children}</div>}
    </div>);
}

const Num = ({ value, onChange, label, style }) => (
  <input type="number" value={value} aria-label={label}
    onChange={(e) => onChange(e.target.value)}
    style={{ ...S.inp, width: 64, padding: "4px 6px", fontSize: 12, ...style }} />
);

/** План жёлтым, а когда есть выполнения — зелёное среднее рядом. */
export function Fact({ plan, fact, unit = "" }) {
  return (
    <span style={{ fontSize: 11 }}>
      <span style={{ color: WARN }} title="план: столько заложено">{plan}</span>
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

/** Люди — по человеку на нажатие. */
function People({ title, ids, people, nameOf, empty, onToggle }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ ...S.lbl, marginBottom: 3 }}>{title}</div>
      <div className="flex flex-wrap gap-2">
        {people.length === 0 && (
          <span style={{ fontSize: 11, color: C.muted }}>{empty}</span>)}
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

/* ═══ 1. ВОРКЕРЫ ═══
   Люди актива. Они и выполняют его функции, поэтому стоят первыми: сначала
   кто, потом что делает.

   У каждого рядом с именем — короткий итог: средняя оценка, доля работ,
   сданных в срок, и сколько их было. Выбирать человека вслепую, а потом
   искать его историю в другом месте, — значит выбирать не глядя. Полная
   история открывается нажатием на строку.

   Порядок в списке — свой: по умолчанию впереди лучшие по оценке, но его
   можно переложить руками, и тогда он таким и сохранится. Порядок здесь
   не украшение: он говорит, кого зовут на работу первым. */
export function Workers({ workers, people = [], nameOf, tasks = [], funcs = [],
  onToggle, onOrder, onOpenPerson }) {
  const [sorted, setSorted] = useState(true);
  const stat = (id) => statsOf(tasks, funcs, id);
  return (
    <Section title="воркеры актива"
      hint="Постановщики, исполнители и проверяющие этого актива. На его функции можно ставить только их."
      empty={people.length ? null : "Людей ещё нет — заведите их во вкладке «Люди и роли»."}>
      {people.length > 0 && (<>
        <div className="flex flex-wrap gap-2" style={{ marginBottom: 6 }}>
          <button style={{ ...btn(sorted), fontSize: 11, padding: "3px 8px" }}
            onClick={() => setSorted(true)}>по рейтингу</button>
          <button style={{ ...btn(!sorted), fontSize: 11, padding: "3px 8px" }}
            onClick={() => setSorted(false)}>свой порядок</button>
        </div>
        <div style={{ background: C.panel2, border: `1px solid ${C.line}`,
          borderRadius: 8, padding: 8 }}>
          {WORKER_KINDS.map((k) => {
            const ids = workers[k.id] || [];
            const shown = sorted ? byRating(tasks, funcs, ids) : ids;
            const free = people.filter((p) => !ids.includes(p.id));
            return (
              <div key={k.id} style={{ marginTop: 6 }}>
                <div style={{ ...S.lbl, marginBottom: 3 }}>{k.many}</div>
                {!ids.length && (
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
                    никого — выберите ниже</div>)}
                {shown.map((pid, i) => {
                  const s = stat(pid);
                  return (
                    <div key={pid} className="flex items-center gap-2"
                      style={{ padding: "4px 0", borderTop: `1px solid ${C.line}` }}>
                      <button style={{ background: "none", border: "none", padding: 0,
                        flex: 1, textAlign: "left", cursor: "pointer", color: C.text }}
                        onClick={() => onOpenPerson && onOpenPerson(pid)}
                        title="вся история этого человека">
                        <span style={{ fontSize: 12 }}>{nameOf ? nameOf(pid) : pid}</span>
                        <span style={{ fontSize: 10.5, color: s.mark == null ? C.muted
                          : s.mark >= 4 ? OK : s.mark >= 3 ? WARN : BAD }}>
                          {" · "}{shortStat(s)}</span>
                      </button>
                      {!sorted && (<>
                        <button style={{ ...btn(false), fontSize: 11, padding: "1px 6px" }}
                          aria-label={`выше: ${nameOf ? nameOf(pid) : pid}`}
                          disabled={i === 0}
                          onClick={() => onOrder(k.id, pid, -1)}>↑</button>
                        <button style={{ ...btn(false), fontSize: 11, padding: "1px 6px" }}
                          aria-label={`ниже: ${nameOf ? nameOf(pid) : pid}`}
                          disabled={i === shown.length - 1}
                          onClick={() => onOrder(k.id, pid, 1)}>↓</button>
                      </>)}
                      <button style={{ ...btn(false), fontSize: 11, padding: "1px 6px",
                        color: BAD }} aria-label={`убрать из ${k.many}`}
                        onClick={() => onToggle(k.id, pid)}>×</button>
                    </div>);
                })}
                {!!free.length && (
                  <div className="flex flex-wrap gap-2" style={{ marginTop: 5 }}>
                    {free.map((p) => (
                      <button key={p.id} style={{ ...btn(false), fontSize: 11,
                        padding: "3px 7px" }} onClick={() => onToggle(k.id, p.id)}>
                        + {p.name || p.id}
                        <span style={{ color: C.muted }}> · {shortStat(stat(p.id))}</span>
                      </button>))}
                  </div>)}
              </div>);
          })}
        </div></>)}
    </Section>);
}

/* ═══ 2. ФУНКЦИИ ═══ */

/**
 * Список входов или выходов: ресурс, вилка «сколько» и факт рядом.
 *
 * У выхода есть ещё получатель: пусто — ресурс остаётся в своём активе,
 * иначе функция передаёт выданное в названный актив.
 */
function Ports({ kind, title, hint, list, own, others, entities, assetName, traitName,
  runs, onAdd, onSet, onDel }) {
  const [pick, setPick] = useState("");
  const out = kind === "gives";
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ ...S.lbl, marginBottom: 4 }}>{title}</div>
      {list.length === 0 && (
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{hint}</div>)}
      {list.map((p) => {
        const at = others.find((t) => t.id === p.trait);
        return (
          <div key={p.id} style={{ border: `1px solid ${okRange(p) ? C.line : BAD}`,
            borderRadius: 6, padding: 7, marginBottom: 5 }}>
            <div className="flex items-center gap-2">
              <span style={{ flex: 1, fontSize: 12 }}>
                {traitName(p.trait)}
                {at && !out && (
                  <span style={{ color: ACC, fontSize: 11 }}>
                    {" ← из актива «"}{assetName(at.e)}»</span>)}
              </span>
              <button style={{ ...btn(false), fontSize: 11, padding: "2px 6px", color: BAD }}
                aria-label={`убрать ${out ? "выход" : "вход"} ${traitName(p.trait)}`}
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
            {/* Передача: то, что выдано, может уехать в другой актив. */}
            {out && (
              <div className="flex items-center gap-2" style={{ marginTop: 5, flexWrap: "wrap" }}>
                <span style={S.lbl}>передаёт в</span>
                <select value={p.to || ""} aria-label={`кому передаётся ${traitName(p.trait)}`}
                  onChange={(e) => onSet(p.id, { to: e.target.value })}
                  style={{ ...S.inp, width: "auto", padding: "4px 6px", fontSize: 12 }}>
                  <option value="">— остаётся в этом активе —</option>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>))}
                </select>
              </div>)}
          </div>);
      })}
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
        {own.filter((t) => !list.some((p) => p.trait === t.id)).map((t) => (
          <button key={t.id} style={{ ...btn(false), fontSize: 11, padding: "3px 7px" }}
            onClick={() => onAdd(t.id)}>
            + {out ? "выдаёт" : "берёт"} «{t.l}»</button>))}
        {!out && others.length > 0 && (
          <select value={pick} aria-label="взять ресурс из другого актива"
            onChange={(e) => { if (e.target.value) { onAdd(e.target.value); setPick(""); } }}
            style={{ ...S.inp, width: "auto", padding: "4px 6px", fontSize: 11 }}>
            <option value="">+ взять из другого актива…</option>
            {others.filter((t) => !list.some((p) => p.trait === t.id)).map((t) => (
              <option key={t.id} value={t.id}>{assetName(t.e)} · {t.l}</option>))}
          </select>)}
      </div>
    </div>);
}

export function Funcs({ entityId, funcs, setFuncs, traits, entities = [], workers,
  people = [], nameOf, runsOf, open, setOpen, onWhy }) {
  const mine = funcs.filter((f) => f.e === entityId);
  const own = traits.filter((t) => t.e === entityId);
  const others = traits.filter((t) => t.e !== entityId);
  const elsewhere = entities.filter((e) => e.id !== entityId);
  const traitName = (id) => traits.find((t) => t.id === id)?.l || "(ресурс удалён)";
  const assetName = (id) => entities.find((e) => e.id === id)?.name || "другой актив";
  // Назначить на функцию можно только воркера этого актива: люди —
  // свойство актива, и чужой человек означал бы, что список воркеров ни
  // на что не влияет.
  const pool = (k) => people.filter((p) => workers[k].some((id) => String(id) === String(p.id)));

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

  return (
    <Section title="функции актива" addLabel="+ функция" onAdd={add}
      empty={mine.length ? null : "Функций пока нет. Функция может только взять и дать: взять несколько ресурсов и выдать несколько других, а выданное — передать в другие активы. Сколько берёт и сколько выдаёт — диапазон: сначала закладывается, потом уточняется реальными выполнениями."}>
      {mine.map((f) => {
        const runs = runsOf ? runsOf(f.id) : [];
        return (
          <Card key={f.id} title={f.name} titleLabel="функции"
            onTitle={(v) => up(f.id, (x) => ({ ...x, name: v }))}
            open={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)}
            onDelete={() => { setFuncs((p) => p.filter((x) => x.id !== f.id)); setOpen(null); }}
            mark={<Mark text="функция" ok={checkFunc(f, { traits, entities }).ok}
              onWhy={() => onWhy && onWhy(f.id)} />}
            summary={<>
              {f.takes.length ? f.takes.map((t) => traitName(t.trait)).join(", ") : "ничего не берёт"}
              {" → "}
              {f.gives.length
                ? f.gives.map((g) => traitName(g.trait)
                  + (g.to && g.to !== f.e ? ` в «${assetName(g.to)}»` : "")).join(", ")
                : "ничего не выдаёт"}
              {" · "}<Timing func={f} runs={runs} />
            </>}>
            <Ports kind="takes" title="берёт" list={f.takes} own={own} others={others}
              hint="Функция ничего не берёт — значит и преобразовывать ей нечего."
              entities={elsewhere} assetName={assetName} traitName={traitName} runs={runs}
              onAdd={(tid) => up(f.id, (x) => ({ ...x, takes: [...x.takes, newPort(tid)] }))}
              onSet={(pid, patch) => upPort(f.id, "takes", pid, patch)}
              onDel={(pid) => up(f.id, (x) => ({
                ...x, takes: x.takes.filter((p) => p.id !== pid) }))} />

            <Ports kind="gives" title="выдаёт" list={f.gives} own={own} others={others}
              hint="Функция ничего не выдаёт — значит она ничего не производит."
              entities={elsewhere} assetName={assetName} traitName={traitName} runs={runs}
              onAdd={(tid) => up(f.id, (x) => ({ ...x, gives: [...x.gives, newGive(tid)] }))}
              onSet={(pid, patch) => upPort(f.id, "gives", pid, patch)}
              onDel={(pid) => up(f.id, (x) => ({
                ...x, gives: x.gives.filter((p) => p.id !== pid) }))} />

            <div className="flex items-center gap-2" style={{ marginTop: 10, flexWrap: "wrap" }}>
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

            {/* Расписание — не то же самое, что длительность: работа может
                занимать час, но делаться раз в месяц. Пусто значит
                «непрерывно», следующее выполнение сразу за предыдущим. */}
            <div className="flex items-center gap-2" style={{ marginTop: 6, flexWrap: "wrap" }}>
              <span style={S.lbl}>повторяется</span>
              <select value={everyOf(f) > 0 ? "every" : "flow"}
                aria-label="как часто повторяется"
                onChange={(e) => up(f.id, (x) => ({ ...x,
                  every: e.target.value === "every" ? (Number(x.every) || 1) : 0 }))}
                style={{ ...S.inp, width: "auto", padding: "4px 6px", fontSize: 12 }}>
                <option value="flow">непрерывно</option>
                <option value="every">раз в…</option>
              </select>
              {everyOf(f) > 0 && (<>
                <Num value={f.every} label="как часто повторять"
                  onChange={(v) => up(f.id, (x) => ({ ...x, every: Number(v) || 0 }))} />
                <select value={f.everyUnit} aria-label="единица расписания"
                  onChange={(e) => up(f.id, (x) => ({ ...x, everyUnit: e.target.value }))}
                  style={{ ...S.inp, width: "auto", padding: "4px 6px", fontSize: 12 }}>
                  {Object.keys(DUR_UNITS).map((u) => <option key={u} value={u}>{u}</option>)}
                </select></>)}
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 10.5, color: C.muted }}>
                {everyOf(f) > hoursOf(f)
                  ? "реже, чем делается: срок цикла считается по расписанию"
                  : "чаще самой работы не выйдет — считаем по длительности"}</span>
            </div>

            {WORKER_KINDS.map((k) => (
              <People key={k.id} title={k.many} ids={f[k.id] || []} people={pool(k.id)}
                nameOf={nameOf}
                empty={`в активе ещё нет ${k.many.toLowerCase()} — добавьте их в «воркерах актива»`}
                onToggle={(pid) => togglePerson(f.id, k.id, pid)} />))}
          </Card>);
      })}
    </Section>);
}

/* ═══ 3. РЕСУРСЫ ═══
   Ресурс — это то, что есть: сколько его сейчас и сколько нужно. Сам он не
   меняется — его берут и выдают функции, поэтому здесь нет ни стрелок, ни
   формул: только величина, цель и тип. */
export function Traits({ entityId, traits, setTraits, funcs, kinds, kindOf, open, setOpen,
  onWhy, onDelete }) {
  const mine = traits.filter((t) => t.e === entityId);
  const [draft, setDraft] = useState("");
  const up = (id, patch) => setTraits((p) => p.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const add = (kindId) => {
    if (!draft.trim()) return;
    const t = { id: `t${Date.now().toString(36)}`, e: entityId, k: kindId, l: draft.trim(),
      unit: "ед.", have: 0, want: null };
    setTraits((p) => [...p, t]);
    setDraft(""); setOpen(t.id);
  };
  return (
    <Section title="ресурсы актива"
      empty={mine.length ? null : "Ресурсов пока нет. Ресурс — это то, что есть: функции его берут и выдают."}>
      {mine.map((t) => {
        const k = kindOf(t.k);
        const made = funcs.filter((f) => f.gives.some((g) => g.trait === t.id)).length;
        const used = funcs.filter((f) => f.takes.some((p) => p.trait === t.id)).length;
        return (
          <Card key={t.id} title={t.l} titleLabel="ресурса"
            onTitle={(v) => up(t.id, { l: v })}
            open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)}
            onDelete={() => { onDelete(t.id); setOpen(null); }}
            mark={<Mark text="ресурс" ok={checkTrait(t.id, { traits, funcs }).ok}
              onWhy={() => onWhy && onWhy(t.id)} />}
            summary={<>
              <span style={{ color: k.color }}>{k.sign} {k.name}</span>
              {` · есть ${nm(Number(t.have) || 0)} ${t.unit || ""}`}
              {t.want != null ? ` · нужно ${nm(Number(t.want))}` : ""}
              {` · выдают ${made}, берут ${used}`}
            </>}>
            <div className="flex flex-wrap gap-2" style={{ marginTop: 6 }}>
              <div style={{ flex: "1 1 110px" }}>
                <div style={S.lbl}>есть сейчас</div>
                <NumField value={t.have} onCommit={(v) => up(t.id, { have: v ?? 0 })} />
              </div>
              <div style={{ flex: "1 1 110px" }}>
                <div style={S.lbl}>единица</div>
                <TxtField value={t.unit || ""} onCommit={(v) => up(t.id, { unit: v })} />
              </div>
              <div style={{ flex: "1 1 110px" }}>
                <div style={S.lbl}>нужно (цель)</div>
                <NumField value={t.want} placeholder="без цели"
                  onCommit={(v) => up(t.id, { want: v })} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2" style={{ marginTop: 6 }}>
              {kinds.map((x) => (
                <button key={x.id} style={{ ...btn(t.k === x.id, x.color), fontSize: 11,
                  padding: "3px 7px" }} onClick={() => up(t.id, { k: x.id })}>
                  {x.sign} {x.name}</button>))}
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
              Ресурс сам себя не меняет: его берут и выдают функции. Цель —
              это планка, до которой прогноз должен его довести.
            </div>
          </Card>);
      })}
      <div className="flex flex-wrap gap-2" style={{ marginTop: 6 }}>
        <TxtField value={draft} placeholder="текст нового ресурса"
          style={{ flex: "1 1 160px" }} onCommit={setDraft} />
        {kinds.map((k) => (
          <button key={k.id} style={{ ...btn(false), borderColor: k.color, color: k.color,
            fontSize: 11, padding: "3px 7px" }} onClick={() => add(k.id)}>
            + {k.sign} {k.name}</button>))}
      </div>
    </Section>);
}

/* ═══ карточка актива целиком ═══
   Три вкладки одного вида. Какая открыта — состояние интерфейса: в модель
   не уезжает и в историю правок не попадает. */
export default function AssetPanel(props) {
  const [tab, setTab] = useState("funcs");
  const [openFunc, setOpenFunc] = useState(null);
  const [openTrait, setOpenTrait] = useState(null);
  const mineFuncs = props.funcs.filter((f) => f.e === props.entityId).length;
  const mineTraits = props.traits.filter((t) => t.e === props.entityId).length;
  const workers = WORKER_KINDS
    .reduce((n, k) => n + (props.workers[k.id] || []).length, 0);
  const TABS = [
    ["workers", "Воркеры", workers],
    ["funcs", "Функции", mineFuncs],
    ["traits", "Ресурсы", mineTraits],
  ];
  return (
    <div>
      <div className="flex gap-2" style={{ marginTop: 10, overflowX: "auto" }}>
        {TABS.map(([id, name, n]) => (
          <button key={id} style={{ ...btn(tab === id), fontSize: 12 }}
            onClick={() => setTab(id)}>
            {name} <span style={{ opacity: 0.7 }}>{n}</span></button>))}
      </div>

      {tab === "workers" && (
        <Workers workers={props.workers} people={props.people} nameOf={props.nameOf}
          tasks={props.tasks} funcs={props.funcs}
          onToggle={props.onToggleWorker} onOrder={props.onOrderWorker}
          onOpenPerson={props.onOpenPerson} />)}

      {tab === "funcs" && (
        <Funcs {...props} open={openFunc} setOpen={setOpenFunc} onWhy={props.onWhyFunc} />)}

      {tab === "traits" && (
        <Traits entityId={props.entityId} traits={props.traits} setTraits={props.setTraits}
          funcs={props.funcs} kinds={props.kinds} kindOf={props.kindOf}
          open={openTrait} setOpen={setOpenTrait}
          onWhy={props.onWhyTrait} onDelete={props.onDeleteTrait} />)}
    </div>);
}
