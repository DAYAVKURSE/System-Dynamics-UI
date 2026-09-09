import React, { useEffect, useState } from "react";
import { C, OK, BAD, ACC, WARN, S, btn, nm, NumField, TxtField } from "./ui.jsx";
import { DUR_UNITS, FUNC_KINDS, WORKER_KINDS, byCrew, checkFunc, checkTrait, countWorkers,
  editFunc, funcState,
  crewOf,
  chanceOf, everyOf, everyRange, factorChance, factorsOf, groupsOf, sameEvery, sameHours,
  funcKind, isFactor, newFactor, fromHours,
  hoursOf, newFunc, newGive, newPort, okRange, portSpends, rangeText, runHours,
  runQty } from "../lib/funcs.js";
import { Mark } from "./Modal.jsx";
import { statusColor } from "./ProfilePanel.jsx";
import { scheduleOfPerson, statusOf, visibleStats } from "../lib/workers.js";
import { unitsOf } from "../lib/units.js";

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
  onDelete, children, accent }) {
  return (
    /* Полоса слева — состояние карточки одним взглядом, без чтения. В
       списке из двадцати функций это единственный способ увидеть, где
       недоделано: подпись под названием для этого приходится читать. */
    <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8,
      padding: 8, marginBottom: 6,
      borderLeft: `2px solid ${accent || C.line}` }}>
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

/**
 * Сколько ресурса функция берёт или выдаёт.
 *
 * Чаще всего это ТОЧНОЕ число: «берёт две заявки», «выдаёт один макет». Два
 * поля «от» и «до» заставляли писать это число дважды и читались как
 * обещание неопределённости, которой нет. Поэтому по умолчанию поле одно, а
 * вилка — по галочке «диапазон», для случаев, когда сколько именно уйдёт,
 * решается на месте («от 2 до 4 обращений»).
 *
 * В записи по-прежнему две границы (`lo`, `hi`) — точное число это `lo`,
 * равное `hi`: заводить второй способ записать то же самое значило бы
 * получить два вида порта и два прогноза по ним.
 *
 * Галочка живёт в состоянии окна, а не в модели: «от 3 до 3» и «ровно 3» —
 * одно и то же, и хранить, каким из двух способов это набрали, незачем.
 * Открывается она по тому, различаются ли границы.
 */
function PortQty({ p, name, onSet, fact }) {
  const lo = Number(p.lo) || 0;
  const hi = Number(p.hi) || 0;
  const [ranged, setRanged] = useState(lo !== hi);
  const exact = () => {
    // Схлопывая вилку, берём нижнюю границу: она — то, на что рассчитывали.
    const one = lo || hi;
    setRanged(false);
    if (lo !== one || hi !== one) onSet({ lo: one, hi: one });
  };
  /* Своей строки у количества нет: оно стоит в строке ресурса, рядом с тем,
     расходуется ли взятое. Отдельная строка на каждое поле разносила один
     ресурс на пять строк, и список переставал читаться списком. */
  const box = { width: 46, fontSize: 11.5, padding: "3px 4px" };
  return (<>
    {ranged ? (<>
      <span style={S.lbl}>от</span>
      <Num value={p.lo} label={`сколько минимум ${name}`} style={box}
        onChange={(v) => onSet({ lo: Number(v) || 0 })} />
      <span style={S.lbl}>до</span>
      <Num value={p.hi} label={`сколько максимум ${name}`} style={box}
        onChange={(v) => onSet({ hi: Number(v) || 0 })} />
    </>) : (<>
      <span style={S.lbl}>ровно</span>
      {/* Одно число — сразу обе границы: иначе прогноз считал бы вилку,
          которой человек не задавал. */}
      <Num value={p.lo} label={`сколько ${name}`} style={box}
        onChange={(v) => onSet({ lo: Number(v) || 0, hi: Number(v) || 0 })} />
    </>)}
    <label className="flex items-center gap-2"
      style={{ fontSize: 10.5, color: C.muted, cursor: "pointer" }}>
      <input type="checkbox" aria-label={`диапазон ${name}`} checked={ranged}
        onChange={(e) => (e.target.checked ? setRanged(true) : exact())}
        style={{ accentColor: ACC }} />
      диапазон
    </label>
    {fact}
  </>);
}

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
/**
 * Строка человека в списке: должность, имя, статистика, рейтинг, работы.
 *
 * Порядок не случаен и читается слева направо как ответ на «кто это и
 * стоит ли ему поручать»: сперва КЕМ он числится, потом КТО он, потом как
 * работает — сроки, оценка, объём. Свалить это в одну серую строку через
 * точки значило бы заставить искать нужное число глазами.
 *
 * Чего нет — так и сказано словом: «без оценок» честнее нуля, который
 * читается как «оценили на ноль». Про себя — «свой рейтинг скрыт»: свои
 * оценки человеку не показываются, рейтинг работает на того, кто поручает.
 */
