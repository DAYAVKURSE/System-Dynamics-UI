import { FACTORS_ON } from "../lib/flags.js";
import React, { useEffect, useMemo, useState } from "react";
import { C, OK, WARN, BAD, NEU, ACC, NameField, S, btn, nm, NumField, TxtField } from "./ui.jsx";
import { funcLabel, twinNo } from "./TasksBoard.jsx";
import { putReportFile, reportSrc, textHref } from "../storage.js";
import { getTelegram } from "../telegram.js";
import { putShare } from "../identity.js";
import {
  childrenOf, dropNode, linkTo, newProject, newSection, pickedOf, procsOfTrait,
  pathOf, rootsOf, shareLink, summaryOf,
} from "../lib/reports.js";
import { deliverReport, reportHtml, reportOf, rangeTimeText, timeText }
  from "../lib/reportDoc.js";
import { chainOf } from "../lib/chain.js";
import { MATERIAL_KINDS, newCode, newMaterials, spentIds, traitKind, unitsOf, unitsOfTrait }
  from "../lib/units.js";
import Modal from "./Modal.jsx";

/* ════════════════════════════════════════════════════════════════
   ОТЧЁТЫ · карта проектов

   Раздел не показывает «что выбрали показать» — он ПРОСЛЕЖИВАЕТ. Человек
   называет две вещи: с какого ресурса начинается работа (и прикладывает его
   самого — вот это техническое задание) и до какого звена вести. Всё
   остальное приложение считает само по модели: как изменятся ресурсы,
   сколько это займёт, какие шаги будут сделаны и какие факторы на это
   повлияют.

   ─── два вопроса, и оба про ОДНУ вещь ───

   · выбрана определённая единица («вот этот договор») — отчёт про неё:
     её задачи, её вещи, её часы;
   · не выбрано ничего — прогноз: что произойдёт, когда договор появится.

   Третьего вопроса — «покажи весь поток по функциям» — здесь нет.
   Отслеживая ОДИН контакт лида, человек видел четыре одинаковых «передать
   заказ разработчикам» (работу над четырьмя чужими контактами) и
   справедливо не понимал, при чём тут его.

   ─── две части и разделы отчёта ───

   Части одни и те же в каждом блоке, включая корневой проект, потому что
   проект и раздел это одна и та же запись:

     1. прогноз ресурсов — насколько изменится каждый; вещи, которые уже
        вышли, открываются нажатием на строку своего ресурса;
     2. задачи — таймлайн на календарной линейке, а под ним РАЗДЕЛЫ ОТЧЁТА.

   Раздел отчёта — это выполняемая ФУНКЦИЯ, и набор данных у него тот же,
   что и у отчёта целиком: оценка, прогноз ресурсов, задачи. Ссылка есть у
   раздела, а не у части страницы: ссылаются на «передачу заказа
   разработчикам», а не на «первый блок сверху».

   Разделы руками никто не размечает — кнопки для этого нет.
   ════════════════════════════════════════════════════════════════ */

/* Вилка часов: меньшее слева, и одинаковые границы говорятся один раз.
   «Щедрая» сторона оценки считается по БЫСТРОЙ работе, поэтому часов в ней
   меньше — и без сортировки строка выходила задом наперёд: «674–505 ч». */
const hoursRange = (a, b) => {
  const lo = Math.min(Number(a) || 0, Number(b) || 0);
  const hi = Math.max(Number(a) || 0, Number(b) || 0);
  return lo === hi ? `${nm(hi)} ч` : `${nm(lo)}–${nm(hi)} ч`;
};

const fmtDT = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v)
    : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit",
      year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/* ─────── ПРОГНОЗ РЕСУРСОВ ───────

   Вопрос здесь один: НАСКОЛЬКО изменится каждый ресурс и сходится ли
   прогноз с фактом. Поэтому у каждого ресурса своя строка и своя шкала:
   доход в сотнях тысяч и договоры в штуках на общей шкале превращали
   договоры в невидимую чёрточку — «график, на котором ни хрена не
   понятно». Сравнивать доход с договорами и незачем: их не складывают.
   Сравнивают ПРОГНОЗ С ФАКТОМ, и это сравнение внутри строки честное —
   обе полосы на одной шкале.

   Прогноз — вилка, и рисуется вилкой: полоса от нижней границы до верхней,
   а не одно число, которого никто не обещал. Ноль отмечен линией: расход
   уходит влево от него, приход — вправо, и врать формой не приходится.

   ─── созданное открывается ЗДЕСЬ ───

   Отдельного списка «созданные ресурсы» нет. Вопрос «что уже появилось»
   задают не вообще, а про конкретный ресурс: «а договоров-то сколько
   реально вышло, покажи их». Поэтому строка ресурса, у которого есть
   родившиеся единицы, нажимается — и под ней открываются сами вещи со
   скачиванием. Второй список отвечал бы на тот же вопрос второй раз и в
   другом порядке.

   Числа стоят ТЕКСТОМ рядом с названием, а не подписями внутри картинки.
   Прежде они рисовались за краем svg с `overflow: visible` и при больших
   значениях вылезали из формы; текст в потоке переносится и не вылезает
   никогда. Заодно это второе кодирование к цвету: пара «прогноз/факт»
   читается и без цвета — так требует правило про план и факт. */
export function ChangeChart({ rows = [], traitName, madeOf, off, onToggle }) {
  const [open, setOpen] = useState("");
  if (!rows.length) return null;
  const isOff = (id) => !!(off && off.has && off.has(String(id)));
  const live = rows.filter((r) => !isOff(r.trait));
  /* ОДНА шкала на все столбцы (владелец, 2026-09-19: «однородный график,
     который также будет показывать отрицательные значения»). Своя шкала у
     каждого — это не график, а набор полос: «+3» и «+3000» выглядели бы
     одинаково. Ноль всегда на шкале, поэтому убыль видно вниз от него, а
     прибыль вверх. */
  const vals = live.flatMap((r) => [Math.min(r.lo, r.hi), Math.max(r.lo, r.hi),
    ...(r.fact == null ? [] : [r.fact])]);
  const rawMin = Math.min(0, ...vals);
  const rawMax = Math.max(0, ...vals);
  const pad = (rawMax - rawMin || 1) * 0.08;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const H = 128;                       // высота поля полос
  const y = (v) => ((max - v) / (max - min || 1)) * H;
  const zeroY = y(0);
  /* Полоса — от нуля к значению: вверх при прибыли, вниз при убыли
     (владелец, 2026-09-20: «полоски должны быть вертикальными… отдалённо
     похож на эквалайзер»). */
  const bar = (a, b, color, title, dim) => {
    const top = Math.min(y(a), y(b));
    const height = Math.abs(y(b) - y(a));
    return (
      <div title={title} style={{ position: "absolute", left: 0, right: 0,
        top, height: Math.max(height, a === b ? 0 : 2), background: color,
        borderRadius: 2, opacity: dim ? 0.45 : 1 }} />);
  };
  const dot = (color, label) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10.5, color: C.muted }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color }} />
      {label}</span>);
  const opened = open ? rows.find((r) => r.trait === open) : null;
  const openedUnits = opened && madeOf ? madeOf(opened.trait) : [];
  return (
    <div>
      <div className="flex" style={{ alignItems: "flex-start", gap: 6 }}>
        {/* Шкала слева: без неё высота полосы — число без единиц. */}
        <div style={{ position: "relative", width: 34, height: H, flex: "0 0 34px",
          fontSize: 9.5, color: C.muted, fontFamily: "ui-monospace, monospace" }}>
          <span style={{ position: "absolute", right: 0, top: 0 }}>{nm(rawMax)}</span>
          <span style={{ position: "absolute", right: 0, top: zeroY - 6 }}>0</span>
          {rawMin < 0 && <span style={{ position: "absolute", right: 0, bottom: 0 }}>{nm(rawMin)}</span>}
        </div>
        <div data-chart="" style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
          <div className="flex" style={{ alignItems: "flex-end", gap: 10,
            minWidth: `${rows.length * 42}px` }}>
            {rows.map((r) => {
              const lo = Math.min(r.lo, r.hi);
              const hi = Math.max(r.lo, r.hi);
              const gone = isOff(r.trait);
              const planText = lo === hi ? nm(hi) : `${nm(lo)} … ${nm(hi)}`;
              const units = madeOf ? madeOf(r.trait) : [];
              const label = `${traitName(r.trait)}: прогноз ${planText}`
                + (r.fact == null ? ", факта нет" : `, факт ${nm(r.fact)}`)
                + (gone ? " — не прослеживается" : "");
              return (
                <div key={r.trait} style={{ flex: "0 0 32px", width: 32 }}>
                  <div role="img" aria-label={label} data-off={gone ? "1" : undefined}
                    style={{ position: "relative", height: H,
                      opacity: gone ? 0.35 : 1, cursor: units.length && !gone ? "pointer" : "default" }}
                    onClick={() => (units.length && !gone ? setOpen(open === r.trait ? "" : r.trait) : null)}>
                    <div style={{ position: "absolute", left: 0, right: 0, top: zeroY,
                      height: 1, background: C.line }} />
                    {/* Прогноз — левая полоса, факт — правая: столбик на
                        ресурс, как на эквалайзере. */}
                    <div style={{ position: "absolute", left: 2, width: 12, top: 0, bottom: 0 }}>
                      {lo !== 0 && bar(0, lo, gone ? NEU : WARN, `прогноз не меньше ${nm(lo)}`)}
                      {lo !== hi && bar(lo, hi, gone ? NEU : WARN, `прогноз до ${nm(hi)}`, true)}
                    </div>
                    <div style={{ position: "absolute", right: 2, width: 12, top: 0, bottom: 0 }}>
                      {r.fact != null && r.fact !== 0 && bar(0, r.fact, gone ? NEU : OK, `факт ${nm(r.fact)}`)}
                    </div>
                  </div>
                  {/* Подпись по диагонали и галочка под самой полосой
                      (владелец, 2026-09-20). Снятая галочка — ресурс серый
                      и в отчёт не идёт. */}
                  <div style={{ height: 78, position: "relative", marginTop: 4 }}>
                    {onToggle && (
                      <input type="checkbox" checked={!gone}
                        aria-label={`прослеживать ${traitName(r.trait)}`}
                        onChange={() => onToggle(r.trait)}
                        style={{ position: "absolute", left: 8, top: 0 }} />)}
                    {/* Длинное имя обрезается: иначе подпись уезжает на
                        соседний столбец и читаются обе плохо. */}
                    <span title={traitName(r.trait)} style={{ position: "absolute", left: 14, top: 20,
                      transform: "rotate(45deg)", transformOrigin: "left top",
                      whiteSpace: "nowrap", fontSize: 10.5, maxWidth: 86,
                      overflow: "hidden", textOverflow: "ellipsis",
                      color: gone ? C.muted : C.text }}>{traitName(r.trait)}</span>
                  </div>
                </div>);
            })}
          </div>
        </div>
      </div>
      {/* Подписи — ПОД графиком и без пояснений (владелец, 2026-09-20). */}
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 4 }}>
        {dot(WARN, "прогноз")}{dot(OK, "факт")}{dot(NEU, "неактивен")}
      </div>
      {opened && !!openedUnits.length && (
        <div style={{ borderLeft: `2px solid ${C.line}`, paddingLeft: 8, marginTop: 6 }}
          aria-label={`созданные единицы: ${traitName(opened.trait)}`}>
          {openedUnits.map((u) => (<MadeUnit key={u.id} u={u} traitName={traitName} />))}
        </div>)}
    </div>);
}

