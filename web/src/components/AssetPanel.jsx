import React, { useEffect, useState } from "react";
import { C, OK, BAD, ACC, WARN, S, btn, nm, NumField, TxtField } from "./ui.jsx";
import { DUR_UNITS, FUNC_KINDS, WORKER_KINDS, checkFunc, checkTrait, countWorkers,
  chanceOf, everyOf, everyRange, groupsOf, sameEvery, sameHours,
  funcKind, isFactor, newFactor, fromHours,
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
      {/* План — вилка, и подписью она должна быть вилкой: одно число здесь
          выглядело бы обещанием, которого никто не давал. */}
      <span style={{ color: WARN }} title="план: столько заложено на одно выполнение">
        {sameHours(func)
          ? `${nm(func.dur)} ${func.durUnit}`
          : `${nm(func.dur)}–${nm(func.durHi)} ${func.durUnit}`}</span>
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
 * Вход и выход устроены одинаково, и добавляются одинаково — одним полем,
 * в котором лежат ВСЕ ресурсы схемы: свои и чужие. Прежде их было два —
 * кнопки для своих и отдельный список «взять из другого актива», — и это
 * был вопрос не по делу: функции всё равно, чей ресурс она берёт.
 *
 * Получателя у выхода нет. Ресурс уже принадлежит своему активу, и
 * выдать чужой ресурс значит передать туда. Отдельное поле «передаёт в»
 * спрашивало то, что уже сказано выбором ресурса, и могло разойтись с ним:
 * выбран ресурс одного актива, получателем назван другой — и что тогда
 * правда, не знал никто.
 */
function Ports({ kind, title, hint, list, own, others, assetName, traitName,
  runs, onAdd, onSet, onDel }) {
  const [pick, setPick] = useState("");
  const out = kind === "gives";
  const taken = (t) => list.some((p) => p.trait === t.id);
  const free = { own: own.filter((t) => !taken(t)), others: others.filter((t) => !taken(t)) };
  const anyFree = free.own.length > 0 || free.others.length > 0;
  // Требования функции: между группами «и», внутри группы «или».
  const groups = groupsOf(list);
  // Чужие ресурсы в списке идут по активам: «заявки» и «заявки» из разных
  // активов иначе не различить.
  const byAsset = [];
  free.others.forEach((t) => {
    const row = byAsset.find((g) => g.e === t.e);
    if (row) row.list.push(t); else byAsset.push({ e: t.e, list: [t] });
  });
  /* Один и тот же список ресурсов нужен и полю «+ берёт», и полю «или» у
     каждой группы: собираем его один раз. */
  const options = (<>
    {free.own.length > 0 && (
      <optgroup label="этот актив">
        {free.own.map((t) => (<option key={t.id} value={t.id}>{t.l}</option>))}
      </optgroup>)}
    {byAsset.map((g) => (
      <optgroup key={g.e} label={assetName(g.e)}>
        {g.list.map((t) => (<option key={t.id} value={t.id}>{t.l}</option>))}
      </optgroup>))}
  </>);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ ...S.lbl, marginBottom: 4 }}>{title}</div>
      {list.length === 0 && (
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{hint}</div>)}
      {groups.map((g, gi) => (
        <div key={g[0].id}>
          {/* «И» между требованиями: разделитель стоит МЕЖДУ группами, а не
              подписью у каждой, — иначе первая группа выглядела бы как
              продолжение чего-то, чего перед ней нет. */}
          {gi > 0 && (
            <div style={{ ...S.lbl, textAlign: "center", margin: "2px 0 4px" }}>и</div>)}
          <div style={{ border: `1px solid ${g.length > 1 ? ACC : "transparent"}`,
            borderRadius: 7, padding: g.length > 1 ? 5 : 0, marginBottom: 5 }}>
            {g.map((p, i) => {
              const at = others.find((t) => t.id === p.trait);
              return (
                <div key={p.id}>
                  {i > 0 && (
                    <div style={{ ...S.lbl, color: ACC, textAlign: "center",
                      margin: "3px 0" }}>или</div>)}
                  <div style={{ border: `1px solid ${okRange(p) ? C.line : BAD}`,
                    borderRadius: 6, padding: 7 }}>
                    <div className="flex items-center gap-2">
                      <span style={{ flex: 1, fontSize: 12, minWidth: 0 }}>
                        {traitName(p.trait)}
                        {/* Чужой ресурс — это и есть связь с другим активом:
                            взятый приходит оттуда, выданный уходит туда. */}
                        {at && (
                          <span style={{ color: ACC, fontSize: 11 }}>
                            {out ? " → в актив «" : " ← из актива «"}{assetName(at.e)}»</span>)}
                      </span>
                      <button style={{ ...btn(false), fontSize: 11, padding: "2px 6px",
                        color: BAD }}
                        aria-label={`убрать ${out ? "выход" : "вход"} ${traitName(p.trait)}`}
                        onClick={() => onDel(p.id)}>×</button>
                    </div>
                    <div className="flex items-center gap-2"
                      style={{ marginTop: 5, flexWrap: "wrap" }}>
                      <span style={S.lbl}>от</span>
                      <Num value={p.lo} label={`сколько минимум ${traitName(p.trait)}`}
                        onChange={(v) => onSet(p.id, { lo: Number(v) || 0 })} />
                      <span style={S.lbl}>до</span>
                      <Num value={p.hi} label={`сколько максимум ${traitName(p.trait)}`}
                        onChange={(v) => onSet(p.id, { hi: Number(v) || 0 })} />
                      <span style={{ flex: 1 }} />
                      <Fact plan={rangeText(p)} fact={runQty(runs, kind, p.trait)} />
                    </div>
                  </div>
                </div>);
            })}
            {/* ДобавитьВАРИАНТ в эту группу — «или», а не «и». Отдельным полем
                у каждой группы: иначе пришлось бы сперва завести вход, а
                потом объяснять приложению, к чему он относится. */}
            {!out && anyFree && (
              <select value="" aria-label={`или вместо ${traitName(g[0].trait)}`}
                onChange={(e) => { if (e.target.value) onAdd(e.target.value, g[0].group); }}
                style={{ ...S.inp, width: "100%", maxWidth: "100%", minWidth: 0,
                  boxSizing: "border-box", padding: "4px 6px", fontSize: 11,
                  marginTop: 4, color: C.muted }}>
                <option value="">или вместо этого…</option>
                {options}
              </select>)}
          </div>
        </div>))}
      {(free.own.length > 0 || free.others.length > 0) && (
        /* Ширина — по форме, а не по самому длинному названию: у select
           ширина считается по содержимому, и одно длинное имя ресурса
           растягивало поле за край карточки. */
        <select value={pick} aria-label={out ? "выдать ресурс" : "взять ресурс"}
          onChange={(e) => { if (e.target.value) { onAdd(e.target.value); setPick(""); } }}
          style={{ ...S.inp, width: "100%", maxWidth: "100%", minWidth: 0,
            boxSizing: "border-box", padding: "5px 6px", fontSize: 12 }}>
          <option value="">{out ? "+ выдаёт ресурс…" : "+ берёт ресурс… (и)"}</option>
          {options}
        </select>)}
    </div>);
}

