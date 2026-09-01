import React, { useEffect, useState } from "react";
import { C, OK, BAD, ACC, S, btn, TxtField } from "./ui.jsx";
import CallRoom from "./CallRoom.jsx";
import { callLink, createMeeting, deleteMeeting, listMeetings } from "../calls.js";

/* ════════════════════════════════════════════════════════════════
   ЗВОНКИ · список встреч и вход в комнату

   Встречу удобнее заводить прямо из чата — набрать имя бота и время, —
   но там она заводится вслепую, без списка. Здесь то, что в переписку не
   помещается: какие встречи уже есть и куда ведёт каждая ссылка.
   ════════════════════════════════════════════════════════════════ */

const fmt = (v) => {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v)
    : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit" });
};

export default function CallsBoard({ meId, openCall, onOpenCall }) {
  const [list, setList] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [at, setAt] = useState("");

  const load = async () => {
    try { setList(await listMeetings()); }
    catch (e) { setMsg(e.message); setList([]); }
  };
  useEffect(() => { load(); }, []);

  const act = async (fn) => {
    setBusy(true); setMsg("");
    try { await fn(); await load(); } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  if (openCall) {
    return <CallRoom meetingId={openCall} meId={meId} onClose={() => onOpenCall(null)} />;
  }

  return (
    <div>
      <div style={{ ...S.card, marginBottom: 10 }}>
        <div style={S.lbl}>назначить встречу</div>
        <div className="flex flex-wrap gap-2" style={{ margin: "6px 0 6px" }}>
          <TxtField value={title} placeholder="о чём созвон" style={{ flex: "2 1 180px" }}
            onCommit={setTitle} />
          <TxtField value={at} placeholder="когда, словами" style={{ flex: "1 1 130px" }}
            onCommit={setAt} />
          <button style={btn(true)} disabled={busy || !title.trim()}
            onClick={() => act(async () => {
              const m = await createMeeting({ title: title.trim(), at: at.trim(), text: "" });
              setTitle(""); setAt(""); onOpenCall(m.id);
            })}>Создать и войти</button>
        </div>
        <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
          Позвать собеседника проще из чата: наберите имя бота и время —
          «@бот завтра 15:00 разбор прогноза», — и отправьте карточку со
          ссылкой. Здесь то же самое, но со списком.
        </div>
        {msg && <div style={{ fontSize: 11.5, color: BAD, marginTop: 6 }}>{msg}</div>}
      </div>

      <div style={{ ...S.card }}>
        <div style={S.lbl}>встречи</div>
        {list === null && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
          Загружаю…</div>}
        {list && !list.length && (
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
            Встреч пока нет. Заведите первую выше или прямо из чата.</div>)}
        {(list || []).map((m) => (
          <div key={m.id} style={{ background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: 8, padding: 9, marginTop: 6 }}>
            <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, flex: "1 1 140px" }}>
                {m.title}</span>
              <span style={{ fontSize: 10.5, color: C.muted }}>
                {m.at || fmt(m.createdAt)}</span>
              <button style={btn(true, OK)} onClick={() => onOpenCall(m.id)}>Войти</button>
              <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
                disabled={busy} onClick={() => act(() => deleteMeeting(m.id))}>✕</button>
            </div>
            <div style={{ fontSize: 10, color: ACC, marginTop: 5, wordBreak: "break-all",
              fontFamily: "ui-monospace, Menlo, monospace" }}>
              {callLink(m.id)}</div>
          </div>))}
      </div>
    </div>);
}