function WorkerLine({ pid, name, stat, person, positionName }) {
  const sc = scheduleOfPerson(person || {});
  const st = statusOf(sc.status);
  const chip = (text, color) => (
    <span style={{ fontSize: 10.5, color: color || C.muted,
      whiteSpace: "nowrap" }}>{text}</span>);
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 7,
      alignItems: "baseline" }}>
      {/* 1. должность — кем человек числится в организации */}
      {chip(positionName || "без должности", ACC)}
      {/* 2. имя */}
      <span style={{ fontSize: 12.5, color: C.text }}>{name}</span>
      {/* 3. статистика — как он держит сроки */}
      {chip(stat.onTime == null ? "сроков нет"
        : `в срок ${Math.round(stat.onTime * 100)}%`,
      stat.onTime == null ? C.muted : stat.onTime >= 0.8 ? OK : WARN)}
      {/* 4. рейтинг — средняя ОПУБЛИКОВАННАЯ оценка за принятые работы */}
      {chip(stat.self ? "свой рейтинг скрыт"
        : stat.mark == null ? "без оценок"
          : `рейтинг ${Math.round(stat.mark * 10) / 10}`,
      stat.self || stat.mark == null ? C.muted
        : stat.mark >= 4 ? OK : stat.mark >= 3 ? WARN : BAD)}
      {/* 5. сколько работ сдано и принято */}
      {chip(`${stat.done} сдано`)}
      {/* Статус стоит здесь же: он отвечает «можно ли поручить прямо
          сейчас», и узнавать это, открыв карточку, поздно. */}
      {chip(`· ${st.name}`, statusColor(sc.status))}
    </span>);
}

