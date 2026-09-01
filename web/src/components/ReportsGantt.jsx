import React, { useMemo, useState } from "react";
import { C, OK, WARN, BAD, NEU, ACC, S, btn, nm } from "./ui.jsx";
import { STATUSES } from "./TasksBoard.jsx";
import { unitOf } from "../lib/sim.js";

/* ════════════════════════════════════════════════════════════════
   ОТЧЁТЫ · что делалось, когда, ради какой цели и с каким результатом.

   Таймлайн Ганта, а не список: у работы есть протяжённость, и главное, что
   нужно увидеть, — как задачи ложатся во времени относительно друг друга.
   Список этого не показывает, а календарь показывает только один месяц.
   ════════════════════════════════════════════════════════════════ */

const DAY = 86400000;
const fmtD = (ms) => new Date(ms).toLocaleDateString("ru-RU",
  { day: "2-digit", month: "2-digit", year: "2-digit" });
const fmtDT = (v) => {
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("ru-RU",
    { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const ms = (v) => { const t = new Date(v).getTime(); return isNaN(t) ? null : t; };

/* Полоса задачи: от начала её движения (или первой сдачи) до последней сдачи
   либо до конца движения. Задача без дат и без сдач полосы не имеет — ей
   нечего показать во времени, и рисовать её «от сегодня до сегодня» значило
   бы выдумать данные. */
export function barOf(task, edge) {
  const subs = (task.submissions || []).map((s) => ms(s.at)).filter(Boolean).sort();
  const from = ms(edge?.start) ?? subs[0] ?? null;
  const to = subs[subs.length - 1] ?? ms(edge?.end) ?? (from ? from + DAY : null);
  if (from == null || to == null) return null;
  return { from, to: Math.max(to, from + DAY / 4) };
}

export default function ReportsGantt({ tasks, edges, traits, goals, entityName }) {
  const [openId, setOpenId] = useState(null);
  const edgeById = useMemo(() =>
    Object.fromEntries((edges || []).map((e) => [e.id, e])), [edges]);
  const goalById = useMemo(() =>
    Object.fromEntries((goals || []).map((g) => [g.id, g])), [goals]);

  const rows = useMemo(() => (tasks || [])
    .map((t) => ({ t, edge: edgeById[t.edgeId], bar: barOf(t, edgeById[t.edgeId]) }))
    .filter((r) => r.bar)
    .sort((a, b) => a.bar.from - b.bar.from), [tasks, edgeById]);

  if (!rows.length) {
    return (<div style={S.card}>
      Пока нечего показать. Отчёт появляется здесь, когда задачу сдают:
      во вкладке «Задачи» откройте задачу и нажмите «СДАТЬ» — можно приложить
      текст, файл или фотографию.
    </div>);
  }

  // Общее окно таймлайна с полями по краям, чтобы полосы не липли к границе.
  const min = Math.min(...rows.map((r) => r.bar.from));
  const max = Math.max(...rows.map((r) => r.bar.to), Date.now());
  const pad = Math.max(DAY, (max - min) * 0.04);
  const A = min - pad, B = max + pad, W = B - A;
  const pct = (v) => ((v - A) / W) * 100;

  // Засечки: не больше семи, иначе на телефоне подписи налезают друг на друга.
  const ticks = [];
  const step = (B - A) / 6;
  for (let i = 0; i <= 6; i++) ticks.push(A + step * i);

  const open = rows.find((r) => r.t.id === openId) || null;

  return (
    <div>
      <div style={{ ...S.card, marginBottom: 10 }}>
        <div style={S.lbl}>отчёты · что делалось и когда</div>
        <div className="flex flex-wrap gap-2" style={{ margin: "8px 0 0" }}>
          {STATUSES.map((s) => (
            <span key={s.id} className="flex items-center gap-2"
              style={{ fontSize: 11, color: C.muted }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color,
                display: "inline-block" }} />
              {s.name}
            </span>))}
        </div>
      </div>

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
            </div>
          </div>

          {rows.map(({ t, edge, bar }) => {
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
                    {goalById[t.goalId]?.l || "цель удалена"}</div>
                </div>
                <div style={{ flex: 1, position: "relative", height: 26,
                  background: C.ink, borderRadius: 6,
                  border: `1px solid ${on ? ACC : C.line}` }}>
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

      {open && (() => {
        const { t, edge } = open;
        const target = traits.find((x) => x.id === edge?.to);
        const goal = goalById[t.goalId];
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
              Статус: {st?.name || "—"} · цель: {goal ? goal.l : "удалена"}
              {edge ? <> · движение: {entityName ? entityName(edge.from) : ""} →
                {" "}{target?.l || "?"}{edge.carrier ? ` (${edge.carrier})` : ""}</> : null}
              {edge?.start ? <> · начало {fmtDT(edge.start)}</> : null}
              {edge?.end ? <> · конец {fmtDT(edge.end)}</> : null}
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
                      перешло {nm(sb.amount)}
                      {target ? ` ${unitOf(target).split("/")[0]}` : ""}
                      {edge ? <span style={{ color: C.muted, fontWeight: 400 }}>
                        {" "}· планировалось {nm(Math.abs(Number(edge.gives) || 0))}</span> : null}
                    </span>
                    <span style={{ fontSize: 10, color: C.muted }}>{fmtDT(sb.at)}</span>
                  </div>
                  {sb.text && <div style={{ fontSize: 12, marginTop: 5, lineHeight: 1.5 }}>
                    {sb.text}</div>}
                  {sb.file && (
                    <div style={{ marginTop: 6 }}>
                      {/^image\//.test(sb.file.type || "")
                        ? <img src={sb.file.data} alt={sb.file.name}
                            style={{ maxWidth: "100%", borderRadius: 6,
                              border: `1px solid ${C.line}` }} />
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
