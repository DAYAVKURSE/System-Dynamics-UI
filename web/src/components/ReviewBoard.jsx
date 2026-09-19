import React, { useMemo, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, nm } from "./ui.jsx";
import { HiddenSwitch, STATUSES, TaskSetup, canSeeComment, funcLabel, roleOf, whyNotSet }
  from "./TasksBoard.jsx";
import { MARK_MAX, MARK_MIN, inTime, lastSubmission } from "../lib/workers.js";
import { reportSrc } from "../storage.js";
import { unitsOf } from "../lib/units.js";
import { givenUnits, tookUnits } from "../lib/taskUnits.js";
import { UnitList } from "./UnitLinks.jsx";

/* ════════════════════════════════════════════════════════════════
   ПРОВЕРКА

   Здесь только то, что проверяет именно этот человек: задачи, где он
   назначен проверяющим и по которым уже есть сдача. Принять — задача
   становится готовой; вернуть — уходит обратно в работу с комментарием.

   Решение «принято» отделено от «сдано» намеренно: принятая сдача идёт в
   расчёт как фактическое выполнение функции, и если бы исполнитель
   принимал сам себя, фактом стало бы его собственное заявление.

   Принять — значит поставить оценку и написать, за что. Обе вещи
   обязательны: оценка без слов не говорит, что исправить, а слова без
   оценки не складываются в историю человека. Из этих оценок и растёт его
   рейтинг, по которому постановщик выбирает, кому поручить следующую
   работу, — поэтому «принял молча» здесь не бывает.

   Оценка при этом публикуется БЕЗ ИМЕНИ и не сразу: только когда по ней
   нельзя вычислить, кто её поставил (сервер, `lib/ratings.js`). Решение
   можно сделать скрытым — переключатель один на отметку и слова: скрытую
   отметку видит только проверяющий (в средние она входит), скрытые слова —
   он и исполнитель. Публично — по умолчанию: приём — это ответ о работе,
   и прятать его — решение, а не привычка.

   Оценку постановки из сдачи проверяющему НЕ показывают: она про
   постановщика и доходит до него по тем же правилам публикации, а не
   через третьего.

   ─── готовые живут здесь ───

   С доски задач колонка «Готово» убрана: доска отвечает на вопрос «что
   мне делать», и сделанное отвечало на другой. Принял работу этот
   человек — ему и видеть результат, поэтому готовые стоят здесь,
   отдельным разделом.

   ─── удалить можно только то, что ещё не начали ───

   Задачу, которую никто не взял, удаляют насовсем: терять нечего — ни
   сдач, ни оценок, ни часов по ней нет. А у начатой всё это есть, и
   стереть её значило бы сделать вид, что работы не было. Поэтому у
   взятой в работу, сданной и принятой кнопки удаления нет вовсе.
   ════════════════════════════════════════════════════════════════ */

const fmtDT = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v)
    : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit",
      year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const lastOf = lastSubmission;

/**
 * Удалить задачу — только пока её не начали.
 *
 * У неначатой терять нечего: ни сдач, ни оценок, ни часов по ней нет. У
 * начатой всё это есть, и стереть её значило бы сделать вид, что работы
 * не было, — поэтому кнопки там нет вовсе, а не «есть, но откажет».
 *
 * Подтверждение короткое и на месте: удаление необратимо, но и
 * рассказывать о нём нечего — задача пустая.
 */
/* Владелец (2026-09-13) — ещё и то, что ждёт проверки, и готовое: модель
   его, и решать, нужна ли в ней эта работа, — ему. Уходят сдачи, оценки и
   выданные единицы; подтверждение так и говорит. В работе — не удаляет
   никто: сперва «Отменить» на доске, и задача вернётся в бэклог. */
const UNSTARTED = ["wait", "backlog", "deferred"];
const STARTED_KILLABLE = ["review", "done"];
export const canKill = (t, { isOwner = false } = {}) => !!t && (
  (t.taken !== true && UNSTARTED.includes(t.status) && !(t.submissions || []).length)
  || (isOwner && (UNSTARTED.includes(t.status) || STARTED_KILLABLE.includes(t.status))));