/* ─────── задачи ───────

   Шаг и задача — не два раздела отчёта, а одно дело с двух сторон: шаг
   говорит, что должно случиться, задача — что случилось. Пока они стояли
   двумя списками, человеку приходилось сводить их глазами, и первый же
   вопрос был «почему шаг один, а задач четыре». Поэтому здесь один список:
   шаг, а под ним его работа — с ожидаемыми числами рядом с полученными.

   Созданные вещи тоже живут ЗДЕСЬ, у сделавшей их задачи. Отдельным
   списком они отвечали на вопрос «что вообще появилось», а спрашивают
   другое: «что вышло вот из этой работы».

   У фактора задач нет вовсе: с погоды не спрашивают — на его месте так и
   сказано, а не оставлено пустое место, которое читается как недоделка. */

/* ─────── таймлайн шагов ───────

   Отчёт нужен СНАЧАЛА для планирования конкретных работ: «что за чем идёт и
   сколько тянется». Список этого не показывает — «начнётся через 1 ч» и
   «займёт 1 мес» человеку приходится складывать в голове. Поэтому шаги
   стоят на одной шкале времени: сдвиг полосы вправо и есть ответ на «что за
   чем», а её длина — на «как долго».

   Шкала — часы от «сейчас», потому что план считается вперёд от этого
   мгновения. Заведённые задачи ложатся на ту же шкалу по своим срокам: так
   видно, попадает ли назначенная работа в план или уже отстала. Задача без
   дат полосы не получает — рисовать её «где-нибудь» значило бы придумать
   срок, которого никто не ставил. */
/* Дата на оси: коротко, но однозначно. В пределах года год не пишется —
   он и так виден по соседям; за годом — пишется, иначе «03.02» через два
   года читается как в этом. */
const axisDate = (ms, longSpan) => {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", longSpan
    ? { day: "2-digit", month: "2-digit", year: "2-digit" }
    : { day: "2-digit", month: "2-digit" });
};

function Timeline({ steps = [], before = [], traitName = (x) => x }) {
  const now = Date.now();
  const hrs = (v) => {
    if (!v) return null;
    const ms = new Date(v).getTime();
    return Number.isNaN(ms) ? null : (ms - now) / 3600000;
  };
  const rows = [];
  steps.forEach((s) => {
    /* Шаг, который не выполнится, полосы не получает: нарисовать ему срок
       значило бы пообещать работу, которая не начнётся. */
    const stuck = !!s.short?.length;
    rows.push({ key: s.func, name: s.name, kind: "step",
      stuck,
      from: stuck ? null : s.startHours,
      to: stuck ? null : s.startHours + Math.max(s.calendarHours, 0.01),
      /* Почему шаг не выполнится — здесь же: раздела «Функции», где это
         было сказано, больше нет (владелец, 2026-09-19), а молча показать
         полосу без срока значило бы оставить вопрос без ответа. */
      note: stuck
        ? `не выполнится: не хватает ${(s.short || []).map((x) => `${traitName(x.trait)}${
          x.spentBy ? ` (израсходовал шаг «${x.spentBy}»)` : ""}`).join(", ")}`
        : `${nm(s.runs)} × ${timeText(s.calendarHours / Math.max(s.runs, 1))}` });
    s.tasks.forEach((t) => {
      const a = hrs(t.start);
      const b = hrs(t.end);
      rows.push({ key: t.id, name: t.title, kind: "task", done: t.hours != null,
        from: a == null ? null : a, to: b == null ? null : b });
    });
  });
  /* Работа, в которой прослеживаемые вещи родились, лежит ДО цепочки — но
     на той же шкале: без неё не видно, откуда всё началось. */
  before.forEach((t) => {
    rows.unshift({ key: t.id, name: t.title, kind: "task", done: t.hours != null,
      from: hrs(t.start), to: hrs(t.end), before: true });
  });
  const placed = rows.filter((r) => r.from != null && r.to != null);
  if (!placed.length) return null;
  const from0 = Math.min(0, ...placed.map((r) => r.from));
  const to1 = Math.max(...placed.map((r) => r.to), from0 + 1);
  const span = to1 - from0 || 1;
  const at = (v) => ((v - from0) / span) * 100;

  /* ─── ось в ДАТАХ, а не в «сейчас … весь срок» ───

     «Начнётся через 1 ч» и «займёт 1 мес» человек складывал в уме, глядя
     на безымянную полосу: под ней не было ни одной даты, и сказать, на
     какое число попадает конец, было нельзя. Теперь под шкалой стоит
     линейка с числами — по ней и читают, когда что.

     Делений пять: меньше — линейка перестаёт быть линейкой, больше —
     числа налезают друг на друга на телефоне. Шаг равномерный по времени,
     а не «красивый»: подгонять его под круглые даты значило бы сдвигать
     деления относительно полос, которые они подписывают. */
  const TICKS = 5;
  const longSpan = span > 24 * 330;
  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const h = from0 + (span * i) / (TICKS - 1);
    return { at: at(h), text: axisDate(now + h * 3600000, longSpan) };
  });
  const axis = (
    <div style={{ position: "relative", height: 24, marginTop: 2 }}>
      {ticks.map((k, i) => (
        <div key={k.at} style={{ position: "absolute", left: `${k.at}%`,
          top: 0, transform: i === 0 ? "none"
            : (i === TICKS - 1 ? "translateX(-100%)" : "translateX(-50%)") }}>
          <div style={{ width: 1, height: 4, background: C.line,
            margin: i === 0 ? "0" : (i === TICKS - 1 ? "0 0 0 auto" : "0 auto") }} />
          <div style={{ fontSize: 9.5, color: C.muted, whiteSpace: "nowrap" }}>
            {k.text}</div>
        </div>))}
    </div>);

  return (
    <div style={{ marginBottom: 10 }}>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "baseline",
        fontSize: 10, color: C.muted, marginBottom: 3 }}>
        <span style={{ flex: 1 }}>
          сегодня {axisDate(now, longSpan)}</span>
        <span>весь срок: {timeText(to1)}</span>
      </div>
      {rows.map((r, i) => (
        <div key={`${r.key}-${i}`} style={{ marginBottom: 3 }}>
          <div style={{ fontSize: r.kind === "step" ? 11 : 10.5,
            color: r.kind === "step" ? C.text : C.muted,
            paddingLeft: r.kind === "step" ? 0 : 12, lineHeight: 1.4 }}>
            {r.kind === "task" ? "↳ " : ""}{r.name}
            {r.before && <span style={{ color: C.muted }}> · до цепочки</span>}
            {r.note ? <span style={{ color: C.muted }}> · {r.note}</span> : ""}
            {/* Даты стоят и словами: на узкой полосе их не прочесть, а
                спрашивают в первую очередь именно «с какого по какое». */}
            {r.from != null && r.to != null && (
              <span style={{ color: C.muted }}>
                {" · "}{axisDate(now + r.from * 3600000, longSpan)}
                {" — "}{axisDate(now + r.to * 3600000, longSpan)}</span>)}
          </div>
          {/* Пустой жёлоб у шага, которого на шкале нет, читался бы как
              полоса нулевой длины — то есть как работа, которая всё-таки
              случится мгновенно. Поэтому жёлоба у него нет вовсе. */}
          {!r.stuck && (
          <div style={{ position: "relative", height: r.kind === "step" ? 9 : 6,
            marginTop: 2, marginLeft: r.kind === "step" ? 0 : 12,
            background: C.ink, borderRadius: 3, overflow: "hidden" }}>
            {/* Линия «сегодня»: без неё не видно, что часть работы уже позади. */}
            <div style={{ position: "absolute", left: `${at(0)}%`, top: 0, bottom: 0,
              width: 1, background: C.muted, opacity: 0.55 }} />
            {r.from == null || r.to == null
              ? null
              : (<div title={`${r.name}: ${timeText(r.to - r.from)}`}
                  style={{ position: "absolute", left: `${at(r.from)}%`,
                    width: `${Math.max(at(r.to) - at(r.from), 1)}%`, minWidth: 3,
                    top: 0, bottom: 0, borderRadius: 3,
                    background: r.kind === "step" ? WARN : (r.done ? OK : NEU) }} />)}
          </div>)}
          {r.kind === "task" && (r.from == null || r.to == null) && (
            <div style={{ fontSize: 10, color: C.muted, paddingLeft: 12 }}>
              срок не поставлен — на шкале её нет</div>)}
          {r.stuck && (
            <div style={{ fontSize: 10, color: WARN }}>
              на шкале его нет: он не начнётся</div>)}
        </div>))}
      {axis}
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center",
        marginTop: 4, fontSize: 10, color: C.muted }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 9, height: 6, borderRadius: 2, background: WARN }} />
          шаг по прогнозу</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 9, height: 6, borderRadius: 2, background: NEU }} />
          задача в работе</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 9, height: 6, borderRadius: 2, background: OK }} />
          принято</span>
      </div>
    </div>);
}

