import React, { useMemo, useState } from "react";
import { C, OK, WARN, BAD, NEU, ACC, S, btn, nm, alpha } from "./ui.jsx";
import { hoursOf } from "../lib/funcs.js";
import { STATUSES, funcLabel, statusName } from "./TasksBoard.jsx";
import { reportSrc } from "../storage.js";
import { barOf } from "../lib/timelineDoc.js";

/* ════════════════════════════════════════════════════════════════
   TIMELINE · вся работа во времени — и прошлая, и будущая.

   Таймлайн Ганта, а не список: у работы есть протяжённость, и главное, что
   нужно увидеть, — как задачи ложатся во времени относительно друг друга.
   Список этого не показывает, а календарь показывает только один месяц.

   Показываются ВСЕ задачи, а не только сданные: бэклог и запланированное
   на будущее — такая же часть картины, как сделанное. Задача, у которой
   времени нет вовсе (ни начала, ни единой сдачи), на ось не ставится —
   придумывать ей дату нельзя, — но и не пропадает: она в списке под осью,
   и там видно, что срок ей не задан.
   ════════════════════════════════════════════════════════════════ */

const DAY = 86400000;
const ROW = 34;   // высота строки задачи в общем поле
const fmtD = (ms) => new Date(ms).toLocaleDateString("ru-RU",
  { day: "2-digit", month: "2-digit", year: "2-digit" });