export const killStarted = (t) => !!t
  && (t.taken === true || !UNSTARTED.includes(t.status) || !!(t.submissions || []).length);

function Delete({ t, can, killId, setKillId, onKill, isOwner = false }) {
  if (!can || !canKill(t, { isOwner })) return null;
  if (killId === t.id) {
    return (
      <span className="flex gap-2" style={{ alignItems: "center" }}
        onClick={(e) => e.stopPropagation()}>
        <span style={{ fontSize: 10.5, color: BAD }}>
          {killStarted(t) ? "удалить вместе со сдачами, оценками и выданными единицами?"
            : "удалить насовсем?"}</span>
        <button style={{ ...btn(true, BAD), padding: "2px 8px", fontSize: 10.5 }}
          aria-label={`да, удалить ${t.title}`}
          onClick={(e) => { e.stopPropagation(); onKill(t); }}>Да</button>
        <button style={{ ...btn(false), padding: "2px 8px", fontSize: 10.5 }}
          aria-label={`оставить ${t.title}`}
          onClick={(e) => { e.stopPropagation(); setKillId(null); }}>Оставить</button>
      </span>);
  }
  return (
    <button style={{ ...btn(false), padding: "2px 8px", fontSize: 10.5, color: BAD,
      borderColor: "#5A2436" }}
      aria-label={`удалить задачу ${t.title}`}
      onClick={(e) => { e.stopPropagation(); setKillId(t.id); }}>Удалить</button>);
}

/* Карточка вынесена из компонента намеренно: объявленная внутри рендера,
   она пересоздавалась бы каждый раз, и поле комментария теряло бы фокус
   на каждой букве. */
