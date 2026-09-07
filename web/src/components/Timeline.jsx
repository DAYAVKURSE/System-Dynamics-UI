import React, { useMemo, useState } from "react";
import { C, OK, WARN, BAD, NEU, ACC, S, btn, nm } from "./ui.jsx";
import { hoursOf } from "../lib/funcs.js";
import { STATUSES, funcLabel, statusName } from "./TasksBoard.jsx";
import { putReportFile, reportSrc } from "../storage.js";
import { barOf, timelineHtml } from "../lib/timelineDoc.js";
import { deliverReport } from "../lib/reportDoc.js";
import { getTelegram } from "../telegram.js";

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

export default function Timeline({ tasks, funcs = [], traits = [], entities = [], nameOf }) {
  const [openId, setOpenId] = useState(null);
  const [only, setOnly] = useState("all");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const funcById = useMemo(() =>
    Object.fromEntries((funcs || []).map((f) => [f.id, f])), [funcs]);
  const traitName = (id) => traits.find((x) => x.id === id)?.l || "(ресурс удалён)";

  const all = useMemo(() => (tasks || [])
    .filter((t) => only === "all" || t.status === only)
    .map((t) => ({ t, func: funcById[t.funcId], bar: barOf(t, funcById[t.funcId]) })),
  [tasks, funcById, only]);
  const rows = useMemo(() => all.filter((r) => r.bar)
    .sort((a, b) => a.bar.from - b.bar.from), [all]);
  const undated = useMemo(() => all.filter((r) => !r.bar), [all]);

  /* ─── таймлайн файлом ───

     Экран показывает то, что есть в модели СЕЙЧАС, а спрашивают другое:
     «как оно шло». По живой модели на это не ответить — она меняется, и
     вчерашняя картина исчезает бесследно. Файл ложится туда же, куда и
     отчёты (своё хранилище на сервере, ссылка наружу), и так же переживает
     любые правки.

     В файл идут ВСЕ задачи, а не отфильтрованные на экране: его заводят,
     чтобы проследить, и обрезанная выборка отвечала бы на другой вопрос. */
  const save = async () => {
    setSaveErr(""); setSaving(true);
    try {
      const html = timelineHtml(tasks || [], funcs, {
        statusName,
        funcName: (id) => funcLabel(funcs.find((f) => f.id === id), entities),
        personName: (id) => (id == null ? "не назначен"
          : (nameOf ? nameOf(id) : String(id))),
        title: "Таймлайн работы",
      });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      await deliverReport(`timeline-${stamp}.html`, html,
        { telegram: getTelegram(), putFile: putReportFile });
    } catch (e) {
      // Молчаливый отказ здесь хуже всего: человек не знает, ждать ему или
      // нажимать ещё раз.
      setSaveErr(e.message || "не удалось сохранить таймлайн");
    }
    setSaving(false);
  };

  const filterBar = (
    <div style={{ ...S.card, marginBottom: 10 }}>
      <div style={S.lbl}>timeline · вся работа во времени</div>
      <div className="flex flex-wrap gap-2" style={{ margin: "6px 0 0" }}>
        <button style={btn(only === "all")} onClick={() => setOnly("all")}>все</button>
        {STATUSES.map((s) => (
          <button key={s.id} style={btn(only === s.id, s.color)}
            onClick={() => setOnly(s.id)}>{s.name}</button>))}
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
        Полоса — время выполнения задачи; чёрточки на ней — сдачи; пунктир —
        сегодня. Слева от него прошлое, справа запланированное.
      </div>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center",
        marginTop: 8 }}>
        <button style={{ ...btn(true, OK), fontSize: 11 }} disabled={saving}
          onClick={save}>
          {saving ? "Готовлю…" : "Сохранить таймлайн файлом"}</button>
        <span style={{ fontSize: 10, color: C.muted, flex: "1 1 200px",
          lineHeight: 1.5 }}>
          Вся работа с историей — когда отложили, когда взяли, что сдали и
          как приняли. Модель меняется, файл — нет.
        </span>
      </div>
      {saveErr && (
        <div style={{ fontSize: 10.5, color: BAD, marginTop: 5, lineHeight: 1.5 }}>
          {saveErr}</div>)}
    </div>);

  if (!rows.length && !undated.length) {
    return (<div>
      {filterBar}
      <div style={S.card}>
        {only === "all"
          ? "Задач пока нет. Заведите их во вкладке «Задачи» — здесь они лягут во времени."
          : "В этом состоянии задач нет."}
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

      <div style={{ ...S.card, marginBottom: 10, overflowX: "auto",
        WebkitOverflowScrolling: "touch" }}>
        <div style={{ minWidth: 560 }}>
          {/* Шкала времени */}
          <div style={{ display: "flex", marginBottom: 6 }}>
            <div style={{ width: 150, flex: "0 0 150px" }} />
            <div style={{ flex: 1, position: "relative", height: 16 }}>
              {ticks.map((t, i) => (
                <span key={i} style={{ position: "absolute", left: `${pct(t)}%`,
                  transform: "translateX(-50%)", fontSize: 9.5, color: C.muted,
                  whiteSpace: "nowrap" }}>{fmtD(t)}</span>))}
              <span style={{ position: "absolute", left: `${pct(now)}%`, bottom: -2,
                transform: "translateX(-50%)", fontSize: 9, color: ACC,
                whiteSpace: "nowrap" }}>сегодня</span>
            </div>
          </div>

          {rows.map(({ t, func, bar }) => {
            const st = STATUSES.find((x) => x.id === t.status) || { color: NEU, name: "—" };
            const on = t.id === openId;
            const subs = t.submissions || [];
            return (
              <div key={t.id} style={{ display: "flex", alignItems: "center",
                marginBottom: 6, cursor: "pointer" }}
                onClick={() => setOpenId(on ? null : t.id)}>
                <div style={{ width: 150, flex: "0 0 150px", paddingRight: 8,
                  fontSize: 11.5, color: on ? ACC : C.text, lineHeight: 1.35,
                  overflow: "hidden" }}>
                  {t.title}
                  <div style={{ fontSize: 9.5, color: C.muted }}>
                    {funcLabel(func, entities)}</div>
                </div>
                <div style={{ flex: 1, position: "relative", height: 26,
                  background: C.ink, borderRadius: 6,
                  border: `1px solid ${on ? ACC : C.line}` }}>
                  <span style={{ position: "absolute", top: 0, bottom: 0,
                    left: `${pct(now)}%`, width: 0,
                    borderLeft: `1px dashed ${ACC}99` }} />
                  <div style={{ position: "absolute", top: 4, bottom: 4,
                    left: `${pct(bar.from)}%`,
                    width: `${Math.max(1.5, pct(bar.to) - pct(bar.from))}%`,
                    background: st.color, borderRadius: 4, opacity: on ? 1 : 0.85 }} />
                  {/* Сдачи — отметки поверх полосы: видно, когда именно отчитались. */}
                  {subs.map((sb) => {
                    const at = ms(sb.at);
                    return at == null ? null : (
                      <span key={sb.id} title={fmtDT(sb.at)}
                        style={{ position: "absolute", top: 2, bottom: 2,
                          left: `${pct(at)}%`, width: 2, background: C.text,
                          transform: "translateX(-1px)" }} />);
                  })}
                </div>
              </div>);
          })}
        </div>
      </div>

      {!!undated.length && (
        <div style={{ ...S.card, marginBottom: 10 }}>
          <div style={S.lbl}>без сроков — на оси им не место</div>
          <div style={{ fontSize: 10.5, color: C.muted, margin: "5px 0 7px",
            lineHeight: 1.5 }}>
            Начало не задано, и сдач ещё не было. Поставить их на ось значило
            бы придумать дату.
          </div>
          {undated.map(({ t }) => {
            const st = STATUSES.find((x) => x.id === t.status) || { color: NEU, name: "—" };
            return (
              <div key={t.id} className="flex items-center gap-2"
                style={{ padding: "5px 0", borderTop: `1px solid ${C.line}`,
                  cursor: "pointer" }}
                onClick={() => setOpenId(t.id === openId ? null : t.id)}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: st.color }} />
                <span style={{ fontSize: 11.5, flex: 1 }}>{t.title}</span>
                <span style={{ fontSize: 10, color: C.muted }}>{st.name}</span>
              </div>);})}
        </div>)}

      {open && (() => {
        const { t, func } = open;
        const qty = (map) => Object.entries(map || {})
          .map(([id, v]) => `${traitName(id)} ${nm(v)}`).join(", ") || "—";
        const st = STATUSES.find((x) => x.id === t.status);
        return (
          <div style={{ ...S.card, borderColor: ACC }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3,
                background: st?.color || NEU }} />
              <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{t.title}</span>
              <button style={btn(false)} onClick={() => setOpenId(null)}>✕</button>
            </div>
            <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6,
              marginBottom: 8 }}>
              Статус: {st?.name || "—"} · функция: {funcLabel(func, entities)}
              {t.setter ? <> · поставил: {nameOf ? nameOf(t.setter) : t.setter}</> : null}
              {t.assignee ? <> · исполнитель: {nameOf ? nameOf(t.assignee) : t.assignee}</> : null}
              {t.reviewer ? <> · проверяет: {nameOf ? nameOf(t.reviewer) : t.reviewer}</> : null}
              {t.start ? <> · начало {fmtDT(t.start)}</> : null}
            </div>
            {t.body && <div style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 8 }}>
              {t.body}</div>}

            <div style={S.lbl}>сдачи и отчёты</div>
            <div style={{ marginTop: 6 }}>
              {!(t.submissions || []).length &&
                <div style={{ fontSize: 11.5, color: C.muted }}>Сдач пока нет.</div>}
              {(t.submissions || []).map((sb) => (
                <div key={sb.id} style={{ background: C.panel2,
                  border: `1px solid ${C.line}`, borderRadius: 8, padding: 9,
                  marginBottom: 6 }}>
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: OK, flex: 1 }}>
                      ушло {nm(sb.hours)} ч
                      {func ? <span style={{ color: C.muted, fontWeight: 400 }}>
                        {" "}· планировалось {nm(hoursOf(func))} ч</span> : null}
                    </span>
                    <span style={{ fontSize: 10, color: C.muted }}>{fmtDT(sb.at)}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3,
                    lineHeight: 1.5 }}>
                    взято: {qty(sb.takes)} · выдано: {qty(sb.gives)}</div>
                  {sb.text && <div style={{ fontSize: 12, marginTop: 5, lineHeight: 1.5 }}>
                    {sb.text}</div>}
                  {sb.file && (
                    <div style={{ marginTop: 6 }}>
                      {/^image\//.test(sb.file.type || "")
                        ? <img src={reportSrc(sb.file)} alt={sb.file.name}
                            style={{ maxWidth: "100%", borderRadius: 6,
                              border: `1px solid ${C.line}` }} />
                        : sb.file.url
                          // Файл на диске можно открыть; инлайн в Telegram
                          // WebView всё равно не скачивается, поэтому там
                          // остаётся просто подпись.
                          ? <a href={sb.file.url} target="_blank" rel="noreferrer"
                              style={{ fontSize: 11, color: ACC }}>
                              📎 {sb.file.name} · {Math.round((sb.file.size || 0) / 1024)} КБ
                            </a>
                          : <div style={{ fontSize: 11, color: ACC }}>
                              📎 {sb.file.name} · {Math.round((sb.file.size || 0) / 1024)} КБ
                            </div>}
                    </div>)}
                </div>))}
            </div>
          </div>);
      })()}
    </div>);
}