/** Одна созданная вещь: номер, что это, и файл — его и скачивают. */
function MadeUnit({ u, traitName }) {
  return (
    <div className="flex flex-wrap gap-2" style={{ alignItems: "center",
      fontSize: 10.5, color: C.muted, marginTop: 2 }}>
      <span style={{ color: OK }}>вышло:</span>
      <span style={{ color: ACC, fontWeight: 700 }}>№{u.no}</span>
      <span>{traitName(u.trait)} · {u.title || "без названия"}</span>
      <span style={{ color: u.accepted ? OK : WARN }}>
        {u.accepted ? "принято" : "не принято"}</span>
      {/* Файл — сама вещь, а не отчёт о ней: ради неё работу и заказывали,
          и скачать её надо прямо отсюда. */}
      {u.file
        ? <a href={reportSrc(u.file)} target="_blank" rel="noreferrer"
            download={u.file.name} style={{ color: ACC }}>
            {/^image\//.test(u.file.type || "") ? "🖼" : "📎"} скачать · {u.file.name}</a>
        : <span style={{ color: WARN }}>файла нет — при сдаче не приложили</span>}
    </div>);
}

/* ─────── оценка строкой «что — сколько» ───────

   Прежде она шла одной строкой через точки: «выполнений 1 · начнётся через
   мгновенно · займёт 1 дн · работы 24 ч · берёт заявка 1 · даёт макет 1».
   Прочесть это нельзя: непонятно, где кончается одно число и начинается
   другое, и — главное — что за величина названа. Поэтому каждая величина
   стоит своей строкой и названа полностью: слева вопрос, справа ответ. */
function Facts({ rows = [] }) {
  const shown = rows.filter((r) => r && r.value != null && r.value !== "");
  if (!shown.length) return null;
  return (
    <div style={{ marginTop: 3 }}>
      {shown.map((r) => (
        <div key={r.label} className="flex flex-wrap gap-2"
          style={{ alignItems: "baseline", lineHeight: 1.6 }}>
          <span style={{ fontSize: 10.5, color: C.muted, flex: "1 1 175px" }}>
            {r.label}</span>
          <span style={{ fontSize: 11, color: r.color || C.text,
            fontWeight: 600, flex: "1 1 90px" }}>{r.value}</span>
        </div>))}
    </div>);
}

/* Кнопка «ссылка на этот раздел». Раздел отчёта — это выполняемая функция,
   и адрес у него свой: без него на шаг нельзя сослаться, а спрашивают чаще
   всего именно про шаг. На части страницы ссылок нет: часть — это способ
   разложить один и тот же раздел, а не самостоятельное место. */
function AnchorLink({ href, label }) {
  const [copied, setCopied] = useState("");
  const go = async () => {
    try {
      await navigator.clipboard.writeText(href);
      setCopied("ссылка скопирована");
    } catch { setCopied(href); }
  };
  return (
    <span className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
      <button style={{ ...btn(false), fontSize: 10, padding: "1px 6px" }}
        aria-label={`ссылка на раздел отчёта: ${label}`} onClick={go}>🔗</button>
      {copied && (<span style={{ fontSize: 10, color: ACC, wordBreak: "break-all" }}>
        {copied}</span>)}
    </span>);
}

/**
 * Раздел отчёта — одна выполняемая функция.
 *
 * Набор данных у него тот же, что и у отчёта целиком: оценка, прогноз
 * ресурсов и задачи. Иначе «раздел» означал бы то одно, то другое, и
 * ссылка на раздел вела бы неизвестно на что.
 */
/* Строка задачи — одна на все разделы, где задачи показываются: срок,
   исполнитель, состояние, часы по плану и по факту, что взяла и что вышло.
   Ожидалось и вышло — рядом, на одной задаче: ради этого сравнения отчёт
   и заводят. Часы у непринятой работы не показываются: их ещё никто не
   измерил, а ноль читался бы как «сделано даром». */
function TaskRow({ t, planHours, twins, personName, traitName }) {
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: "4px 0" }}>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
        <span style={{ fontSize: 11.5, flex: "1 1 130px" }}>
          {t.title}
          {twins[t.id] && (
            <span style={{ color: C.muted }}>
              {" "}№{twins[t.id].no} из {twins[t.id].of}</span>)}
        </span>
        <span style={{ fontSize: 10.5, color: C.muted }}>
          {t.assignee == null ? "не назначен" : personName(t.assignee)}</span>
        <span style={{ fontSize: 10.5, color: C.muted }}>{fmtDT(t.end)}</span>
        <span style={{ fontSize: 10.5,
          color: t.canceled ? BAD
            : t.status === "done" ? OK : t.status === "deadline" ? BAD : WARN }}>
          {t.canceled ? "отменена"
            : t.status === "done" ? "принято" : t.status}</span>
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>
        {planHours === "—" ? "" : `по плану ${planHours} ч · `}
        {t.hours == null ? "факта пока нет"
          : <span style={{ color: OK }}>по факту {nm(t.hours)} ч</span>}
        {!!t.took.length && (
          <span style={{ color: ACC }}>
            {" · взяла "}{t.took.map((u) => `${traitName(u.trait)} №${u.no}`).join(", ")}
          </span>)}
      </div>
      {t.made.map((u) => (<MadeUnit key={u.id} u={u} traitName={traitName} />))}
    </div>);
}

/* Что функция берёт и что даёт — одной строкой; нули не пишутся, иначе
   строка заполняется тем, чего не происходит. */
const portLine = (list, traitName) => (list || [])
  .filter((x) => nm(x.qty) !== "0")
  .map((x) => `${traitName(x.trait)} ${nm(x.qty)}`).join(", ");

/* Сколько по плану уходит на ОДНО выполнение: с этим числом и сравнивают
   потраченные часы задачи. Выполнений нет — сравнивать не с чем. */
const perRun = (s) => (s.runs > 0 ? nm(Math.round((s.workHi / s.runs) * 10) / 10) : "—");


/* ─── 3. сроки и трудозатраты ─── */
function Schedule({ steps = [], before = [], plan, actual, traitName = (x) => x }) {
  return (
    <div>
      <Facts rows={[
        { label: "Займёт времени — вся цепочка", color: WARN,
          value: rangeTimeText(plan.lo.calendarHours, plan.hi.calendarHours) },
        { label: "Работы людей, человеко-часов", color: WARN,
          value: hoursRange(plan.lo.workHours, plan.hi.workHours) },
        { label: "Фактически ушло часов", color: actual.any ? OK : C.muted,
          value: actual.any ? `${nm(actual.hours)} ч` : "факта пока нет" },
      ]} />
      {/* Таймлайн — на календарной линейке: по ней и читают, когда что. */}
      <div style={{ marginTop: 8 }}>
        <Timeline steps={steps} before={before} traitName={traitName} />
      </div>
      {/* Списка «по функциям» здесь нет (владелец, 2026-09-20: «раздел
          „Сроки и трудозатраты" это уже отражает») — то же самое стоит
          выше полосами на календарной линейке. */}
    </div>);
}