function Card({ t, dim, openId, setOpenId, note, setNote, mark, setMark, hidden, setHidden,
  funcs, traits, entities, nameOf, meId, onAccept, onReturn, extra = null, units = [] }) {
    const on = openId === t.id;
    const sub = lastOf(t);
    const unitName = (id) => traits.find((x) => x.id === id)?.unit || "ед.";
    const f = funcs.find((x) => x.id === t.funcId) || null;
    const traitName = (id) => traits.find((x) => x.id === id)?.l || "(ресурс удалён)";
    const qty = (map) => Object.entries(map || {})
      .map(([id, v]) => `${traitName(id)} ${nm(v)}`).join(", ") || "—";
    const st = STATUSES.find((s) => s.id === t.status);
    return (
      <div style={{ ...S.card, marginBottom: 8, opacity: dim ? 0.65 : 1,
        borderColor: on ? ACC : C.line }}>
        <div className="flex flex-wrap gap-2" style={{ alignItems: "center", cursor: "pointer" }}
          onClick={() => { setOpenId(on ? null : t.id); setNote(""); }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: st?.color || C.muted }} />
          <span style={{ fontSize: 13, fontWeight: 600, flex: "1 1 140px" }}>{t.title}</span>
          {sub && <span style={{ fontSize: 11, color: OK }}>
            сдано за {nm(sub.hours)} ч</span>}
          <span style={{ fontSize: 10.5, color: C.muted }}>{sub ? fmtDT(sub.at) : st?.name}</span>
          <span style={{ fontSize: 11, color: C.muted }}>{on ? "▾" : "▸"}</span>
        </div>

        {on && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, lineHeight: 1.6 }}>
              {f ? funcLabel(f, entities) : "задача без функции"}
              {" · поставил: "}{nameOf ? nameOf(roleOf(t, "setter")) : (roleOf(t, "setter") || "не назначен")}
              {" · исполнитель: "}{nameOf ? nameOf(t.assignee) : (t.assignee || "не назначен")}
            </div>
            {/* Описание функции — то, что за работа вообще; содержимое
                задачи — что к этому добавил постановщик. Первое есть
                всегда, второго может не быть. */}
            {!!String(f?.about || "").trim() && (
              <div style={{ fontSize: 12, marginBottom: 6, lineHeight: 1.5,
                whiteSpace: "pre-wrap", color: C.muted }}>{f.about}</div>)}
            {/* Критерии проверки — то, по чему принимают работу (владелец, 2026-09-18). */}
            {!!(f?.checks || []).length && (
              <div aria-label="критерии проверки" style={{ marginBottom: 6 }}>
                <div style={S.lbl}>критерии проверки</div>
                <ul style={{ margin: "3px 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.5 }}>
                  {f.checks.map((c, i) => (<li key={`${i}:${c}`}>{c}</li>))}
                </ul>
              </div>)}
            {t.body && <div style={{ fontSize: 12, marginBottom: 6, lineHeight: 1.5 }}>{t.body}</div>}

            {!sub && <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 6 }}>
              Сдачи ещё не было — проверять нечего.</div>}
            {(t.submissions || []).map((sb) => (
              <div key={sb.id} style={{ background: C.panel2, border: `1px solid ${C.line}`,
                borderRadius: 8, padding: 8, marginBottom: 6 }}>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 12, fontWeight: 600, color: OK, flex: 1 }}>
                    ушло {nm(sb.hours)} ч</span>
                  <span style={{ fontSize: 10, color: C.muted }}>{fmtDT(sb.at)}</span>
                </div>
                {/* Числа сдачи — это и есть факт, который уточнит прогноз.
                    Проверяющий должен видеть их до того, как примет. */}
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>
                  взято: {qty(sb.takes)} · выдано: {qty(sb.gives)}</div>
                {/* Сами результаты — до того, как их примут: принимают
                    работу по тому, что вышло, а не по числу «1». */}
                {!!Object.keys(sb.files || {}).length && (
                  <div className="flex flex-wrap gap-2" style={{ marginTop: 4 }}>
                    {Object.entries(sb.files).map(([id, f]) => (
                      <a key={id} href={reportSrc(f)} target="_blank" rel="noreferrer"
                        style={{ fontSize: 10.5, color: ACC }}>
                        📎 {traitName(id)}: {f.name}</a>))}
                  </div>)}
                {/* Материалы сдачи — вещами, а не числом: что взяли (по
                    номерам, которые назвал исполнитель) и что выдали
                    (каждая — со скачиванием). Строки выданного есть
                    только у последней сдачи: результат — то, что сдали в
                    последний раз. */}
                {sb.id === sub?.id && (() => {
                  const took = tookUnits(units, sb);
                  const given = givenUnits(units, t, sb);
                  const byTrait = (list) => [...new Set(list.map((u) => u.trait))]
                    .map((id) => ({ trait: id, units: list.filter((u) => u.trait === id) }));
                  const takesQty = Object.entries(sb.takes || {}).filter(([, v]) => Number(v) > 0);
                  return (
                    <div style={{ marginTop: 6 }}>
                      <div style={S.lbl}>материалы</div>
                      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>взято</div>
                      {took.length ? byTrait(took).map((g) => (
                        <UnitList key={g.trait} units={g.units} traitName={traitName(g.trait)}
                          unitName={unitName(g.trait)}
                          label={`взято: ${traitName(g.trait)}`} />))
                        : <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                            {takesQty.length
                              ? `какие именно — не названо, взято: ${qty(Object.fromEntries(takesQty))}`
                              : "ничего не взято"}</div>}
                      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6 }}>выдано</div>
                      {!given.length && (
                        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                          ничего не выдано</div>)}
                      {byTrait(given).map((g) => (
                        <div key={g.trait} style={{ marginTop: 2 }}>
                          <div style={{ fontSize: 11, fontWeight: 600 }}>{traitName(g.trait)}</div>
                          <UnitList units={g.units} traitName={traitName(g.trait)}
                            unitName={unitName(g.trait)}
                            label={`выдано: ${traitName(g.trait)}`} />
                        </div>))}
                    </div>);
                })()}
                {sb.text && <div style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}>
                  {sb.text}</div>}
                {sb.file && (/^image\//.test(sb.file.type || "")
                  ? <img src={reportSrc(sb.file)} alt={sb.file.name}
                      style={{ maxWidth: "100%", borderRadius: 6, marginTop: 5,
                        border: `1px solid ${C.line}` }} />
                  : <div style={{ fontSize: 10.5, color: ACC, marginTop: 4 }}>
                      📎 {sb.file.name}</div>)}
              </div>))}

            {t.status === "review" && (
              <>
                {/* Оценка обязательна и при приёме, и при возврате: она —
                    часть истории человека, а не украшение. */}
                <div style={S.lbl}>оценка за работу</div>
                <div className="flex flex-wrap gap-2" style={{ margin: "5px 0 7px" }}>
                  {Array.from({ length: MARK_MAX - MARK_MIN + 1 }, (_, i) => MARK_MIN + i)
                    .map((v) => (
                      <button key={v} aria-label={`оценка ${v}`}
                        style={{ ...btn(mark === v, mark === v ? OK : null), minWidth: 38 }}
                        onClick={() => setMark(v)}>{v}</button>))}
                  {sub && inTime(t, sub) != null && (
                    <span style={{ fontSize: 10.5, alignSelf: "center",
                      color: inTime(t, sub) ? OK : BAD }}>
                      {inTime(t, sub) ? "сдано в срок" : "сдано после срока"}</span>)}
                </div>
                <input value={note} placeholder="за что такая оценка — обязательно"
                  aria-label="отзыв к оценке"
                  onChange={(e) => setNote(e.target.value)}
                  style={{ ...S.inp, marginBottom: 6 }} />
                {/* Один переключатель на отметку и слова: скрытую отметку
                    видит только автор (в средние она входит), скрытые слова
                    — автор и исполнитель, которому они адресованы. */}
                <div style={{ marginBottom: 6 }}>
                  <HiddenSwitch hidden={hidden} onChange={setHidden} whoElse="исполнитель" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button style={btn(true, OK)}
                    disabled={!mark || !note.trim()}
                    title={mark && note.trim() ? "" : "Поставьте оценку и напишите, за что"}
                    onClick={() => { onAccept(t, note, mark, hidden); setNote(""); setMark(0);
                      setHidden(false); setOpenId(null); }}>
                    Принять</button>
                  <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
                    disabled={!note.trim()}
                    title={note.trim() ? "" : "Напишите, что доработать"}
                    onClick={() => { onReturn(t, note, mark, hidden); setNote(""); setMark(0);
                      setHidden(false); setOpenId(null); }}>
                    Вернуть в бэклог</button>
                </div>
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
                  «Принять» переводит задачу в «Готово» — её числа идут в
                  расчёт как фактическое выполнение функции, а оценка и
                  отзыв — в историю исполнителя. Без оценки и без слов
                  принять нельзя: оценка без слов не говорит, что исправить, а
                  слова без оценки не складываются в историю. Оценка
                  публикуется без вашего имени и только когда её нельзя
                  вычислить. «Вернуть» — в бэклог с текстом доработки.
                </div>
              </>)}
            {/* Чужие скрытые слова здесь не читаются: скрытое — автору и
                адресату. Пометка «только вам» — у адресованных мне. */}
            {!!(t.comments || []).filter((c) => canSeeComment(c, meId)).length && (
              <div style={{ marginTop: 8 }}>
                <div style={S.lbl}>комментарии</div>
                {(t.comments || []).filter((c) => canSeeComment(c, meId)).map((c) => (
                  <div key={c.id} style={{ fontSize: 11.5, color: C.muted,
                    marginTop: 4, lineHeight: 1.5 }}>
                    {c.text} <span style={{ fontSize: 10 }}>
                      {c.by && nameOf ? `· ${nameOf(c.by)} ` : ""}· {fmtDT(c.at)}
                      {c.hidden ? (String(c.to) === String(meId)
                        ? " · скрытый · только вам" : " · скрытый") : ""}</span></div>))}
              </div>)}
            {extra}
          </div>)}
      </div>);
  }

