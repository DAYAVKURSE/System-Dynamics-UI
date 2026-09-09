import React, { useEffect, useState } from "react";
import { C, OK, WARN, BAD, NEU, ACC, S, btn, nm, NumField, TxtField } from "./ui.jsx";
import { funcLabel, twinNo } from "./TasksBoard.jsx";
import { putReportFile, reportSrc } from "../storage.js";
import { getTelegram } from "../telegram.js";
import { putShare } from "../identity.js";
import {
  childrenOf, dropNode, linkTo, newProject,
  pathOf, rootsOf, shareLink, stepAnchor, stepLink, summaryOf,
} from "../lib/reports.js";
import { deliverReport, reportHtml, reportOf, rangeTimeText, timeText }
  from "../lib/reportDoc.js";
import { chainOf } from "../lib/chain.js";
import { unitsOfTrait } from "../lib/units.js";

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
export function ChangeChart({ rows = [], traitName, madeOf }) {
  const [open, setOpen] = useState("");
  if (!rows.length) return null;
  const dot = (color, label) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10.5, color: C.muted }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color }} />
      {label}</span>);
  return (
    <div>
      <div className="flex flex-wrap gap-2"
        style={{ alignItems: "center", marginBottom: 6 }}>
        {dot(WARN, "прогноз (от и до)")}{dot(OK, "факт")}
      </div>
      {rows.map((r) => {
        const lo = Math.min(r.lo, r.hi);
        const hi = Math.max(r.lo, r.hi);
        const vals = [0, lo, hi, ...(r.fact == null ? [] : [r.fact])];
        /* Поля по краям — чтобы нулевая линия не прижималась к самому краю:
           «убавится на 1» иначе рисуется полосой во всю ширину, упирающейся
           в невидимый ноль, и читается как рост. */
        const raw = Math.max(...vals) - Math.min(...vals) || 1;
        const min = Math.min(...vals) - raw * 0.08;
        const max = Math.max(...vals) + raw * 0.08;
        const span = max - min || 1;
        const at = (v) => ((v - min) / span) * 100;
        const zero = at(0);
        /* Полоса растёт ОТ НУЛЯ: «убавится на 3» — это длина от нуля до −3,
           а не невидимая точка. Верная часть вилки (до нижней границы) —
           плотная, «а может и больше» (от нижней до верхней) — полупрозрачная:
           обещано первое, возможно второе, и путать их нельзя. */
        const bar = (a, b, color, title, dim) => {
          const left = Math.min(at(a), at(b));
          const width = Math.abs(at(b) - at(a));
          return (
            <div title={title} style={{ position: "absolute", left: `${left}%`,
              width: `${width}%`, minWidth: 2, top: 0, height: 9, borderRadius: 3,
              background: color, opacity: dim ? 0.45 : 1 }} />);
        };
        const planText = lo === hi ? nm(hi) : `${nm(lo)} … ${nm(hi)}`;
        // Вещи этого ресурса, которые уже родились: их и открывают нажатием.
        const units = madeOf ? madeOf(r.trait) : [];
        const on = open === r.trait;
        const label = `${traitName(r.trait)}: прогноз ${planText}`
          + (r.fact == null ? ", факта нет" : `, факт ${nm(r.fact)}`);
        const head = (
          <div className="flex flex-wrap gap-2" style={{ alignItems: "baseline" }}>
            <span style={{ fontSize: 11.5, flex: "1 1 110px" }}>
              {traitName(r.trait)}</span>
            <span style={{ fontSize: 10.5, color: WARN }}>
              прогноз{" "}
              <b style={{ fontFamily: "ui-monospace, monospace" }}>{planText}</b>
            </span>
            <span style={{ fontSize: 10.5, color: r.fact == null ? C.muted : OK }}>
              {r.fact == null ? "факта нет" : (<>факт{" "}
                <b style={{ fontFamily: "ui-monospace, monospace" }}>
                  {nm(r.fact)}</b></>)}
            </span>
            {!!units.length && (
              <span style={{ fontSize: 10.5, color: ACC }}>
                {on ? "▾" : "▸"} {nm(units.length)} шт. — показать</span>)}
          </div>);
        return (
          <div key={r.trait} style={{ marginBottom: 9 }}>
            {/* Есть что открыть — строка нажимается; нечего — она просто
                строка, и притворяться кнопкой ей незачем. */}
            {units.length
              ? (<div role="button" tabIndex={0} style={{ cursor: "pointer" }}
                  aria-label={`созданные единицы: ${traitName(r.trait)}`}
                  onClick={() => setOpen(on ? "" : r.trait)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault(); setOpen(on ? "" : r.trait);
                    }
                  }}>{head}</div>)
              : head}
            {/* Полоса прогноза и полоса факта — на одной шкале и с общим нулём. */}
            <div style={{ position: "relative", height: r.fact == null ? 11 : 23,
              marginTop: 3, overflow: "hidden" }}
              role="img" aria-label={label}>
              <div style={{ position: "absolute", left: `${zero}%`, top: 0, bottom: 0,
                width: 1, background: C.line }} />
              {lo !== 0 && bar(0, lo, WARN, `прогноз не меньше ${nm(lo)}`)}
              {lo !== hi && bar(lo, hi, WARN, `прогноз до ${nm(hi)}`, true)}
              {/* Ноль полосой не рисуется: обрубок в 2 пикселя у нулевой
                  линии читался бы как «чуть-чуть», а вышло ровно ничего.
                  Само число при этом стоит текстом выше. */}
              {r.fact != null && r.fact !== 0 && (
                <div style={{ position: "absolute", top: 14, left: 0, right: 0,
                  height: 9 }}>
                  {bar(0, r.fact, OK, `факт ${nm(r.fact)}`)}
                </div>)}
            </div>
            {on && (
              <div style={{ borderLeft: `2px solid ${C.line}`, paddingLeft: 8,
                marginTop: 2 }}>
                {units.map((u) => (
                  <MadeUnit key={u.id} u={u} traitName={traitName} />))}
              </div>)}
          </div>);
      })}
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

