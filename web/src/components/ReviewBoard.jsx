import React, { useMemo, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, nm } from "./ui.jsx";
import { STATUSES, funcLabel } from "./TasksBoard.jsx";
import { MARK_MAX, MARK_MIN, inTime, lastSubmission } from "../lib/workers.js";
import { reportSrc } from "../storage.js";

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
   ════════════════════════════════════════════════════════════════ */

const fmtDT = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v)
    : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit",
      year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const lastOf = lastSubmission;

/* Карточка вынесена из компонента намеренно: объявленная внутри рендера,
   она пересоздавалась бы каждый раз, и поле комментария теряло бы фокус
   на каждой букве. */
function Card({ t, dim, openId, setOpenId, note, setNote, mark, setMark,
  funcs, traits, entities, nameOf, onAccept, onReturn }) {
    const on = openId === t.id;
    const sub = lastOf(t);
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
              {" · поставил: "}{nameOf ? nameOf(t.setter) : (t.setter || "не назначен")}
              {" · исполнитель: "}{nameOf ? nameOf(t.assignee) : (t.assignee || "не назначен")}
            </div>
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
                  aria-label="комментарий к оценке"
                  onChange={(e) => setNote(e.target.value)}
                  style={{ ...S.inp, marginBottom: 6 }} />
                <div className="flex flex-wrap gap-2">
                  <button style={btn(true, OK)}
                    disabled={!mark || !note.trim()}
                    title={mark && note.trim() ? "" : "Поставьте оценку и напишите, за что"}
                    onClick={() => { onAccept(t, note, mark); setNote(""); setMark(0);
                      setOpenId(null); }}>
                    Принять</button>
                  <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
                    disabled={!note.trim()}
                    title={note.trim() ? "" : "Напишите, что доработать"}
                    onClick={() => { onReturn(t, note, mark); setNote(""); setMark(0);
                      setOpenId(null); }}>
                    Вернуть в бэклог</button>
                </div>
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
                  «Принять» переводит задачу в «Готово» — её числа идут в
                  расчёт как фактическое выполнение функции, а оценка и
                  комментарий — в историю исполнителя. Без оценки и без слов
                  принять нельзя: оценка без слов не говорит, что исправить, а
                  слова без оценки не складываются в историю. «Вернуть» — в
                  бэклог с текстом доработки.
                </div>
              </>)}
            {!!(t.comments || []).length && (
              <div style={{ marginTop: 8 }}>
                <div style={S.lbl}>комментарии</div>
                {(t.comments || []).map((c) => (
                  <div key={c.id} style={{ fontSize: 11.5, color: C.muted,
                    marginTop: 4, lineHeight: 1.5 }}>
                    {c.text} <span style={{ fontSize: 10 }}>· {fmtDT(c.at)}</span></div>))}
              </div>)}
          </div>)}
      </div>);
  }

export default function ReviewBoard({ tasks = [], traits = [], entities = [], funcs = [],
  meId, isOwner, onAccept, onReturn, nameOf }) {
  const [openId, setOpenId] = useState(null);
  const [note, setNote] = useState("");
  const [mark, setMark] = useState(0);

  // Владельцу видно всё, что вообще ждёт проверки; остальным — только их.
  const mine = useMemo(() => tasks.filter((t) =>
    isOwner || String(t.reviewer || "") === String(meId)), [tasks, meId, isOwner]);
  const waiting = mine.filter((t) => t.status === "review");
  const rest = mine.filter((t) => t.status !== "review");

  return (
    <div>
      <div style={{ ...S.card, marginBottom: 10 }}>
        <div style={S.lbl}>на проверке{isOwner ? " · вы владелец, вам видно всё" : ""}</div>
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
          {isOwner
            ? "Здесь всё, что сдано и ждёт решения, плюс остальные задачи ниже."
            : "Здесь только то, что проверяете вы. Чужие задачи сюда не попадают."}
        </div>
      </div>

      {!waiting.length && (
        <div style={{ ...S.card, marginBottom: 10, fontSize: 12, color: C.muted }}>
          Ничего не ждёт проверки.</div>)}
      {waiting.map((t) => <Card key={t.id} t={t} openId={openId} setOpenId={setOpenId}
        note={note} setNote={setNote} mark={mark} setMark={setMark} funcs={funcs} traits={traits} entities={entities}
        nameOf={nameOf} onAccept={onAccept} onReturn={onReturn} />)}

      {!!rest.length && (
        <>
          <div style={{ ...S.lbl, margin: "12px 0 6px" }}>остальные задачи под вашей проверкой</div>
          {rest.map((t) => <Card key={t.id} t={t} dim openId={openId} setOpenId={setOpenId}
            note={note} setNote={setNote} mark={mark} setMark={setMark} funcs={funcs} traits={traits} entities={entities}
            nameOf={nameOf} onAccept={onAccept} onReturn={onReturn} />)}
        </>)}
    </div>);
}
