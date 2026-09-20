import React, { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, C, ACC, OK, WARN, BAD, NEU, S, btn, TxtField, FoldCard } from "./ui.jsx";
import PersonStats from "./PersonStats.jsx";
import Modal from "./Modal.jsx";
import { putReportFile, reportSrc } from "../storage.js";
import { getDuty, putProfile, refuseFuncRemote, listReminders as listRemindersRemote,
  dropReminder as dropReminderRemote } from "../identity.js";
import { FormAnswers } from "./FormsPanel.jsx";
import { WEEK, WORKER_KINDS, dutyOf } from "../lib/funcs.js";
import { WARNS } from "./TasksBoard.jsx";
import { WORK_STATUSES, dayHours, hasSchedule, inWorkTime, liveStatus, scheduleOfPerson,
  scheduleText, statusOf } from "../lib/workers.js";

/* ════════════════════════════════════════════════════════════════
   ЧЕЛОВЕК · анкета и рейтинг

   Две вещи, и ровно две. АНКЕТА — то, что человек сам о себе сказал.
   РЕЙТИНГ — то, как он работал: оценки, сроки, работы, из которых он
   сложился.

   ─── вопросы задаёт роль ───

   Прежде поле было одно, «о себе»: что в нём написать, решал тот, кто
   пишет. Теперь о чём спрашивать, решает анкета, назначенная роли
   («Люди и роли»): вопросы — её, ответы — человека. Роли без анкеты
   спрашивать нечего — и формы «моя анкета» у такого человека нет вовсе,
   а не пустая. Прежнее поле `about` (PROFILE_FIELDS) остаётся в данных и
   читается как «заполнена ли анкета», но на экране его больше нет.

   ─── кто пишет ───

   Сам человек, и только свою. Про себя он знает точнее, а анкета,
   заполненная кем-то другим, была бы чужим мнением под чужим именем.
   Поэтому чужая страница здесь только читается: поле показано текстом, а
   не полем ввода, — и не потому, что «нет прав», а потому что писать там
   нечего.

   ─── чужих анкет тут нет ───

   Список «другие люди» отсюда убран. Страница отвечает на вопрос про
   ОДНОГО человека — того, которого открыли; список остальных превращал её
   в справочник и предлагал уйти с неё ровно тогда, когда её открыли,
   чтобы прочитать.
   ════════════════════════════════════════════════════════════════ */

/* Цвет статуса: свободен — зелёный, «сейчас нет» — жёлтый, «не берусь» —
   красный, «сегодня не работаю» — серый. Цвет здесь второй ответ к слову, а
   не вместо него: слово стоит рядом всегда. */
export const statusColor = (id) => (
  { ready: OK, break: WARN, off: NEU, busy: BAD }[id] || C.muted);

/**
 * Рабочий график и статус — читаются кем угодно, пишутся только своим.
 *
 * Стоят сразу под анкетой (владелец: анкета — первой) и видны всем:
 * ставить задачу тому, у кого сегодня выходной, — значит назначить срок,
 * которого никто не обещал.
 */