/* ─── 4. задачи ─── */
function TaskList({ steps = [], before = [], actual, personName, traitName }) {
  /* Задачи, названные одинаково, различаются номером при ПОКАЗЕ: править
     сохранённое название приложение не должно — это слова человека. */
  const twins = twinNo([...steps.flatMap((s) => s.tasks), ...before]);
  const any = before.length || steps.some((s) => s.tasks.length);
  const row = (t, planHours) => (
    <TaskRow key={t.id} t={t} planHours={planHours} twins={twins}
      personName={personName} traitName={traitName} />);
  return (
    <div>
      <Facts rows={[
        { label: "Задач принято", color: actual.any ? OK : C.muted,
          value: actual.any ? `${nm(actual.done)} из ${nm(actual.total)}` : "ни одной" },
      ]} />
      {!any && (
        <div style={{ fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
          Задач по этому разделу ещё не заведено — пока это только прогноз.
        </div>)}
      {!!before.length && (<>
        <div style={{ ...S.lbl, margin: "8px 0 2px" }}>как эти вещи появились</div>
        {/* Работа, в которой выбранные вещи родились, лежит ДО цепочки.
            Выбросить её значило бы не ответить, откуда они взялись. */}
        {before.map((t) => row(t, "—"))}
      </>)}
      {any && steps.map((s) => (
        <div key={s.func} style={{ marginTop: 8 }}>
          <div style={S.lbl}>функция «{s.name}»</div>
          {s.tasks.length
            ? s.tasks.map((t) => row(t, perRun(s)))
            : (<div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
                Задач по этой функции ещё не заведено.</div>)}
        </div>))}
    </div>);
}

/* ─── 5. факторы ─── */
function FactorRows({ factors = [] }) {
  return factors.map((x) => (
    <div key={x.func} className="flex flex-wrap gap-2"
      style={{ alignItems: "baseline", fontSize: 11, lineHeight: 1.6 }}>
      <span style={{ flex: "1 1 120px" }}>{x.name}</span>
      <span style={{ color: ACC }}>
        {x.factors.length
          ? x.factors.map((y) => `${y.name} ${y.chance}%`).join(", ")
          : "фактор не назван"}</span>
    </div>));
}

/* ─────── МАТЕРИАЛЫ ───────

   Все единицы ресурсов в одном месте: те, что вышли из сдач, и те, что
   положили руками. Здесь их смотрят по ресурсу, по номерам и скачивают —
   ради этого вещи и хранят. Отсюда же считается, сколько ресурса есть:
   отдельного поля «есть сейчас» у ресурса нет (lib/units.js, `stockOf`).

   Загрузка — окном, а не полем в строке: у единицы три вида (файл, текст,
   уникальное поле), и она может быть только чем-то одним. В окне это
   видно сразу — переключатель, и под ним ровно одно поле. */

const kindName = (id) => MATERIAL_KINDS.find((k) => k.id === id)?.name || id;

function UnitRow({ u, unit, spent, nameOf, traitName, unitNo }) {
  const when = u.at ? fmtDT(u.at) : "";
  /* Имя — только когда оно есть: голый идентификатор («local», «100»)
     читается номером, а не человеком, и говорить его незачем. */
  const named = u.by != null && u.by !== "" && nameOf ? String(nameOf(u.by) ?? "") : "";
  const who = named && named !== String(u.by) ? named : "";
  const body = u.kind === "code" && u.code
    ? <span style={{ fontFamily: "ui-monospace, monospace", letterSpacing: 1 }}>{u.code}</span>
    : u.file ? <span>{/^image\//.test(u.file.type || "") ? "🖼" : "📎"} {u.file.name}</span>
      : u.text && u.from === "material" ? <span style={{ whiteSpace: "pre-wrap" }}>{u.text}</span>
        : u.from === "task" ? <span style={{ color: C.muted }}>{u.title || "без названия"}</span>
          : <span style={{ color: WARN }}>содержимого нет</span>;
  const href = u.file ? reportSrc(u.file) : textHref(u.code || u.text);
  const fileName = u.file ? u.file.name : `${unit}-${u.no}.txt`;
  /* Что отдано взамен: ресурс, сколько и — если исполнитель назвал —
     какие именно номера. По этому видно, из чего вещь сделана. */
  const given = Object.entries(u.takes || {})
    .filter(([, v]) => Number(v) > 0)
    .map(([trait, v]) => {
      const nos = (u.took || []).map((id) => unitNo?.(id)).filter((x) => x && x.trait === trait)
        .map((x) => `№${x.no}`);
      return `${traitName(trait)} ${nm(Number(v))}${nos.length ? ` (${nos.join(", ")})` : ""}`;
    });
  const line = { fontSize: 10.5, color: C.muted, marginTop: 2, lineHeight: 1.5 };
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: "6px 0" }}>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center", fontSize: 11.5 }}>
        <span style={{ color: ACC, fontWeight: 700 }}>№{u.no}</span>
        {u.qty > 1 && <span style={{ color: C.muted }}>×{nm(u.qty)}</span>}
        <span style={{ fontSize: 10, color: C.muted }}>{kindName(u.kind)}</span>
        <span style={{ flex: "1 1 160px", minWidth: 0, overflowWrap: "anywhere" }}>{body}</span>
        {/* Слово, не только цвет: «израсходована» и «не принята» — разные
            вещи, и обе должны читаться без цвета. */}
        {spent && <span style={{ fontSize: 10, color: NEU }}>израсходована</span>}
        {!u.accepted && <span style={{ fontSize: 10, color: WARN }}>не принята</span>}
        {(u.file || u.text || u.code) && (
          <a href={href} target="_blank" rel="noreferrer" download={fileName}
            aria-label={`скачать ${unit} №${u.no}`}
            style={{ ...btn(false), fontSize: 11, textDecoration: "none", color: ACC }}>
            скачать</a>)}
      </div>
      {/* Откуда и когда — у каждой единицы своя история. Из задачи:
          какая функция руководила, что написали при сдаче, что отдано
          взамен. Из материалов: так и сказано, без домыслов. */}
      {u.from === "task" ? (<>
        <div style={line}>
          из задачи «{u.title || "без названия"}»
          {u.funcName ? <> · функция «{u.funcName}»</> : " · функция удалена"}
          {when ? ` · ${when}` : ""}{who ? ` · ${who}` : ""}
        </div>
        <div style={line}>отчёт при сдаче: {u.text
          ? <span style={{ color: C.text, whiteSpace: "pre-wrap" }}>{u.text}</span>
          : <span style={{ color: WARN }}>не написан</span>}</div>
        <div style={line}>отдано взамен: {given.length ? given.join(", ") : "ничего"}</div>
      </>) : (
        <div style={line}>
          добавлен на вкладке «Материалы»{when ? ` · ${when}` : ""}{who ? ` · ${who}` : ""}
        </div>)}
    </div>);
}

