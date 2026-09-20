import React, { useMemo, useState } from "react";
import { C, OK, WARN, BAD, NEU, ACC, S, btn, nm } from "./ui.jsx";
import { ChatButton, Discussion, RateButton, RateModal, STATUSES, TaskSetup, funcLabel,
  lackOf, markOf, newMark, newMessage, roleOf, whyNotSet }
  from "./TasksBoard.jsx";
import { inTime, lastSubmission } from "../lib/workers.js";
import { leftInUnit, timeLeft } from "../lib/funcs.js";
import { unitsOf } from "../lib/units.js";
import { givenUnits, tookUnits } from "../lib/taskUnits.js";
import { MatList } from "./UnitLinks.jsx";

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

/* Поле карточки: «название: текст», каждое своей строкой (владелец,
   2026-09-20). Пустое названо словами — иначе строка читалась бы как
   «поля нет», а не «оно пустое». */
function Row({ label, children }) {
  return (
    <div style={{ fontSize: 11.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
      <span style={{ color: C.muted }}>{label}: </span>{children}
    </div>);
}

/* Полоса времени до срока (владелец, 2026-09-20): зелёная, пока времени
   много; жёлтая, когда осталось меньше половины; красная — меньше 20%.
   Длина полосы — сама доля: чем меньше осталось, тем короче. */
function TimeBar({ task, func }) {
  const left = timeLeft(task);
  if (!left) {
    return (
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>
        до конца срока: срок не назначен</div>);
  }
  /* Остаток — в единицах срока функции (владелец, 2026-09-20): работа
     мерена днями — и остаток в днях. */
  const text = left.left > 0 ? leftInUnit(left.left, func?.durUnit) : "срок прошёл";
  const color = left.tone === "bad" ? BAD : left.tone === "warn" ? WARN : OK;
  return (
    <div style={{ marginBottom: 8 }} aria-label={`до конца срока: ${text}`} data-tone={left.tone}>
      <div style={{ fontSize: 11, color, marginBottom: 3 }}>до конца срока: {text}</div>
      <div style={{ height: 6, borderRadius: 3, background: C.ink, border: `1px solid ${C.line}`,
        overflow: "hidden" }}>
        <div data-bar="" style={{ width: `${Math.round(left.share * 100)}%`, height: "100%",
          background: color, borderRadius: 3 }} />
      </div>
    </div>);
}

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
function Card({ t, dim, openId, setOpenId, note, setNote,
  funcs, traits, entities, nameOf, meId, onAccept, onReturn, onChat, onRate,
  extra = null, units = [] }) {
    const on = openId === t.id;
    const sub = lastOf(t);
    const unitName = (id) => traits.find((x) => x.id === id)?.unit || "ед.";
    const f = funcs.find((x) => x.id === t.funcId) || null;
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
          {/* Обсуждение — на самой плашке (владелец, 2026-09-20): чтобы
              увидеть непрочитанное, задачу не надо раскрывать. */}
          <ChatButton task={t} meId={meId} onOpen={onChat}
            style={{ padding: "2px 8px", fontSize: 10.5 }} />
          <span style={{ fontSize: 11, color: C.muted }}>{on ? "▾" : "▸"}</span>
        </div>

        {on && (
          <div style={{ marginTop: 8 }}>
            {/* Каждое поле — своей строкой и со своим названием (владелец,
                2026-09-20: «всё должно быть написано через двоеточие:
                название поля, двоеточие, текст, и каждое новое поле должно
                быть на новой строке»). Прежде строка шла через «·», а
                описание и содержимое лежали безымянным текстом — что это,
                человек угадывал. */}
            <div aria-label="поля задачи" style={{ marginBottom: 6 }}>
              <Row label="функция">{f ? funcLabel(f, entities) : "не назначена"}</Row>
              <Row label="поставил">{nameOf ? nameOf(roleOf(t, "setter")) : (roleOf(t, "setter") || "не назначен")}</Row>
              <Row label="исполнитель">{nameOf ? nameOf(t.assignee) : (t.assignee || "не назначен")}</Row>
              <Row label="описание">{String(t.body || "").trim() || "не написано"}</Row>
              <Row label="критерии проверки">
                {(f?.checks || []).length ? "" : "не поставлены"}</Row>
              {!!(f?.checks || []).length && (
                <ul aria-label="критерии проверки"
                  style={{ margin: "0 0 2px", paddingLeft: 18, fontSize: 11.5, lineHeight: 1.6 }}>
                  {f.checks.map((c, i) => (<li key={`${i}:${c}`}>{c}</li>))}
                </ul>)}
              {/* Даты на месте прежнего «Сдачи ещё не было» (владелец,
                  2026-09-20): когда задачу поставили и когда её ждут. */}
              <Row label="поставлена">{t.setAt ? fmtDT(t.setAt) : "не записано"}</Row>
              <Row label="сдать до">{t.end ? fmtDT(t.end) : "срок не назначен"}</Row>
            </div>

            {/* У готовой задачи срока не осталось — полоски нет (владелец,
                2026-09-20). */}
            {!sub && t.status !== "done" && (
              <TimeBar task={t} func={funcs.find((f) => f.id === t.funcId)} />)}
            {/* Сдача — четырьмя вещами и без лишних слов (владелец,
                2026-09-20): сколько ушло, когда сдано, отчёт и материалы.
                Чисел «взято: заявки 2» тут больше нет — есть сами вещи. */}
            {(t.submissions || []).map((sb) => (
              <div key={sb.id} style={{ background: C.panel2, border: `1px solid ${C.line}`,
                borderRadius: 8, padding: 8, marginBottom: 6 }}>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 12, fontWeight: 600, color: OK, flex: 1 }}>
                    ушло {nm(sb.hours)} ч</span>
                  <span style={{ fontSize: 10, color: C.muted }}>{fmtDT(sb.at)}</span>
                </div>
                {!!String(sb.text || "").trim() && (<>
                  <div style={{ ...S.lbl, marginTop: 6 }}>отчёт</div>
                  <div style={{ fontSize: 11.5, marginTop: 2, lineHeight: 1.5,
                    whiteSpace: "pre-wrap" }}>{sb.text}</div>
                </>)}
                {/* Материалы сдачи — вещами, а не числом: что взяли и что
                    выдали, по строке на вещь. Строки выданного есть только
                    у последней сдачи: результат — то, что сдали в последний
                    раз. */}
                {sb.id === sub?.id && (() => {
                  const took = tookUnits(units, sb);
                  const given = givenUnits(units, t, sb);
                  const one = (list) => (list[0] ? unitName(list[0].trait) : "ед.");
                  return (
                    <div style={{ marginTop: 6 }}>
                      <div style={S.lbl}>материалы</div>
                      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>взято</div>
                      <MatList units={took} unitName={one(took)} label="взято" />
                      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6 }}>выдано</div>
                      <MatList units={given} unitName={one(given)} label="выдано" />
                    </div>);
                })()}
              </div>))}

            {/* Оценка — исполнителю, своей кнопкой и своим окном
                (владелец, 2026-09-20). Приём работы ею больше не держится:
                принять можно молча, вернуть — с текстом доработки. */}
            <div className="flex flex-wrap gap-2" style={{ marginBottom: 8 }}>
              <RateButton task={t} meId={meId} to={t.assignee} onOpen={onRate} />
            </div>

            {t.status === "review" && (
              <>
                {sub && inTime(t, sub) != null && (
                  <div style={{ fontSize: 10.5, marginBottom: 6,
                    color: inTime(t, sub) ? OK : BAD }}>
                    {inTime(t, sub) ? "сдано в срок" : "сдано после срока"}</div>)}
                <input value={note} placeholder="что доработать — при возврате обязательно"
                  aria-label="что доработать"
                  onChange={(e) => setNote(e.target.value)}
                  style={{ ...S.inp, marginBottom: 6 }} />
                <div className="flex flex-wrap gap-2">
                  <button style={btn(true, OK)}
                    onClick={() => { onAccept(t, note); setNote(""); setOpenId(null); }}>
                    Принять</button>
                  <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
                    disabled={!note.trim()}
                    title={note.trim() ? "" : "Напишите, что доработать"}
                    onClick={() => { onReturn(t, note); setNote(""); setOpenId(null); }}>
                    Вернуть в бэклог</button>
                </div>
              </>)}
            {extra}
          </div>)}
      </div>);
  }