function Schedule({ mine, draft, setDraft, msg = "" }) {
  const sc = scheduleOfPerson(draft);
  /* Статус — по графику (lib/workers.js): в нерабочее время человек
     «сегодня не работает», в рабочее — то, что нажал. Нажимает он
     по-прежнему свой статус; график лишь говорит, когда тот действует. */
  const work = inWorkTime(sc);
  const live = liveStatus(sc);
  const st = statusOf(live);

  /* ─── дни: одиночное нажатие — посмотреть, двойное — править ───

     Владелец (2026-09-13): «при двойном нажатии на день или несколько
     дней они должны становиться жёлтыми, и время редактируется только под
     них, не трогая остальные; под временем — кнопка «Принять», которая
     завершает режим редактирования; при одинарном нажатии просто
     показывается время работы для этого дня, но не редактируется».

     Набор жёлтых (`editing`) и просматриваемый день (`viewed`) — состояние
     экрана, на сервер им ехать незачем. Двойное нажатие берёт день в набор
     или убирает из него — любой день, и выходной тоже: так его и делают
     рабочим (галочка «рабочие дни» в правке). Одиночное — только показ:
     поля с часами дня, без правки. Браузер перед двойным шлёт два
     одиночных — показ от них включается и выключается, вреда нет. */
  const [editing, setEditing] = useState([]);
  const [viewed, setViewed] = useState(null);
  const set = editing;
  const toggle = (d) => { setViewed(null); setEditing(set.includes(d) ? set.filter((x) => x !== d) : [...set, d]); };
  /* В правке одиночное нажатие берёт следующий день в набор (владелец:
     «на следующий день не нужно нажимать два раза»); вне правки — показ. */
  const tap = (d) => (set.length ? toggle(d) : setViewed((v) => (v === d ? null : d)));
  // Перед двойным браузер шлёт два одиночных: в правке они взаимно
  // отменяются, вне правки включают и выключают показ; двойное — берёт день.
  const dbl = (d) => toggle(d);
  const names = (list) => WEEK.filter((w) => list.includes(w.id)).map((w) => w.short).join(", ");
  const allOn = set.length > 0 && set.every((d) => sc.days.includes(d));
  // Поля: в правке — часы первого дня набора; в показе — часы дня; иначе общие.
  const shown = set.length ? dayHours(sc, set[0])
    : viewed != null ? dayHours(sc, viewed) : { from: sc.from, to: sc.to };
  const readOnly = !set.length && viewed != null;
  const setDays = (on) => setDraft((p) => {
    const was = scheduleOfPerson(p).days;
    const days = on ? [...new Set([...was, ...set])] : was.filter((d) => !set.includes(d));
    return { ...p, days };
  });
  const setHours = (key, value) => setDraft((p) => {
    if (!set.length) return { ...p, [key]: value };
    const cur = scheduleOfPerson(p);
    const perDay = { ...cur.perDay };
    set.forEach((d) => { perDay[d] = { ...dayHours(cur, d), [key]: value }; });
    return { ...p, perDay };
  });
  const accept = () => { setEditing([]); setViewed(null); };

  return (
    <FoldCard title={mine ? "мой рабочий график" : "рабочий график"}>

      {/* ─── форма 1: статус ─── */}
      <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8,
        padding: 8, marginTop: 6 }} aria-label="статус">
      <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase",
        letterSpacing: 0.5 }}>статус</div>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center",
        margin: "4px 0 3px" }}>
        <span style={{ width: 9, height: 9, borderRadius: 5,
          background: statusColor(live) }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: statusColor(live) }}
          aria-label="статус сейчас">{st.name}</span>
        <span style={{ fontSize: 10.5, color: C.muted }}>
          {work == null ? "· график не задан"
            : work ? "· по графику сейчас рабочее время" : "· по графику сейчас нерабочее время"}</span>
      </div>
      {mine ? (<>
        <div className="flex flex-wrap gap-2" style={{ marginTop: 5 }}>
          {WORK_STATUSES.map((x) => (
            <button key={x.id} aria-label={`статус: ${x.name}`} aria-pressed={sc.status === x.id}
              style={{ ...btn(sc.status === x.id,
                sc.status === x.id ? statusColor(x.id) : null),
              fontSize: 11, padding: "4px 8px" }}
              /* Метка момента: выбор приоритетнее графика до следующей
                 смены по нему (lib/workers.js, liveStatus). */
              onClick={() => setDraft((p) => ({ ...p, status: x.id,
                statusAt: new Date().toISOString() }))}>
              {x.name}</button>))}
        </div>
      </>) : null}
      </div>

      {/* ─── форма 2: рабочие дни и часы ─── */}
      <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8,
        padding: 8, marginTop: 8 }} aria-label="рабочие дни и часы">
      <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase",
        letterSpacing: 0.5 }}>рабочие дни</div>
      {mine ? (<>
        <div className="flex flex-wrap gap-2" style={{ marginTop: 4 }}>
          {WEEK.map((d) => {
            const on = sc.days.includes(d.id);
            const edit = set.includes(d.id);
            const view = !set.length && viewed === d.id;
            return (
              /* touchAction: двойной тап на телефоне иначе приближает
                 страницу, а не открывает правку часов. */
              <button key={d.id} aria-label={`рабочий день ${d.short}`}
                aria-pressed={on}
                style={{ ...btn(on, edit ? WARN : null), fontSize: 11,
                  padding: "4px 8px", touchAction: "manipulation",
                  ...(edit ? { color: WARN, borderColor: WARN } : {}),
                  ...(view ? { outline: `2px solid ${ACC}`, outlineOffset: 1 } : {}) }}
                onClick={() => tap(d.id)}
                onDoubleClick={() => dbl(d.id)}>{d.short}</button>);
          })}
        </div>
      </>) : (
        <div style={{ fontSize: 12, marginTop: 4,
          color: sc.days.length ? C.text : C.muted }}>
          {sc.days.length
            ? scheduleText({ ...sc, from: "", to: "", perDay: {} }, WEEK)
            : "дни не названы"}</div>)}

      {/* ─── часы ─── */}
      <div style={{ ...S.lbl, marginTop: 10 }}>время работы</div>
      {mine ? (<>
        {set.length > 0 && (
          <div className="flex flex-wrap gap-2" style={{ alignItems: "center",
            fontSize: 11, color: WARN, marginTop: 4, lineHeight: 1.5 }}>
            <span>Правятся только: {names(set)}</span>
            <label className="flex items-center gap-1" style={{ color: C.text, cursor: "pointer" }}>
              <input type="checkbox" aria-label="рабочие дни" checked={allOn}
                onChange={(e) => setDays(e.target.checked)} />
              рабочие дни
            </label>
          </div>)}
        {readOnly && (
          <div style={{ fontSize: 11, color: ACC, marginTop: 4, lineHeight: 1.5 }}>
            {sc.days.includes(viewed)
              ? `Часы для: ${names([viewed])} — только просмотр; править — двойным нажатием`
              : `${names([viewed])} — выходной`}
          </div>)}
        <div className="flex flex-wrap gap-2" style={{ alignItems: "center",
          marginTop: 4 }}>
          <span style={{ fontSize: 11.5, color: C.muted }}>с</span>
          <input type="time" aria-label="работаю с" value={shown.from}
            disabled={readOnly || (set.length > 0 && !allOn)}
            style={{ ...S.inp, flex: "0 1 120px", fontSize: 12 }}
            onChange={(e) => setHours("from", e.target.value)} />
          <span style={{ fontSize: 11.5, color: C.muted }}>до</span>
          <input type="time" aria-label="работаю до" value={shown.to}
            disabled={readOnly || (set.length > 0 && !allOn)}
            style={{ ...S.inp, flex: "0 1 120px", fontSize: 12 }}
            onChange={(e) => setHours("to", e.target.value)} />
        </div>
        {set.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <button aria-label="принять: часы дня"
              style={{ ...btn(true, WARN), fontSize: 11, padding: "3px 10px" }}
              onClick={accept}>Принять</button>
            {!allOn && (
              <span style={{ fontSize: 10.5, color: C.muted, marginLeft: 8 }}>
                выходной — часов нет; отметьте «рабочие дни», чтобы задать</span>)}
          </div>)}
        {set.length === 0 && Object.keys(sc.perDay).length > 0 && (
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
            Свои часы у: {names(Object.keys(sc.perDay).map(Number))}.
          </div>)}
      </>) : (
        <div style={{ fontSize: 12, marginTop: 4,
          color: sc.from || sc.to ? C.text : C.muted }}>
          {sc.from || sc.to
            ? scheduleText({ ...sc, days: [] }, WEEK) : "часы не названы"}</div>)}

      </div>

      {/* Пусто — это ответ «не названо», а не «все дни и круглые сутки»:
          дописать человеку семидневку за него нельзя. */}
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
        {hasSchedule(sc)
          ? `Работает: ${scheduleText(sc, WEEK)}.`
          : (mine
            ? "График не задан — значит про ваши дни и часы ничего не известно."
            : "График не задан: про дни и часы этого человека ничего не известно.")}
      </div>
      {/* График и статус — переключатели, а не форма: нажал — записано.
          Кнопки «Сохранить» у этой карточки нет, и человеку надо видеть,
          что нажатие дошло, — или что не дошло и почему. */}
      {mine && (
        <div aria-live="polite" style={{ fontSize: 10.5, marginTop: 4, lineHeight: 1.5,
          color: msg && msg !== SCHEDULE_SAVED && msg !== SCHEDULE_SAVING ? WARN : C.muted }}>
          {msg || "Дни, часы и статус сохраняются сами, при каждом нажатии."}
        </div>)}
    </FoldCard>);
}