/** Окно «загрузить единицу ресурса»: количество и по полю на каждую единицу. */
function UploadMaterial({ trait, traitName, kind = "file", existing = [], meId,
  onAdd, onClose }) {
  const [qty, setQty] = useState(1);
  /* На каждую единицу — своё содержимое: «Количество 10» — десять
     файлов, десять текстов или десять кодов, по полю на каждый. Списки
     держатся по индексу: убавили количество — хвост отрезан, прибавили —
     дописаны пустые поля, набранное на месте. */
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState({});
  const [errs, setErrs] = useState({});
  const [texts, setTexts] = useState([]);
  /* Подтверждение — один файл на всю загрузку и сразу на все её единицы:
     у кода показать нечего, кроме бумаги о выдаче, и подтверждают ею
     партию, а не каждый ключ отдельно. */
  const [proof, setProof] = useState(null);
  const [proofBusy, setProofBusy] = useState(false);
  const [proofErr, setProofErr] = useState("");
  /* Коды рождаются здесь, в окне, и показываются до загрузки: то, что
     человек видит, то и сохранится. */
  const taken = useMemo(() => new Set(existing.map((m) => m.code).filter(Boolean)), [existing]);
  const [codes, setCodes] = useState(() => [newCode(taken)]);
  const n = Math.max(1, Math.floor(Number(qty)) || 1);
  useEffect(() => {
    setCodes((p) => {
      if (p.length >= n) return p.slice(0, n);
      const used = new Set([...taken, ...p]);
      const more = Array.from({ length: n - p.length }, () => {
        const c = newCode(used); used.add(c); return c;
      });
      return [...p, ...more];
    });
  }, [n, taken]);
  const regen = () => {
    const used = new Set(taken);
    setCodes(Array.from({ length: n }, () => { const c = newCode(used); used.add(c); return c; }));
  };
  const at = (list, i) => list[i];
  const put = (set, i, v) => set((p) => { const q = [...p]; q[i] = v; return q; });
  const pick = async (i, f) => {
    setErrs((p) => ({ ...p, [i]: "" }));
    if (!f) return;
    setBusy((p) => ({ ...p, [i]: true }));
    try { put(setFiles, i, await putReportFile(f)); }
    catch (e) { setErrs((p) => ({ ...p, [i]: e.message || "не удалось сохранить файл" })); }
    setBusy((p) => ({ ...p, [i]: false }));
  };
  const idx = Array.from({ length: n }, (_, i) => i);
  const filled = kind === "file" ? idx.filter((i) => at(files, i)).length
    : kind === "text" ? idx.filter((i) => String(at(texts, i) || "").trim()).length
      : (proof ? n : 0);
  const ready = filled === n && !Object.values(busy).some(Boolean) && !proofBusy;
  const pickProof = async (f) => {
    setProofErr("");
    if (!f) return;
    setProofBusy(true);
    try { setProof(await putReportFile(f)); }
    catch (e) { setProofErr(e.message || "не удалось сохранить файл"); }
    setProofBusy(false);
  };
  const submit = () => {
    if (!ready) return;
    onAdd(newMaterials({ trait, qty: n, kind, by: meId, existing, codes, proof,
      files: idx.map((i) => at(files, i)), texts: idx.map((i) => String(at(texts, i) || "")) }));
    onClose();
  };
  const field = { ...S.inp, width: "100%", marginTop: 4, fontSize: 12 };
  /* Список полей прокручивается сам, внутри окна: тысяча единиц — тысяча
     полей, и кнопка «Загрузить» обязана оставаться под рукой, а не в
     конце километровой ленты. */
  const listBox = { maxHeight: 220, overflowY: "auto", marginTop: 4, paddingRight: 4,
    border: `1px solid ${C.line}`, borderRadius: 6, padding: "2px 6px 6px" };
  const rowLbl = { fontSize: 10.5, color: ACC, fontWeight: 700, marginTop: 6 };
  return (
    <Modal title={`Добавить: ${traitName}`} onClose={onClose}>
      {/* Вид выбирать здесь нечего: чем подтверждается единица, решено у
          самого ресурса — на вкладке «Схема». Вопрос «файл или текст» на
          каждой загрузке был вопросом не на том месте: сегодня договор
          кладут файлом, завтра текстом, и ресурс перестаёт быть одной
          вещью. Правило одно на все двери: и здесь, и при сдаче задачи. */}
      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>
        {kind === "code"
          ? "Единицы этого ресурса — уникальные коды: их создаёт программа. Приложите подтверждение — один файл на всю загрузку."
          : kind === "text"
            ? "Единицы этого ресурса — тексты: у каждой свой."
            : "Единицы этого ресурса — файлы: у каждой свой."}
        {" Вид задан у ресурса, на вкладке «Схема»."}
      </div>
      <div style={{ ...S.lbl, marginTop: 8 }}>количество</div>
      <input type="number" min="1" step="1" value={qty} aria-label="количество"
        onChange={(e) => setQty(e.target.value)} style={{ ...field, width: 120 }} />
      {kind === "file" && (
        <div style={{ marginTop: 8 }}>
          <div style={S.lbl}>файлы — {n > 1 ? `свой у каждой из ${nm(n)} единиц` : "один"}
            {n > 1 ? ` · приложено ${filled} из ${nm(n)}` : ""}</div>
          <div role="list" aria-label="файлы единиц" style={listBox}>
            {idx.map((i) => (
              <div key={i} role="listitem">
                {n > 1 && <div style={rowLbl}>единица {i + 1}</div>}
                <input type="file" aria-label={`файл единицы ${i + 1}`} disabled={!!busy[i]}
                  onChange={(e) => pick(i, e.target.files?.[0])}
                  style={{ marginTop: 4, fontSize: 11.5, maxWidth: "100%" }} />
                {busy[i] && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>сохраняем…</div>}
                {at(files, i) && !busy[i] && (
                  <div style={{ fontSize: 11, color: OK, marginTop: 3 }}>📎 {at(files, i).name}</div>)}
                {errs[i] && <div style={{ fontSize: 11, color: BAD, marginTop: 3 }}>{errs[i]}</div>}
              </div>))}
          </div>
        </div>)}
      {kind === "text" && (
        <div style={{ marginTop: 8 }}>
          <div style={S.lbl}>тексты — {n > 1 ? `свой у каждой из ${nm(n)} единиц` : "один"}
            {n > 1 ? ` · заполнено ${filled} из ${nm(n)}` : ""}</div>
          <div role="list" aria-label="тексты единиц" style={listBox}>
            {idx.map((i) => (
              <div key={i} role="listitem">
                {n > 1 && <div style={rowLbl}>единица {i + 1}</div>}
                <textarea value={at(texts, i) || ""} aria-label={`текст единицы ${i + 1}`}
                  rows={n > 1 ? 2 : 4} onChange={(e) => put(setTexts, i, e.target.value)}
                  style={{ ...field, resize: "vertical" }} />
              </div>))}
          </div>
        </div>)}
      {kind === "code" && (
        <div style={{ marginTop: 8 }}>
          <div style={S.lbl}>уникальный код — {n > 1 ? "свой у каждой единицы" : "создан программой"}</div>
          <div role="list" aria-label="уникальные коды" style={{ ...listBox, maxHeight: 180 }}>
            {codes.map((c, i) => (
              <input key={i} readOnly value={c} aria-label={`уникальный код ${i + 1}`}
                style={{ ...field, fontFamily: "ui-monospace, monospace", letterSpacing: 1 }} />))}
          </div>
          <button style={{ ...btn(false), fontSize: 11, marginTop: 6 }} onClick={regen}>
            {n > 1 ? "другие коды" : "другой код"}</button>
          <div style={{ ...S.lbl, marginTop: 10 }}>подтверждение — один файл на все единицы</div>
          <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 4 }}>
            <label style={{ ...btn(false), fontSize: 11.5, cursor: proofBusy ? "default" : "pointer",
              opacity: proofBusy ? 0.6 : 1, borderColor: proof ? undefined : "#5A2436" }}>
              {proofBusy ? "Загружаю…" : proof ? "Заменить подтверждение" : "Загрузить подтверждение"}
              <input type="file" style={{ display: "none" }} disabled={proofBusy}
                aria-label="подтверждение выдачи"
                onChange={(e) => pickProof(e.target.files?.[0])} />
            </label>
            {proof && <span style={{ fontSize: 11, color: OK }}>📎 {proof.name}</span>}
            {proofErr && <span style={{ fontSize: 11, color: BAD }}>{proofErr}</span>}
          </div>
          {!proof && (
            <div style={{ fontSize: 10.5, color: WARN, marginTop: 3 }}>
              без него загрузить нельзя: код показать нечем, кроме бумаги о выдаче</div>)}
        </div>)}
      <div className="flex gap-2" style={{ marginTop: 12, justifyContent: "flex-end" }}>
        <button style={btn(false)} onClick={onClose}>Отмена</button>
        <button style={{ ...btn(true, OK), opacity: ready ? 1 : 0.5 }} disabled={!ready}
          onClick={submit}>Загрузить</button>
      </div>
    </Modal>);
}