export default function ReviewBoard({ tasks = [], traits = [], entities = [], funcs = [],
  meId, isOwner, onAccept, onReturn, nameOf, setTasks, people = [], canAssign = true,
  published, onComment, onDropComment, onSetup, onDelete, factors = [], materials = [],
  ratings = null }) {
  const [openId, setOpenId] = useState(null);
  /* Единицы считаются один раз на всю вкладку: карточек много, а список
     у них общий — по нему ищут и взятое, и выданное. */
  const units = useMemo(() => unitsOf({ tasks, funcs, materials }), [tasks, funcs, materials]);
  const [note, setNote] = useState("");
  const [mark, setMark] = useState(0);
  // Скрыто ли решение — отметка и слова разом. Публично по умолчанию:
  // приём — это ответ о работе, и прятать его — решение, а не привычка.
  const [hidden, setHidden] = useState(false);
  const [setupId, setSetupId] = useState(null);
  /* Какую задачу спросили удалить. Удаляет тот же, кто ставит: владелец
     или постановщик — решать, нужна ли работа, его дело. */
  const [killId, setKillId] = useState(null);
  const canDelete = canAssign;
  const kill = (t) => {
    setKillId(null);
    if (onDelete) onDelete(t);
    else setTasks?.((p) => p.filter((x) => x.id !== t.id));
  };
  /* Строка «удалить» внутри раскрытой карточки: удаляют, глядя на задачу.
     Неначатую — тот, кто ставит; начатую (ждёт проверки, готова) — только
     владелец, и подпись говорит, что уйдёт вместе с ней. */
  const killRow = (t, style = { marginTop: 8 }) => (canKill(t, { isOwner }) ? (
    <div className="flex gap-2" style={{ alignItems: "center", ...style }}>
      <span style={{ fontSize: 10.5, color: C.muted, flex: 1 }}>
        {killStarted(t)
          ? "удалить насовсем может только владелец: уйдут сдачи, оценки и выданные единицы"
          : "задача ещё не начата — её можно удалить насовсем"}</span>
      <Delete t={t} can={killStarted(t) ? isOwner : canDelete} isOwner={isOwner}
        killId={killId} setKillId={setKillId} onKill={kill} />
    </div>) : null);

  // Владельцу видно всё, что вообще ждёт проверки; остальным — только их.
  const mine = useMemo(() => tasks.filter((t) =>
    isOwner || String(roleOf(t, "reviewer") || "") === String(meId)), [tasks, meId, isOwner]);
  const waiting = mine.filter((t) => t.status === "review");
  /* Готовые — своим разделом: с доски задач их убрали, и смотрят их
     здесь, у того, кто их принимал. */
  const done = mine.filter((t) => t.status === "done");
  const rest = mine.filter((t) => !["review", "wait", "done"].includes(t.status));

  /* ─── очередь постановки ───
     Постановка и приём — работа одного и того же человека: не того, кто
     делает. Поэтому они рядом, на одной вкладке, а не разнесены по двум.

     Задачи сюда приходят из применённых целей: у них есть функция и срок,
     но нет ни людей, ни содержимого — это и предстоит назвать. Владельцу
     видно всё непоставленное (в задаче из цели постановщик ещё не назван),
     остальным — то, где постановщик они. */
  const toSet = useMemo(() => tasks.filter((t) => t.status === "wait"
    && (isOwner || String(roleOf(t, "setter") || "") === String(meId))), [tasks, meId, isOwner]);
  const setup = toSet.find((t) => t.id === setupId) || null;

  return (
    <div>
      <div style={{ ...S.card, marginBottom: 10 }}>
        <div style={S.lbl}>постановка и проверка{isOwner ? " · вы владелец, вам видно всё" : ""}</div>
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
          {isOwner
            ? "Здесь ставят задачи и принимают сдачи: и то, и другое делает не тот, кто работу делает."
            : "Здесь то, что ставите и проверяете вы. Чужие задачи сюда не попадают."}
        </div>
      </div>

      {/* Сперва то, что ещё не поручено: непоставленная задача — это работа,
          которой пока нет, и она важнее уже сделанной. */}
      <div style={{ ...S.card, marginBottom: 10 }}>
        <div className="flex items-center gap-2">
          <span style={S.lbl}>ждут постановки</span>
          <span style={{ fontSize: 10.5, color: toSet.length ? WARN : C.muted }}>
            {toSet.length}</span>
        </div>
        {!toSet.length && (
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
            Ничего не ждёт постановки: задачи приходят из применённых целей.
          </div>)}
        {/* Форма постановки раскрывается ПОД своей задачей, а не общим
            блоком в самом низу страницы. Внизу она отвечала бы на вопрос
            «какую задачу мы сейчас ставим» тем, что человек должен
            вспомнить сам, — а он только что на неё нажал. */}
        {toSet.map((t) => {
          const why = whyNotSet(t, funcs, traits, tasks, factors);
          const on = setupId === t.id;
          return (
            <div key={t.id}>
              <div className="flex flex-wrap gap-2"
                style={{ alignItems: "center", padding: "7px 0",
                  borderTop: `1px solid ${C.line}`, cursor: "pointer" }}
                onClick={() => setSetupId(on ? null : t.id)}>
                <span style={{ fontSize: 12.5, fontWeight: 600, flex: "1 1 140px" }}>
                  {t.title}</span>
                <span style={{ fontSize: 10.5, color: C.muted }}>
                  {funcLabel(funcs.find((f) => f.id === t.funcId), entities)}</span>
                {why && <span style={{ fontSize: 10.5, color: WARN }}>{why}</span>}
                <span style={{ fontSize: 11, color: C.muted }}>{on ? "▾" : "▸"}</span>
              </div>
              {on && setup && (
                <TaskSetup task={setup} tasks={tasks} funcs={funcs} traits={traits} factors={factors}
                  ratings={ratings}
                  entities={entities} people={people}
                  /* Людей назначает тот, кто ставит: постановщик этой
                     задачи — или владелец, у которого модель целиком.
                     Форма постановки — для постановщика, а не для
                     владельца (ROADMAP v1.2), и запертые выпадающие списки
                     у него делали бы «Поставить» недостижимой навсегда. */
                  canAssign={canAssign || String(roleOf(setup, "setter") || "") === String(meId)}
                  nameOf={nameOf} setTasks={setTasks} onSetup={onSetup}
                  published={published} meId={meId}
                  onClose={() => setSetupId(null)} />)}
              {/* «Удалить» — ВНУТРИ раскрытой формы, а не в строке списка:
                  удаляют, глядя на задачу, а не пробегая по заголовкам. В
                  строке кнопка стояла на пути к «развернуть» и удаляла то,
                  что ещё не открыли. */}
              {on && killRow(t, { margin: "0 0 10px" })}
            </div>);
        })}
      </div>

      {!waiting.length && (
        <div style={{ ...S.card, marginBottom: 10, fontSize: 12, color: C.muted }}>
          Ничего не ждёт проверки.</div>)}
      {waiting.map((t) => <Card key={t.id} t={t} openId={openId} setOpenId={setOpenId}
        note={note} setNote={setNote} mark={mark} setMark={setMark}
        hidden={hidden} setHidden={setHidden} meId={meId}
        funcs={funcs} traits={traits} entities={entities}
        nameOf={nameOf} onAccept={onAccept} onReturn={onReturn} units={units}
        extra={killRow(t)} />)}

      {!!rest.length && (
        <>
          <div style={{ ...S.lbl, margin: "12px 0 6px" }}>остальные задачи под вашей проверкой</div>
          {rest.map((t) => (
            <Card key={t.id} t={t} dim openId={openId} setOpenId={setOpenId}
              note={note} setNote={setNote} mark={mark} setMark={setMark}
              hidden={hidden} setHidden={setHidden} meId={meId}
              funcs={funcs} traits={traits} entities={entities}
              nameOf={nameOf} onAccept={onAccept} onReturn={onReturn} units={units}
              extra={killRow(t)} />))}
        </>)}

      {/* ─── готовые ───
          С доски задач их убрали: доска отвечает на «что мне делать».
          Принял работу этот человек — ему и видеть результат. */}
      {!!done.length && (
        <>
          <div className="flex items-center gap-2" style={{ margin: "12px 0 6px" }}>
            <span style={S.lbl}>готовые</span>
            <span style={{ fontSize: 10.5, color: OK }}>{done.length}</span>
          </div>
          {done.map((t) => <Card key={t.id} t={t} dim openId={openId} setOpenId={setOpenId}
            note={note} setNote={setNote} mark={mark} setMark={setMark}
            hidden={hidden} setHidden={setHidden} meId={meId}
            funcs={funcs} traits={traits} entities={entities}
            nameOf={nameOf} onAccept={onAccept} onReturn={onReturn} units={units}
            extra={killRow(t)} />)}
        </>)}
    </div>);
}