/* Что карточка графика говорит о своём сохранении. Слова вынесены, чтобы
   тест и цвет строки сверялись с одним и тем же текстом. */
export const SCHEDULE_SAVING = "сохраняю график…";
export const SCHEDULE_SAVED = "график сохранён";
const scheduleKey = (p) => JSON.stringify(scheduleOfPerson(p));

/** Поле анкеты одно. Что в него писать — решает человек, а не форма. */
export const PROFILE_FIELDS = [
  { id: "about", name: "анкета", area: true,
    /* Подсказка — шаблон целиком: человек заполняет строки по порядку, а
       тот, кто выбирает, кому поручить работу, читает у всех одно и то же. */
    hint: [
      "Отправь текст анкеты, по следующему шаблону:",
      "",
      "1. Имя:",
      "2. Возраст:",
      "3. Город:",
      "4. Согласны ли вы нести полную ответственность, вплоть до финансовой, за правдивость предоставленной информации? (да/нет):",
      "5. Юридический статус (физлицо/самозанятый/ИП):",
      "6. Желаемая должность/должности:",
      "7. Стек или используемые в работе инструменты:",
      "8. Как вы понимаете градацию junior/middle/senior? Кратко:",
      "9. Ваш уровень:",
      "10. Какие технологии изучаете/хотели бы:",
      "11. Иностранные языки, уровень:",
      "12. Образование:",
      "13. Что такое коммерческий опыт, в вашем понимании, кратко:",
      "14. Сколько лет коммерческого опыта:",
      "15. Наиболее крупные проекты (если есть):",
      "16. Должность в них (если есть):",
      "17. Ниши, в которых работали:",
      "18. Доступных часов работы в неделю:",
      "19. Желаемая оплата в час (руб):",
      "20. Ник в телеграм:",
      "21. Другие теги для поиска анкеты:",
    ].join("\n") },
];

/* Ответы на вопросы анкет по ролям — по идентификатору вопроса. Лежат
   рядом с полем `about`, а не вместо него: поле остаётся тем, кому анкет
   по ролям не назначили. */
const answersOf = (p) => (p?.answers && typeof p.answers === "object" ? { ...p.answers } : {});

export const emptyProfile = () => ({
  ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f.id, ""])),
  ...scheduleOfPerson({}),
  answers: {},
});

/** Анкета из записи человека — в том виде, в каком её показывают. */
export const profileOf = (person = {}) => ({
  ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f.id, String(person?.[f.id] || "")])),
  ...scheduleOfPerson(person),
  answers: answersOf(person),
});

/* ─────── за сколько предупреждать ───────

   Настройка человека, а не задачи: напоминание приходит ему, и на сколько
   заранее ему удобно, знает он сам. Прежде «предупредить за» стояло в
   форме постановки, и постановщик решал за исполнителя, когда того будить.
   Целые минуты от 0 («только в момент начала») до суток; умолчание — 10,
   как было у задач. Разбор повторяет серверный (`warnOf` в orgStore.js):
   не число — умолчание, число вне отрезка прижимается к краю. */
export const WARN_DEFAULT = 10;
export const warnMinOf = (v) => {
  const n = Number(v);
  if (v == null || v === "" || !Number.isFinite(n)) return WARN_DEFAULT;
  return Math.min(1440, Math.max(0, Math.round(n)));
};
/* Варианты те же, что были у задачи, без «не предупреждать»: «пора
   начинать» расписание шлёт всегда, выбирается только, за сколько до него
   предупредить. */