export function Materials({ model = {}, entities = [], materials = [], setMaterials,
  meId, nameOf }) {
  const traits = model.traits || [];
  const traitName = (id) => traits.find((t) => t.id === id)?.l || "(ресурс удалён)";
  /* Все активы разом, а не один ресурс из списка: по форме ходят, чтобы
     видеть, где чего и сколько. Актив раскрывается в ресурсы, ресурс —
     в число и кнопки, «Посмотреть» — в сами единицы. */
  const [openAsset, setOpenAsset] = useState(() => new Set());
  const [picked, setPicked] = useState("");
  const [shown, setShown] = useState(false);
  const [adding, setAdding] = useState(false);
  const all = useMemo(() => unitsOf(model), [model]);
  const spent = useMemo(() => spentIds(model), [model]);
  const stock = (t) => nm(Number(t.have) || 0);
  const unitNo = (id) => { const u = all.find((x) => x.id === id); return u ? { no: u.no, trait: u.trait } : null; };
  const toggleAsset = (id) => setOpenAsset((p) => {
    const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  const pick = (id) => { setPicked((p) => (p === id ? "" : id)); setShown(false); };
  const cur = traits.find((t) => t.id === picked) || null;
  /* Свёрнуты по умолчанию (владелец, 2026-09-19): к материалам приходят
     редко, а места они занимают весь первый экран. */
  const [shownAll, setShownAll] = useState(false);
  return (
    <div style={{ ...S.card, marginBottom: 10 }}>
      <button type="button" aria-expanded={shownAll} aria-label="материалы — единицы ресурсов"
        onClick={() => setShownAll((v) => !v)} className="flex items-center gap-2"
        style={{ width: "100%", background: "transparent", border: "none", padding: 0,
          cursor: "pointer", textAlign: "left" }}>
        <span style={{ ...S.lbl, flex: 1 }}>материалы — единицы ресурсов</span>
        <span style={{ fontSize: 11, color: C.muted }}>{shownAll ? "▾" : "▸"}</span>
      </button>
      {shownAll && (<>
      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
        Все единицы ресурсов — из сдач и загруженные руками. Нажмите на актив, потом на ресурс.
      </div>
      {!entities.length && (
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8 }}>
          Активов в схеме пока нет.</div>)}
      {entities.map((e) => {
        const own = traits.filter((t) => t.e === e.id);
        const open = openAsset.has(e.id);
        const count = own.reduce((a, t) => a + (all.filter((u) => u.trait === t.id).length), 0);
        return (
          <div key={e.id} style={{ marginTop: 8 }}>
            <button aria-expanded={open} aria-label={`актив ${e.name || "без названия"}`}
              onClick={() => toggleAsset(e.id)}
              style={{ ...btn(open), width: "100%", textAlign: "left", fontSize: 12.5,
                display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: e.color || NEU,
                flexShrink: 0 }} />
              <span style={{ flex: 1, fontWeight: 600 }}>{e.name || "без названия"}</span>
              <span style={{ fontSize: 10.5, color: C.muted, fontWeight: 400 }}>
                ресурсов {own.length} · единиц {count}</span>
              <span style={{ fontSize: 11, color: C.muted }}>{open ? "▾" : "▸"}</span>
            </button>
            {open && (
              <div style={{ marginLeft: 10, borderLeft: `2px solid ${C.line}`, paddingLeft: 8,
                marginTop: 4 }}>
                {!own.length && (
                  <div style={{ fontSize: 11, color: C.muted, padding: "4px 0" }}>
                    Ресурсов у актива нет.</div>)}
                {own.map((t) => {
                  const on = picked === t.id;
                  const units = on ? unitsOfTrait(model, t.id) : [];
                  return (
                    <div key={t.id} style={{ marginTop: 4 }}>
                      <button aria-pressed={on} aria-label={`ресурс ${t.l || "без названия"}`}
                        onClick={() => pick(t.id)}
                        style={{ ...btn(on), width: "100%", textAlign: "left", fontSize: 12,
                          display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ flex: 1 }}>{t.l || "без названия"}</span>
                        <span style={{ fontSize: 10.5, color: C.muted }}>
                          есть {stock(t)} {t.unit || ""}</span>
                      </button>
                      {on && (
                        <div style={{ padding: "6px 2px 2px" }}>
                          <div className="flex flex-wrap gap-2" style={{ alignItems: "center",
                            fontSize: 11.5 }}>
                            <span>есть <b>{stock(t)}</b> {t.unit || ""}</span>
                            <span style={{ color: C.muted }}>
                              · единиц в списке {all.filter((u) => u.trait === t.id).length}</span>
                            <span style={{ flex: 1 }} />
                            <button style={btn(shown)} aria-pressed={shown}
                              onClick={() => setShown((v) => !v)}>
                              {shown ? "Скрыть" : "Посмотреть"}</button>
                            <button style={btn(true)} onClick={() => setAdding(true)}>
                              Загрузить единицу ресурса</button>
                          </div>
                          {shown && (units.length
                            ? <div style={{ marginTop: 6 }}>
                              {units.map((u) => (
                                <UnitRow key={u.id} u={u} unit={t.unit || "ед."}
                                  spent={spent.has(u.id)} nameOf={nameOf}
                                  traitName={traitName} unitNo={unitNo} />))}
                            </div>
                            : <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
                              Единиц пока нет: их сдают в задачах или загружают здесь.</div>)}
                        </div>)}
                    </div>);
                })}
              </div>)}
          </div>);
      })}
      {adding && cur && (
        <UploadMaterial trait={cur.id} traitName={cur.l || "ресурс"} existing={materials}
          kind={traitKind(cur)}
          meId={meId} onClose={() => setAdding(false)}
          onAdd={(rows) => { setMaterials?.((p) => [...(p || []), ...rows]); setShown(true); }} />)}
      </>)}
    </div>);
}

/** Один блок карты — и проект, и раздел: они устроены одинаково. */
/* Часть отчёта. Объявлена снаружи Node намеренно: объявленная внутри, она
   была бы новым типом компонента на каждой перерисовке — React разбирал бы
   поддерево и собирал заново, а вместе с ним терялось бы всё состояние
   внутри.

   Ссылки у части НЕТ. Часть — это способ разложить один и тот же отчёт
   («прогноз ресурсов», «задачи»), а не самостоятельное место, на которое
   ссылаются. Раздел отчёта — это выполняемая функция, и адрес есть у неё:
   ссылка «на первый блок страницы» отвечала бы не на тот вопрос, ради
   которого её берут. */
/* ─────── РАЗДЕЛЫ ОТЧЁТА ───────

   Пять разделов, и у каждого один вопрос:
     1. Ресурсы — что изменится: сколько чего прибавится или убавится.
     2. Функции — что будет сделано: цепочка, у каждой — берёт, даёт, сколько раз.
     3. Сроки и трудозатраты: когда что начнётся, сколько продлится, сколько часов.
     4. Задачи — что уже сделано: заведённая работа, кто, срок, состояние, часы.
     5. Факторы — что влияет: что случается само и с какой вероятностью.

   Прежде «прогноз ресурсов» открывался часами работы и сроками, а каждая
   функция была «разделом отчёта» с тем же набором — оценка, ресурсы,
   задачи, — и всё это трижды. Читалось это так: «зачем мне в ресурсах,
   сколько функция займёт времени». Теперь у раздела своя тема, под
   заголовком сказано, что в нём, и одно и то же в двух местах не стоит. */
/* Раздел сворачивается нажатием на заголовок (владелец, 2026-09-19: «все
   формы на вкладке „Отчёты" должны уметь сворачиваться при нажатии»). */
/* Пояснений у разделов нет (владелец, 2026-09-20: «убери из отчётов весь
   лишний текст»): заголовок и есть объяснение, а абзац под ним человек
   всё равно перечитывает один раз и больше не смотрит. */