export function Funcs({ entityId, funcs, setFuncs, traits, entities = [], workers,
  factors = [], people = [], nameOf, runsOf, open, setOpen, onWhy }) {
  const mine = funcs.filter((f) => f.e === entityId);
  const own = traits.filter((t) => t.e === entityId);
  const others = traits.filter((t) => t.e !== entityId);
  const traitName = (id) => traits.find((t) => t.id === id)?.l || "(ресурс удалён)";
  const assetName = (id) => entities.find((e) => e.id === id)?.name || "другой актив";
  const factorName = (id) => factors.find((x) => x.id === id)?.name || "(фактор удалён)";
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
            mark={<Mark text="функция" ok={checkFunc(f, { traits, factors }).ok}
              onWhy={() => onWhy && onWhy(f.id)} />}
            summary={<>
              {/* В свёрнутой строке «или» обязано быть видно: без него
                  «спрос, пользователи» читается как «и то, и другое», а это
                  прямо противоположно тому, что задано. */}
              {f.takes.length
                ? groupsOf(f.takes)
                  .map((g) => g.map((t) => traitName(t.trait)).join(" или "))
                  .join(", ")
                : "ничего не берёт"}
              {" → "}
              {f.gives.length
                ? f.gives.map((g) => {
                  const at = others.find((t) => t.id === g.trait);
                  return traitName(g.trait) + (at ? ` в «${assetName(at.e)}»` : "");
                }).join(", ")
                : "ничего не выдаёт"}
              {" · "}<Timing func={f} runs={runs} />
              {isFactor(f) && (
                <span style={{ color: ACC }}>
                  {" · фактор"}{f.factor ? `: ${factorName(f.factor)}` : " не выбран"}</span>)}
            </>}>
            <Ports kind="takes" title="берёт" list={f.takes} own={own} others={others}
              hint="Функция ничего не берёт — значит и преобразовывать ей нечего."
              assetName={assetName} traitName={traitName} runs={runs}
              onAdd={(tid, group) => up(f.id, (x) => ({ ...x,
                takes: [...x.takes, newPort(tid, 1, 1, group)] }))}
              onSet={(pid, patch) => upPort(f.id, "takes", pid, patch)}
              onDel={(pid) => up(f.id, (x) => ({
                ...x, takes: x.takes.filter((p) => p.id !== pid) }))} />

            <Ports kind="gives" title="выдаёт" list={f.gives} own={own} others={others}
              hint="Функция ничего не выдаёт — значит она ничего не производит."
              assetName={assetName} traitName={traitName} runs={runs}
              onAdd={(tid) => up(f.id, (x) => ({ ...x, gives: [...x.gives, newGive(tid)] }))}
              onSet={(pid, patch) => upPort(f.id, "gives", pid, patch)}
              onDel={(pid) => up(f.id, (x) => ({
                ...x, gives: x.gives.filter((p) => p.id !== pid) }))} />

            {/* Время — такая же вилка, как количества: работа редко занимает
                ровно столько, сколько задумано. Когда занимает — галочка
                «одинаковое» связывает границы, и число вводится одно. */}
            <div className="flex items-center gap-2" style={{ marginTop: 10, flexWrap: "wrap" }}>
              <span style={S.lbl}>выполняется за</span>
              <span style={S.lbl}>от</span>
              <Num value={f.dur} label="время одного выполнения"
                onChange={(v) => up(f.id, (x) => ({ ...x, dur: Number(v) || 0,
                  ...(sameHours(x) ? { durHi: Number(v) || 0 } : {}) }))} />
              {!sameHours(f) && (<>
                <span style={S.lbl}>до</span>
                <Num value={f.durHi} label="время одного выполнения максимум"
                  onChange={(v) => up(f.id, (x) => ({ ...x, durHi: Number(v) || 0 }))} />
              </>)}
              <select value={f.durUnit} aria-label="единица времени функции"
                onChange={(e) => up(f.id, (x) => ({ ...x, durUnit: e.target.value }))}
                style={{ ...S.inp, width: "auto", padding: "4px 6px", fontSize: 12 }}>
                {Object.keys(DUR_UNITS).map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <span style={{ flex: 1 }} />
              <Timing func={f} runs={runs} />
            </div>
            <label className="flex items-center gap-2"
              style={{ marginTop: 5, fontSize: 11, color: C.muted, cursor: "pointer" }}>
              <input type="checkbox" aria-label="одинаковое" checked={sameHours(f)}
                onChange={(e) => up(f.id, (x) => ({ ...x,
                  durHi: e.target.checked ? Number(x.dur) || 0
                    : Math.max(Number(x.dur) || 0, Number(x.durHi) || 0) * 2 }))}
                style={{ accentColor: ACC }} />
              одинаковое — время известно точно, а не вилкой
            </label>

            {/* Через сколько будет следующая ПОПЫТКА — не «повторение»:
                попытка может и не удаться. «Сразу» значит, что следующая
                начинается за предыдущей и всё упирается только в саму
                работу. Тоже вилка: срок между попытками редко бывает
                ровным. */}
            <div className="flex items-center gap-2" style={{ marginTop: 6, flexWrap: "wrap" }}>
              <span style={S.lbl}>следующая попытка через</span>
              <select value={everyRange(f).hi > 0 ? "every" : "flow"}
                aria-label="когда следующая попытка"
                onChange={(e) => up(f.id, (x) => {
                  const on = e.target.value === "every";
                  const v = on ? (Number(x.every) || 1) : 0;
                  return { ...x, every: v, everyHi: on ? Math.max(v, Number(x.everyHi) || 0) : 0 };
                })}
                style={{ ...S.inp, width: "auto", padding: "4px 6px", fontSize: 12 }}>
                <option value="flow">сразу</option>
                <option value="every">через…</option>
              </select>
              {everyRange(f).hi > 0 && (<>
                <span style={S.lbl}>от</span>
                <Num value={f.every} label="через сколько следующая попытка"
                  onChange={(v) => up(f.id, (x) => ({ ...x, every: Number(v) || 0,
                    ...(sameEvery(x) ? { everyHi: Number(v) || 0 } : {}) }))} />
                {!sameEvery(f) && (<>
                  <span style={S.lbl}>до</span>
                  <Num value={f.everyHi} label="через сколько следующая попытка максимум"
                    onChange={(v) => up(f.id, (x) => ({ ...x, everyHi: Number(v) || 0 }))} />
                </>)}
                <select value={f.everyUnit} aria-label="единица срока попытки"
                  onChange={(e) => up(f.id, (x) => ({ ...x, everyUnit: e.target.value }))}
                  style={{ ...S.inp, width: "auto", padding: "4px 6px", fontSize: 12 }}>
                  {Object.keys(DUR_UNITS).map((u) => <option key={u} value={u}>{u}</option>)}
                </select></>)}
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 10.5, color: C.muted }}>
                {everyOf(f) > hoursOf(f)
                  ? "реже, чем делается: потолок считается по этому сроку"
                  : "чаще самой работы не выйдет — потолок по длительности"}</span>
            </div>
            {everyRange(f).hi > 0 && (
              <label className="flex items-center gap-2"
                style={{ marginTop: 5, fontSize: 11, color: C.muted, cursor: "pointer" }}>
                <input type="checkbox" aria-label="одинаковый срок попытки"
                  checked={sameEvery(f)}
                  onChange={(e) => up(f.id, (x) => ({ ...x,
                    everyHi: e.target.checked ? Number(x.every) || 0
                      : Math.max(Number(x.every) || 0, Number(x.everyHi) || 0) * 2 }))}
                  style={{ accentColor: ACC }} />
                одинаковый — срок между попытками известен точно
              </label>)}

            {/* Чем функция выполняется — людьми или сама собой. Вопрос
                стоит ПЕРЕД ролями, потому что от ответа зависит, есть ли
                они вообще: у фактора исполнителя нет, и показывать пустые
                списки значило бы спрашивать, кто отвечает за погоду. */}
            <div style={{ ...S.lbl, marginTop: 10 }}>чем выполняется</div>
            <div className="flex flex-wrap gap-2" style={{ marginTop: 4 }}>
              {FUNC_KINDS.map((k) => (
                <label key={k.id} className="flex items-center gap-2"
                  style={{ ...btn(funcKind(f) === k.id), padding: "5px 10px",
                    cursor: "pointer" }}>
                  <input type="radio" name={`kind-${f.id}`} value={k.id}
                    aria-label={k.name} checked={funcKind(f) === k.id}
                    onChange={() => up(f.id, (x) => ({ ...x, kind: k.id }))}
                    style={{ accentColor: ACC }} />
                  {k.name}
                </label>))}
            </div>

            {isFactor(f) ? (<>
              <div style={{ ...S.lbl, marginTop: 8 }}>с какой вероятностью случается</div>
              <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
                <Num value={chanceOf(f)} label="вероятность фактора"
                  onChange={(v) => up(f.id, (x) => ({ ...x,
                    chance: Math.max(0, Math.min(100, Number(v) || 0)) }))} />
                <span style={{ fontSize: 12, color: C.muted }}>%</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 10.5, color: C.muted, textAlign: "right" }}>
                  {chanceOf(f) >= 100
                    ? "удаётся каждая попытка"
                    : `удаётся примерно каждая ${Math.round(100 / Math.max(chanceOf(f), 1))}-я`}
                </span>
              </div>
              <div style={{ ...S.lbl, marginTop: 8 }}>какой фактор</div>
              <select value={f.factor || ""} aria-label="фактор функции"
                onChange={(e) => up(f.id, (x) => ({ ...x, factor: e.target.value }))}
                style={{ ...S.inp, marginTop: 4, padding: "6px 7px", fontSize: 12 }}>
                <option value="">— выберите —</option>
                {factors.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
              </select>
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
                {factors.length
                  ? "Фактор происходит без человека: ресурсы он меняет так же, но задач по нему не заводится и спрашивать за него не с кого."
                  : "Факторов в активе ещё нет — заведите их во вкладке «Факторы»."}
              </div>
            </>) : WORKER_KINDS.map((k) => (
              <People key={k.id} title={k.many} ids={f[k.id] || []} people={pool(k.id)}
                nameOf={nameOf}
                empty={`в активе ещё нет ${k.many.toLowerCase()} — добавьте их в «воркерах актива»`}
                onToggle={(pid) => togglePerson(f.id, k.id, pid)} />))}
          </Card>);
      })}
    </Section>);
}