export const WARN_CHOICES = WARNS.filter((w) => w.v != null);

/** Заполнена ли анкета — полем или хотя бы одним ответом на вопрос. */
export const filled = (p = {}) => PROFILE_FIELDS.some((f) => String(p[f.id] || "").trim())
  || Object.values(answersOf(p)).some((v) => String(v || "").trim());

/* `published` — реестр опубликованных оценок из модели; `ratings` — ответ
   сервера про рейтинги, если его спросили. Оба нужны только рейтингу
   ниже: анкета про них не знает. */
/* ════════════════════════════════════════════════════════════════
   ВЫПОЛНЯЕМЫЕ ЗАДАЧИ · что человеку поручено

   То же, что в воркерах актива, но собранное по ВСЕМ активам сразу:
   настройки актива человек не видит, а знать, что на нём висит, должен.

   Выбрать себе работу здесь нельзя. Поручает должность — её назначают у
   функции, и работу берёт любой воркер с такой должностью. Человек может
   только отказаться от того, в чём его уже выбрали, и вернуть отказ
   назад тем же нажатием: отказ не окончателен.
   ════════════════════════════════════════════════════════════════ */

const ROLE_NAME = Object.fromEntries(WORKER_KINDS.map((k) => [k.id, k.one]));
/* Один и тот же пустой список на все вызовы: `= []` в подписи создаёт
   новый массив на каждый отрисованный кадр, а от него считается список
   поручений — и пересчёт звал бы сам себя без конца. */
const NONE = [];

function Duty({ mine, list, busy, msg, onRefuse }) {
  // По активам: человек думает «что у меня в этом активе», а не списком
  // функций вперемешку.
  const byAsset = [];
  list.forEach((d) => {
    let g = byAsset.find((x) => x.id === d.asset);
    if (!g) { g = { id: d.asset, name: d.assetName, items: [] }; byAsset.push(g); }
    g.items.push(d);
  });
  return (
    <FoldCard title={mine ? "мои выполняемые задачи" : "выполняемые задачи"}>
      <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, margin: "6px 0 8px" }}>
        {mine
          ? "Здесь то, в чём вас выбрали. Выбрать себе работу нельзя — только отказаться."
          : "То, в чём человека выбрали на схемах."}
      </div>

      {!byAsset.length && (
        <div style={{ fontSize: 12, color: C.muted }}>
          {mine ? "Вам пока ничего не поручено." : "Ему пока ничего не поручено."}</div>)}

      {/* Каждое поручение — своей рамкой (владелец, 2026-09-13): в списке
          строк глазу не за что зацепиться, а рамка говорит «вот одно». */}
      {byAsset.map((g) => (
        <div key={g.id} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>{g.name}</div>
          {g.items.map((d) => (
            <div key={d.func} className="flex flex-wrap gap-2" data-duty={d.func}
              style={{ alignItems: "center", padding: "6px 8px", marginBottom: 6,
                background: C.panel2, border: `1px solid ${d.off ? "#5A2436" : C.line}`,
                borderRadius: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600,
                textDecoration: d.off ? "line-through" : "none",
                color: d.off ? C.muted : C.text }}>{d.name}</span>
              <span style={{ fontSize: 10.5, color: C.muted }}>
                {d.roles.map((r) => ROLE_NAME[r] || r).join(", ")}</span>
              <span style={{ flex: 1 }} />
              {d.off && <span style={{ fontSize: 10.5, color: BAD }}>отказ</span>}
              {mine && (
                <button disabled={busy}
                  aria-label={`${d.off ? "вернуть" : "отказаться"}: ${d.name}`}
                  style={{ ...btn(d.off, d.off ? null : BAD), fontSize: 11,
                    padding: "2px 8px" }}
                  onClick={() => onRefuse(d.func, !d.off)}>
                  {d.off ? "Вернуть" : "Отказаться"}</button>)}
            </div>))}
        </div>))}

      {msg && <div style={{ fontSize: 11, color: WARN, marginTop: 4 }}>{msg}</div>}
    </FoldCard>);
}

/* ─────── ОКНО КАРТИНКИ (владелец, 2026-09-20) ───────

   Нажали на кружок — открылась сама картинка, а под ней «Заменить» и
   «Удалить». Картинка ОДНА: «Заменить» кладёт новую взамен прежней, а не
   вторую рядом. Чужую картинку только смотрят — кнопок под ней нет. */
const AVATAR_MAX = 300 * 1024;

