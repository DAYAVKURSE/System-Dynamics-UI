import React from "react";
import { C, OK, WARN, BAD } from "./ui.jsx";
import { MARK_MAX, statsOf } from "../lib/workers.js";

/* ════════════════════════════════════════════════════════════════
   КАРТОЧКА ЧЕЛОВЕКА: чем он занят и как это принимают

   В списке воркеров о человеке сказано одной строкой — средняя оценка,
   доля «в срок», сколько работ. Строка отвечает на вопрос «кого ставить»,
   но не отвечает ни на один следующий: за что снизили оценку, где именно
   сорвал срок, что вообще делал. Поэтому здесь — всё то же самое, но
   разложенное по работам.

   ─── почему каждая оценка с комментарием ───

   Оценка без слов — это приговор без объяснения: человек видит «3» и не
   знает, что исправлять, а тот, кто выбирает исполнителя, не знает, стоит
   ли эта тройка внимания. Поэтому комментарий проверяющего показан рядом
   с оценкой, а не спрятан в задаче.

   ─── чего здесь нет ───

   Никаких сводных «баллов эффективности»: они складывают несравнимое и
   выглядят точнее, чем есть. Есть три величины, каждая со своим смыслом,
   и список работ, по которому их можно проверить руками.
   ════════════════════════════════════════════════════════════════ */

const two = (n) => String(n).padStart(2, "0");

/** Дата коротко: «3 сен, 14:20». Год не пишем — история недлинная. */
export function when(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  const m = ["янв", "фев", "мар", "апр", "мая", "июн",
    "июл", "авг", "сен", "окт", "ноя", "дек"][d.getMonth()];
  return `${d.getDate()} ${m}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

const markColor = (m) => (m == null ? C.muted : m >= 4 ? OK : m >= 3 ? WARN : BAD);

/** Одно число сводки: крупная величина и подпись под ней. */
function Fig({ value, label, color }) {
  return (
    <div style={{ flex: "1 1 90px", background: C.panel2, border: `1px solid ${C.line}`,
      borderRadius: 8, padding: "6px 8px" }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: color || C.text }}>{value}</div>
      <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.4 }}>{label}</div>
    </div>);
}

/**
 * Полная история человека: сводка сверху, работы под ней.
 *
 * Показывается в модальном окне из списка воркеров. Модель сюда не
 * передаётся целиком — только задачи и функции: больше для истории ничего
 * не нужно, а лишнее пришлось бы держать в согласии.
 */
export default function PersonStats({ tasks = [], funcs = [], personId, traitName }) {
  const s = statsOf(tasks, funcs, personId);
  const tn = traitName || ((id) => id);

  if (!s.total) {
    return (
      <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
        Этот человек ещё ничего не сдавал. Пока нет ни одной сданной работы,
        сказать о нём нечего: ни оценки, ни срока — это не «плохо», это
        «неизвестно».
      </div>);
  }

  return (<div>
    <div className="flex flex-wrap gap-2" style={{ marginBottom: 10 }}>
      <Fig label={`средняя оценка · ${s.marks} из ${MARK_MAX}-балльных`}
        color={markColor(s.mark)}
        value={s.mark == null ? "—" : Math.round(s.mark * 10) / 10} />
      <Fig label={`укладывается в срок · ${s.timed} со сроком`}
        value={s.onTime == null ? "—" : `${Math.round(s.onTime * 100)}%`} />
      <Fig label="принятых работ" value={s.done} />
      <Fig label="часов по факту" value={Math.round(s.hours * 10) / 10} />
    </div>

    {!!s.returned && (
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
        Ещё {s.returned} сдач{s.returned === 1 ? "а" : ""} не принята: в средние
        они не идут — вернули, значит работы пока нет.
      </div>)}

    <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase",
      letterSpacing: 0.4, marginBottom: 4 }}>работы</div>

    {s.rows.map((r) => (
      <div key={r.task} style={{ borderTop: `1px solid ${C.line}`, padding: "7px 0" }}>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{r.func}</span>
          {r.done ? (
            <span style={{ fontSize: 12, fontWeight: 700, color: markColor(r.mark) }}>
              {r.mark == null ? "принято" : `${r.mark}/${MARK_MAX}`}</span>
          ) : (
            <span style={{ fontSize: 11, color: WARN }}>вернули</span>)}
        </div>
        {r.title && r.title !== r.func && (
          <div style={{ fontSize: 11.5, color: C.text }}>{r.title}</div>)}
        <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.6 }}>
          {when(r.start)} → сдано {when(r.at)}
          {r.end ? ` · срок ${when(r.end)}` : " · срок не ставили"}
          {" · "}{Math.round(r.hours * 10) / 10} ч
        </div>
        {r.inTime !== null && (
          <div style={{ fontSize: 10.5, color: r.inTime ? OK : BAD }}>
            {r.inTime ? "в срок" : "после срока"}</div>)}
        {r.text && (
          <div style={{ fontSize: 11.5, marginTop: 3, whiteSpace: "pre-wrap" }}>{r.text}</div>)}
        {(!!Object.keys(r.takes).length || !!Object.keys(r.gives).length) && (
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
            {Object.entries(r.takes).map(([k, v]) => `−${v} ${tn(k)}`).join(", ")}
            {Object.keys(r.takes).length && Object.keys(r.gives).length ? " · " : ""}
            {Object.entries(r.gives).map(([k, v]) => `+${v} ${tn(k)}`).join(", ")}
          </div>)}
        {r.comment && (
          <div style={{ fontSize: 11.5, marginTop: 4, padding: "4px 7px",
            background: C.panel2, borderRadius: 6, borderLeft: `2px solid ${markColor(r.mark)}` }}>
            <span style={{ color: C.muted }}>проверяющий: </span>{r.comment}
          </div>)}
      </div>))}
  </div>);
}