export function Workers({ workers, people = [], nameOf, tasks = [], funcs = [],
  positionOf, onToggleCrew, onOrder, onOpenPerson, published, me,
  positions = [], onAddPosition, onDropPosition, onSetPosition }) {
  /* Должности заводятся ЗДЕСЬ, рядом с людьми: кем человек числится,
     решают там же, где решают, кто где работает. Роль в организации —
     ДРУГОЕ: она отвечает на «что человеку показывать» (вкладки) и живёт в
     «Людях и ролях». Один и тот же дизайнер бывает и исполнителем, и
     проверяющим, поэтому общего списка у них быть не может. */
  const [newPosition, setNewPosition] = useState("");
  const [posMsg, setPosMsg] = useState("");
  const act = async (fn) => {
    setPosMsg("");
    try { await fn(); } catch (e) { setPosMsg(e.message || "не вышло"); }
  };
  // Кто смотрит — тот себя в списке видит без рейтинга (`visibleStats`).
  const stat = (id) => visibleStats({ tasks, funcs, published }, id, me?.id);
  const personOf = (id) => people.find((p) => String(p.id) === String(id)) || {};
  // Воркеры актива одним списком — без деления на роли: сперва «кто здесь
  // работает», и только потом «кто чем занят».
  const crew = crewOf(workers);
  const inCrew = (id) => crew.some((x) => String(x) === String(id));
  const name = (id) => (nameOf ? nameOf(id) : id);
  return (
    <Section title="воркеры актива"
      hint="Кто вообще работает в этом активе. Постановщика, исполнителя и проверяющего выбирают у КАЖДОЙ ФУНКЦИИ отдельно — из отмеченных здесь."
      empty={people.length ? null : "Людей ещё нет — заведите их во вкладке «Люди и роли»."}>
      {people.length > 0 && (<>
        {/* ─── воркеры ───

            Один список, и только он. Прежде тут же стояли три списка ролей
            — постановщики, исполнители, проверяющие актива, — и они
            отвечали на вопрос, которого никто не задавал: роль человек
            исполняет НЕ В АКТИВЕ ВООБЩЕ, а в конкретной работе. Один и тот
            же человек ставит одну функцию и выполняет другую, и «он
            исполнитель актива» это стирало. Роли теперь у функции, а здесь
            остался ответ на «кто здесь работает».

            Нажатие на имя открывает окно человека — график, статус, анкету
            и рейтинг. Окно, а не страницу: со страницы человек уезжал бы из
            актива, который сейчас собирает, и возвращаться было бы некуда.

            Порядок здесь задаёт человек, и именно в этом порядке воркеры
            показываются потом в формах выбора: у выбирающего бывают
            причины, которых в цифрах нет. */}
        <div style={{ background: C.panel2, border: `1px solid ${C.line}`,
          borderRadius: 8, padding: 8 }}>
          <div style={{ ...S.lbl, marginBottom: 4 }}>воркеры</div>
          {!crew.length && (
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
              Пока никого: отметьте, кто работает в этом активе.</div>)}
          {[...crew, ...people.map((p) => p.id).filter((id) => !inCrew(id))]
            .map((pid, i) => {
              const on = inCrew(pid);
              return (
                <div key={pid} className="flex flex-wrap gap-2"
                  style={{ padding: "5px 0", opacity: on ? 1 : 0.55,
                    alignItems: "center",
                    borderTop: i ? `1px solid ${C.line}` : "none" }}>
                  <input type="checkbox" checked={on}
                    aria-label={`воркер актива: ${name(pid)}`}
                    onChange={() => onToggleCrew && onToggleCrew(pid)}
                    style={{ accentColor: ACC }} />
                  <button style={{ background: "none", border: "none", padding: 0,
                    flex: "1 1 150px", textAlign: "left", cursor: "pointer",
                    color: C.text, minWidth: 0 }}
                    onClick={() => onOpenPerson && onOpenPerson(pid)}
                    title="график, статус, анкета и рейтинг — окном, не уходя со схемы">
                    <WorkerLine pid={pid} name={name(pid)} stat={stat(pid)}
                      person={personOf(pid)}
                      positionName={positionOf && positionOf(pid)} />
                  </button>
                  {onSetPosition && positions.length > 0 && (
                    <select style={{ ...S.inp, width: "auto", fontSize: 11, padding: "2px 4px" }}
                      aria-label={`должность: ${name(pid)}`}
                      value={personOf(pid).position || ""}
                      onChange={(e) => act(() => onSetPosition(pid, e.target.value))}>
                      <option value="">— без должности —</option>
                      {positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>)}
                  {on && (<>
                    <button style={{ ...btn(false), fontSize: 11, padding: "1px 6px" }}
                      aria-label={`выше: ${name(pid)}`} disabled={i === 0}
                      onClick={() => onOrder && onOrder(pid, -1)}>↑</button>
                    <button style={{ ...btn(false), fontSize: 11, padding: "1px 6px" }}
                      aria-label={`ниже: ${name(pid)}`}
                      disabled={i >= crew.length - 1}
                      onClick={() => onOrder && onOrder(pid, 1)}>↓</button>
                  </>)}
                </div>);
            })}
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
            Здесь все, кого вообще добавили на эту схему. Отмеченные — воркеры
            этого актива: из них и только из них выбираются постановщик,
            исполнитель и проверяющий У КАЖДОЙ ФУНКЦИИ.
            {crew.length > 1
              ? " Порядок задаёте вы: кого поставили выше, того и предлагают первым."
              : ""}
          </div>
        </div>

        {/* ─── должности ───
            Список должностей создаётся здесь: у воркера должность видна в
            строке, и заводить её в другой вкладке значило бы ходить туда
            за каждым новым человеком. Роли (вкладки) — не здесь: это
            другой вопрос и другой список. */}
        {onAddPosition && (
          <div style={{ background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: 8, padding: 8, marginTop: 8 }}>
            <div style={{ ...S.lbl, marginBottom: 4 }}>должности</div>
            {!positions.length && (
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
                Должностей ещё нет — добавьте первую.</div>)}
            <div className="flex flex-wrap gap-2" style={{ marginBottom: 6 }}>
              {positions.map((p) => (
                <span key={p.id} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999,
                  background: C.panel, border: `1px solid ${C.line}` }}>
                  {p.name}
                  {onDropPosition && (
                    <button style={{ background: "none", border: "none", cursor: "pointer",
                      color: C.muted, marginLeft: 4, padding: 0 }}
                      aria-label={`убрать должность: ${p.name}`}
                      onClick={() => act(() => onDropPosition(p.id))}>×</button>)}
                </span>))}
            </div>
            <div className="flex gap-2">
              <input style={{ ...S.inp, flex: 1 }} value={newPosition} aria-label="новая должность"
                placeholder="название должности"
                onChange={(e) => setNewPosition(e.target.value)} />
              <button style={btn(false)} disabled={!newPosition.trim()}
                onClick={() => act(async () => {
                  await onAddPosition(newPosition.trim()); setNewPosition(""); })}>
                Добавить</button>
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
              Должность — кем человек числится. Что ему показывать, решает
              РОЛЬ: она у каждого своя и выбирается в «Людях и ролях».
            </div>
            {posMsg && <div style={{ fontSize: 11, color: WARN, marginTop: 4 }}>{posMsg}</div>}
          </div>)}
      </>)}
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
  /* ─── вход и выход — два РАЗНЫХ блока ───

     Прежде это были две одинаковые серые надписи посреди сплошной ленты
     одинаковых тёмных карточек: где кончается «берёт» и начинается
     «выдаёт», глазом не находилось вовсе. Теперь у каждой секции своя
     шапка со своим цветом и счётчиком, и цвет тот же, каким вход и выход
     говорят везде: голубой — то, что приходит, зелёный — то, что выходит. */
  const tone = out ? OK : ACC;
  const wash = out ? "rgba(61,220,151,.10)" : "rgba(124,224,255,.10)";
  const edge = out ? "rgba(61,220,151,.25)" : "rgba(124,224,255,.25)";
  return (
    <div style={{ marginTop: 8, border: `1px solid ${edge}`, borderRadius: 8,
      overflow: "hidden" }}>
      <div className="flex items-center gap-2"
        style={{ ...S.lbl, color: tone, background: wash, padding: "5px 8px",
          borderBottom: `1px solid ${edge}` }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: tone }} />
        {title}
        <span style={{ color: C.muted }}>· {list.length}</span>
      </div>
      <div style={{ padding: "7px 8px" }}>
      {list.length === 0 && (
        <div style={{ fontSize: 11, color: BAD, marginBottom: 6 }}>{hint}</div>)}
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
                  {/* Ресурс — ОДНОЙ строкой: название, сколько, расходует
                      ли, убрать. Прежде на каждый вход уходило пять строк,
                      и две из них были одним и тем же пояснением, повторённым
                      у каждого ресурса. Теперь пояснение стоит один раз под
                      секцией, а строки читаются списком. */}
                  <div style={{ borderTop: i > 0 || gi > 0 ? `1px dashed ${C.line}` : "none",
                    padding: "6px 0" }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span style={{ flex: "1 1 90px", fontSize: 12.5, minWidth: 0 }}>
                        {traitName(p.trait)}
                        {/* Чужой ресурс — это и есть связь с другим активом:
                            взятый приходит оттуда, выданный уходит туда. */}
                        {at && (
                          <span style={{ color: ACC, fontSize: 11 }}>
                            {out ? " → «" : " ← «"}{assetName(at.e)}»</span>)}
                      </span>
                      <button style={{ ...btn(false), fontSize: 11, padding: "0 5px",
                        color: BAD, borderColor: "#5A2436" }}
                        aria-label={`убрать ${out ? "выход" : "вход"} ${traitName(p.trait)}`}
                        onClick={() => onDel(p.id)}>×</button>
                    </div>
                    {/* Сколько — второй строкой, вместе с тем, расходуется ли
                        взятое. Всё в одну строку не влезает на телефоне, а
                        пять строк на каждый ресурс (как было) не читаются
                        списком вовсе. */}
                    <div className="flex flex-wrap items-center gap-2"
                      style={{ marginTop: 3 }}>
                      <PortQty p={p} name={traitName(p.trait)}
                        onSet={(patch) => onSet(p.id, patch)} />
                      {/* Расходует или только обрабатывает. Вопрос стоит у
                          входа, а не у ресурса: одна функция ткань режет, а
                          другая на неё смотрит — и это про функции, а не про
                          ткань. Метка-переключатель вместо галочки с абзацем:
                          пояснение стоит один раз под секцией. */}
                      {!out && (
                        <button aria-label={`расходует ${traitName(p.trait)}`}
                          aria-pressed={portSpends(p)}
                          onClick={() => onSet(p.id, { spend: !portSpends(p) })}
                          style={{ background: "transparent", cursor: "pointer",
                            border: `1px solid ${portSpends(p) ? WARN : C.line}`,
                            color: portSpends(p) ? WARN : C.muted,
                            borderRadius: 20, padding: "1px 7px", fontSize: 10,
                            whiteSpace: "nowrap" }}>
                          {portSpends(p) ? "✓ расходует" : "○ расходует"}</button>)}
                      <span style={{ flex: 1 }} />
                      {/* Сводка словами: «ровно 3» или «от 3 до 5», а рядом
                          факт по выполнениям, когда он есть. Она отвечает не
                          на тот вопрос, что поля: поля — куда вводить, сводка
                          — что в итоге вышло и сходится ли это с делом. */}
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
                  marginTop: 4, color: C.muted,
                  // Действие, а не данные: пунктир отличает «добавить» от
                  // самих ресурсов, которые уже добавлены.
                  background: "transparent", borderStyle: "dashed" }}>
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
            boxSizing: "border-box", padding: "5px 6px", fontSize: 12, marginTop: 6,
            background: "transparent", borderStyle: "dashed", color: C.muted }}>
          <option value="">{out ? "+ выдаёт ресурс…" : "+ берёт ресурс… (и)"}</option>
          {options}
        </select>)}
      {/* Пояснение про расход — ОДИН раз на секцию, а не у каждого входа. */}
      {!out && list.length > 0 && (
        <div style={{ fontSize: 10, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
          «Расходует» — взятое исчезает у всех. Снятая метка значит, что ресурс
          остаётся и достаётся другим функциям, но эта по нему уже отработала.
        </div>)}
      </div>
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
  /* ─── кого можно назначить на функцию ───

     ВСЕХ воркеров актива, и одинаково для всех трёх ролей. Прежде каждая
     роль брала свой список с самого актива («постановщики актива»), и
     получалось, что роль человек исполняет в активе вообще, — а исполняет
     он её в конкретной работе: одну функцию ставит, другую выполняет,
     третью проверяет. Списки ролей у актива это стирали, поэтому их там
     больше нет.

     Назначить можно только воркера ЭТОГО актива: люди — свойство актива, и
     чужой человек означал бы, что список воркеров ни на что не влияет. В
     том порядке, который человек задал в списке: кого поставили выше, того
     и предлагают первым. */
  const crew = crewOf(workers);
  const pool = () => byCrew(workers,
    people.filter((p) => crew.some((id) => String(id) === String(p.id))));

  /* Правка идёт через `editFunc` — ту же дверь, что и удаление ресурса или
     снятие человека с актива: пометка «принята» должна слетать от ЛЮБОГО
     изменения и не слетать от того, что человек ткнул в поле и передумал.
     Само принятие идёт мимо — иначе оно снимало бы себя же. */
  const up = (id, make) => setFuncs((p) => p.map((f) => (f.id === id
    ? editFunc(f, make) : f)));
  const accept = (id) => setFuncs((p) => p.map((f) => (f.id === id
    ? { ...f, accepted: true } : f)));
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
      empty={mine.length ? null
        : "Функций пока нет. Функция обменивает одни ресурсы на другие: берёт одни, выдаёт другие."}>
      {mine.map((f) => {
        const runs = runsOf ? runsOf(f.id) : [];
        const st = funcState(f, { traits, factors });
        return (
          <Card key={f.id} title={f.name} titleLabel="функции"
            onTitle={(v) => up(f.id, (x) => ({ ...x, name: v }))}
            open={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)}
            onDelete={() => { setFuncs((p) => p.filter((x) => x.id !== f.id)); setOpen(null); }}
            accent={st.kind === "ready" ? OK : BAD}
            /* role="status" — чтобы смена состояния («готова» → «не принята»)
               прозвучала: без неё читалка молчит, и правка выглядит так,
               будто ничего не произошло. */
            mark={<span role="status" className="flex items-center gap-2">
              <span style={{ width: 7, height: 7, borderRadius: "50%",
                background: st.kind === "ready" ? OK : BAD }} />
              {/* Слово, а не только цвет: цвет один и тот же у «не
                  заполнена» и «не принята», и различает их подпись. */}
              <Mark text={st.word} label="функция" ok={st.ok}
                tone={st.kind === "ready" ? OK : BAD}
                onWhy={() => onWhy && onWhy(f.id)} />
              <span style={{ fontSize: 10.5, color: C.muted }}>
                {st.kind === "gaps" ? `— ${st.gaps[0]}`
                  : st.kind === "draft" ? "— осталось нажать «Принять»" : ""}</span>
            </span>}
            summary={<>
              {/* В свёрнутой строке «или» обязано быть видно: без него
                  «спрос, пользователи» читается как «и то, и другое», а это
                  прямо противоположно тому, что задано. */}
              {f.takes.length
                ? groupsOf(f.takes)
                  .map((g) => g.map((t) => traitName(t.trait)
                    + (portSpends(t) ? "" : " (не расходует)")).join(" или "))
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
                  {" · фактор"}{factorsOf(f).length
                    ? `: ${factorsOf(f).map(factorName).join(", затем ")}`
                    : " не выбран"}</span>)}
            </>}>
            {/* Описание — чем функция занята, своими словами. Необязательное:
                функция может быть понятна и по названию. Зато написанное
                здесь едет в КАЖДУЮ её задачу, и постановщику не приходится
                переписывать одно и то же в каждое выполнение. */}
            <div style={{ ...S.lbl, marginTop: 8 }}>описание — необязательно</div>
            <TxtField area value={f.about || ""} aria-label="описание функции"
              placeholder="что это за работа — увидит исполнитель в каждой задаче"
              style={{ minHeight: 52, margin: "4px 0", lineHeight: 1.5 }}
              onCommit={(v) => up(f.id, (x) => ({ ...x, about: v }))} />

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
              {/* «От» — только когда есть «до»: «выполняется за от 2 часа»
                  при точном времени читается как обрывок фразы. */}
              {!sameHours(f) && <span style={S.lbl}>от</span>}
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
              <input type="checkbox" aria-label="точное время" checked={sameHours(f)}
                onChange={(e) => up(f.id, (x) => ({ ...x,
                  durHi: e.target.checked ? Number(x.dur) || 0
                    : Math.max(Number(x.dur) || 0, Number(x.durHi) || 0) * 2 }))}
                style={{ accentColor: ACC }} />
              точное время
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
                {!sameEvery(f) && <span style={S.lbl}>от</span>}
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
                <input type="checkbox" aria-label="точное время попытки"
                  checked={sameEvery(f)}
                  onChange={(e) => up(f.id, (x) => ({ ...x,
                    everyHi: e.target.checked ? Number(x.every) || 0
                      : Math.max(Number(x.every) || 0, Number(x.everyHi) || 0) * 2 }))}
                  style={{ accentColor: ACC }} />
                точное время
              </label>)}

            {/* Сколько таких дел ведут ОДНОВРЕМЕННО.

                Настройка про долгие работы: юрист ведёт восемь дел
                месяцами разом, и выстраивать их друг за другом значило бы
                обещать восемь месяцев там, где выйдет один. Работа от
                этого быстрее не делается — час работы остаётся часом;
                меняется только то, сколько дел помещается в календарь.

                Это НЕ множитель от числа людей: сказано «сколько их может
                вести один и тот же воркер», и столько и берётся. Двое
                исполнителей по-прежнему не делают работу вдвое быстрее —
                см. инвариант 6. */}
            <div className="flex items-center gap-2" style={{ marginTop: 6, flexWrap: "wrap" }}>
              <span style={S.lbl}>одновременных выполнений</span>
              <Num value={f.par ?? 1} label="одновременных выполнений"
                onChange={(v) => up(f.id, (x) => ({ ...x,
                  par: Math.max(1, Math.floor(Number(v) || 1)) }))} />
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 10.5, color: C.muted }}>
                {(f.par ?? 1) > 1
                  ? `столько ведётся разом — ${nm(f.par)} выполнений займут время одного`
                  : "по одному, друг за другом"}</span>
            </div>

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
              {/* Факторов может быть несколько, и в одной попытке они идут
                  ПО ПОРЯДКУ: сперва должен случиться первый, потом второй.
                  Поэтому список, а не одно поле, и между строками стоит
                  «затем» — порядок здесь значит ровно то, что написано. */}
              <div style={{ ...S.lbl, marginTop: 8 }}>от каких факторов</div>
              {factorsOf(f).map((id, i) => (
                <div key={`${id}-${i}`}>
                  {i > 0 && (
                    <div style={{ ...S.lbl, color: ACC, textAlign: "center",
                      margin: "3px 0" }}>затем</div>)}
                  <div className="flex items-center gap-2"
                    style={{ background: C.panel2, border: `1px solid ${C.line}`,
                      borderRadius: 6, padding: "5px 7px", marginTop: 4 }}>
                    <span style={{ flex: 1, fontSize: 12, minWidth: 0 }}>
                      {factorName(id)}
                      <span style={{ color: C.muted }}>
                        {" · "}{factorChance(factors.find((x) => x.id === id))}%</span>
                    </span>
                    <button style={{ ...btn(false), fontSize: 11, padding: "2px 6px",
                      color: BAD }} aria-label={`убрать фактор ${factorName(id)}`}
                      onClick={() => up(f.id, (x) => ({ ...x,
                        factors: factorsOf(x).filter((_, j) => j !== i) }))}>×</button>
                  </div>
                </div>))}
              {factors.length > 0 && (
                <select value="" aria-label="фактор функции"
                  onChange={(e) => { if (e.target.value) {
                    up(f.id, (x) => ({ ...x, factors: [...factorsOf(x), e.target.value] }));
                  } }}
                  style={{ ...S.inp, marginTop: 4, padding: "6px 7px", fontSize: 12 }}>
                  <option value="">{factorsOf(f).length ? "+ затем фактор…" : "+ фактор…"}</option>
                  {factors.filter((x) => !factorsOf(f).includes(x.id))
                    .map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
                </select>)}
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
                {!factors.length
                  ? "Факторов в активе ещё нет — заведите их во вкладке «Факторы»."
                  : !factorsOf(f).length
                    ? "Пока не сказано, от чего это происходит: выберите хотя бы один фактор."
                    : `Фактор происходит без человека: задач по нему не заводится и спрашивать за него не с кого. Вероятности заданы самим факторам, во вкладке «Факторы»; за одну попытку должны случиться все по порядку — вместе это ${Math.round(chanceOf(f, factors) * 100) / 100}%.`}
              </div>
            </>) : (<>
              {/* Роли — У ФУНКЦИИ, и это единственное место, где их
                  назначают: работу ставят, выполняют и принимают в ней, а
                  не «в активе вообще». */}
              {WORKER_KINDS.map((k) => (
                <People key={k.id} title={k.many} ids={f[k.id] || []} people={pool()}
                  nameOf={nameOf}
                  empty={"в активе ещё нет воркеров — отметьте их в «воркерах актива»"}
                  onToggle={(pid) => togglePerson(f.id, k.id, pid)} />))}
            </>)}

            {/* ─── «Принять» ───

                Проверки говорят, что функция СОБРАНА. Принять — сказать, что
                она дособрана и её можно пускать в дело; это слово человека, и
                автоматически оно не появляется. Пока чего-то не хватает,
                кнопка не нажимается и прямо называет, чего именно: кнопка,
                которая молча не работает, злит сильнее, чем её отсутствие. */}
            {/* Нативный `disabled` только у незаполненной: принятая кнопка
                остаётся в обходе клавиатурой, иначе фокус на ней просто
                исчезает и человек не узнаёт, что она вообще есть. Причина
                отказа входит в доступное имя — иначе читалка объявит
                «принять функцию», и почему нельзя, не скажет никто. */}
            <button onClick={() => st.kind !== "ready" && accept(f.id)}
              disabled={!st.ok} aria-disabled={st.kind === "ready"}
              aria-label={st.ok
                ? `принять функцию ${f.name || "без названия"}`
                : `принять функцию ${f.name || "без названия"} — пока нельзя: ${st.gaps.join("; ")}`}
              style={{ width: "100%", marginTop: 10, borderRadius: 7, padding: "7px",
                fontSize: 12, cursor: st.ok && st.kind !== "ready" ? "pointer" : "default",
                background: st.kind === "draft" ? "rgba(61,220,151,.13)" : "transparent",
                border: `1px solid ${st.kind === "draft" ? OK : C.line}`,
                color: st.kind === "draft" ? OK : C.muted }}>
              {st.kind === "ready" ? "Принята — любая правка снимет пометку"
                : st.ok ? "Принять"
                  : `Принять — пока нельзя: ${st.gaps.join("; ")}`}</button>
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
  const used = (id) => funcs.filter((f) => isFactor(f) && factorsOf(f).includes(id)).length;
  const add = () => {
    setFactors((p) => [...p, newFactor(entityId, draft.trim() || "новый фактор")]);
    setDraft("");
  };
  const del = (id) => {
    setFactors((p) => p.filter((x) => x.id !== id));
    /* Функции, ссылавшиеся на удалённый фактор, не остаются с мёртвой
       ссылкой: они краснеют подписью «фактор не выбран», а не молча
       считаются исправными. */
    setFuncs((p) => p.map((f) => (factorsOf(f).includes(id)
      ? editFunc(f, (x) => ({ ...x, factors: factorsOf(x).filter((z) => z !== id) }))
      : f)));
  };
  return (
    <Section title="факторы актива"
      hint="Фактор — то, что меняет ресурсы без человека: сезон, износ, курс, реклама, которая крутится сама. Задач по нему не заводится и спрашивать за него не с кого."
      empty={mine.length ? null : "Факторов пока нет."}>
      {mine.map((x) => {
        const chance = x.chance == null ? 100 : x.chance;
        return (
          <div key={x.id} style={{ background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: 8, padding: 8, marginTop: 6 }}>
            <div className="flex items-center gap-2">
              <TxtField value={x.name} aria-label="название фактора"
                style={{ flex: "1 1 140px", padding: "5px 7px", fontSize: 12.5 }}
                onCommit={(v) => setFactors((p) => p.map((y) => (y.id === x.id
                  ? { ...y, name: v } : y)))} />
              <span style={{ fontSize: 10.5, color: C.muted, whiteSpace: "nowrap" }}>
                {used(x.id) ? `функций: ${used(x.id)}` : "не используется"}</span>
              <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436",
                fontSize: 11, padding: "2px 6px" }} aria-label={`удалить фактор ${x.name}`}
                onClick={() => del(x.id)}>✕</button>
            </div>
            {/* Вероятность — свойство самого фактора: сезон удачлив одинаково,
                сколько бы функций от него ни зависело. Спрашивать её у каждой
                функции значило бы задавать один вопрос по нескольку раз. */}
            <div className="flex items-center gap-2" style={{ marginTop: 6 }}>
              <span style={S.lbl}>случается с вероятностью</span>
              <Num value={chance} label={`вероятность фактора ${x.name}`}
                onChange={(v) => setFactors((p) => p.map((y) => (y.id === x.id
                  ? { ...y, chance: Math.max(0, Math.min(100, Number(v) || 0)) } : y)))} />
              <span style={{ fontSize: 12, color: C.muted }}>%</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 10.5, color: C.muted, textAlign: "right" }}>
                {chance >= 100 ? "удаётся каждая попытка"
                  : chance <= 0 ? "не случается вовсе"
                    : `в среднем каждая ${Math.round(100 / chance)}-я попытка`}</span>
            </div>
          </div>);
      })}
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
export function Traits({ entityId, traits, setTraits, funcs, tasks = [], kinds, kindOf,
  open, setOpen,
  onWhy, onDelete, onUpKind, onAddKind, onDelKind, kindMsg }) {
  const mine = traits.filter((t) => t.e === entityId);
  // Единицы с номерами: их не заводят руками, они рождаются сдачами.
  const units = unitsOf({ tasks, funcs });
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
            {/* ─── единицы с номерами ───
                Количество говорит, сколько всего, и молчит о том, ЧТО
                именно. Работают же не с количеством: вот это техническое
                задание от того заказчика, вот дизайн к нему. Номера тут
                не заводятся руками — единица рождается сдачей задачи, и
                это единственный честный способ: заведённый руками номер
                означал бы вещь, которой никто не делал. */}
            <div style={{ ...S.lbl, marginTop: 8 }}>единицы с номерами</div>
            {(() => {
              const own = units.filter((u) => u.trait === t.id);
              if (!own.length) {
                return (
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4,
                    lineHeight: 1.5 }}>
                    Пока ни одной: единица появляется, когда сдают задачу, —
                    и на неё уже можно сослаться в отчёте.
                  </div>);
              }
              return [...own].reverse().slice(0, 8).map((u) => (
                <div key={u.id} className="flex flex-wrap gap-2"
                  style={{ alignItems: "center", fontSize: 11, marginTop: 4 }}>
                  <span style={{ color: ACC, fontWeight: 700 }}>№{u.no}</span>
                  <span style={{ flex: "1 1 110px", minWidth: 0 }}>
                    {u.title || "без названия"}</span>
                  <span style={{ color: u.accepted ? OK : WARN, fontSize: 10 }}>
                    {u.accepted ? "принято" : "не принято"}</span>
                </div>));
            })()}
            {units.filter((u) => u.trait === t.id).length > 8 && (
              <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>
                показаны последние 8 — остальные видно в отчётах.</div>)}

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
          tasks={props.tasks} funcs={props.funcs} positionOf={props.positionOf}
          onToggleCrew={props.onToggleCrew} onOrder={props.onOrderWorker}
          onOpenPerson={props.onOpenPerson}
          published={props.published} me={props.me}
          positions={props.positions} onAddPosition={props.onAddPosition}
          onDropPosition={props.onDropPosition} onSetPosition={props.onSetPosition} />)}

      {tab === "funcs" && (
        <Funcs {...props} open={openFunc} setOpen={setOpenFunc} onWhy={props.onWhyFunc} />)}

      {tab === "factors" && (
        <Factors entityId={props.entityId} factors={props.factors || []}
          setFactors={props.setFactors} funcs={props.funcs} setFuncs={props.setFuncs} />)}

      {tab === "traits" && (
        <Traits entityId={props.entityId} traits={props.traits} setTraits={props.setTraits}
          funcs={props.funcs} tasks={props.tasks} kinds={props.kinds} kindOf={props.kindOf}
          open={openTrait} setOpen={setOpenTrait}
          onWhy={props.onWhyTrait} onDelete={props.onDeleteTrait}
          onUpKind={props.onUpKind} onAddKind={props.onAddKind}
          onDelKind={props.onDelKind} kindMsg={props.kindMsg} />)}
    </div>);
}