export function AvatarModal({ src, name, mine, busy, msg, onPick, onDrop, onClose }) {
  const file = useRef(null);
  return (
    <Modal title={name || "лицо"} onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
        {src ? (
          <img src={src} alt="" aria-label={`лицо крупно: ${name || "—"}`}
            style={{ maxWidth: "100%", maxHeight: "46dvh", borderRadius: 12,
              display: "block", objectFit: "contain" }} />
        ) : (
          <div aria-label="лица нет"
            style={{ width: 160, height: 160, borderRadius: "50%", background: C.panel2,
              border: `1px solid ${C.line}`, display: "flex", alignItems: "center",
              justifyContent: "center", color: C.muted, fontSize: 64, fontWeight: 700 }}>
            {String(name || "").trim().slice(0, 1).toUpperCase()}
          </div>)}
      </div>
      {mine && (
        <div className="flex flex-wrap gap-2" style={{ justifyContent: "center" }}>
          <label style={{ ...btn(true, ACC), display: "inline-block",
            cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Загружаю…" : "Заменить"}
            <input ref={file} type="file" accept="image/*" style={{ display: "none" }}
              aria-label="новое лицо" disabled={busy}
              onChange={(e) => onPick?.(e.target.files?.[0])} />
          </label>
          <button type="button" disabled={busy || !src}
            style={{ ...btn(false), color: BAD, borderColor: "#5A2436",
              opacity: src ? 1 : 0.5 }}
            onClick={() => onDrop?.()}>Удалить</button>
        </div>)}
      {msg && (
        <div role="status" style={{ fontSize: 11, color: BAD, marginTop: 8,
          textAlign: "center" }}>{msg}</div>)}
    </Modal>);
}

export default function ProfilePanel({ me, personId, people = [], tasks = [], funcs = NONE,
  entities = NONE, rolesOf, traitName, onSaved, published, ratings, onRefuseFunc,
  anon = false }) {
  // Чья анкета открыта. По умолчанию — своя: с себя человек и начинает.
  const id = personId == null ? me?.id : personId;
  const mine = String(id) === String(me?.id);
  const person = people.find((p) => String(p.id) === String(id)) || null;
  const name = person?.name || (mine ? me?.name : "") || String(id ?? "");
  /* Анкеты по ролям: свои приходят с «кто я», чужие — со списком людей.
     Есть хоть одна — показываются её вопросы, а не одно большое поле. */
  const forms = (mine ? me?.forms : person?.forms) || [];

  /* ─── откуда берётся черновик ───

     Своя анкета приходит вместе с «кто я», чужая — из списка людей. Но
     приходят они НЕ РАЗОМ: «кто я» — первым запросом, список людей —
     вторым, а «Люди и роли» перечитывают его ещё раз. Прежде черновик
     пересобирался из пропсов при каждом их изменении — и всё, что человек
     успел нажать до прихода списка, молча заменялось прежними значениями;
     заодно стиралось и «Сохранено.» сразу после сохранения.

     Поэтому черновик пересобирается из источника, но поля, которые человек
     ТРОГАЛ, остаются его: `touched` помнит их до сохранения. Сменился сам
     человек (открыли другого) — всё сбрасывается, это другая анкета. */
  const source = useMemo(
    () => (mine ? { ...emptyProfile(), ...(me?.profile || {}) } : profileOf(person)),
    [mine, me, person]);
  const sourceKey = JSON.stringify(source);
  const touched = useRef(new Set());
  const [draft, setDraft] = useState(source);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [nameMsg, setNameMsg] = useState("");
  const [faceOpen, setFaceOpen] = useState(false);
  const [faceMsg, setFaceMsg] = useState("");
  const [faceBusy, setFaceBusy] = useState(false);
  const [scMsg, setScMsg] = useState("");
  // Что сервер знает о графике сейчас: с этим сверяется автосохранение.
  const savedSchedule = useRef(scheduleKey(source));
  useEffect(() => {
    touched.current = new Set();
    setMsg(""); setScMsg("");
  }, [id, mine]);
  useEffect(() => {
    savedSchedule.current = scheduleKey(source);
    setDraft((prev) => {
      const next = { ...source };
      touched.current.forEach((k) => { if (k in prev) next[k] = prev[k]; });
      return next;
    });
  }, [sourceKey, id, mine]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* Правка помечает поле тронутым — только так оно переживёт приход
     списка людей. Помечать в самом обновлении состояния можно: добавление
     в множество повторяется без вреда. */
  const change = (fn) => setDraft((p) => {
    const n = typeof fn === "function" ? fn(p) : { ...p, ...fn };
    Object.keys(n).forEach((k) => { if (n[k] !== p[k]) touched.current.add(k); });
    return n;
  });

  /* ─── график и статус сохраняются сами ───

     Это переключатели, а не поля формы: «сегодня не работаю» нажимают и
     уходят, а кнопка «Сохранить» стояла в другой карточке и называлась
     «анкету». Нажал, перешёл на другую вкладку, вернулся — прежние
     значения: сохранить их никто не просил. Теперь каждое нажатие уезжает
     само, с короткой задержкой, чтобы пять дней подряд ушли одним
     запросом; уход со вкладки раньше задержки — отправка сразу.

     Запросы идут по цепочке: два подряд могли бы приехать на сервер в
     обратном порядке, и записанным оказалось бы прежнее. */
  const chain = useRef(Promise.resolve());
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const latest = useRef({ onSaved });
  latest.current.onSaved = onSaved;
  const pushSchedule = (p) => {
    const sc = scheduleOfPerson(p);
    if (alive.current) setScMsg(SCHEDULE_SAVING);
    chain.current = chain.current.then(async () => {
      try {
        const saved = await putProfile(sc);
        const got = saved?.profile ? { ...saved.profile } : { ...p, ...sc };
        savedSchedule.current = scheduleKey(got);
        latest.current.onSaved?.(got);
        if (alive.current) setScMsg(SCHEDULE_SAVED);
      } catch (e) {
        if (alive.current) setScMsg(`График не сохранился: ${e.message || "нет связи"}.`);
      }
    });
  };
  const pending = useRef(null);
  const draftScheduleKey = scheduleKey(draft);
  useEffect(() => {
    if (!mine || draftScheduleKey === savedSchedule.current) return undefined;
    pending.current = draft;
    const t = setTimeout(() => { pending.current = null; pushSchedule(draft); }, 400);
    return () => clearTimeout(t);
  }, [mine, draftScheduleKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  /* Размонтировали с неотправленным нажатием — отправить сейчас: иначе
     переход на другую вкладку и был бы тем самым «не сохранилось». */
  useEffect(() => () => {
    if (pending.current) { const p = pending.current; pending.current = null; pushSchedule(p); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── поручения ───

     Владелец видит модель целиком и считает список сам; позванному модель
     не видна — за него считает сервер тем же правилом. Отказ уходит туда
     же, откуда пришёл список: у владельца — правкой модели, у остальных —
     отдельным запросом. */
  const localDuty = useMemo(
    () => dutyOf({ funcs, entities }, id, { rolesOf: rolesOf || (() => []) }),
    [funcs, entities, id, rolesOf]);
  const [duty, setDuty] = useState(localDuty);
  const [dutyMsg, setDutyMsg] = useState("");
  const [dutyBusy, setDutyBusy] = useState(false);
  /* Нажатые отказы переживают приход списка: ответ сервера мог уйти
     раньше нажатия и вернуться позже — тогда список «откатил» бы то, что
     человек только что нажал. */
  const dutyTouched = useRef(new Map());
  const keep = (list) => list.map((d) => (dutyTouched.current.has(d.func)
    ? { ...d, off: dutyTouched.current.get(d.func) } : d));
  useEffect(() => { setDuty(keep(localDuty)); }, [localDuty]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { dutyTouched.current = new Map(); }, [id]);
  useEffect(() => {
    if (!mine || onRefuseFunc) return undefined;
    let on = true;
    getDuty().then((d) => { if (on) setDuty(keep(d)); }).catch(() => {});
    return () => { on = false; };
  }, [mine, id, onRefuseFunc]);   // eslint-disable-line react-hooks/exhaustive-deps

  const refuse = async (funcId, off) => {
    setDutyMsg("");
    dutyTouched.current.set(funcId, off);
    setDuty((p) => p.map((d) => (d.func === funcId ? { ...d, off } : d)));
    if (onRefuseFunc) { onRefuseFunc(funcId, off); return; }
    setDutyBusy(true);
    try { await refuseFuncRemote(funcId, off); }
    catch (e) {
      dutyTouched.current.set(funcId, !off);
      setDuty((p) => p.map((d) => (d.func === funcId ? { ...d, off: !off } : d)));
      setDutyMsg(e.message || "не удалось отправить отказ");
    }
    setDutyBusy(false);
  };

  /* Имя сохраняется своим нажатием, а не вместе с анкетой: анкеты у роли
     может и не быть, а имя есть у каждого. Пустое не принимается —
     безымянного человека не выберешь в исполнители. */
  /* Картинка человека. Своя приходит с «кто я», чужая — со списком людей;
     поле одно и то же, поэтому берётся оттуда же, откуда и анкета. */
  const face = String((mine ? me?.profile?.avatar : person?.avatar) || "");

  /* «Заменить»: картинка уезжает на диск сервера, а в анкету едет ссылка.
     Без сервера — сама картинка строкой, и тогда она должна быть
     маленькой: анкета живёт в org.json, а не на файловом диске. */
  const pickFace = async (f) => {
    if (!f) return;
    setFaceBusy(true); setFaceMsg("");
    try {
      const saved = await putReportFile(f, { kind: "avatar" });
      const src = reportSrc(saved);
      if (!src) throw new Error("не удалось прочитать картинку");
      if (!saved.url && src.length > AVATAR_MAX) {
        throw new Error(`без сервера картинка хранится в анкете — не больше ${Math.round(AVATAR_MAX / 1024)} КБ`);
      }
      const got = await putProfile({ avatar: src });
      onSaved?.(got?.profile || { ...draft, avatar: src });
      setFaceOpen(false);
    } catch (e) { setFaceMsg(e.message || "не удалось загрузить картинку"); }
    setFaceBusy(false);
  };
  /* «Удалить» оставляет ПУСТОЙ кружок (владелец, 2026-09-20): телеграмная
     назад не возвращается — её тоже убрали. */
  const dropFace = async () => {
    setFaceBusy(true); setFaceMsg("");
    try {
      const got = await putProfile({ avatar: "" });
      onSaved?.(got?.profile || { ...draft, avatar: "" });
      setFaceOpen(false);
    } catch (e) { setFaceMsg(e.message || "не удалось убрать картинку"); }
    setFaceBusy(false);
  };

  const rename = async (raw) => {
    const called = String(raw || "").trim();
    setNaming(false);
    if (!called || called === name) return;
    setBusy(true); setNameMsg("");
    try {
      const saved = await putProfile({ name: called });
      onSaved?.(saved?.profile || { ...draft, name: called });
    } catch (e) { setNameMsg(e.message || "не удалось сохранить имя"); }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true); setMsg("");
    try {
      /* Уходит и анкета, и график со статусом: их пишет тот же человек, и
         одно нажатие «Сохранить» не должно оставлять половину недописанной. */
      const saved = await putProfile({
        ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f.id, draft[f.id] ?? ""])),
        ...scheduleOfPerson(draft),
        // Ответы на вопросы — только когда вопросы есть: без анкет по ролям
        // слать пустой словарь незачем.
        ...(forms.length ? { answers: answersOf(draft) } : {}),
      });
      const got = saved?.profile || draft;
      touched.current = new Set();
      savedSchedule.current = scheduleKey(got);
      onSaved?.(got);
      setMsg("Сохранено.");
    } catch (e) { setMsg(e.message || "не удалось сохранить"); }
    setBusy(false);
  };

  return (
    <div>
      {/* Имя — шапкой страницы, а не внутри анкеты: анкеты может не быть.
          Своё имя правится здесь же, карандашом справа (владелец,
          2026-09-20): названное здесь имя приложение показывает везде. */}
      <div className="flex items-center gap-2" style={{ margin: "2px 0 8px" }}>
        {/* Кружок с лицом — ПЕРЕД именем (владелец, 2026-09-20). Нажатие
            открывает саму картинку; своя правится там же. */}
        {/* Незнакомый автор с «Рынка услуг»: вместо лица — знак
            приложения, и открывать там нечего (владелец, 2026-09-20). */}
        <Avatar src={anon ? "" : face} name={name} size={38} logo={anon}
          onClick={anon ? undefined : () => setFaceOpen(true)}
          title={anon ? "лицо скрыто" : mine ? "ваше лицо" : `лицо: ${name || "—"}`} />
        {naming ? (
          <input autoFocus aria-label="имя" defaultValue={name}
            style={{ ...S.inp, flex: 1, fontSize: 15, fontWeight: 700, padding: "3px 6px" }}
            onBlur={(e) => rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setNaming(false);
            }} />
        ) : (<>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{name || "—"}</span>
          {mine && (
            <button type="button" aria-label="изменить имя" title="Изменить имя"
              disabled={busy} onClick={() => { setNaming(true); setMsg(""); }}
              style={{ ...btn(false), fontSize: 12, padding: "2px 7px" }}>✎</button>)}
        </>)}
      </div>
      {nameMsg && (
        <div style={{ fontSize: 11, color: BAD, marginBottom: 6 }}>{nameMsg}</div>)}
      {faceOpen && (
        <AvatarModal src={face} name={name} mine={mine} busy={faceBusy} msg={faceMsg}
          onPick={pickFace} onDrop={dropFace}
          onClose={() => { setFaceOpen(false); setFaceMsg(""); }} />)}

      {/* Анкета — ПЕРВОЙ, и только когда есть что заполнять: вопросы
          задаёт анкета, назначенная роли («Люди и роли»). Ролям без анкеты
          спрашивать нечего — и формы нет вовсе, а не пустая. Своё колесо
          прокрутки: анкета бывает на двадцать вопросов, и график с
          задачами не должны уезжать за ней. */}
      {!!forms.length && (
        <FoldCard title={mine ? "моя анкета" : "анкета"}>
          <div aria-label="вопросы анкеты"
            style={{ maxHeight: "55vh", overflowY: "auto", paddingRight: 4, marginBottom: 8 }}>
            <FormAnswers forms={forms} answers={answersOf(draft)} mine={mine}
              onChange={(a) => change((p) => ({ ...p, answers: a }))} />
          </div>
          {mine && (
            <div className="flex items-center gap-2">
              <button style={btn(true, ACC)} disabled={busy} onClick={save}>
                {busy ? "Сохраняю…" : "Сохранить анкету"}</button>
              {msg && (
                <span style={{ fontSize: 11, color: msg === "Сохранено." ? OK : WARN }}>
                  {msg}</span>)}
            </div>)}
        </FoldCard>)}

      {/* График и статус: видно всем, кто открыл воркера, а не только ему. */}
      <Schedule mine={mine} draft={draft} setDraft={change} msg={scMsg} />

      {/* Выполняемые задачи — ПЕРЕД работами: сначала то, что на человеке
          висит сейчас, потом то, как он работал раньше. */}
      <Duty mine={mine} list={duty} busy={dutyBusy} msg={dutyMsg} onRefuse={refuse} />

      {/* Рейтинг — вторая половина ответа на тот же вопрос: не «кто это», а
          «как он работал». Поэтому здесь же, а не в отдельном окне.

          Про себя — без цифр: свои оценки человеку не показываются, только
          отзывы, адресованные ему (владелец: «Рейтинг и отзывы», и это
          отзывы, а не комментарии). Кто смотрит, карточке говорит `viewerId`. */}
      <FoldCard title="рейтинг и отзывы">
        <PersonStats tasks={tasks} funcs={funcs} personId={id} traitName={traitName}
          published={published} viewerId={me?.id} ratings={ratings} />
      </FoldCard>
    </div>);
}

/* ════════════════════════════════════════════════════════════════
   НАПОМИНАНИЯ · за сколько предупреждать

   Карточка в инструментах, у каждого своя. Бот шлёт напоминание «через N
   минут» и «пора начинать» тому, кому поручена задача, — и N выбирает он,
   а не постановщик. Записывается в анкету (`warnMin`) тем же маршрутом,
   что и график: это тоже сведения о человеке, а не о задаче.
   ════════════════════════════════════════════════════════════════ */
/* ─────── СПИСОК НАПОМИНАНИЙ (владелец, 2026-09-20) ───────

   По ФОРМЕ на каждое напоминание, и в форме всё строго «ключ: значение».
   Два из них — про состояние дел:

   · статус выполнения — чем занята сама задача: бэклог, в работе, сдана;
   · статус напоминания — ушло оно уже или ещё нет.

   Напоминание заводится, когда задача появляется в бэклоге, и из списка
   не пропадает, пока его не удалят кнопкой: прежде список считался из
   задач, и взятая в работу задача исчезала из него вместе с
   напоминанием — «список напоминаний пуст», хотя работа была. */
const KIND_WORD = { task: "исполнителю: пора начинать", setup: "постановщику: нужно поставить" };
const whenLocal = (isoStr) => {
  const d = new Date(isoStr || "");
  return isNaN(d.getTime()) ? "" : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit" });
};
/* Строка формы: «ключ: значение» — и никак иначе. */
const Field = ({ label, children, tone }) => (
  <div style={{ fontSize: 11.5, lineHeight: 1.7 }}>
    <span style={{ color: C.muted }}>{label}: </span>
    <span style={tone ? { color: tone } : undefined}>{children}</span>
  </div>);

export function ReminderList({ known }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const load = () => listRemindersRemote().then(setList).catch((e) => setErr(e.message));
  useEffect(() => { if (known) load(); }, [known]);   // eslint-disable-line react-hooks/exhaustive-deps
  const drop = async (id) => {
    setBusy(id); setErr("");
    try { await dropReminderRemote(id); setList((p) => (p || []).filter((r) => r.id !== id)); }
    catch (e) { setErr(e.message || "не удалось удалить"); }
    setBusy("");
  };
  if (!known) return null;
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, padding: 8,
      marginTop: 8 }} aria-label="список напоминаний">
      <div className="flex items-center gap-2">
        <span style={{ ...S.lbl, flex: 1 }}>список напоминаний</span>
        <button type="button" style={{ ...btn(false), fontSize: 11, padding: "2px 8px" }} onClick={load}>
          Обновить</button>
      </div>
      {list === null && !err && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>Загружаю…</div>}
      {err && <div style={{ fontSize: 11.5, color: BAD, marginTop: 4 }}>{err}</div>}
      {list && !list.length && (
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>Напоминаний нет.</div>)}
      {(list || []).map((r) => (
        <div key={r.id} aria-label={`напоминание ${r.id}`}
          style={{ background: C.panel, border: `1px solid ${r.hanging ? WARN : C.line}`,
            borderRadius: 8, padding: 8, marginTop: 6 }}>
          <Field label="задача">{r.title}</Field>
          <Field label="напоминание">{KIND_WORD[r.kind] || r.kind}</Field>
          {r.end && <Field label="срок">{String(r.end).replace("T", " ")}</Field>}
          <Field label="когда">{r.at ? whenLocal(r.at) : "как только появится время"}</Field>
          <Field label="статус выполнения"
            tone={r.doing === "в работе" ? ACC : r.doing === "сдана" ? OK : undefined}>
            {r.canceled ? "отменена" : r.doing}</Field>
          <Field label="статус напоминания" tone={r.sentAt ? OK : WARN}>
            {r.sentAt ? `отправлено ${whenLocal(r.sentAt)}` : "не отправлено"}</Field>
          {r.hanging && (
            <Field label="повтор" tone={WARN}>
              {r.hanging.deferredUntil
                ? `молчит до ${whenLocal(r.hanging.deferredUntil)}`
                : "раз в минуту, пока не нажмут кнопку"}</Field>)}
          <button type="button" disabled={busy === r.id}
            aria-label={`удалить напоминание ${r.title}`}
            style={{ ...btn(false), color: BAD, borderColor: "#5A2436", fontSize: 11,
              padding: "3px 9px", marginTop: 6 }}
            onClick={() => drop(r.id)}>{busy === r.id ? "Удаляю…" : "Удалить"}</button>
        </div>))}
    </div>);
}

