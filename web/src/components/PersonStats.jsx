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
   которые ему адресованы: скрытые отзывы и опубликованные анонимные.
   Правило живёт не здесь, а в `visibleStats()` — карточка только
   спрашивает.

   ─── чего здесь нет ───

   Никаких сводных «баллов эффективности»: они складывают несравнимое и
   выглядят точнее, чем есть. Есть несколько величин, каждая со своим
   смыслом, и список работ, по которому их можно проверить руками.
   ════════════════════════════════════════════════════════════════ */

const markColor = (m) => (m == null ? C.muted : m >= 4 ? OK : m >= 3 ? WARN : BAD);

/* НА СКОЛЬКО ОПОЗДАЛИ (владелец, 2026-09-21: «в срок или с задержкой; если
   с задержкой, то с какой»). Считается от срока до сдачи и пишется
   крупными единицами: «2 дня 5 ч» понятнее, чем «53 ч», а минуты нужны
   только тогда, когда часов нет вовсе. */
const MINUTE = 60 * 1000;
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
};
export function lateBy(row) {
  const end = Date.parse(row?.end || "");
  const at = Date.parse(row?.at || "");
  if (!Number.isFinite(end) || !Number.isFinite(at) || at <= end) return "";
  const mins = Math.round((at - end) / MINUTE);
  const days = Math.floor(mins / (60 * 24));
  const hours = Math.floor((mins % (60 * 24)) / 60);
  const rest = mins % 60;
  if (days) return `${days} ${plural(days, "день", "дня", "дней")}${hours ? ` ${hours} ч` : ""}`;
  if (hours) return `${hours} ч${rest ? ` ${rest} мин` : ""}`;
  return `${mins} ${plural(mins, "минута", "минуты", "минут")}`;
}
const round1 = (v) => Math.round(v * 10) / 10;

/** Фраза, которая заменяет человеку его же рейтинг. Одна на всё приложение. */
export const SELF_HIDDEN = "Свои оценки не показываются: рейтинг работает на того, кто поручает";

/** Одно число сводки: крупная величина и подпись под ней. */
function Fig({ value, label, color }) {
  return (
    <div style={{ flex: "1 1 90px", background: C.panel2, border: `1px solid ${C.line}`,
      borderRadius: "var(--radius-sm)", padding: "var(--space-4) var(--space-8)" }}>
      <div style={{ fontSize: "var(--fs-title)", fontWeight: 700, color: color || C.text }}>{value}</div>
      <div style={{ fontSize: "var(--fs-hint)", color: C.muted, lineHeight: 1.4 }}>{label}</div>
    </div>);
}

/** Слова оценки — без имени: вид оценки и текст, у скрытых — пометка. */
function Words({ list, empty }) {
  if (!list.length) {
    return <div style={{ fontSize: "var(--fs-hint)", color: C.muted, lineHeight: 1.5 }}>{empty}</div>;
  }
  return (<div>
    {list.map((c, i) => (
      <div key={i} style={{ fontSize: "var(--fs-hint)", marginTop: "var(--space-4)", padding: "var(--space-4) var(--space-8)",
        background: C.panel2, borderRadius: "var(--radius-sm)", borderLeft: `2px solid ${C.line}`,
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
  published, viewerId, ratings, managed = false }) {
  const model = { tasks, funcs, published };
  const s = visibleStats(model, personId, viewerId);
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
      <div style={{ marginBottom: "var(--space-8)" }}>
        <div style={{ fontSize: "var(--fs-hint)", color: C.muted, lineHeight: 1.6, marginBottom: "var(--space-8)" }}>
          {SELF_HIDDEN}. Здесь — отзывы о вас: скрытые и опубликованные,
          без имени.
        </div>
        <div style={{ ...S.lbl, marginBottom: "var(--space-4)" }}>отзывы о вас</div>
        <Words list={mine} empty="Отзывов о вас пока нет." />
      </div>
    ) : (<>
      <div className="flex flex-wrap gap-2" style={{ marginBottom: "var(--space-8)" }}>
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
        <div style={{ fontSize: "var(--fs-hint)", color: C.muted, marginBottom: "var(--space-8)", lineHeight: 1.5 }}>
          Ещё {s.pending} оцен{s.pending === 1 ? "ка ждёт" : "ки ждут"} публикации:
          оценка публикуется без имени и только когда по ней нельзя узнать,
          кто её поставил.
        </div>)}
      {!!aboutSetup.length && (
        <div style={{ marginBottom: "var(--space-8)" }}>
          <div style={{ ...S.lbl, marginBottom: "var(--space-4)" }}>о постановке задач</div>
          <Words list={aboutSetup} empty="" />
        </div>)}
      {/* Страница, которую человек ВЕДЁТ (виртуальный сотрудник): слова,
          адресованные ей, показываются целиком — читать их больше некому.
          В строках работ они не покажутся: там зритель — посторонний. */}
      {managed && (
        <div style={{ marginBottom: "var(--space-8)" }}>
          <div style={{ ...S.lbl, marginBottom: "var(--space-4)" }}>отзывы о нём</div>
          <Words list={remote?.comments || []} empty="Отзывов о нём пока нет." />
        </div>)}
    </>)}

    {!s.total ? (
      <div style={{ fontSize: "var(--fs-hint)", color: C.muted, lineHeight: 1.6 }}>
        {s.self
          ? "Вы ещё ничего не сдавали."
          : "Ещё ничего не сдавал: ни оценки, ни срока — это «неизвестно», а не «плохо»."}
      </div>
    ) : (<>
      <div style={{ fontSize: "var(--fs-hint)", color: C.muted, textTransform: "uppercase",
        letterSpacing: "var(--ls-caps)", marginBottom: "var(--space-4)" }}>работы</div>

      {s.rows.map((r) => (
        <div key={r.task} style={{ borderTop: `1px solid ${C.line}`, padding: "var(--space-8) 0" }}>
          <div className="flex flex-wrap items-center gap-2">
            <span style={{ fontSize: "var(--fs-body)", fontWeight: 600, flex: "1 1 140px" }}>
              {r.title || r.func}</span>
            <span style={{ fontSize: "var(--fs-hint)", fontWeight: 700, color: r.done ? OK : WARN }}>
              {r.done ? "принято" : "не принято"}</span>
          </div>
          {r.inTime !== null && (
            <div style={{ fontSize: "var(--fs-hint)", color: r.inTime ? OK : BAD }}>
              {r.inTime ? "в срок" : `с задержкой: ${lateBy(r)}`}</div>)}
        </div>))}
    </>)}
  </div>);
}