function Part({ n, title, children, open: open0 = true }) {
  const [open, setOpen] = useState(open0);
  return (
    <section style={{ marginTop: 12, borderTop: `1px solid ${C.line}`,
      paddingTop: 8 }}>
      <button type="button" aria-expanded={open} aria-label={`${n}. ${title}`}
        onClick={() => setOpen((v) => !v)} className="flex items-center gap-2"
        style={{ width: "100%", background: "transparent", border: "none", padding: 0,
          cursor: "pointer", textAlign: "left", color: C.text }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>{n}. {title}</span>
        <span style={{ fontSize: 11, color: C.muted }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && <div style={{ marginTop: 6 }}>{children}</div>}
    </section>);
}

function Node({ node, nodes, model, doc, depth = 0, focus, onFocus, setNodes,
  traitName, funcName, nameOf, entities }) {
  /* Раздел, который что-то прослеживает, открыт: его и заводили ради
     движения (владелец, 2026-09-19 — «Проследить» показывает результат
     сразу). Пустой — свёрнут: показывать нечего. */
  const [open, setOpen] = useState(depth < 1 || !!node.trait);
  const [link, setLink] = useState(null);
  const [linkErr, setLinkErr] = useState("");
  const [busy, setBusy] = useState(false);
  const kids = childrenOf(nodes, node.id);
  const up = (patch) => setNodes((p) => p.map((n) => (n.id === node.id ? { ...n, ...patch } : n)));
  const sum = summaryOf(model, node, nodes);
  const root = !node.parent;
  const { chain, plan, actual, factors, changes } = doc;

  const traits = model.traits || [];
  const funcs = model.funcs || [];
  /* Звеном может быть и ресурс, и функция: человек говорит «до готового
     сайта» или «до вёрстки», и запрещать одно из двух не за что.

     Предлагается то, до чего цепочка и правда доходит. Считается это по
     цепочке БЕЗ звена — иначе выбранное звено обрезало бы список, и
     передвинуть его дальше было бы уже нечем: человек заперся бы в первом
     же выборе. */
  // Единицы этого ресурса, которые уже родились из сдач: с ними работа
  // уже происходила, и о каждой можно спросить отдельно.
  /* ─── выбор — ЧЕРНОВИК, пока не нажали «Проследить» ───

     Владелец (2026-09-19): «ресурс начинает прослеживаться до нажатия
     кнопки „Проследить" — исправь это». Выбор ресурса это ещё вопрос, а не
     ответ: пока кнопку не нажали, отчёт не считается и на экране ничего не
     меняется. */
  const [form, setForm] = useState(false);
  const [draft, setDraft] = useState(() => ({ trait: "", proc: "", units: [], qty: 1 }));
  const setD = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const units = draft.trait ? unitsOfTrait(model, draft.trait) : [];
  /* В списке процессов — только те, где этот ресурс участвует (владелец,
     2026-09-20): процесс, где о нём не сказано ни слова, только мешает. */
  const procs = useMemo(() => procsOfTrait(model, draft.trait), [model, draft.trait]);
  const picked = draft.units.filter(Boolean);
  /* Ресурсы, которые решено не прослеживать: строка сереет, полосы нет, и
     в отчёт он не идёт (владелец, 2026-09-19). */
  const offSet = useMemo(() => new Set((node.off || []).map(String)), [node.off]);
  const toggleTrait = (id) => up({ off: offSet.has(String(id))
    ? (node.off || []).filter((x) => String(x) !== String(id))
    : [...(node.off || []), String(id)] });
  // Все единицы модели: по ним видно, над чем работала каждая задача.
  const full = chainOf(model, { from: draft.trait });
  /* Звено — только РЕСУРС: прослеживают «до готового сайта», а «до вёрстки»
     — не звено, а действие по дороге к нему; так сказал владелец. Старая
     запись с функцией в `upto` читается как была (chainOf её понимает),
     но выбрать функцию заново нельзя. */
  const uptoTraits = traits.filter((t) => t.id !== draft.trait
    && (full.traits || []).includes(t.id));

  /* ─── «Проследить» ───

     Владелец (2026-09-19): «нужно добавить кнопку „Проследить", по нажатию
     которой будет создаваться раздел отчёта с прослеживаемым движением
     ресурсов». Выбор ресурса сам по себе ничего не создаёт — он остаётся
     вопросом, пока на него не нажали; нажатие уносит выбор в отдельный
     раздел, и в отчёте их может быть сколько угодно: один ресурс — один
     раздел. */
  /* «Применить» СОЗДАЁТ раздел (владелец, 2026-09-20): один ресурс — один
     раздел, и в отчёте их может быть сколько угодно. Перенастройки нет:
     раздел удаляют и создают заново — так не бывает наполовину
     переписанного раздела, у которого имя от одного ресурса, а числа от
     другого. */
  const trace = () => {
    if (!draft.trait) return;
    const procName = (model.procs || []).find((pr) => pr.id === draft.proc)?.name;
    const name = `${traitName(draft.trait)}${procName ? ` · ${procName}` : ""}`;
    const kid = { ...newSection(node.id, name), trait: draft.trait, proc: draft.proc,
      units: picked, qty: picked.length || 1 };
    setNodes((p) => [...p, kid]);
    setDraft({ trait: "", proc: "", units: [], qty: 1 });
    setForm(false);
    setOpen(true);
  };
  /* Цепочки нет, а функции, берущие этот ресурс, у процесса, принятого
     гипотетически: расчёт их не считает, пока не включены гипотезы
     (`activeFuncs` в lib/funcs.js). Молчать об этом нельзя — пустой отчёт
     читается как «движения нет», хотя движение описано. */
  const hypoBlocked = !!node.trait && !(plan.hi.steps || []).length
    && funcs.some((f) => f.proc && (f.takes || []).some((x) => x.trait === node.trait)
      && (model.procs || []).find((pr) => pr.id === f.proc)?.status === "hypo")
    && model.hypoOn !== true;

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const download = async () => {
    setSaveErr(""); setSaving(true);
    try {
      const html = reportHtml(doc, { traitName, funcName,
        personName: (id) => (nameOf ? nameOf(id) : id),
        title: node.name || "Отчёт" });
      const safe = String(node.name || "otchet").replace(/[^\wа-яА-ЯёЁ -]+/g, "").trim();
      await deliverReport(`${safe || "otchet"}.html`, html,
        { telegram: getTelegram(), putFile: putReportFile });
    } catch (e) {
      // Молчаливый отказ здесь хуже всего: человек не знает, ждать ему или
      // нажимать ещё раз.
      setSaveErr(e.message || "не удалось отдать отчёт");
    }
    setSaving(false);
  };

  const makeLink = async () => {
    setBusy(true); setLinkErr("");
    try {
      const saved = await putShare(node.id);
      const url = shareLink(saved.token);
      setLink(url);
      try { await navigator.clipboard.writeText(url); } catch { /* покажем адрес */ }
    } catch (e) {
      setLink(linkTo(node.id));
      setLinkErr(e.message || "снимок не сохранился");
    }
    setBusy(false);
  };

  return (
    <div style={{ background: depth ? "transparent" : C.panel2,
      border: `1px solid ${focus === node.id ? ACC : C.line}`, borderRadius: 10,
      padding: 9, marginTop: 8,
      borderLeft: depth ? `2px solid ${C.line}` : `1px solid ${C.line}`,
      marginLeft: depth ? 6 : 0 }}>
      <div className="flex items-center gap-2">
        <button style={{ ...btn(false), fontSize: 11, padding: "2px 6px" }}
          aria-label={`${open ? "свернуть" : "развернуть"} ${node.name || "блок"}`}
          onClick={() => setOpen(!open)}>{open ? "▾" : "▸"}</button>
        {/* Имя правится двойным нажатием, как у техпроцессов; слова
            «проект» в шапке больше нет (владелец, 2026-09-19). */}
        <NameField value={node.name} aria-label={root ? "название отчёта" : "название раздела"}
          placeholder={root ? "без названия" : "раздел без названия"}
          style={{ fontSize: root ? 13 : 12.5, fontWeight: root ? 700 : 600 }}
          onCommit={(v) => up({ name: v })} />
        {!root && <span style={{ fontSize: 10, color: C.muted }}>раздел</span>}
        {/* «Удалить» — в шапке, чтобы было видно и у свёрнутого блока
            (владелец, 2026-09-20: «у отчёта должна быть видна кнопка
            „Удалить", если он свернут»). */}
        <button style={{ ...btn(false), fontSize: 11, color: BAD, borderColor: "#5A2436",
          marginLeft: "auto", flex: "none" }}
          aria-label={`удалить ${root ? "отчёт" : "раздел"} ${node.name || "без названия"}`}
          onClick={() => setNodes((p) => dropNode(p, node.id))}>удалить</button>
      </div>

      {/* Сводки под названием нет (владелец, 2026-09-20: «не должно быть
          написано, сколько функций в цепочке, сколько задач, поэтому
          разделу и тому подобное») — эти числа стоят внутри разделов,
          каждое на своём месте. */}

      {open && (<>
        {/* ─── новый раздел ───

            У отчёта есть название, под ним — кнопка «Создать раздел»
            (владелец, 2026-09-20). Поля формы стоят столбиком, у каждого
            своя подпись: прежде они шли строкой, два из них были
            неактивны, и что они спрашивают — понять было нельзя. */}
        {root && (<>
          <button style={{ ...btn(true, ACC), fontSize: 11.5, marginTop: 8 }}
            aria-expanded={form} aria-label={`создать раздел: ${node.name || "без названия"}`}
            onClick={() => setForm((v) => !v)}>
            {form ? "▾ Создать раздел" : "+ Создать раздел"}</button>
          {form && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8,
              background: C.ink, border: `1px solid ${C.line}`, borderRadius: 8, padding: 9 }}>
              <label style={{ display: "block" }}>
                <div style={S.lbl}>отслеживаемый ресурс</div>
                <select style={{ ...S.inp, width: "100%", fontSize: 11.5, padding: "4px 6px", marginTop: 3 }}
                  aria-label="отслеживаемый ресурс" value={draft.trait}
                  onChange={(e) => setD({ trait: e.target.value, proc: "", units: [] })}>
                  <option value="">— выберите ресурс —</option>
                  {traits.map((t) => (<option key={t.id} value={t.id}>{t.l}</option>))}
                </select>
              </label>
              <label style={{ display: "block" }}>
                <div style={S.lbl}>отслеживаемый техпроцесс</div>
                <select style={{ ...S.inp, width: "100%", fontSize: 11.5, padding: "4px 6px", marginTop: 3 }}
                  aria-label="отслеживаемый техпроцесс" value={draft.proc}
                  disabled={!draft.trait || !procs.length}
                  onChange={(e) => setD({ proc: e.target.value })}>
                  <option value="">
                    {!draft.trait ? "— сначала выберите ресурс —"
                      : !procs.length ? "процессов с этим ресурсом нет — вся схема"
                        : "вся схема"}
                  </option>
                  {procs.map((pr) => (
                    <option key={pr.id} value={pr.id}>{pr.name || "процесс без названия"}</option>))}
                </select>
              </label>
              <label style={{ display: "block" }}>
                <div style={S.lbl}>существующая единица</div>
                <select style={{ ...S.inp, width: "100%", fontSize: 11.5, padding: "4px 6px", marginTop: 3 }}
                  aria-label="существующая единица" value=""
                  disabled={!draft.trait || !units.length}
                  onChange={(e) => (e.target.value
                    ? setD({ units: [...new Set([...picked, e.target.value])] })
                    : null)}>
                  <option value="">
                    {!draft.trait ? "— сначала выберите ресурс —"
                      : !units.length ? "единиц пока нет — это прогноз"
                        : picked.length ? "+ добавить единицу" : "— без единицы: прогноз —"}
                  </option>
                  {units.filter((u) => !picked.includes(u.id)).map((u) => (
                    <option key={u.id} value={u.id}>
                      №{u.no} {u.title || "без названия"}
                      {u.accepted ? "" : " (не принято)"}</option>))}
                </select>
              </label>
              {!!picked.length && (
                <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
                  {picked.map((id) => {
                    const u = units.find((x) => x.id === id);
                    return (
                      <button key={id} style={{ ...btn(true, ACC), fontSize: 11, padding: "3px 7px" }}
                        aria-label={`убрать единицу: ${u ? `№${u.no}` : id}`}
                        onClick={() => setD({ units: picked.filter((x) => x !== id) })}>
                        {u ? `№${u.no} ${u.title || "без названия"}` : "единица удалена"}
                        {" ×"}</button>);
                  })}
                </div>)}
              <button style={{ ...btn(true, OK), fontSize: 11.5,
                opacity: draft.trait ? 1 : 0.45, cursor: draft.trait ? "pointer" : "default" }}
                disabled={!draft.trait} onClick={trace} aria-label="применить">Применить</button>
            </div>)}
        </>)}
        {hypoBlocked && (
          <div style={{ fontSize: 11, color: WARN, marginTop: 6, lineHeight: 1.5 }}>
            Движение не считается: функции, которые берут «{traitName(node.trait)}»,
            принадлежат процессу, принятому гипотетически. Включите «считать
            гипотезы» на «Схеме».
          </div>)}

        {!!doc.unit && (
          <div style={{ background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: 8, padding: 8, marginTop: 8 }}>
            <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
              <span style={{ fontSize: 11, color: ACC, fontWeight: 700 }}>
                №{doc.unit.no}</span>
              <span style={{ fontSize: 12, flex: "1 1 120px" }}>
                {doc.unit.title || "без названия"}</span>
              <span style={{ fontSize: 10.5, color: doc.unit.accepted ? OK : WARN }}>
                {doc.unit.accepted ? "принято" : "не принято"}</span>
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3, lineHeight: 1.6 }}>
              {fmtDT(doc.unit.at)} · {doc.unit.by == null ? "исполнитель не назначен"
                : (nameOf ? nameOf(doc.unit.by) : doc.unit.by)}
              {" · сделано функцией "}{funcName(doc.unit.func)}
            </div>
            {!!doc.parents.length && (
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3, lineHeight: 1.6 }}>
                сделано из: {doc.parents.map((u) =>
                  `№${u.no} ${u.title || "без названия"}`).join(", ")}
              </div>)}
            {doc.unit.file && (
              <a href={reportSrc(doc.unit.file)} target="_blank" rel="noreferrer"
                style={{ fontSize: 10.5, color: ACC, display: "inline-block",
                  marginTop: 4 }}>📎 {doc.unit.file.name}</a>)}
            <div style={{ fontSize: 10.5, marginTop: 5, lineHeight: 1.5,
              color: doc.traced ? C.muted : WARN }}>
              {doc.traced
                ? `Дальше — только то, что выросло из неё: вещей в родословной ${doc.family.length}.`
                : "Что из чего сделано, не записано: при сдаче не отметили взятое."}
            </div>
          </div>)}

        {!!node.trait && (<>
          <Part n={1} title="Ресурсы">
            {changes.length
              ? <ChangeChart rows={changes} traitName={traitName}
                  madeOf={(t) => doc.made.filter((u) => u.trait === t)}
                  off={offSet} onToggle={toggleTrait} />
              : <div style={{ fontSize: 11, color: C.muted }}>
                  Ресурсы по этой цепочке не меняются.</div>}
            {!!Object.keys(plan.hi.need || {}).length && (
              <div style={{ fontSize: 10.5, color: WARN, marginTop: 6, lineHeight: 1.5 }}>
                Своего не хватит — нужно со стороны:{" "}
                {Object.entries(plan.hi.need)
                  .map(([id, q]) => `${traitName(id)} ${nm(q)}`).join(", ")}
              </div>)}
          </Part>

          <Part n={2} title="Сроки и трудозатраты">
            <Schedule steps={doc.steps} before={doc.before} plan={plan} actual={actual}
              traitName={traitName} />
          </Part>

          <Part n={3} title="Задачи — что уже сделано">
            <TaskList steps={doc.steps} before={doc.before} actual={actual}
              traitName={traitName}
              personName={(id) => (nameOf ? nameOf(id) : id)} />
          </Part>

          {FACTORS_ON && !!factors.length && (
            <Part n={4} title="Факторы — что влияет">
              <FactorRows factors={factors} />
            </Part>)}
        </>)}

        {kids.map((k, i) => (
          <Node key={k.id} node={k} nodes={nodes} model={model}
            doc={doc.sections[i]} depth={depth + 1}
            focus={focus} onFocus={onFocus} setNodes={setNodes}
            traitName={traitName} funcName={funcName} nameOf={nameOf} entities={entities} />))}

        {/* Скачать и ссылка — ВНИЗУ: у раздела внизу раздела, у отчёта
            внизу отчёта, под его разделами (владелец, 2026-09-20). Ссылка
            бывает только на весь отчёт или на созданный раздел — на то,
            что у них внутри, ссылок нет. */}
        <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
          <button style={{ ...btn(true, OK), fontSize: 11 }} disabled={saving}
            aria-label={root ? "скачать отчёт" : `скачать раздел ${node.name || "без названия"}`}
            onClick={download}>
            {saving ? "Готовлю…" : root ? "Скачать отчёт" : "Скачать раздел"}</button>
          <button style={{ ...btn(false), fontSize: 11 }} disabled={busy}
            aria-label={root ? "ссылка на отчёт" : `ссылка на раздел ${node.name || "без названия"}`}
            onClick={makeLink}>
            {busy ? "Готовлю…" : link ? "обновить ссылку"
              : root ? "Ссылка на отчёт" : "Ссылка на раздел"}</button>
        </div>
        {saveErr && (
          <div style={{ fontSize: 10.5, color: BAD, marginTop: 5, lineHeight: 1.5 }}>
            {saveErr}</div>)}
        {link && (
          <div style={{ fontSize: 10.5, color: ACC, marginTop: 5,
            wordBreak: "break-all", lineHeight: 1.5 }}>
            {link}
            <div style={{ color: linkErr ? WARN : C.muted }}>
              {linkErr
                ? `Снимок не сохранился (${linkErr}) — эта ссылка откроется только у тех, у кого модель уже есть.`
                : "Открывается без входа: снимок этого блока и ничего сверх."}
            </div>
          </div>)}
      </>)}
    </div>);
}