/* ═══ 4. ФАКТОРЫ ═══
   То, что меняет ресурсы без человека: сезон, износ, курс, реклама,
   которая крутится сама. Форма та же, что у остальных частей актива:
   название и удаление — больше у фактора ничего и нет. */
export function Factors({ entityId, factors, setFactors, funcs, setFuncs }) {
  const mine = factors.filter((x) => x.e === entityId);
  const [draft, setDraft] = useState("");
  const used = (id) => funcs.filter((f) => isFactor(f) && f.factor === id).length;
  const add = () => {
    setFactors((p) => [...p, newFactor(entityId, draft.trim() || "новый фактор")]);
    setDraft("");
  };
  const del = (id) => {
    setFactors((p) => p.filter((x) => x.id !== id));
    /* Функции, ссылавшиеся на удалённый фактор, не остаются с мёртвой
       ссылкой: они краснеют подписью «фактор не выбран», а не молча
       считаются исправными. */
    setFuncs((p) => p.map((f) => (f.factor === id ? { ...f, factor: "" } : f)));
  };
  return (
    <Section title="факторы актива"
      hint="Фактор — то, что меняет ресурсы без человека: сезон, износ, курс, реклама, которая крутится сама. Задач по нему не заводится и спрашивать за него не с кого."
      empty={mine.length ? null : "Факторов пока нет."}>
      {mine.map((x) => (
        <div key={x.id} className="flex items-center gap-2" style={{ marginTop: 6 }}>
          <TxtField value={x.name} aria-label="название фактора"
            style={{ flex: "1 1 140px", padding: "5px 7px", fontSize: 12.5 }}
            onCommit={(v) => setFactors((p) => p.map((y) => (y.id === x.id
              ? { ...y, name: v } : y)))} />
          <span style={{ fontSize: 10.5, color: C.muted, whiteSpace: "nowrap" }}>
            {used(x.id) ? `функций: ${used(x.id)}` : "не используется"}</span>
          <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436",
            fontSize: 11, padding: "2px 6px" }} aria-label={`удалить фактор ${x.name}`}
            onClick={() => del(x.id)}>✕</button>
        </div>))}
      <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
        <TxtField value={draft} placeholder="название нового фактора"
          style={{ flex: "1 1 160px" }} onCommit={setDraft} />
        <button style={btn(false)} onClick={add}>+ фактор</button>
      </div>
    </Section>);
}