function Timeline({ steps = [], before = [] }) {
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
    rows.push({ key: s.func, name: s.name, factor: s.factor, kind: "step",
      stuck,
      from: stuck ? null : s.startHours,
      to: stuck ? null : s.startHours + Math.max(s.calendarHours, 0.01),
      note: stuck ? "не выполнится"
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
            {r.factor && <span style={{ color: ACC }}> · фактор</span>}
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
                    background: r.kind === "step"
                      ? (r.factor ? ACC : WARN)
                      : (r.done ? OK : NEU) }} />)}
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
function StepSection({ s, no, nodeId, own, traitName, personName, row, perRun,
  portLine }) {
  const factHours = Math.round((s.factHours || 0) * 10) / 10;
  const madeOf = (trait) => (s.made || []).filter((u) => u.trait === trait);
  return (
    <section id={stepAnchor(nodeId, s.func)}
      style={{ borderTop: `1px solid ${C.line}`, padding: "9px 0" }}>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "baseline" }}>
        <span style={{ fontSize: 10.5, color: C.muted, minWidth: 18 }}>{no}.</span>
        <span style={{ fontSize: 12, flex: "1 1 120px", fontWeight: 600 }}>
          {s.name}
          {s.factor && <span style={{ color: ACC, fontSize: 10.5 }}> · фактор</span>}
        </span>
        <AnchorLink href={stepLink(nodeId, s.func)} label={s.name} />
      </div>

      <div style={{ marginLeft: 26 }}>
        {/* ─── оценка ─── */}
        <div style={{ ...S.lbl, marginTop: 6 }}>оценка</div>
        {s.short?.length ? (
          <div style={{ fontSize: 10.5, color: WARN, lineHeight: 1.5 }}>
            не выполнится: не хватает{" "}
            {s.short.map((x) => `${traitName(x.trait)}${x.spentBy
              ? ` (израсходовал шаг «${x.spentBy}»)` : ""}`).join(", ")}
          </div>
        ) : (
          <Facts rows={[
            { label: "Кол-во выполнений ожидается", value: nm(s.runs), color: WARN },
            { label: "Начнётся через",
              color: WARN,
              value: s.startHours > 0 ? timeText(s.startHours)
                : "сразу после постановки" },
            { label: "Займёт времени", value: timeText(s.calendarHours), color: WARN },
            s.factor ? null
              : { label: "Работы (человеко-часов)",
                value: hoursRange(s.workLo, s.workHi), color: WARN },
            { label: "Берёт ресурсов", value: portLine(s.takes) },
            { label: "Даёт ресурсов", value: portLine(s.gives) },
            { label: "Выполнений принято",
              color: s.doneCount ? OK : C.muted,
              value: s.factor ? "" : (s.doneCount
                ? `${nm(s.doneCount)} из ${nm(s.tasks.length)}`
                : "ни одного") },
            { label: "Фактически ушло часов",
              color: s.doneCount ? OK : C.muted,
              value: s.factor ? "" : (s.doneCount ? `${nm(factHours)} ч`
                : "факта пока нет") },
            own && own.factors.length
              ? { label: "На это влияют факторы",
                color: ACC,
                value: own.factors.map((y) => `${y.name} ${y.chance}%`).join(", ") }
              : null,
          ]} />)}

        {/* ─── прогноз ресурсов этого шага ─── */}
        <div style={{ ...S.lbl, marginTop: 8 }}>прогноз ресурсов</div>
        {(s.changes || []).length
          ? <ChangeChart rows={s.changes} traitName={traitName} madeOf={madeOf} />
          : (<div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
              Ресурсы этим шагом не меняются.</div>)}

        {/* ─── задачи ─── */}
        <div style={{ ...S.lbl, marginTop: 8 }}>задачи</div>
        {s.factor
          ? (<div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
              Задач тут не бывает: фактор случается сам, и спрашивать за него
              не с кого.</div>)
          : s.tasks.length
            ? s.tasks.map((t) => row(t, perRun(s)))
            : (<div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
                Задач на этот шаг ещё не заведено.</div>)}
      </div>
    </section>);
}