export default function ReportsPanel({ nodes = [], setNodes, model = {},
  entities = [], nameOf, focus, onFocus, runsOf, materials = [], setMaterials, meId }) {
  const traitName = (id) => (model.traits || []).find((t) => t.id === id)?.l
    || (id ? "(ресурс удалён)" : "");
  const funcName = (id) => {
    const f = (model.funcs || []).find((x) => x.id === id);
    return f ? funcLabel(f, entities) : "(функция удалена)";
  };
  const path = focus ? pathOf(nodes, focus) : [];
  const shown = focus && path.length ? [path[path.length - 1]] : rootsOf(nodes);
  /* Шапка вкладки тоже сворачивается. */
  const [head, setHead] = useState(true);

  /* Ссылка на шаг ведёт к якорю, а браузер ищет его в тот момент, когда
     разметки ещё нет: React рисует после. Поэтому к якорю едем сами, когда
     блоки уже нарисованы. Нет такого якоря — молчим: ссылка могла прийти из
     другой модели, и прыгать в случайное место хуже, чем остаться на месте. */
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const id = decodeURIComponent(String(window.location.hash || "").slice(1));
    if (!id) return undefined;
    const t = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    }, 0);
    return () => clearTimeout(t);
  }, [focus, nodes.length]);

  return (
    <div>
      {/* Материалы — перед проектами: проект начинается с единицы, и
          прежде чем на неё ссылаться, её надо иметь. */}
      <Materials model={model} entities={entities} materials={materials}
        setMaterials={setMaterials} meId={meId} nameOf={nameOf} />
      {/* ОДНА форма на всё (владелец, 2026-09-19: «сделай, чтобы отчёты
          были в одной форме»): имя посередине, «+ отчёт» справа, сами
          отчёты — внутри. Кнопки «все отчёты» нет: они и так все здесь. */}
      <div style={{ ...S.card, marginBottom: 10 }}>
        <div className="flex items-center gap-2">
          <span style={{ flex: 1 }} />
          {/* Нажатие на имя сворачивает форму — как и все формы вкладки. */}
          <button type="button" aria-expanded={head} aria-label="отчёты"
            onClick={() => setHead((v) => !v)}
            style={{ background: "transparent", border: "none", padding: 0,
              cursor: "pointer" }}>
            <span style={S.lbl}>отчёты {head ? "▾" : "▸"}</span>
          </button>
          <span style={{ flex: 1 }} />
          {/* Новый отчёт встаёт СВЕРХУ: его только что завели, с ним и
              работают (владелец, 2026-09-19). */}
          <button style={btn(true)}
            onClick={() => setNodes((p) => [newProject("новый отчёт"), ...p])}>+ отчёт</button>
        </div>

        {head && (<>
          {!nodes.length && (
            <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, marginTop: 8 }}>
              Отчётов пока нет.</div>)}

          {focus && !path.length && (
            <div style={{ fontSize: 11.5, color: WARN, lineHeight: 1.6, marginTop: 8 }}>
              Такого отчёта в этой модели нет. Возможно, ссылка ведёт в другую
              рабочую область или отчёт удалили.</div>)}

          {shown.map((n) => (
            <Node key={n.id} node={n} nodes={nodes} model={model}
              doc={reportOf(model, n, nodes, { runsOf })}
              focus={focus} onFocus={onFocus} setNodes={setNodes} traitName={traitName}
              funcName={funcName} nameOf={nameOf} entities={entities} />))}
        </>)}
      </div>
    </div>);
}
