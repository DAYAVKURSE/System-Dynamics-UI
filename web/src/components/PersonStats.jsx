import React from "react";
import { C, OK, WARN, BAD, S } from "./ui.jsx";
import { MARK_MAX, commentsFor, kindName, visibleStats } from "../lib/workers.js";

/* ════════════════════════════════════════════════════════════════
   КАРТОЧКА ЧЕЛОВЕКА: чем он занят и как это принимают

   В списке воркеров о человеке сказано одной строкой — средняя оценка,
   доля «в срок», сколько работ. Строка отвечает на вопрос «кого ставить»,
   но не отвечает ни на один следующий: за что снизили оценку, где именно
   сорвал срок, что вообще делал. Поэтому здесь — всё то же самое, но
   разложенное по работам.

   ─── оценки без имени ───

   Оценка здесь — только ОПУБЛИКОВАННАЯ: без автора и только когда по ней
   нельзя вычислить, кто её поставил. Принятая, но ещё не опубликованная
   работа так и подписана — «оценка ещё не опубликована», а не «без
   оценки»: это разные ответы.

   ─── про себя человек видит не всё ───

   Свои оценки и свой рейтинг не показываются: рейтинг существует, чтобы
   ЕМУ поручали работу, а не чтобы он смотрел на себя. Вместо цифр — слова,
   которые ему адресованы: скрытые комментарии и опубликованные анонимные.
   Правило живёт не здесь, а в `visibleStats()` — карточка только
   спрашивает.

   ─── чего здесь нет ───

   Никаких сводных «баллов эффективности»: они складывают несравнимое и
   выглядят точнее, чем есть. Есть несколько величин, каждая со своим
   смыслом, и список работ, по которому их можно проверить руками.
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
const round1 = (v) => Math.round(v * 10) / 10;

/** Фраза, которая заменяет человеку его же рейтинг. Одна на всё приложение. */
export const SELF_HIDDEN = "Свои оценки не показываются: рейтинг работает на того, кто поручает";

/** Одно число сводки: крупная величина и подпись под ней. */
function Fig({ value, label, color }) {
  return (
    <div style={{ flex: "1 1 90px", background: C.panel2, border: `1px solid ${C.line}`,
      borderRadius: 8, padding: "6px 8px" }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: color || C.text }}>{value}</div>
      <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.4 }}>{label}</div>
    </div>);
}

/** Слова оценки — без имени: вид оценки и текст, у скрытых — пометка. */
function Words({ list, empty }) {
  if (!list.length) {
    return <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>{empty}</div>;
  }
  return (<div>
    {list.map((c, i) => (
      <div key={i} style={{ fontSize: 11.5, marginTop: 4, padding: "4px 7px",
        background: C.panel2, borderRadius: 6, borderLeft: `2px solid ${C.line}`,
        lineHeight: 1.5 }}>
        <span style={{ color: C.muted }}>{kindName(c.kind)}
          {c.hidden ? " · скрытый · только вам" : ""}: </span>{c.text}
      </div>))}
  </div>);
}

/**
 * Полная история человека: сводка сверху, работы под ней.
 *
 * Модель сюда не передаётся целиком — только задачи, функции и реестр
 * опубликованного: больше для истории ничего не нужно. `viewerId` — кто
 * смотрит: от этого зависит, что из оценок видно. `ratings` — ответ
 * сервера `GET /api/workspace/ratings`, если его спросили: у не-владельца
 * в модели только свои задачи, и слова про его постановку лежат в чужих.
 */
export default function PersonStats({ tasks = [], funcs = [], personId, traitName,
  published, viewerId, ratings }) {
  const model = { tasks, funcs, published };
  const s = visibleStats(model, personId, viewerId);
  const tn = traitName || ((id) => id);
  const words = commentsFor(model, { viewer: viewerId });
  const remote = ratings?.others?.[String(personId)] || null;

  /* ─── про себя ─── */
  const mine = s.self ? (ratings?.mine?.comments || words.mine) : [];
  /* ─── про другого ─── */
  const mark = remote ? remote.mark : s.mark;
  const marks = remote ? remote.count : s.marks;
  const setupMark = remote ? remote.setup?.mark ?? null : s.setup.mark;
  const setupMarks = remote ? remote.setup?.count ?? 0 : s.setup.marks;
  const aboutSetup = (remote ? remote.comments : words.others[String(personId)] || [])
    .filter((c) => c.kind === "setup");

  return (<div>
    {s.self ? (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 8 }}>
          {SELF_HIDDEN}. Здесь — то, что вам написали: скрытые комментарии и
          опубликованные, без имени.
        </div>
        <div style={{ ...S.lbl, marginBottom: 4 }}>комментарии вам</div>
        <Words list={mine} empty="Адресованных вам комментариев пока нет." />
      </div>
    ) : (<>
      <div className="flex flex-wrap gap-2" style={{ marginBottom: 10 }}>
        <Fig label={`средняя оценка · ${marks} опубликованных`}
          color={markColor(mark)}
          value={mark == null ? "—" : round1(mark)} />
        <Fig label={`укладывается в срок · ${s.timed} со сроком`}
          value={s.onTime == null ? "—" : `${Math.round(s.onTime * 100)}%`} />
        <Fig label="принятых работ" value={s.done} />
        <Fig label="часов по факту" value={round1(s.hours)} />
        <Fig label={`оценка постановки · ${setupMarks} опубликованных`}
          color={markColor(setupMark)}
          value={setupMark == null ? "—" : round1(setupMark)} />
      </div>
      {!!s.pending && (
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
          Ещё {s.pending} оцен{s.pending === 1 ? "ка ждёт" : "ки ждут"} публикации:
          оценка публикуется без имени и только когда по ней нельзя узнать,
          кто её поставил.
        </div>)}
      {!!aboutSetup.length && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ ...S.lbl, marginBottom: 4 }}>о постановке задач</div>
          <Words list={aboutSetup} empty="" />
        </div>)}
    </>)}

    {!s.total ? (
      <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
        {s.self
          ? "Вы ещё ничего не сдавали."
          : "Ещё ничего не сдавал: ни оценки, ни срока — это «неизвестно», а не «плохо»."}
      </div>
    ) : (<>
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
                {r.mark != null ? `${r.mark}/${MARK_MAX}`
                  : r.pending && !s.self ? "оценка ещё не опубликована" : "принято"}</span>
            ) : (
              <span style={{ fontSize: 11, color: WARN }}>вернули</span>)}
          </div>
          {r.title && r.title !== r.func && (
            <div style={{ fontSize: 11.5, color: C.text }}>{r.title}</div>)}
          <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.6 }}>
            {when(r.start)} → сдано {when(r.at)}
            {r.end ? ` · срок ${when(r.end)}` : " · срок не ставили"}
            {" · "}{round1(r.hours)} ч
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
          {/* Слова проверяющего — без имени, как и оценка. Скрытые видит
              только тот, кому их писали. */}
          {r.comment && (
            <div style={{ fontSize: 11.5, marginTop: 4, padding: "4px 7px",
              background: C.panel2, borderRadius: 6, borderLeft: `2px solid ${markColor(r.mark)}` }}>
              <span style={{ color: C.muted }}>проверяющий
                {r.hidden ? " · скрытый · только вам" : ""}: </span>{r.comment}
            </div>)}
        </div>))}
    </>)}
  </div>);
}
