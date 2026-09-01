import React, { useMemo, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, nm } from "./ui.jsx";
import { STATUSES, TaskEditor, moveLabel } from "./TasksBoard.jsx";
import { unitOf } from "../lib/sim.js";
import { reportSrc } from "../storage.js";

/* ════════════════════════════════════════════════════════════════
   ПРОВЕРКА

   Здесь только то, что проверяет именно этот человек: задачи, где он
   назначен проверяющим и по которым уже есть сдача. Принять — задача
   становится готовой; вернуть — уходит обратно в работу с комментарием.

   Решение «принято» отделено от «сдано» намеренно: иначе исполнитель сам
   принимал бы свою работу, а повтор движения «после утверждения отчёта»
   держаться было бы не на чем.
   ════════════════════════════════════════════════════════════════ */

const fmtDT = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v)
    : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit",
      year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const lastOf = (t) => {
  const subs = t.submissions || [];
  return subs.length ? subs[subs.length - 1] : null;
};

export default function ReviewBoard({ tasks = [], traits = [], entities = [], edges = [],
  goals = [], meId, isOwner, onAccept, onReturn, nameOf }) {
  const [openId, setOpenId] = useState(null);
  const [note, setNote] = useState("");

  // Владельцу видно всё, что вообще ждёт проверки; остальным — только их.
  const mine = useMemo(() => tasks.filter((t) =>
    isOwner || String(t.reviewer || "") === String(meId)), [tasks, meId, isOwner]);
  const waiting = mine.filter((t) => t.status === "review");
  const rest = mine.filter((t) => t.status !== "review");

  const Card = ({ t, dim }) => {
    const on = openId === t.id;
    const sub = lastOf(t);
    const ed = edges.find((e) => e.id === t.edgeId) || null;
    const target = ed ? traits.find((x) => x.id === ed.to) : null;
    const st = STATUSES.find((s) => s.id === t.status);
    return (
      <div style={{ ...S.card, marginBottom: 8, opacity: dim ? 0.65 : 1,
        borderColor: on ? ACC : C.line }}>
        <div className="flex flex-wrap gap-2" style={{ alignItems: "center", cursor: "pointer" }}
          onClick={() => { setOpenId(on ? null : t.id); setNote(""); }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: st?.color || C.muted }} />
          <span style={{ fontSize: 13, fontWeight: 600, flex: "1 1 140px" }}>{t.title}</span>
          {sub && <span style={{ fontSize: 11, color: OK }}>
            сдано {nm(sub.amount)}{target ? ` ${String(unitOf(target)).split("/")[0]}` : ""}</span>}
          <span style={{ fontSize: 10.5, color: C.muted }}>{sub ? fmtDT(sub.at) : st?.name}</span>
          <span style={{ fontSize: 11, color: C.muted }}>{on ? "▾" : "▸"}</span>
        </div>

        {on && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, lineHeight: 1.6 }}>
              {ed ? moveLabel(ed, traits, entities) : "задача без движения"}
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
                    сдано {nm(sb.amount)}
                    {target ? ` ${String(unitOf(target)).split("/")[0]}` : ""}</span>
                  <span style={{ fontSize: 10, color: C.muted }}>{fmtDT(sb.at)}</span>
                </div>
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
                <input value={note} placeholder="комментарий к решению"
                  onChange={(e) => setNote(e.target.value)}
                  style={{ ...S.inp, marginBottom: 6 }} />
                <div className="flex flex-wrap gap-2">
                  <button style={btn(true, OK)}
                    onClick={() => { onAccept(t, note); setNote(""); setOpenId(null); }}>
                    Принять</button>
                  <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
                    onClick={() => { onReturn(t, note); setNote(""); setOpenId(null); }}>
                    Вернуть в работу</button>
                </div>
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
                  «Принять» переводит задачу в «Готово». «Вернуть» — обратно
                  в работу; комментарий увидит исполнитель.
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
  };

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
      {waiting.map((t) => <Card key={t.id} t={t} />)}

      {!!rest.length && (
        <>
          <div style={{ ...S.lbl, margin: "12px 0 6px" }}>остальные задачи под вашей проверкой</div>
          {rest.map((t) => <Card key={t.id} t={t} dim />)}
        </>)}
    </div>);
}