/**
 * Классификации ресурсов — здесь же, на вкладке ресурсов.
 *
 * Классификация это свойство ресурса: значок и цвет, которыми он помечен.
 * Держать её отдельно от ресурсов значило разложить одно понятие по двум
 * местам — правишь тип, а ресурсы, которым он принадлежит, в другой
 * вкладке. Спойлер оставлен: правят их редко, а место они занимают всегда.
 */
export function Kinds({ kinds, onUp, onAdd, onDel, msg }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
      <button style={{ background: "none", border: "none", padding: 0, width: "100%",
        textAlign: "left", cursor: "pointer", color: C.muted }}
        aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span style={S.lbl}>{open ? "▾" : "▸"} классификации ресурсов</span>
        <span style={{ fontSize: 10.5, color: C.muted }}> · {kinds.length}</span>
      </button>
      {open && (<>
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
          Каждый ресурс относится к одной классификации: она задаёт значок и
          цвет. Удаление переводит её ресурсы в первую оставшуюся.
        </div>
        <div style={{ marginTop: 8 }}>
          {kinds.map((k) => (
            <div key={k.id} className="flex flex-wrap gap-2"
              style={{ alignItems: "center", marginBottom: 6 }}>
              <TxtField value={k.sign} aria-label={`значок ${k.name}`}
                style={{ flex: "0 0 52px", textAlign: "center" }}
                onCommit={(v) => onUp(k.id, "sign", v || "•")} />
              <TxtField value={k.name} aria-label="название классификации"
                style={{ flex: "1 1 130px" }} onCommit={(v) => onUp(k.id, "name", v)} />
              <input type="color" value={k.color} aria-label={`цвет ${k.name}`}
                onChange={(e) => onUp(k.id, "color", e.target.value)}
                style={{ width: 38, height: 30, background: "none", border: "none" }} />
              <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
                onClick={() => onDel(k.id)}>✕</button>
            </div>))}
          <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
            <button style={btn(false)} onClick={onAdd}>+ классификация</button>
            {msg && <span style={{ fontSize: 11, color: C.muted }}>{msg}</span>}
          </div>
        </div>
      </>)}
    </div>);
}