function Tasks({ steps = [], before = [], plan, actual, factors = [],
  funcName, personName, traitName, nodeId }) {
  /* Задачи, названные одинаково, различаются номером при ПОКАЗЕ: править
     сохранённое название приложение не должно — это слова человека. */
  const twins = twinNo([...steps.flatMap((s) => s.tasks), ...before]);
  const portLine = (list) => (list || [])
    .filter((x) => nm(x.qty) !== "0")
    .map((x) => `${traitName(x.trait)} ${nm(x.qty)}`).join(", ");
  const perRun = (s) => (s.runs > 0 ? nm(Math.round((s.workHi / s.runs) * 10) / 10) : "0");

  const row = (t, planHours) => (
    <div key={t.id} style={{ borderTop: `1px solid ${C.line}`, padding: "4px 0" }}>
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
      {/* Ожидалось и вышло — рядом, на одной задаче: ради этого сравнения
          отчёт и заводят. Часы у непринятой работы не показываются: их
          ещё никто не измерил, а ноль читался бы как «сделано даром». */}
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>
        {planHours === "—" ? "" : `прогноз ${planHours} ч · `}
        {t.hours == null ? "факта пока нет"
          : <span style={{ color: OK }}>факт {nm(t.hours)} ч</span>}
        {!!t.took.length && (
          <span style={{ color: ACC }}>
            {" · взяла "}{t.took.map((u) => `${traitName(u.trait)} №${u.no}`).join(", ")}
          </span>)}
      </div>
      {t.made.map((u) => (<MadeUnit key={u.id} u={u} traitName={traitName} />))}
    </div>);

  return (
    <div>
      {/* Итог по разделу — теми же подписанными строками, что и у шага:
          одна величина, одно название, одна строка. */}
      <Facts rows={[
        { label: "Шагов в цепочке", value: nm(plan.hi.steps.length), color: WARN },
        { label: "Работы (человеко-часов)", color: WARN,
          value: hoursRange(plan.lo.workHours, plan.hi.workHours) },
        { label: "Задач принято", color: actual.any ? OK : C.muted,
          value: actual.any ? `${nm(actual.done)} из ${nm(actual.total)}`
            : "ни одной" },
        { label: "Фактически ушло часов", color: actual.any ? OK : C.muted,
          value: actual.any ? `${nm(actual.hours)} ч` : "факта пока нет" },
      ]} />
      {!steps.length && (
        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
          Шагов нет: с этого ресурса цепочка никуда не ведёт.</div>)}
      {/* Таймлайн — на календарной линейке: по ней и читают, когда что. */}
      <div style={{ marginTop: 8 }}>
        <Timeline steps={steps} before={before} />
      </div>
      {!!before.length && (<>
        <div style={{ ...S.lbl, margin: "10px 0 4px" }}>как эти вещи появились</div>
        {/* Работа, в которой выбранные вещи родились, лежит ДО цепочки.
            Выбросить её значило бы не ответить, откуда они взялись. */}
        {before.map((t) => row(t, "—"))}
      </>)}

      {/* ─── разделы отчёта: по одному на выполняемую функцию ─── */}
      {!!steps.length && (
        <div style={{ ...S.lbl, margin: "12px 0 0" }}>
          разделы отчёта — по одному на функцию</div>)}
      {steps.map((s, i) => (
        <StepSection key={s.func} s={s} no={i + 1} nodeId={nodeId}
          own={factors.find((x) => x.func === s.func)}
          traitName={traitName} personName={personName} row={row}
          perRun={perRun} portLine={portLine} />))}
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
function Part({ n, title, children }) {
  return (
    <section style={{ marginTop: 10, borderTop: `1px solid ${C.line}`,
      paddingTop: 8 }}>
      <div style={{ ...S.lbl, marginBottom: 6 }}>{n}. {title}</div>
      {children}
    </section>);
}

function Node({ node, nodes, model, doc, depth = 0, focus, onFocus, setNodes,
  traitName, funcName, nameOf, entities }) {
  const [open, setOpen] = useState(depth < 1);
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
  const units = node.trait ? unitsOfTrait(model, node.trait) : [];
  const picked = Array.isArray(node.units) ? node.units.filter(Boolean) : [];
  // Все единицы модели: по ним видно, над чем работала каждая задача.
  const full = chainOf(model, { from: node.trait });
  const uptoTraits = traits.filter((t) => t.id !== node.trait
    && (full.traits || []).includes(t.id));
  const uptoFuncs = full.steps || [];

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
        <TxtField value={node.name} aria-label={root ? "название проекта" : "название раздела"}
          style={{ flex: 1, padding: "4px 6px", fontSize: root ? 13 : 12.5,
            fontWeight: root ? 700 : 600 }}
          onCommit={(v) => up({ name: v })} />
        <span style={{ fontSize: 10, color: C.muted }}>{root ? "проект" : "раздел"}</span>
      </div>

      {/* «Шаг» и «задача» — не одно и то же, и коротких слов тут мало:
          шаг это ФУНКЦИЯ цепочки, а задача — одно её выполнение. Одна
          функция, выполненная четыре раза, — это один шаг и четыре задачи,
          и подпись обязана говорить это словами, а не оставлять человека
          гадать, почему числа разные. */}
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4, lineHeight: 1.6 }}>
        шагов в цепочке: {plan.hi.steps.length} ·
        {" "}работ по вещам этого блока: {sum.rows} · принято: {sum.accepted} ·
        {" "}{nm(sum.hours)} ч
      </div>

      {open && (<>
        {/* ─── что прослеживаем ─── */}
        <div style={{ ...S.lbl, marginTop: 8 }}>что прослеживаем</div>
        <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 4 }}>
          <select style={{ ...S.inp, flex: "1 1 130px", minWidth: 0, fontSize: 11.5,
            padding: "4px 6px" }}
            aria-label={`с какого ресурса: ${node.name || "без названия"}`}
            value={node.trait}
            onChange={(e) => up({ trait: e.target.value, upto: "", units: [] })}>
            <option value="">— с какого ресурса —</option>
            {traits.map((t) => (<option key={t.id} value={t.id}>{t.l}</option>))}
          </select>
          {/* ─── КАКАЯ ИМЕННО единица этого ресурса ───

              Поле стоит рядом с самим ресурсом, потому что вопрос один и
              тот же: «какой договор». Прежде выбор жил отдельным рядом
              кнопок ниже, и его попросту не находили — а без него отчёт
              отвечал прогнозом там, где спрашивали про сделанное.

              Пусто — это ответ, а не пропуск: «что произойдёт, когда
              договор появится». Выбрана единица — второй вопрос: «что
              происходило вот с этим». */}
          <select style={{ ...S.inp, flex: "1 1 150px", minWidth: 0, fontSize: 11.5,
            padding: "4px 6px" }}
            aria-label={`какая единица: ${node.name || "без названия"}`}
            value="" disabled={!node.trait || !units.length}
            onChange={(e) => (e.target.value
              ? up({ units: [...new Set([...picked, e.target.value])] })
              : null)}>
            <option value="">
              {!node.trait ? "— сначала выберите ресурс —"
                : !units.length ? "единиц пока нет — это прогноз"
                  : picked.length ? "+ добавить единицу" : "— какая именно единица —"}
            </option>
            {units.filter((u) => !picked.includes(u.id)).map((u) => (
              <option key={u.id} value={u.id}>
                №{u.no} {u.title || "без названия"}
                {u.accepted ? "" : " (не принято)"}</option>))}
          </select>
          {/* Количество стоит ЗДЕСЬ, у самого ресурса: это его количество, и
              спрашивать «сколько» отдельно от «чего» — значит заставлять
              человека держать связь в голове. Выбраны конкретные единицы —
              число берётся из них и руками не правится: две записи про одно
              и то же разъехались бы, и стало бы непонятно, какой верить. */}
          <NumField value={picked.length || node.qty || 1}
            style={{ flex: "0 1 72px", fontSize: 11.5, padding: "4px 6px",
              opacity: picked.length ? 0.6 : 1 }}
            readOnly={!!picked.length}
            aria-label={`количество: ${node.name || "без названия"}`}
            onCommit={(v) => (picked.length
              ? null : up({ qty: Math.max(1, Number(v) || 1) }))} />
          <span style={{ fontSize: 10.5, color: C.muted }}>
            {picked.length ? "шт. — столько выбрано" : "шт."}</span>
          <select style={{ ...S.inp, flex: "1 1 130px", minWidth: 0, fontSize: 11.5,
            padding: "4px 6px" }}
            aria-label={`до какого звена: ${node.name || "без названия"}`}
            value={node.upto} disabled={!node.trait}
            onChange={(e) => up({ upto: e.target.value })}>
            <option value="">
              {node.trait ? "до конца цепочки" : "— сначала выберите ресурс —"}</option>
            {!!uptoTraits.length && (
              <optgroup label="до ресурса">
                {uptoTraits.map((t) => (<option key={t.id} value={t.id}>{t.l}</option>))}
              </optgroup>)}
            {!!uptoFuncs.length && (
              <optgroup label="до функции">
                {uptoFuncs.map((f) => (
                  <option key={f.id} value={f.id}>{funcLabel(f, entities)}</option>))}
              </optgroup>)}
          </select>
        </div>

        {/* ─── выбранные единицы ───

            Ресурс сюда не ЗАГРУЖАЮТ: новые вещи рождаются там, где их и
            делают, — при сдаче выполненной задачи. Здесь их ВЫБИРАЮТ из уже
            сделанных, и выбранные стоят рядом фишками: видно, про что
            отчёт, и любую можно снять. */}
        {!!picked.length && (
          <div className="flex flex-wrap gap-2" style={{ marginTop: 6,
            alignItems: "center" }}>
            {picked.map((id) => {
              const u = units.find((x) => x.id === id);
              return (
                <button key={id} style={{ ...btn(true, ACC), fontSize: 11,
                  padding: "3px 7px" }}
                  aria-label={`убрать единицу: ${u ? `№${u.no}` : id}`}
                  onClick={() => up({ units: picked.filter((x) => x !== id) })}>
                  {u ? `№${u.no} ${u.title || "без названия"}` : "единица удалена"}
                  {" ×"}</button>);
            })}
          </div>)}
        {!!node.trait && (
          <div style={{ fontSize: 10, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
            {picked.length
              ? `Выбрано ${picked.length} — отчёт про них и про то, что из них выросло: их задачи, их вещи, их часы.`
              : units.length
                ? `Единица не выбрана — это ПРОГНОЗ: что произойдёт, когда ${
                  traitName(node.trait)} появится в системе. Выберите конкретную
                  единицу выше, чтобы увидеть, что по ней уже сделано.`
                : `Единиц у ресурса «${traitName(node.trait)}» пока нет — выбирать
                  не из чего, и это прогноз. Единица появляется, когда её выдаёт
                  чья-то выполненная задача; ресурс, приходящий со стороны, их не
                  имеет вовсе.`}
          </div>)}

        {!node.trait && (
          <div style={{ fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
            Выберите ресурс, с которого начинается работа, и звено, до которого
            её прослеживать. Дальше приложение посчитает само: как изменятся
            ресурсы, сколько это займёт, какие шаги будут сделаны и что на них
            повлияет.
          </div>)}

        {doc.broken && (
          <div style={{ fontSize: 11, color: WARN, marginTop: 6, lineHeight: 1.5 }}>
            До этого звена цепочка не доходит: между ним и выбранным ресурсом
            разрыв — ни одна функция не берёт то, что выдаёт предыдущая.
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
                : "Что из чего сделано, по ней не записано: при сдаче не отметили взятое. Показана она одна — достраивать родословную по датам значило бы выдать догадку за знание."}
            </div>
          </div>)}

        {!!node.trait && (<>
          {/* ═══ 1. ПРОГНОЗ РЕСУРСОВ ═══

              Первым — потому что раздел и заводят ради вопроса «что будет с
              этим ресурсом». Отдельного списка «созданные ресурсы» здесь
              нет: вещи открываются нажатием на строку своего ресурса прямо
              в прогнозе. Второй список отвечал бы на тот же вопрос второй
              раз и в другом порядке. */}
          <Part n={1} title="прогноз ресурсов">
            <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 6,
              lineHeight: 1.5 }}>
              считано на {nm(plan.hi.qty)} × {traitName(node.trait)}
              {doc.hypothetical ? " (единица не выбрана — прогноз для новой)" : ""}
            </div>
            <Facts rows={[
              { label: "Работы (человеко-часов)", color: WARN,
                value: hoursRange(plan.lo.workHours, plan.hi.workHours) },
              { label: "Займёт времени", color: WARN,
                value: rangeTimeText(plan.lo.calendarHours, plan.hi.calendarHours) },
              { label: "Фактически ушло часов", color: actual.any ? OK : C.muted,
                value: actual.any ? `${nm(actual.hours)} ч` : "факта пока нет" },
              Object.keys(plan.hi.need || {}).length
                ? { label: "Нужно со стороны", color: WARN,
                  value: Object.entries(plan.hi.need)
                    .map(([id, q]) => `${traitName(id)} ${nm(q)}`).join(", ") }
                : null,
              factors.length
                ? { label: "На это влияют факторы", color: ACC,
                  value: factors.map((x) => `${x.name}${x.factors.length
                    ? ` (${x.factors.map((y) => `${y.name} ${y.chance}%`).join(", ")})`
                    : ""}`).join("; ") }
                : null,
            ]} />
            <div style={{ height: 8 }} />
            {changes.length
              ? <ChangeChart rows={changes} traitName={traitName}
                  madeOf={(t) => doc.made.filter((u) => u.trait === t)} />
              : <div style={{ fontSize: 11, color: C.muted }}>
                  Ресурсы по этой цепочке не меняются.</div>}
            {/* Нажимать не на что — так и сказано: молчаливо неактивная
                строка читается как поломка. */}
            {!!changes.length && (
              <div style={{ fontSize: 10, color: C.muted, marginTop: 6,
                lineHeight: 1.5 }}>
                {doc.made.length
                  ? "Нажмите на ресурс — откроются сами вещи, которые по нему вышли, и их можно скачать."
                  : "Готовых вещей по этой цепочке ещё нет — открывать пока нечего."}
              </div>)}
          </Part>

          {/* ═══ 2. ЗАДАЧИ ═══

              Таймлайн того, что делалось и что будет сделано, на
              календарной линейке — а под ним разделы отчёта, по одному на
              каждую выполняемую функцию, с тем же набором данных. */}
          <Part n={2} title="задачи">
            <Tasks steps={doc.steps} before={doc.before} plan={plan}
              actual={actual} factors={factors} funcName={funcName}
              traitName={traitName} nodeId={node.id}
              personName={(id) => (nameOf ? nameOf(id) : id)} />
          </Part>
        </>)}

        <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
          <button style={{ ...btn(true, OK), fontSize: 11 }} disabled={saving}
            onClick={download}>
            {saving ? "Готовлю…" : "Скачать отчёт"}</button>
          <button style={{ ...btn(false), fontSize: 11 }} disabled={busy}
            onClick={makeLink}>
            {busy ? "Готовлю…" : link ? "обновить ссылку" : "ссылка на этот блок"}</button>
          <span style={{ flex: 1 }} />
          <button style={{ ...btn(false), fontSize: 11, color: BAD,
            borderColor: "#5A2436" }}
            onClick={() => setNodes((p) => dropNode(p, node.id))}>удалить</button>
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
                : "Открывается у кого угодно и без входа: там снимок этого блока — оценка, шаги, созданные ресурсы и факт, и ничего сверх."}
            </div>
          </div>)}

        {kids.map((k, i) => (
          <Node key={k.id} node={k} nodes={nodes} model={model}
            doc={doc.sections[i]} depth={depth + 1}
            focus={focus} onFocus={onFocus} setNodes={setNodes}
            traitName={traitName} funcName={funcName} nameOf={nameOf} entities={entities} />))}
      </>)}
    </div>);
}