const fmtDT = (v) => {
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("ru-RU",
    { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
};
/* Пустая дата — это НЕ дата, а не полночь 1970 года: `new Date(null)` даёт
   ровно её, и задача без начала уезжала на ось в шестидесятые, утаскивая
   за собой всю шкалу. */
const ms = (v) => {
  if (v == null || v === "") return null;
  const t = new Date(v).getTime();
  return isNaN(t) ? null : t;
};

/* Полоса задачи считается в `lib/timelineDoc.js`: по ней рисуется и экран, и
   файл, и правило у них обязано быть одно. Здесь она только переизлучается —
   прежние места читают её отсюда. */
export { barOf };

/* `meId` — чьими глазами собирается файл: у владельца задачи приходят
   целиком, со скрытыми словами всех проверяющих, и файл без зрителя
   унёс бы их наружу. */
export default function Timeline({ tasks, funcs = [], traits = [], entities = [], nameOf,
  procs = [], meId = null, hypoOn = true }) {
  const [openId, setOpenId] = useState(null);
  /* Функция гипотетического процесса — не удалённая (владелец, 2026-09-20:
     «если гипотеза выключена, на некоторых функциях написано „функция
     удалена" — должна быть подпись, что функция гипотетическая»). Сюда
     приходят ВСЕ функции, а не только те, что в расчёте: таймлайн — про
     работу, которая была, и выключенная галочка её не отменяет. */
  const hypoOf = useMemo(() => new Set((procs || []).filter((p) => p.status === "hypo").map((p) => p.id)), [procs]);
  const funcTag = (f) => (f && f.proc && hypoOf.has(f.proc)
    ? <span style={{ color: WARN }}> · гипотетическая{hypoOn ? "" : ", гипотезы выключены"}</span> : null);
  const [only, setOnly] = useState("all");
  /* Фильтр по техпроцессу (владелец, 2026-09-19): в модели их несколько, и
     смотреть работу обычно нужно по одному. */
  const [proc, setProc] = useState("all");
  const funcById = useMemo(() =>
    Object.fromEntries((funcs || []).map((f) => [f.id, f])), [funcs]);
  const traitName = (id) => traits.find((x) => x.id === id)?.l || "(ресурс удалён)";

  /* «Отменена» — не статус, а пометка на задаче, но искать её надо так же,
     как статус: для человека это такое же состояние работы. */
  const stateOf = (t) => (t?.canceled === true ? "canceled" : t?.status);
  const all = useMemo(() => (tasks || [])
    .filter((t) => only === "all" || stateOf(t) === only)
    .filter((t) => proc === "all"
      || (proc === "none" ? !funcById[t.funcId]?.proc : funcById[t.funcId]?.proc === proc))
    .map((t) => ({ t, func: funcById[t.funcId], bar: barOf(t, funcById[t.funcId]) })),
  [tasks, funcById, only, proc]);
  const rows = useMemo(() => all.filter((r) => r.bar)
    .sort((a, b) => a.bar.from - b.bar.from), [all]);
  const undated = useMemo(() => all.filter((r) => !r.bar), [all]);

  /* Процессы, по которым есть работа: пустых в списке нет — выбирать
     нечего. «Вне процессов» — задачи функций, заведённых руками. */
  const procList = useMemo(() => {
    const used = new Set((tasks || []).map((t) => funcById[t.funcId]?.proc).filter(Boolean));
    return (procs || []).filter((p) => used.has(p.id));
  }, [tasks, funcById, procs]);
  const loose = useMemo(() => (tasks || []).some((t) => !funcById[t.funcId]?.proc),
    [tasks, funcById]);
  const filterBar = (
    <div style={{ ...S.card, marginBottom: "var(--space-8)" }}>
      <div style={S.lbl}>timeline · вся работа во времени</div>
      {/* Выпадающими списками, а не кучей кнопок (владелец, 2026-09-19). */}
      <div className="flex flex-wrap gap-2" style={{ margin: "var(--space-4) 0 0" }}>
        <select aria-label="статус задач" value={only} onChange={(e) => setOnly(e.target.value)}
          style={{ ...S.inp, flex: "1 1 150px", minWidth: 0, fontSize: "var(--fs-hint)" }}>
          <option value="all">все статусы</option>
          {STATUSES.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          <option value="canceled">Отменена</option>
        </select>
        <select aria-label="технологический процесс" value={proc}
          onChange={(e) => setProc(e.target.value)}
          style={{ ...S.inp, flex: "1 1 150px", minWidth: 0, fontSize: "var(--fs-hint)" }}>
          <option value="all">все процессы</option>
          {procList.map((p) => (
            <option key={p.id} value={p.id}>{p.name || "процесс без названия"}</option>))}
          {loose && <option value="none">вне процессов</option>}
        </select>
      </div>
    </div>);

  if (!rows.length && !undated.length) {
    return (<div>
      {filterBar}
      <div style={S.card}>
        {only === "all" ? "Задач пока нет." : "В этом состоянии задач нет."}
      </div>
    </div>);
  }

  // Общее окно таймлайна с полями по краям, чтобы полосы не липли к границе.
  // «Сегодня» входит в окно всегда: без него не видно, где кончается
  // сделанное и начинается запланированное.
  const now = Date.now();
  const min = Math.min(...rows.map((r) => r.bar.from), now);
  const max = Math.max(...rows.map((r) => r.bar.to), now);
  const pad = Math.max(DAY, (max - min) * 0.04);
  const A = min - pad, B = max + pad, W = B - A;
  const pct = (v) => ((v - A) / W) * 100;

  // Засечки: не больше семи, иначе на телефоне подписи налезают друг на друга.
  const ticks = [];
  const step = (B - A) / 6;
  for (let i = 0; i <= 6; i++) ticks.push(A + step * i);

  const open = all.find((r) => r.t.id === openId) || null;

  return (
    <div>
      {filterBar}

      <div style={{ ...S.card, marginBottom: "var(--space-8)", overflowX: "auto",
        WebkitOverflowScrolling: "touch" }}>
        <div style={{ minWidth: 560 }}>
          {/* Шкала времени: даты по засечкам, а на месте сегодняшнего дня —
              одно слово «сегодня», дата под ним не пишется (владелец,
              2026-09-22: слово накладывалось на дату). */}
          <div style={{ display: "flex", marginBottom: "var(--space-4)" }}>
            <div style={{ width: 150, flex: "0 0 150px" }} />
            <div style={{ flex: 1, position: "relative", height: 16 }}>
              {ticks.filter((t) => Math.abs(pct(t) - pct(now)) > 14).map((t, i) => (
                <span key={i} style={{ position: "absolute", left: `${pct(t)}%`,
                  transform: "translateX(-50%)", fontSize: "var(--fs-hint)", color: C.muted,
                  whiteSpace: "nowrap" }}>{fmtD(t)}</span>))}
              <span aria-label="сегодня" style={{ position: "absolute", left: `${pct(now)}%`,
                transform: "translateX(-50%)", fontSize: "var(--fs-hint)", color: ACC,
                whiteSpace: "nowrap" }}>сегодня</span>
            </div>
          </div>

          {/* Полосы — в ОДНОМ поле, а не в рамке под каждую задачу (владелец,
              2026-09-22); линия сегодняшнего дня идёт через все задачи. */}
          <div style={{ display: "flex" }}>
            <div style={{ width: 150, flex: "0 0 150px" }}>
              {rows.map(({ t, func }) => {
                const on = t.id === openId;
                return (
                  <div key={t.id} onClick={() => setOpenId(on ? null : t.id)}
                    style={{ height: ROW, boxSizing: "border-box", paddingRight: "var(--space-8)",
                      fontSize: "var(--fs-hint)", color: on ? ACC : C.text, lineHeight: 1.35,
                      overflow: "hidden", cursor: "pointer" }}>
                    {t.title}
                    <div style={{ fontSize: "var(--fs-hint)", color: C.muted }}>
                      {funcLabel(func, entities)}{funcTag(func)}</div>
                  </div>);
              })}
            </div>
            <div aria-label="поле таймлайна" style={{ flex: 1, position: "relative", background: C.ink,
              borderRadius: "var(--radius-sm)", border: `1px solid ${C.line}` }}>
              <span aria-label="линия сегодняшнего дня" style={{ position: "absolute", top: 0, bottom: 0,
                left: `${pct(now)}%`, width: 0, borderLeft: `1px dashed ${alpha(ACC, "99")}` }} />
              {rows.map(({ t, bar }) => {
                const st = STATUSES.find((x) => x.id === t.status) || { color: NEU, name: "—" };
                const on = t.id === openId;
                const subs = t.submissions || [];
                return (
                  <div key={t.id} onClick={() => setOpenId(on ? null : t.id)}
                    style={{ position: "relative", height: ROW, cursor: "pointer" }}>
                    <div style={{ position: "absolute", top: 8, bottom: 8, left: `${pct(bar.from)}%`,
                      width: `${Math.max(1.5, pct(bar.to) - pct(bar.from))}%`,
                      background: st.color, borderRadius: "var(--radius-sm)", opacity: on ? 1 : 0.85,
                      outline: on ? `1px solid ${ACC}` : "none" }} />
                    {/* Сдачи — отметки поверх полосы: видно, когда именно отчитались. */}
                    {subs.map((sb) => {
                      const at = ms(sb.at);
                      return at == null ? null : (
                        <span key={sb.id} title={fmtDT(sb.at)}
                          style={{ position: "absolute", top: 6, bottom: 6,
                            left: `${pct(at)}%`, width: 2, background: C.text,
                            transform: "translateX(-1px)" }} />);
                    })}
                  </div>);
              })}
            </div>
          </div>
        </div>
      </div>

      {!!undated.length && (
        <div style={{ ...S.card, marginBottom: "var(--space-8)" }}>
          <div style={S.lbl}>без сроков</div>
          {undated.map(({ t }) => {
            const st = STATUSES.find((x) => x.id === t.status) || { color: NEU, name: "—" };
            return (
              <div key={t.id} className="flex items-center gap-2"
                style={{ padding: "var(--space-4) 0", borderTop: `1px solid ${C.line}`,
                  cursor: "pointer" }}
                onClick={() => setOpenId(t.id === openId ? null : t.id)}>
                <span style={{ width: 8, height: 8, borderRadius: "var(--radius-sm)", background: st.color }} />
                <span style={{ fontSize: "var(--fs-hint)", flex: 1 }}>{t.title}</span>
                <span style={{ fontSize: "var(--fs-hint)", color: C.muted }}>{st.name}</span>
              </div>);})}
        </div>)}

      {open && (() => {
        const { t, func } = open;
        const qty = (map) => Object.entries(map || {})
          .map(([id, v]) => `${traitName(id)} ${nm(v)}`).join(", ") || "—";
        const st = STATUSES.find((x) => x.id === t.status);
        return (
          <div style={{ ...S.card, borderColor: ACC }}>
            <div className="flex items-center gap-2" style={{ marginBottom: "var(--space-4)" }}>
              <span style={{ width: 10, height: 10, borderRadius: "var(--radius-sm)",
                background: st?.color || NEU }} />
              <span style={{ fontSize: "var(--fs-body)", fontWeight: 700, flex: 1 }}>{t.title}</span>
              <button style={btn(false)} onClick={() => setOpenId(null)}>✕</button>
            </div>
            <div style={{ fontSize: "var(--fs-hint)", color: C.muted, lineHeight: 1.6,
              marginBottom: "var(--space-8)" }}>
              Статус: {st?.name || "—"} · функция: {funcLabel(func, entities)}{funcTag(func)}
              {t.setter ? <> · поставил: {nameOf ? nameOf(t.setter) : t.setter}</> : null}
              {t.assignee ? <> · исполнитель: {nameOf ? nameOf(t.assignee) : t.assignee}</> : null}
              {t.reviewer ? <> · проверяет: {nameOf ? nameOf(t.reviewer) : t.reviewer}</> : null}
              {t.start ? <> · начало {fmtDT(t.start)}</> : null}
            </div>
            {t.body && <div style={{ fontSize: "var(--fs-hint)", lineHeight: 1.5, marginBottom: "var(--space-8)" }}>
              {t.body}</div>}

            <div style={S.lbl}>сдачи и отчёты</div>
            <div style={{ marginTop: "var(--space-4)" }}>
              {!(t.submissions || []).length &&
                <div style={{ fontSize: "var(--fs-hint)", color: C.muted }}>Сдач пока нет.</div>}
              {(t.submissions || []).map((sb) => (
                <div key={sb.id} style={{ background: C.panel2,
                  border: `1px solid ${C.line}`, borderRadius: "var(--radius-sm)", padding: "var(--space-8)",
                  marginBottom: "var(--space-4)" }}>
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: "var(--fs-body)", fontWeight: 600, color: OK, flex: 1 }}>
                      ушло {nm(sb.hours)} ч
                      {func ? <span style={{ color: C.muted, fontWeight: 400 }}>
                        {" "}· планировалось {nm(hoursOf(func))} ч</span> : null}
                    </span>
                    <span style={{ fontSize: "var(--fs-hint)", color: C.muted }}>{fmtDT(sb.at)}</span>
                  </div>
                  <div style={{ fontSize: "var(--fs-hint)", color: C.muted, marginTop: "var(--space-4)",
                    lineHeight: 1.5 }}>
                    взято: {qty(sb.takes)} · выдано: {qty(sb.gives)}</div>
                  {sb.text && <div style={{ fontSize: "var(--fs-hint)", marginTop: "var(--space-4)", lineHeight: 1.5 }}>
                    {sb.text}</div>}
                  {sb.file && (
                    <div style={{ marginTop: "var(--space-4)" }}>
                      {/^image\//.test(sb.file.type || "")
                        ? <img src={reportSrc(sb.file)} alt={sb.file.name}
                            style={{ maxWidth: "100%", borderRadius: "var(--radius-sm)",
                              border: `1px solid ${C.line}` }} />
                        : sb.file.url
                          // Файл на диске можно открыть; инлайн в Telegram
                          // WebView всё равно не скачивается, поэтому там
                          // остаётся просто подпись.
                          ? <a href={sb.file.url} target="_blank" rel="noreferrer"
                              style={{ fontSize: "var(--fs-hint)", color: ACC }}>
                              📎 {sb.file.name} · {Math.round((sb.file.size || 0) / 1024)} КБ
                            </a>
                          : <div style={{ fontSize: "var(--fs-hint)", color: ACC }}>
                              📎 {sb.file.name} · {Math.round((sb.file.size || 0) / 1024)} КБ
                            </div>}
                    </div>)}
                </div>))}
            </div>
          </div>);
      })()}
    </div>);
}