export function RemindersCard({ me, onSaved }) {
  const current = warnMinOf(me?.profile?.warnMin);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const known = Boolean(me?.known && !me?.solo);
  const pick = async (patch) => {
    setBusy(true); setMsg("");
    try {
      const saved = await putProfile(patch);
      onSaved?.(saved?.profile || { ...(me?.profile || {}), ...patch });
      setMsg("Сохранено.");
    } catch (e) { setMsg(e.message || "не удалось сохранить"); }
    setBusy(false);
  };
  const label = WARN_CHOICES.find((w) => w.v === current)?.name || `за ${current} мин`;
  return (
    <FoldCard title="напоминания">
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
        <span style={{ fontSize: 11.5, color: C.muted }}>предупреждать</span>
        <select style={{ ...S.inp, flex: "0 1 200px" }} value={String(current)}
          aria-label="предупреждать за" disabled={busy || !known}
          onChange={(e) => pick({ warnMin: warnMinOf(e.target.value) })}>
          {WARN_CHOICES.map((w) => (
            <option key={w.v} value={String(w.v)}>{w.name}</option>))}
        </select>
        {msg && (
          <span style={{ fontSize: 11, color: msg === "Сохранено." ? OK : WARN }}>{msg}</span>)}
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
        {known
          ? "Применяется сразу. Чтобы напоминание дошло, у бота должен быть начат диалог."
          : "Без сервера напоминаний нет: боту некуда слать, и выбирать здесь нечего."}
      </div>
      <ReminderList known={known} />
    </FoldCard>);
}
