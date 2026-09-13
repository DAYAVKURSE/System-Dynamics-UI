import { FACTORS_ON } from "../lib/flags.js";
import React, { useEffect, useState } from "react";
import { C, OK, BAD, ACC, WARN, S, btn, nm, TxtField } from "./ui.jsx";
import { DUR_UNITS, WORKER_KINDS, byCrew, byPost, checkFunc, checkTrait, countWorkers,
  eligible, exceptOf, postsOf, togglePost, toggleExcept,
  editFunc, funcState,
  crewOf,
  chanceOf, everyOf, everyRange, factorChance, factorsOf, groupsOf, sameEvery, sameHours,
  newFactor, fromHours,
  hoursOf, newFunc, newGive, newPort, okRange, parAssetOf, parOf, parWorkerOf,
  portSpends, rangeText, runHours,
  runQty } from "../lib/funcs.js";
import { MATERIAL_KINDS, traitKind } from "../lib/units.js";
import { Mark } from "./Modal.jsx";
import { statusColor } from "./ProfilePanel.jsx";
import { scheduleOfPerson, statusOf, visibleStats, liveStatus } from "../lib/workers.js";
import { hasKind, kindIdsOf, toggleKind } from "../lib/traits.js";

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

/**
 * Форма — подкарточка ОДНОГО смыслового блока: подпись и то, что к ней
 * относится, в одной рамке.
 *
 * Прежде раскрытая карточка шла сплошной лентой подписей и полей, и где
 * кончается один вопрос и начинается другой, приходилось угадывать по
 * отступам: «под ресурсами всё вместе» (владелец, 2026-09-13). Рамка
 * отвечает на это без единого слова — то же, что делает `Card` для
 * карточек в списке, только на шаг внутрь.
 */
