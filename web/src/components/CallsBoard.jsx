import React, { useEffect, useState } from "react";
import { C, OK, BAD, ACC, S, btn, TxtField, DANGER_LINE } from "./ui.jsx";
import CallRoom from "./CallRoom.jsx";
import {
  callLink, createMeeting, deleteMeeting, deleteRecording, listMeetings, listRecordings,
  sendRecording,
} from "../calls.js";

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

const mb = (n) => `${(Number(n || 0) / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;

// Больше этого бот файлом не отправит (предел Bot API) — и человек должен
// видеть заранее, что придёт ссылка, а не файл.
const MAX_BOT_FILE_BYTES = 50 * 1024 * 1024;

export default function CallsBoard({ meId, openCall, onOpenCall, nameOf }) {
  const [list, setList] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [at, setAt] = useState("");
  const [recs, setRecs] = useState(null);
  const [openRec, setOpenRec] = useState("");   // какая запись раскрыта
  const [recMsg, setRecMsg] = useState("");
  const [confirmDel, setConfirmDel] = useState("");   // какую запись переспрашиваем

  const load = async () => {
    try { setList(await listMeetings()); }
    catch (e) { setMsg(e.message); setList([]); }
  };
  const loadRecs = async () => {
    try { setRecs(await listRecordings()); }
    catch { setRecs([]); }        // нет сервера или нет прав — просто нечего показывать
  };
  useEffect(() => { load(); }, []);
  // Список записей перечитывается и при возврате из комнаты: штатный путь
  // «записал → вышел → забрать файл» иначе показывал «Записей пока нет».
  useEffect(() => { if (!openCall) loadRecs(); }, [openCall]);

  const act = async (fn) => {
    setBusy(true); setMsg("");
    try { await fn(); await load(); } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  /* Действия с записями — со своим сообщением и своим обновлением.
     Раньше отказ «бот не смог отправить файл» появлялся в карточке встреч
     наверху: человек жал «Скачать» и не видел вообще ничего. */
  const actRec = async (fn) => {
    setBusy(true); setRecMsg("");
    try { await fn(); await loadRecs(); } catch (e) { setRecMsg(e.message); }
    setBusy(false);
  };

  if (openCall) {
    return <CallRoom meetingId={openCall} meId={meId} nameOf={nameOf}
      onClose={() => onOpenCall(null)} />;
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
        {msg && <div style={{ fontSize: 11.5, color: BAD, marginTop: 6 }}>{msg}</div>}
      </div>

      <div style={{ ...S.card }}>
        <div style={S.lbl}>встречи</div>
        {list === null && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
          Загружаю…</div>}
        {list && !list.length && (
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
            Встреч пока нет.</div>)}
        {(list || []).map((m) => (
          <div key={m.id} style={{ background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: 8, padding: 9, marginTop: 6 }}>
            <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, flex: "1 1 140px" }}>
                {m.title}</span>
              <span style={{ fontSize: 10.5, color: C.muted }}>
                {m.at || fmt(m.createdAt)}</span>
              <button style={btn(true, OK)} onClick={() => onOpenCall(m.id)}>Войти</button>
              <button style={{ ...btn(true, BAD) }}
                disabled={busy} onClick={() => act(() => deleteMeeting(m.id))}>✕</button>
            </div>
            <div style={{ fontSize: 10, color: ACC, marginTop: 5, wordBreak: "break-all",
              fontFamily: "var(--font-sans)" }}>
              {/* Ссылку собирает сервер: только он знает имя бота и
                  приложения звонка. Своя — на случай работы без сервера. */}
              {m.link || callLink(m.id)}</div>
          </div>))}
      </div>

      {/* ─────── записи созвонов ───────
          Запись делает каждый свою и кладёт на сервер. Показываем их здесь,
          рядом со встречами: искать запись во вкладке отчётов по задачам
          никому не придёт в голову.

          «Скачать» — это отправка себе в чат с ботом, и так и подписано:
          сохранить файл прямо из мини-приложения Telegram не даёт, а из
          чата он открывается и пересылается штатно. */}
      <div style={{ ...S.card, marginTop: 10 }}>
        <div style={S.lbl}>записи</div>
        {recs === null && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
          Загружаю…</div>}
        {recs && !recs.length && (
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
            Записей пока нет.</div>)}
        {(recs || []).map((r) => (
          <div key={r.id} style={{ background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: 8, padding: 9, marginTop: 6 }}>
            <button aria-label={`запись ${r.name}`}
              onClick={() => {
                setRecMsg(""); setConfirmDel("");
                setOpenRec(openRec === r.id ? "" : r.id);
              }}
              style={{ display: "flex", width: "100%", gap: 8, alignItems: "center",
                background: "transparent", border: 0, padding: 0, cursor: "pointer",
                color: C.text, textAlign: "left" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.name}</span>
              <span style={{ fontSize: 10.5, color: C.muted, whiteSpace: "nowrap" }}>
                {mb(r.size)} · {fmt(r.savedAt)}</span>
            </button>
            {openRec === r.id && (
              <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
                <button style={btn(true, OK)} disabled={busy}
                  onClick={() => actRec(async () => {
                    const out = await sendRecording(r.id);
                    setRecMsg(out?.sent === "link"
                      ? "Запись великовата для файла — отправил в чат ссылку на неё."
                      : "Отправил запись в чат с ботом.");
                  })}>
                  {r.size > MAX_BOT_FILE_BYTES ? "Прислать ссылку" : "Скачать"}</button>
                {/* Удаление — в два касания. Другой копии нет: файл уехал на
                    сервер сразу, на телефоне его не осталось, и час созвона
                    не должен исчезать от промаха пальцем. */}
                <button style={{ ...btn(confirmDel === r.id, BAD), color: BAD,
                  borderColor: DANGER_LINE }} disabled={busy}
                  onClick={() => {
                    if (confirmDel !== r.id) { setConfirmDel(r.id); setRecMsg(""); return; }
                    setConfirmDel("");
                    actRec(async () => {
                      await deleteRecording(r.scope, r.id);
                      setOpenRec(""); setRecMsg("Запись удалена с сервера.");
                    });
                  }}>
                  {confirmDel === r.id ? "Удалить насовсем?" : "Удалить"}</button>
              </div>)}
          </div>))}
        {recMsg && <div style={{ fontSize: 11.5, color: ACC, marginTop: 8, lineHeight: 1.5 }}>
          {recMsg}</div>}
      </div>
    </div>);
}