export default function ReviewBoard({ tasks = [], traits = [], entities = [], funcs = [],
  meId, isOwner, onAccept, onReturn, nameOf, setTasks, people = [], canAssign = true,
  published, onSay, onSeen, onRate, onSetup, onDelete, factors = [], materials = [],
  ratings = null }) {
  const [openId, setOpenId] = useState(null);
  /* ─── обсуждение ───
     Разговор один на задачу и открывается с её плашки. Открыли —
     непрочитанного больше нет, и метка уезжает на сервер: считаться она
     должна одинаково на всех устройствах. */
  const [chatId, setChatId] = useState(null);
  const chatTask = tasks.find((t) => t.id === chatId) || null;
  const mark_ = (t) => ({ ...(t.seenBy || {}),
    ...(meId == null ? {} : { [String(meId)]: new Date().toISOString() }) });
  const openChat = (t) => {
    setChatId(t.id);
    setTasks?.((p) => p.map((x) => (x.id === t.id ? { ...x, seenBy: mark_(x) } : x)));
    onSeen?.(t);
  };
  /* Оценка — окном: звёзды, отзыв и его видимость. Проверяющий оценивает
     исполнителя; себе не ставят, и кнопка тогда не нажимается. */
  const [rateId, setRateId] = useState(null);
  const rateTask = tasks.find((t) => t.id === rateId) || null;
  const openRate = (t) => setRateId(t.id);
  const rate = (t, { mark, text, pub }) => {
    const to = t.assignee;
    const row = newMark({ to, mark, text, pub }, meId);
    setTasks?.((p) => p.map((x) => (x.id === t.id
      ? { ...x, marks: [...(x.marks || []).filter((m) => !(String(m.by) === String(meId)
        && String(m.to) === String(to))), row] }
      : x)));
    onRate?.(t, { to, mark, text, pub });
  };
  const say = (t, text) => {
    const m = newMessage(text, meId);
    setTasks?.((p) => p.map((x) => (x.id === t.id
      ? { ...x, chat: [...(x.chat || []), m],
        seenBy: { ...(x.seenBy || {}), ...(meId == null ? {} : { [String(meId)]: m.at }) } }
      : x)));
    onSay?.(t, text);
  };
  /* Единицы считаются один раз на всю вкладку: карточек много, а список
     у них общий — по нему ищут и взятое, и выданное. */
  const units = useMemo(() => unitsOf({ tasks, funcs, materials }), [tasks, funcs, materials]);
  const [note, setNote] = useState("");
  // Скрыто ли решение — отметка и слова разом. Публично по умолчанию:
  // приём — это ответ о работе, и прятать его — решение, а не привычка.
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
  /* ─── отозвать из бэклога ───

     Владелец (2026-09-19): «на вкладке проверки должна быть возможность
     отозвать те задачи, которые в бэклоге, для редактирования». Задача
     возвращается в «ждут постановки» с пометкой `held`: без неё
     поставленная сама собой задача тут же уехала бы обратно в бэклог, и
     переставить её было бы нечем. Взятую в работу не отзывают — сперва
     «Отменить» на доске: отобрать работу у того, кто её делает, отзыв не
     вправе. */
  const recallable = (t) => ["backlog", "deferred"].includes(t.status)
    && t.taken !== true && !(t.submissions || []).length;
  const recall = (t) => {
    const patch = { status: "wait", held: true, taken: false };
    setTasks?.((p) => p.map((x) => (x.id === t.id ? { ...x, ...patch } : x)));
    if (typeof onSetup === "function") Promise.resolve(onSetup(t, patch)).catch(() => {});
    setSetupId(t.id);
  };
  const recallRow = (t) => (recallable(t) ? (
    <div className="flex gap-2" style={{ alignItems: "center", marginTop: 8 }}>
      <span style={{ flex: 1 }} />
      <button style={{ ...btn(false), padding: "2px 8px", fontSize: 10.5 }}
        aria-label={`отозвать задачу ${t.title}`}
        onClick={(e) => { e.stopPropagation(); recall(t); }}>Отозвать</button>
    </div>) : null);
  const killRow = (t, style = { marginTop: 8 }) => (canKill(t, { isOwner }) ? (
    <div className="flex gap-2" style={{ alignItems: "center", ...style }}>
      <span style={{ flex: 1 }} />
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
  /* Остальная работа — не общей кучей, а по состояниям (владелец,
     2026-09-19): «должно показываться, какие задачи в бэклоге, какие в
     работе, по каким дедлайн, какие готовые». Тот, кто ставит и
     принимает, видит по этим разделам, где работа стоит, а где идёт. */
  const REST = [
    { id: "backlog", title: "в бэклоге", states: ["backlog", "deferred"], color: NEU },
    { id: "progress", title: "в работе", states: ["progress"], color: ACC },
    { id: "deadline", title: "дедлайн", states: ["deadline"], color: BAD },
  ];
  const restGroups = REST.map((g) => ({ ...g,
    rows: mine.filter((t) => g.states.includes(t.status)) }));

  /* ─── очередь постановки ───
     Постановка и приём — работа одного и того же человека: не того, кто
     делает. Поэтому они рядом, на одной вкладке, а не разнесены по двум.

     Задачи сюда приходят из применённых целей: у них есть функция и срок,
     но нет ни людей, ни содержимого — это и предстоит назвать. Владельцу
     видно всё непоставленное (в задаче из цели постановщик ещё не назван),
     остальным — то, где постановщик они. */
  /* Ждут постановки только те, что поставить МОЖНО и НУЖНО (владелец,
     2026-09-20). «Нужно» — задача ещё не поставлена и ставит её этот
     человек. «Можно» — ресурсов на неё хватает: пока их нет, ставить
     нечего, и строка с «не хватает ресурсов» была не очередью, а списком
     того, чего сейчас сделать нельзя. Незаполненность (люди, срок,
     содержимое) задачу не прячет: её тут и заполняют. */
  const toSet = useMemo(() => tasks.filter((t) => t.status === "wait"
    && (isOwner || String(roleOf(t, "setter") || "") === String(meId))
    && !lackOf(t, funcs, traits, tasks, factors).length),
  [tasks, meId, isOwner, funcs, traits, factors]);
  const setup = toSet.find((t) => t.id === setupId) || null;

  return (
    <div>
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
            Ничего не ждёт постановки.
          </div>)}
        {/* Форма постановки раскрывается ПОД своей задачей, а не общим
            блоком в самом низу страницы. Внизу она отвечала бы на вопрос
            «какую задачу мы сейчас ставим» тем, что человек должен
            вспомнить сам, — а он только что на неё нажал. */}
        {toSet.map((t) => {
          const why = whyNotSet(t, funcs, traits, tasks, factors);
          const on = setupId === t.id;
          return (
            /* Каждая задача — своей формой, а не строкой за полоской
               (владелец, 2026-09-19): полоска разделяла задачи, но не
               показывала, где одна кончается и начинается другая. */
            <div key={t.id} style={{ background: C.panel2,
              border: `1px solid ${on ? ACC : C.line}`, borderRadius: 8,
              padding: 8, marginTop: 8 }}>
              <div className="flex flex-wrap gap-2"
                style={{ alignItems: "center", cursor: "pointer" }}
                onClick={() => setSetupId(on ? null : t.id)}>
                <span style={{ fontSize: 12.5, fontWeight: 600, flex: "1 1 140px" }}>
                  {t.title}</span>
                <span style={{ fontSize: 10.5, color: C.muted }}>
                  {funcLabel(funcs.find((f) => f.id === t.funcId), entities)}</span>
                {why && <span style={{ fontSize: 10.5, color: WARN }}>{why}</span>}
                {/* Кнопка есть и здесь — неактивная: обсуждение
                    открывается, когда задачу поставят. */}
                <ChatButton task={t} meId={meId} onOpen={openChat}
                  style={{ padding: "2px 8px", fontSize: 10.5 }} />
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
        note={note} setNote={setNote} meId={meId}
        funcs={funcs} traits={traits} entities={entities}
        nameOf={nameOf} onAccept={onAccept} onReturn={onReturn} units={units}
        onChat={openChat} onRate={openRate} extra={killRow(t)} />)}

      {restGroups.filter((g) => g.rows.length).map((g) => (
        <React.Fragment key={g.id}>
          <div className="flex items-center gap-2" style={{ margin: "12px 0 6px" }}>
            <span style={S.lbl}>{g.title}</span>
            <span style={{ fontSize: 10.5, color: g.color }}>{g.rows.length}</span>
          </div>
          {g.rows.map((t) => (
            <Card key={t.id} t={t} dim openId={openId} setOpenId={setOpenId}
        note={note} setNote={setNote} meId={meId}
              funcs={funcs} traits={traits} entities={entities}
              nameOf={nameOf} onAccept={onAccept} onReturn={onReturn} units={units}
              onChat={openChat} onRate={openRate} extra={<>{recallRow(t)}{killRow(t)}</>} />))}
        </React.Fragment>))}

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
        note={note} setNote={setNote} meId={meId}
            funcs={funcs} traits={traits} entities={entities}
            nameOf={nameOf} onAccept={onAccept} onReturn={onReturn} units={units}
            onChat={openChat} onRate={openRate} extra={killRow(t)} />)}
        </>)}

      {/* Обсуждение — окном поверх вкладки: разговор один на задачу, и
          открывается он с её плашки. */}
      {chatTask && (
        <Discussion task={chatTask} meId={meId} nameOf={nameOf}
          onSend={(text) => say(chatTask, text)} onClose={() => setChatId(null)} />)}

      {rateTask && (
        <RateModal task={rateTask}
          whom={nameOf ? nameOf(rateTask.assignee) : String(rateTask.assignee ?? "")}
          mine={markOf(rateTask, meId, rateTask.assignee)}
          onSend={(m) => rate(rateTask, m)} onClose={() => setRateId(null)} />)}
    </div>);
}