function Form({ title, children, style }) {
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.line}`,
      borderRadius: 8, padding: 9, marginTop: 8, ...style }}>
      {title && <div style={{ ...S.lbl, marginBottom: 5 }}>{title}</div>}
      {children}
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
/* Роли у работы: какие роли эту работу ставят, делают, принимают.
   Рядом — кто под них попадает СЕЙЧАС: выбор роли без ответа «и кто
   же это» читался бы как обещание, которого никто не проверял. */
function Posts({ title, ids, positions, who, nameOf, legacy, empty, onToggle }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ ...S.lbl, marginBottom: 3 }}>{title} — роли</div>
      <div className="flex flex-wrap gap-2">
        {!positions.length && (
          <span style={{ fontSize: 11, color: C.muted }}>{empty}</span>)}
        {positions.map((p) => {
          const on = ids.includes(p.id);
          return (
            <button key={p.id} aria-pressed={on} aria-label={`${title}: ${p.name}`}
              style={{ ...btn(on, on ? ACC : null), fontSize: 11, padding: "3px 7px" }}
              onClick={() => onToggle(p.id)}>{p.name}</button>);
        })}
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>
        {who.length
          ? `подходят: ${who.map((id) => (nameOf ? nameOf(id) : id)).join(", ")}`
          : (legacy.length
            ? `роль не выбрана — назначать можно записанных прежде: ${
              legacy.map((id) => (nameOf ? nameOf(id) : id)).join(", ")}`
            : (ids.length ? "с такой ролью в активе никого нет" : empty))}
      </div>
    </div>);
}

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
 * Строка человека в списке: роли, имя, статистика, рейтинг, работы.
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
function WorkerLine({ pid, name, stat, person, roleNames }) {
  const sc = scheduleOfPerson(person || {});
  // По графику: в нерабочее время человек «не работает», что бы ни нажал.
  const live = liveStatus(sc);
  const st = statusOf(live);
  const chip = (text, color) => (
    <span style={{ fontSize: 10.5, color: color || C.muted,
      whiteSpace: "nowrap" }}>{text}</span>);
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 7,
      alignItems: "baseline" }}>
      {/* 1. роли — кем человек здесь числится */}
      {chip(roleNames || "без роли", ACC)}
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
      {chip(`· ${st.name}`, statusColor(live))}
    </span>);
}

export function Workers({ workers, people = [], nameOf, tasks = [], funcs = [],
  entityId, onToggleFunc,
  rolesOf = () => [], roleName = () => "", onToggleCrew, onOrder, onOpenPerson,
  pickByOrder = true, onPickByOrder,
  published, me,
  positions = [], onAddPosition, onDropPosition, onSetRoles }) {
  /* ИСКЛЮЧЕНИЯ. Что человек делает, решает его ДОЛЖНОСТЬ: функция называет
     роль, и всякий воркер актива с ней эту работу берёт. Здесь —
     обратное: «эту функцию он не берёт». Поэтому в строке стоят только те
     функции, к которым у него и так есть доступ по роли, а нажатие
     закрывает одну из них (`funcs[].except`). */
  const own = funcs.filter((f) => f.e === entityId);
  const reachable = (pid) => own.filter((f) => WORKER_KINDS
    .some((k) => byPost(f, k.id, rolesOf, pid)));
  const off = (pid, f) => exceptOf(f).some((x) => String(x) === String(pid));
  /* РОЛИ заводятся ЗДЕСЬ, рядом с людьми: кем человек здесь числится,
     решают там же, где решают, кто где работает. Прежде это звалось
     «должностью» и было вторым списком рядом с ролями — но вопрос один:
     кто он здесь. Список теперь один, и его же читают «Люди и роли»,
     договоры и роли функций.

     Ролей у человека НЕСКОЛЬКО: он и дизайнер, и проверяющий. Поэтому
     здесь отметки, а не выпадающий список: выпадающий заставлял выбрать
     одну и молча отменял остальные. */
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
      hint="Кто работает в активе. Какую работу он берёт, решает его роль."
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
        {/* ─── роли ───
            Список ролей создаётся здесь: у воркера роли видны в строке, и
            заводить их в другой вкладке значило бы ходить туда за каждым
            новым человеком. Список ОДИН на всё приложение: те же роли
            открывают вкладки, по ним же заключают договоры в «Людях и
            ролях» и назначают работу у функции. */}
        {onAddPosition && (
          <div style={{ background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: 8, padding: 8, marginBottom: 8 }}>
            <div style={{ ...S.lbl, marginBottom: 4 }}>роли</div>
            {!positions.length && (
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
                Ролей ещё нет — добавьте первую.</div>)}
            <div className="flex flex-wrap gap-2" style={{ marginBottom: 6 }}>
              {positions.map((p) => (
                <span key={p.id} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999,
                  background: C.panel, border: `1px solid ${C.line}` }}>
                  {p.name}
                  {onDropPosition && (
                    <button style={{ background: "none", border: "none", cursor: "pointer",
                      color: C.muted, marginLeft: 4, padding: 0 }}
                      aria-label={`убрать роль: ${p.name}`}
                      onClick={() => act(() => onDropPosition(p.id))}>×</button>)}
                </span>))}
            </div>
            <div className="flex gap-2">
              <input style={{ ...S.inp, flex: 1 }} value={newPosition} aria-label="новая роль"
                placeholder="название роли"
                onChange={(e) => setNewPosition(e.target.value)} />
              <button style={btn(false)} disabled={!newPosition.trim()}
                onClick={() => act(async () => {
                  await onAddPosition(newPosition.trim()); setNewPosition(""); })}>
                Добавить</button>
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
              Роль — кем человек здесь числится; по ней и назначают работу.
              Ролей у одного может быть несколько. Что роль открывает и какой
              по ней договор — в «Людях и ролях».
            </div>
            {posMsg && <div style={{ fontSize: 11, color: WARN, marginTop: 4 }}>{posMsg}</div>}
          </div>)}
        <div style={{ background: C.panel2, border: `1px solid ${C.line}`,
          borderRadius: 8, padding: 8 }}>
          <div style={{ ...S.lbl, marginBottom: 4 }}>воркеры</div>
          {!crew.length && (
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
              {people.some((p) => (rolesOf(p.id) || []).length)
                ? "Пока никого: отметьте, кто работает в этом активе."
                : "Ни у кого ещё нет роли — отметить в активе некого."}</div>)}
          {/* Кого вообще можно отметить: у кого ЕСТЬ роль. Человек без
              роли работу брать не может — её назначают ролью, — и строка
              с отметкой обещала бы то, чего не будет. Уже отмеченные
              остаются в списке всегда: молча пропавший воркер выглядел бы
              поломкой, а не правилом. */}
          {[...crew, ...people.filter((p) => (rolesOf(p.id) || []).length)
            .map((p) => p.id).filter((id) => !inCrew(id))]
            .map((pid, i) => {
              const on = inCrew(pid);
              return (
                /* Каждый воркер — своей формой, а не строкой под чертой: у
                   строки под именем висят ещё роли и исключения, и черта
                   не говорила, где кончается один человек и начинается
                   следующий (владелец, 2026-09-13). */
                <div key={pid} className="flex flex-wrap gap-2"
                  style={{ background: C.panel2, border: `1px solid ${C.line}`,
                    borderRadius: 8, padding: 8, marginBottom: 6,
                    opacity: on ? 1 : 0.55, alignItems: "center" }}>
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
                      roleNames={(rolesOf(pid) || []).map(roleName).filter(Boolean).join(", ")} />
                  </button>
                  {/* Отметки, а не выпадающий список: ролей у человека
                      несколько, и выбор одной молча снимал бы остальные. */}
                  {onSetRoles && positions.length > 0 && (
                    <div className="flex flex-wrap gap-2" style={{ flexBasis: "100%",
                      alignItems: "center", paddingLeft: 22 }}>
                      <span style={{ fontSize: 10.5, color: C.muted }}>роли:</span>
                      {positions.map((p) => {
                        const has = (rolesOf(pid) || []).some((r) => String(r) === p.id);
                        return (
                          <button key={p.id} aria-pressed={has}
                            aria-label={`роль «${p.name}»: ${name(pid)}`}
                            style={{ ...btn(has, has ? ACC : null), fontSize: 11,
                              padding: "2px 7px" }}
                            onClick={() => act(() => onSetRoles(pid, has
                              ? (rolesOf(pid) || []).filter((r) => String(r) !== p.id)
                              : [...(rolesOf(pid) || []), p.id]))}>
                            {p.name}</button>);
                      })}
                    </div>)}
                  {on && (<>
                    <button style={{ ...btn(false), fontSize: 11, padding: "1px 6px" }}
                      aria-label={`выше: ${name(pid)}`} disabled={i === 0}
                      onClick={() => onOrder && onOrder(pid, -1)}>↑</button>
                    <button style={{ ...btn(false), fontSize: 11, padding: "1px 6px" }}
                      aria-label={`ниже: ${name(pid)}`}
                      disabled={i >= crew.length - 1}
                      onClick={() => onOrder && onOrder(pid, 1)}>↓</button>
                  </>)}
                  {on && (
                    <div className="flex flex-wrap gap-2" style={{ flexBasis: "100%",
                      alignItems: "center", paddingLeft: 22 }}>
                      <span style={{ fontSize: 10.5, color: C.muted }}>исключения:</span>
                      {!reachable(pid).length && (
                        <span style={{ fontSize: 10.5, color: C.muted }}>
                          {own.length
                            ? "по его ролям ему пока ничего не поручено"
                            : "функций у актива ещё нет"}</span>)}
                      {reachable(pid).map((f) => (
                        <button key={f.id} aria-pressed={off(pid, f)}
                          aria-label={`исключение «${f.name || "без названия"}»: ${name(pid)}`}
                          style={{ ...btn(off(pid, f), BAD), fontSize: 11, padding: "2px 7px" }}
                          onClick={() => onToggleFunc && onToggleFunc(pid, f.id)}>
                          {off(pid, f) ? "✕ " : ""}{f.name || "без названия"}</button>))}
                    </div>)}
                </div>);
            })}
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
            Здесь все, кого вообще добавили на эту схему. Отмеченные — воркеры
            этого актива. Кто что делает, решает ДОЛЖНОСТЬ: она выбирается у
            функции, и работу берёт любой воркер с этой ролью.
            Исключения закрывают одну функцию одному человеку.
            {crew.length > 1
              ? (pickByOrder
                ? " Порядок задаёте вы: кого поставили выше, того и предлагают первым."
                : " Порядок задаёте вы, но на выбор он сейчас не влияет.")
              : ""}
          </div>
          {/* Галочка — чтобы ВЫКЛЮЧИТЬ: порядок влияет на выбор по умолчанию,
              этого владелец и хотел. Стоит под списком, а не в настройках
              актива: решают про этот порядок, глядя на него. */}
          {onPickByOrder && (
            <label className="flex gap-2" style={{ alignItems: "center", marginTop: 8,
              fontSize: 11.5, color: C.text, cursor: "pointer" }}>
              <input type="checkbox" checked={pickByOrder}
                aria-label="учитывать положение в списке при выборе воркера"
                onChange={(e) => onPickByOrder(e.target.checked)}
                style={{ accentColor: ACC }} />
              учитывать положение в списке при выборе воркера
            </label>)}
          {onPickByOrder && (
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
              {pickByOrder
                ? "При постановке первым предлагается и по умолчанию назначается тот, кто выше."
                : "Воркеры предлагаются по алфавиту, и никто не назначается сам."}
            </div>)}
        </div>

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
          «Расходует» — взятое исчезает. Без метки ресурс остаётся другим, но эта функция по нему отработала.
        </div>)}
      </div>
    </div>);
}

export function Funcs({ entityId, funcs, setFuncs, traits, entities = [], workers,
  factors = [], people = [], nameOf, runsOf, open, setOpen, onWhy,
  positions = [], rolesOf = () => [], onMarket }) {
  const mine = funcs.filter((f) => f.e === entityId);
  const own = traits.filter((t) => t.e === entityId);
  const others = traits.filter((t) => t.e !== entityId);
  const traitName = (id) => traits.find((t) => t.id === id)?.l || "(ресурс удалён)";
  const assetName = (id) => entities.find((e) => e.id === id)?.name || "другой актив";
  /* Фактор — свой у актива, как и его функции: сезон одного актива не
     двигает ресурсы другого. Поэтому выбирать дают только из своих, а
     чужой, попавший в старую запись, показан с пометкой, чтобы его сняли. */
  const ownFactors = factors.filter((x) => x.e === entityId);
  const factorName = (id) => {
    const x = factors.find((z) => z.id === id);
    if (!x) return "(фактор удалён)";
    return x.e === entityId ? x.name : `${x.name} (фактор актива «${assetName(x.e)}»)`;
  };
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
  /* Функция глазами расчёта: потолок «= числу воркеров» — уже числом.
     Ровно то же делает `withCrewPar` на входе в прогноз; здесь оно нужно,
     чтобы подпись под полями говорила то же, что посчитает план. */
  const live = (f) => (f.parCrew ? { ...f, parAll: Math.max(1, crew.length) } : f);
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
              {/* Функцию процесса пересобирают из его текста: правка здесь
                  доживёт до первой правки текста, и об этом сказано. */}
              {f.proc && (
                <span style={{ fontSize: 10.5, color: C.muted }}>
                  · из технологического процесса</span>)}
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
              {FACTORS_ON && !!factorsOf(f).length && (
                <span style={{ color: ACC }}>
                  {` · факторы: ${factorsOf(f).map(factorName).join(", ")} — конверсия ${
                    Math.round(chanceOf(f, factors) * 100) / 100}%`}</span>)}
            </>}>
            {/* Описание — чем функция занята, своими словами. Необязательное:
                функция может быть понятна и по названию. Зато написанное
                здесь едет в КАЖДУЮ её задачу, и постановщику не приходится
                переписывать одно и то же в каждое выполнение. */}
            <Form title="описание — необязательно">
              <TxtField area value={f.about || ""} aria-label="описание функции"
                placeholder="что это за работа — увидит исполнитель в каждой задаче"
                style={{ minHeight: 52, lineHeight: 1.5 }}
                onCommit={(v) => up(f.id, (x) => ({ ...x, about: v }))} />
            </Form>

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

            {/* Факторы стоят сразу за ресурсами, потому что говорят о них:
                при конверсии 10% входа нужно вдесятеро больше, чем
                сказано в «берёт». Их бывает несколько — хватает любого. */}
            {FACTORS_ON && (
            <Form title="факторы — необязательно">
            {factorsOf(f).map((id, i) => (
              <div key={`${id}-${i}`} className="flex items-center gap-2"
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
              </div>))}
            {ownFactors.length > 0 && (
              <select value="" aria-label="фактор функции"
                onChange={(e) => { if (e.target.value) {
                  up(f.id, (x) => ({ ...x, factors: [...factorsOf(x), e.target.value] }));
                } }}
                style={{ ...S.inp, marginTop: 4, padding: "6px 7px", fontSize: 12 }}>
                <option value="">{factorsOf(f).length ? "+ ещё фактор…" : "+ фактор…"}</option>
                {ownFactors.filter((x) => !factorsOf(f).includes(x.id))
                  .map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
              </select>)}
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
              {!factorsOf(f).length
                ? (ownFactors.length
                  ? "Без факторов функция срабатывает всегда: сколько взяла, столько и выдала."
                  : "Факторов в активе нет — заведите их во вкладке «Факторы».")
                : `Конверсия ${Math.round(chanceOf(f, factors) * 100) / 100}%: входа нужно в ${
                  nm(Math.round(10000 / Math.max(chanceOf(f, factors), 0.01)) / 100)} раза больше, чем сказано в «берёт».`}
            </div>
            </Form>)}

            {/* Время — такая же вилка, как количества: работа редко занимает
                ровно столько, сколько задумано. Когда занимает — галочка
                «одинаковое» связывает границы, и число вводится одно. */}
            <Form title="срок">
            <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
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
            </Form>

            {/* Через сколько будет следующая ПОПЫТКА — не «повторение»:
                попытка может и не удаться. «Сразу» значит, что следующая
                начинается за предыдущей и всё упирается только в саму
                работу. Тоже вилка: срок между попытками редко бывает
                ровным. */}
            <Form title="следующая попытка">
            <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
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
            </Form>

            {/* Сколько таких дел идёт ОДНОВРЕМЕННО — два разных предела.

                НА ВОРКЕРА: сколько их держит один человек. Настройка про
                долгие работы — юрист ведёт восемь дел месяцами разом, и
                выстраивать их друг за другом значило бы обещать восемь
                месяцев там, где выйдет один.

                НА АКТИВ: сколько их идёт в активе вообще. Станок один,
                кабинет один, лицензий три — сколько бы людей ни было,
                разом идёт столько. Пусто значит «предела нет».

                Работа от одновременности быстрее не делается — час работы
                остаётся часом; меняется только то, сколько дел помещается
                в календарь. И это не множитель от числа людей: двое
                исполнителей по-прежнему не делают работу вдвое быстрее —
                см. инвариант 6. Поэтому в счёт идёт меньший из двух
                пределов. */}
            <Form title="одновременные выполнения">
            <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
              <span style={S.lbl}>одновременных выполнений на воркера</span>
              <Num value={f.par ?? 1} label="одновременных выполнений на воркера"
                onChange={(v) => up(f.id, (x) => ({ ...x,
                  par: Math.max(1, Math.floor(Number(v) || 1)) }))} />
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
              {parWorkerOf(f) > 1
                ? "столько одному под силу разом"
                : "по одному, друг за другом"}</div>

            <div className="flex items-center gap-2" style={{ marginTop: 6, flexWrap: "wrap" }}>
              <span style={S.lbl}>одновременных выполнений на актив</span>
              {/* Привязали к людям — число не вводят: оно уже сказано
                  составом актива, и второе место, где то же самое пишут
                  руками, разошлось бы с ним в первый же день. */}
              {!f.parCrew && (
                <Num value={f.parAll ?? 0} label="одновременных выполнений на актив"
                  onChange={(v) => up(f.id, (x) => ({ ...x,
                    parAll: Math.max(0, Math.floor(Number(v) || 0)) }))} />)}
              <label className="flex items-center gap-2"
                style={{ fontSize: 11, color: C.muted, cursor: "pointer" }}>
                <input type="checkbox" checked={f.parCrew === true}
                  aria-label="одновременных выполнений на актив = количеству воркеров"
                  onChange={(e) => up(f.id, (x) => ({ ...x, parCrew: e.target.checked }))}
                  style={{ accentColor: ACC }} />
                = количеству воркеров
              </label>
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
              {f.parCrew
                ? `воркеров в активе: ${nm(crew.length)} — столько и идёт разом`
                : parAssetOf(f)
                  ? `больше ${nm(parAssetOf(f))} в активе разом не идёт`
                  : "предела нет"}</div>

            {/* Итог двух пределов: сколько дел ложится в календарь разом. */}
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
              {`в календарь помещается ${nm(parOf(live(f)))} разом: столько дел `
                + "займут время одного"}</div>
            </Form>

            {/* Роли — У ФУНКЦИИ, и назначается ДОЛЖНОСТЬ, а не человек:
                «ставит юрист, делает дизайнер, принимает редактор». Взять
                работу сможет любой воркер актива с такой ролью — кроме
                тех, кому её закрыли исключением (карточка «Воркеры»). */}
            <Form title="должности и исполнители">
            {WORKER_KINDS.map((k) => (
              <Posts key={k.id} title={k.many} ids={postsOf(f, k.id)} positions={positions}
                who={eligible(f, k.id, { crew: crewOf(workers), rolesOf, people })}
                nameOf={nameOf}
                legacy={postsOf(f, k.id).length ? [] : (f[k.id] || [])}
                empty={positions.length
                  ? "роль не выбрана — назначать некого"
                  : "ролей ещё нет: заведите их в «воркерах актива»"}
                onToggle={(pid) => up(f.id, (x) => togglePost(x, k.id, pid))} />))}
            </Form>

            {/* ─── рынок услуг ───

                Функция — это уже готовое описание работы: что берёт, что
                выдаёт и за какой срок. Владелец (2026-09-13) просил
                выставлять её наружу отсюда же: заказом, когда работу нужно
                получить, услугой — когда готовы делать её для других.
                Переписывать то же самое руками во второй раз не за чем.

                Кнопки стоят, только когда рынок подключён (`onMarket`):
                кнопка, которая никуда не ведёт, обещала бы то, чего нет. */}
            {onMarket && (
              <Form title="рынок услуг">
                <div className="flex flex-wrap gap-2">
                  <button style={{ ...btn(false), fontSize: 12 }}
                    onClick={() => onMarket(f, "order")}>Сделать заказ</button>
                  <button style={{ ...btn(false), fontSize: 12 }}
                    onClick={() => onMarket(f, "service")}>Сделать услугой</button>
                </div>
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6,
                  lineHeight: 1.5 }}>
                  {"Заказ появится у всех в «Рынке услуг» → «Заказы»; услуга — в «Услуги»."
                    + " Название, описание, ресурсы и срок берутся из функции,"
                    + " их можно поправить."}
                </div>
              </Form>)}

            {/* ─── «Принять» ───

                Принять — сказать, что функцию можно пускать в дело. Это
                слово человека, и автоматически оно не появляется; но и
                запретить его проверка не может: кнопка нажимается всегда,
                а чего, по мнению проверки, не хватает, написано рядом с
                подписью — подсказкой, не условием. */}
            {/* Без нативного `disabled`: принятая кнопка остаётся в обходе
                клавиатурой, иначе фокус на ней просто исчезает и человек не
                узнаёт, что она вообще есть. */}
            <Form title="принять">
            <button onClick={() => st.kind !== "ready" && accept(f.id)}
              aria-disabled={st.kind === "ready"}
              aria-label={`принять функцию ${f.name || "без названия"}`}
              style={{ width: "100%", borderRadius: 7, padding: "7px",
                fontSize: 12, cursor: st.kind !== "ready" ? "pointer" : "default",
                background: st.kind !== "ready" ? "rgba(61,220,151,.13)" : "transparent",
                border: `1px solid ${st.kind !== "ready" ? OK : C.line}`,
                color: st.kind !== "ready" ? OK : C.muted }}>
              {st.kind === "ready" ? "Принята — любая правка снимет пометку" : "Принять"}</button>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
              {st.kind === "ready"
                ? "Функция принята: её можно пускать в дело. Любая правка снимет пометку."
                : `Принять — сказать, что функцию можно пускать в дело.${
                  st.kind === "gaps" ? ` Проверка считает, что ${st.gaps[0]}.` : ""}`}
            </div>
            </Form>
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
  const used = (id) => funcs.filter((f) => factorsOf(f).includes(id)).length;
  /* Пометка «принят» слетает от правки имени или вероятности — и только от
     правки: поле отдаёт значение по расфокусу, и клик мимо — не правка. */
  const up = (id, patch) => setFactors((p) => p.map((x) => {
    if (x.id !== id) return x;
    const same = Object.keys(patch).every((k) => x[k] === patch[k]);
    return same ? x : { ...x, ...patch, accepted: false };
  }));
  const accept = (id) => setFactors((p) => p.map((x) => (x.id === id
    ? { ...x, accepted: true } : x)));
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
      hint="Фактор — вероятность: сезон, износ, курс. Он задаёт конверсию функции."
      empty={mine.length ? null : "Факторов пока нет."}>
      {mine.map((x) => {
        const chance = x.chance == null ? 100 : x.chance;
        // Прежние записи пометки не знали: молчание — «не принят».
        const taken = x.accepted === true;
        return (
          <div key={x.id} style={{ background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: 8, padding: 8, marginTop: 6,
            borderLeft: `2px solid ${taken ? OK : BAD}` }}>
            <div className="flex items-center gap-2">
              <TxtField value={x.name} aria-label="название фактора"
                style={{ flex: "1 1 140px", padding: "5px 7px", fontSize: 12.5 }}
                onCommit={(v) => up(x.id, { name: v })} />
              <span style={{ fontSize: 10.5, color: C.muted, whiteSpace: "nowrap" }}>
                {used(x.id) ? `функций: ${used(x.id)}` : "не используется"}</span>
              <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436",
                fontSize: 11, padding: "2px 6px" }} aria-label={`удалить фактор ${x.name}`}
                onClick={() => del(x.id)}>✕</button>
            </div>
            {/* Та же подпись, что у функции и ресурса: красная, пока человек
                не принял. У фактора строения нет — красным он бывает только
                от этого, и знака «?» здесь не надо. */}
            <div role="status" className="flex items-center gap-2" style={{ marginTop: 2 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%",
                background: taken ? OK : BAD }} />
              <Mark text={taken ? "фактор" : "не принят"} label="фактор" ok
                tone={taken ? undefined : BAD} onWhy={() => {}} />
            </div>
            {/* Вероятность — свойство самого фактора: сезон удачлив одинаково,
                сколько бы функций от него ни зависело. Спрашивать её у каждой
                функции значило бы задавать один вопрос по нескольку раз. */}
            <div className="flex items-center gap-2" style={{ marginTop: 6 }}>
              <span style={S.lbl}>случается с вероятностью</span>
              <Num value={chance} label={`вероятность фактора ${x.name}`}
                onChange={(v) => up(x.id, { chance: Math.max(0, Math.min(100, Number(v) || 0)) })} />
              <span style={{ fontSize: 12, color: C.muted }}>%</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 10.5, color: C.muted, textAlign: "right" }}>
                {chance >= 100 ? "удаётся каждая попытка"
                  : chance <= 0 ? "не случается вовсе"
                    : `в среднем каждая ${Math.round(100 / chance)}-я попытка`}</span>
            </div>
            {/* «Принять» — как у функции: слово человека, снимается правкой. */}
            <button onClick={() => !taken && accept(x.id)} aria-disabled={taken}
              aria-label={`принять фактор ${x.name || "без названия"}`}
              style={{ width: "100%", marginTop: 8, borderRadius: 7, padding: "7px",
                fontSize: 12, cursor: taken ? "default" : "pointer",
                background: taken ? "transparent" : "rgba(61,220,151,.13)",
                border: `1px solid ${taken ? C.line : OK}`,
                color: taken ? C.muted : OK }}>
              {taken ? "Принят — любая правка снимет пометку" : "Принять"}</button>
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
          Классификация задаёт значок и цвет. Удаление переводит её ресурсы в первую оставшуюся.
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
export function Traits({ entityId, traits, setTraits, funcs, tasks = [], materials = [],
  kinds, kindOf, open, setOpen,
  onWhy, onDelete, onUpKind, onAddKind, onDelKind, kindMsg }) {
  const mine = traits.filter((t) => t.e === entityId);
  /* Сколько ресурса есть — единицы в материалах и принятых сдачах:
     `have` здесь уже посчитан по ним (`withStock`), руками не вводят;
     сами единицы — в «Материалах» на вкладке «Отчёты». */
  const [draft, setDraft] = useState("");
  /* Пометка «принят» — слово человека о ТОМ ресурсе, который он видел:
     любая правка имени, единицы, вида или классификаций её снимает. Но
     только правка: поле отдаёт значение по расфокусу, и клик мимо поля
     оставляет пометку на месте — как у функции (`editFunc`). */
  const up = (id, patch) => setTraits((p) => p.map((t) => {
    if (t.id !== id) return t;
    const next = { ...t, ...patch };
    const same = Object.keys(patch).every((k) => JSON.stringify(t[k]) === JSON.stringify(next[k]));
    return same ? t : { ...next, accepted: false };
  }));
  const accept = (id) => setTraits((p) => p.map((t) => (t.id === id
    ? { ...t, accepted: true } : t)));
  const add = (kindId) => {
    if (!draft.trim()) return;
    /* Заводится с одной классификацией — той, кнопкой которой его завели.
       Остальные ставятся в карточке: список — не «сразу всё», а «сколько
       нужно». */
    const t = { id: `t${Date.now().toString(36)}`, e: entityId,
      ks: kindId ? [kindId] : [], k: kindId || "", l: draft.trim(),
      unit: "ед." };
    setTraits((p) => [...p, t]);
    setDraft(""); setOpen(t.id);
  };
  return (
    <Section title="ресурсы актива"
      empty={mine.length ? null : "Ресурсов пока нет. Ресурс — это то, что есть: функции его берут и выдают."}>
      {mine.map((t) => {
        const ks = kindIdsOf(t).map(kindOf);
        const made = funcs.filter((f) => f.gives.some((g) => g.trait === t.id)).length;
        const used = funcs.filter((f) => f.takes.some((p) => p.trait === t.id)).length;
        /* Прежние записи пометки не знали: молчание читается как «не
           принят» — так же, как у функции. */
        const taken = t.accepted === true;
        return (
          <Card key={t.id} title={t.l} titleLabel="ресурса"
            onTitle={(v) => up(t.id, { l: v })}
            open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)}
            onDelete={() => { onDelete(t.id); setOpen(null); }}
            accent={taken ? OK : BAD}
            /* Та же грамматика, что у функции: точка, слово, и красное —
               пока человек не принял. «Не принят» — словом, а не только
               цветом: красным ресурс бывает и от строения, и различает их
               подпись. Знак «?» остаётся про строение. */
            mark={<span role="status" className="flex items-center gap-2">
              <span style={{ width: 7, height: 7, borderRadius: "50%",
                background: taken ? OK : BAD }} />
              <Mark text={taken ? "ресурс" : "не принят"} label="ресурс"
                ok={checkTrait(t.id, { traits, funcs }).ok} tone={taken ? undefined : BAD}
                onWhy={() => onWhy && onWhy(t.id)} />
            </span>}
            summary={<>
              {/* Все классификации сразу: одна вещь бывает и ресурсом, и
                  затратой, и выбирать за человека, какую показать, не за
                  что. Ни одной — так и сказано, а не подставлена первая
                  попавшаяся. */}
              {ks.length
                ? ks.map((k, i) => (
                  <span key={k.id || i} style={{ color: k.color }}>
                    {i ? " · " : ""}{k.sign} {k.name}</span>))
                : <span style={{ color: C.muted }}>без классификации</span>}
              {` · есть ${nm(Number(t.have) || 0)} ${t.unit || ""}`}
              {` · выдают ${made}, берут ${used}`}
            </>}>
            <Form title="количество и единица">
            <div className="flex flex-wrap gap-2">
              {/* «Есть сейчас» не вводят: это число единиц в материалах и
                  принятых сдачах минус израсходованное. Введённое руками
                  число разошлось бы с вещами, которые можно скачать. */}
              <div style={{ flex: "1 1 110px" }}>
                <div style={S.lbl}>есть сейчас</div>
                <div style={{ fontSize: 12.5, padding: "6px 0" }} aria-label="есть сейчас">
                  {nm(Number(t.have) || 0)} {t.unit || ""}
                  <span style={{ fontSize: 10.5, color: C.muted }}> · по материалам</span>
                </div>
              </div>
              <div style={{ flex: "1 1 110px" }}>
                <div style={S.lbl}>единица</div>
                <TxtField value={t.unit || ""} onCommit={(v) => up(t.id, { unit: v })} />
              </div>
            </div>
            </Form>
            {/* ─── чем подтверждается единица ───
                Вопрос не к загрузке, а к ресурсу: чем подтверждается
                договор, решают один раз — когда заводят «договоры», а не
                каждый раз, когда очередной договор кладут. Отсюда правило
                и берут обе двери: «Материалы» и сдача задачи.
                Загружают только файл или текст; уникальный код создаёт
                программа, а прикладывают к нему подтверждение — один файл
                на всю загрузку. */}
            <Form title="чем подтверждается единица">
            <div className="flex flex-wrap gap-2">
              {MATERIAL_KINDS.map((k) => {
                const on = traitKind(t) === k.id;
                return (
                  <button key={k.id} aria-pressed={on}
                    aria-label={`${k.name}: ${t.l || "без названия"}`}
                    style={{ ...btn(on, on ? ACC : null), fontSize: 11, padding: "3px 7px" }}
                    onClick={() => up(t.id, { kind: k.id })}>{k.name}</button>);
              })}
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
              {traitKind(t) === "code"
                ? "Код создаёт программа. При загрузке прикладывают подтверждение — один файл на все единицы."
                : traitKind(t) === "text"
                  ? "Каждую единицу вводят текстом — свой у каждой."
                  : "Каждую единицу прикладывают файлом — свой у каждой."}
            </div>
            </Form>

            {/* Классификаций может быть несколько: кнопки не переключают
                одну на другую, а ставят и снимают каждую сама по себе. */}
            <Form title="чем считаем — можно несколько">
            <div className="flex flex-wrap gap-2">
              {kinds.map((x) => {
                const on = hasKind(t, x.id);
                return (
                  <button key={x.id} aria-pressed={on}
                    aria-label={`${x.name}: ${t.l || "без названия"}`}
                    style={{ ...btn(on, x.color), fontSize: 11, padding: "3px 7px" }}
                    onClick={() => { const z = toggleKind(t, x.id); up(t.id, { ks: z.ks, k: z.k }); }}>
                    {x.sign} {x.name}</button>);
              })}
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
              Ресурс меняют функции. Цель по нему ставится в «Прогнозе».
            </div>
            </Form>
            {/* «Принять» — как у функции: слово человека, что ресурс описан
                верно. Кнопка нажимается всегда, а любая правка пометку
                снимает — иначе зелёная точка стояла бы на изменённом. */}
            <Form title="принять">
            <button onClick={() => !taken && accept(t.id)} aria-disabled={taken}
              aria-label={`принять ресурс ${t.l || "без названия"}`}
              style={{ width: "100%", borderRadius: 7, padding: "7px",
                fontSize: 12, cursor: taken ? "default" : "pointer",
                background: taken ? "transparent" : "rgba(61,220,151,.13)",
                border: `1px solid ${taken ? C.line : OK}`,
                color: taken ? C.muted : OK }}>
              {taken ? "Принят — любая правка снимет пометку" : "Принять"}</button>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
              {taken
                ? "Ресурс принят. Любая правка названия, единицы или вида снимет пометку."
                : "Принять — сказать, что ресурс описан верно."}
            </div>
            </Form>
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
    if (!focus) return;
    // Из процесса (2026-09-13) просят открыть и ресурс, и воркеров: нажатие
    // на сущность в шаге ведёт туда же, куда вкладка и карточка руками.
    if (focus.kind === "func") { setTab("funcs"); setOpenFunc(focus.id); }
    else if (focus.kind === "trait") { setTab("traits"); setOpenTrait(focus.id); }
    else if (focus.kind === "workers") setTab("workers");
  }, [focus?.id, focus?.n, focus?.kind]);
  const mineFuncs = props.funcs.filter((f) => f.e === props.entityId).length;
  const mineTraits = props.traits.filter((t) => t.e === props.entityId).length;
  const mineFactors = (props.factors || []).filter((x) => x.e === props.entityId).length;
  // Людей, а не назначений: один человек может быть всеми тремя сразу.
  const workers = countWorkers(props.workers);
  const TABS = [
    ["workers", "Воркеры", workers],
    ["funcs", "Функции", mineFuncs],
    // Факторы — сразу за функциями: их выбирают в функции, и рядом искать
    // ближе. Пока убраны с экрана (lib/flags.js) — модель их помнит.
    ...(FACTORS_ON ? [["factors", "Факторы", mineFactors]] : []),
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
          tasks={props.tasks} funcs={props.funcs} entityId={props.entityId}
          rolesOf={props.rolesOf} roleName={props.roleName}
          onToggleFunc={(pid, fid) => props.setFuncs((p) => p.map((f) => (f.id === fid
            ? editFunc(f, (x) => toggleExcept(x, pid)) : f)))}
          onToggleCrew={props.onToggleCrew} onOrder={props.onOrderWorker}
          pickByOrder={props.pickByOrder} onPickByOrder={props.onPickByOrder}
          onOpenPerson={props.onOpenPerson}
          published={props.published} me={props.me}
          positions={props.positions} onAddPosition={props.onAddPosition}
          onDropPosition={props.onDropPosition} onSetRoles={props.onSetRoles} />)}

      {/* `onMarket` назван отдельно, хотя и уехал бы с `{...props}`: кнопки
          «рынка услуг» показываются только когда он передан, и молчаливая
          передача через россыпь пропсов это бы спрятала. */}
      {tab === "funcs" && (
        <Funcs {...props} open={openFunc} setOpen={setOpenFunc} onWhy={props.onWhyFunc}
          onMarket={props.onMarket} />)}

      {tab === "factors" && (
        <Factors entityId={props.entityId} factors={props.factors || []}
          setFactors={props.setFactors} funcs={props.funcs} setFuncs={props.setFuncs} />)}

      {tab === "traits" && (
        <Traits entityId={props.entityId} traits={props.traits} setTraits={props.setTraits}
          funcs={props.funcs} tasks={props.tasks} materials={props.materials}
          kinds={props.kinds} kindOf={props.kindOf}
          open={openTrait} setOpen={setOpenTrait}
          onWhy={props.onWhyTrait} onDelete={props.onDeleteTrait}
          onUpKind={props.onUpKind} onAddKind={props.onAddKind}
          onDelKind={props.onDelKind} kindMsg={props.kindMsg} />)}
    </div>);
}