/* ═══ 3. РЕСУРСЫ ═══
   Ресурс — это то, что есть: сколько его сейчас. Сам он не меняется — его
   берут и выдают функции, поэтому здесь нет ни стрелок, ни формул: только
   величина и тип.

   Цели здесь тоже нет, и это осознанно. Поле «сколько нужно» обедняло
   цель до числа, а цель — это ещё темп («один клиент В НЕДЕЛЮ»), срок и
   цена. Всё это живёт в «Прогнозе», где считается; здесь ему места нет. */
export function Traits({ entityId, traits, setTraits, funcs, kinds, kindOf, open, setOpen,
  onWhy, onDelete, onUpKind, onAddKind, onDelKind, kindMsg }) {
  const mine = traits.filter((t) => t.e === entityId);
  const [draft, setDraft] = useState("");
  const up = (id, patch) => setTraits((p) => p.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const add = (kindId) => {
    if (!draft.trim()) return;
    const t = { id: `t${Date.now().toString(36)}`, e: entityId, k: kindId, l: draft.trim(),
      unit: "ед.", have: 0 };
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
            </div>
            <div className="flex flex-wrap gap-2" style={{ marginTop: 6 }}>
              {kinds.map((x) => (
                <button key={x.id} style={{ ...btn(t.k === x.id, x.color), fontSize: 11,
                  padding: "3px 7px" }} onClick={() => up(t.id, { k: x.id })}>
                  {x.sign} {x.name}</button>))}
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
              Ресурс сам себя не меняет: его берут и выдают функции. Цель по
              нему ставится в «Прогнозе»: у неё есть темп, срок и цена, и
              одним числом здесь она не выражается.
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
      {onUpKind && (
        <Kinds kinds={kinds} onUp={onUpKind} onAdd={onAddKind} onDel={onDelKind}
          msg={kindMsg} />)}
    </Section>);
}

/* ═══ карточка актива целиком ═══
   Три вкладки одного вида. Какая открыта — состояние интерфейса: в модель
   не уезжает и в историю правок не попадает. */
export default function AssetPanel(props) {
  const [tab, setTab] = useState("funcs");
  const [openFunc, setOpenFunc] = useState(null);
  const [openTrait, setOpenTrait] = useState(null);
  /* Снаружи можно попросить открыть конкретную функцию — так работает
     нажатие на стрелку передачи в схеме. Просьба приходит с меткой `n`:
     без неё повторное нажатие на ту же стрелку ничего бы не сделало, ведь
     значение не изменилось. */
  const focus = props.focus;
  useEffect(() => {
    if (!focus || focus.kind !== "func") return;
    setTab("funcs");
    setOpenFunc(focus.id);
  }, [focus?.id, focus?.n, focus?.kind]);
  const mineFuncs = props.funcs.filter((f) => f.e === props.entityId).length;
  const mineTraits = props.traits.filter((t) => t.e === props.entityId).length;
  const mineFactors = (props.factors || []).filter((x) => x.e === props.entityId).length;
  // Людей, а не назначений: один человек может быть всеми тремя сразу.
  const workers = countWorkers(props.workers);
  const TABS = [
    ["workers", "Воркеры", workers],
    ["funcs", "Функции", mineFuncs],
    ["traits", "Ресурсы", mineTraits],
    ["factors", "Факторы", mineFactors],
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

      {tab === "factors" && (
        <Factors entityId={props.entityId} factors={props.factors || []}
          setFactors={props.setFactors} funcs={props.funcs} setFuncs={props.setFuncs} />)}

      {tab === "traits" && (
        <Traits entityId={props.entityId} traits={props.traits} setTraits={props.setTraits}
          funcs={props.funcs} kinds={props.kinds} kindOf={props.kindOf}
          open={openTrait} setOpen={setOpenTrait}
          onWhy={props.onWhyTrait} onDelete={props.onDeleteTrait}
          onUpKind={props.onUpKind} onAddKind={props.onAddKind}
          onDelKind={props.onDelKind} kindMsg={props.kindMsg} />)}
    </div>);
}