export default function ReportsPanel({ nodes = [], setNodes, model = {},
  entities = [], nameOf, focus, onFocus, runsOf }) {
  const traitName = (id) => (model.traits || []).find((t) => t.id === id)?.l
    || (id ? "(ресурс удалён)" : "");
  const funcName = (id) => {
    const f = (model.funcs || []).find((x) => x.id === id);
    return f ? funcLabel(f, entities) : "(функция удалена)";
  };
  const path = focus ? pathOf(nodes, focus) : [];
  const shown = focus && path.length ? [path[path.length - 1]] : rootsOf(nodes);

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
      <div style={{ ...S.card, marginBottom: 10 }}>
        <div className="flex items-center gap-2">
          <span style={S.lbl}>отчёты — карта проектов</span>
          <span style={{ flex: 1 }} />
          <button style={btn(true)}
            onClick={() => setNodes((p) => [...p, newProject()])}>+ проект</button>
        </div>
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
          В разделе называют две вещи: ресурс, с которого начинается работа
          (и прикладывают его самого), и звено, до которого её прослеживать.
          Остальное приложение считает по модели — как изменятся ресурсы,
          сколько это займёт, какие шаги будут сделаны и что на них повлияет.
        </div>
        {!!path.length && (
          <div className="flex flex-wrap gap-2" style={{ marginTop: 8, alignItems: "center" }}>
            <button style={{ ...btn(false), fontSize: 11 }}
              onClick={() => onFocus?.(null)}>← вся карта</button>
            <span style={{ fontSize: 11, color: C.muted }}>
              {path.map((n) => n.name || "без названия").join(" → ")}</span>
          </div>)}
      </div>

      {!nodes.length && (
        <div style={{ ...S.card, fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
          Проектов пока нет. Проект — это заказ или направление работы: с
          какого ресурса он начинается и до какого звена его вести.
        </div>)}

      {focus && !path.length && (
        <div style={{ ...S.card, fontSize: 11.5, color: WARN, lineHeight: 1.6 }}>
          Такого блока в этой модели нет. Возможно, ссылка ведёт в другую
          рабочую область или блок удалили.
        </div>)}

      {shown.map((n) => (
        <Node key={n.id} node={n} nodes={nodes} model={model}
          doc={reportOf(model, n, nodes, { runsOf })}
          focus={focus} onFocus={onFocus} setNodes={setNodes} traitName={traitName}
          funcName={funcName} nameOf={nameOf} entities={entities} />))}
    </div>);
}
