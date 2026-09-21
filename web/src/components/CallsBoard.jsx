import React, { useCallback, useEffect, useState } from "react";
import { C, OK, BAD, ACC, S, btn, Download, TxtField, DANGER_LINE } from "./ui.jsx";
import CallRoom from "./CallRoom.jsx";
import {
  callLink, createMeeting, deleteMeeting, deleteRecording, deleteTranscript, getTranscript, listMeetings,
  listRecordings, sendRecording, transcribeRecording,
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
      <div style={{ ...S.card, marginBottom: "var(--space-8)" }}>
        <div style={S.lbl}>назначить встречу</div>
        <div className="flex flex-wrap gap-2" style={{ margin: "var(--space-4) 0 var(--space-4)" }}>
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
        {msg && <div style={{ fontSize: "var(--fs-hint)", color: BAD, marginTop: "var(--space-4)" }}>{msg}</div>}
      </div>

      <div style={{ ...S.card }}>
        <div style={S.lbl}>встречи</div>
        {list === null && <div style={{ fontSize: "var(--fs-hint)", color: C.muted, marginTop: "var(--space-4)" }}>
          Загружаю…</div>}
        {list && !list.length && (
          <div style={{ fontSize: "var(--fs-hint)", color: C.muted, marginTop: "var(--space-4)", lineHeight: 1.6 }}>
            Встреч пока нет.</div>)}
        {(list || []).map((m) => (
          <div key={m.id} style={{ background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: "var(--radius-sm)", padding: "var(--space-8)", marginTop: "var(--space-4)" }}>
            <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
              <span style={{ fontSize: "var(--fs-body)", fontWeight: 600, flex: "1 1 140px" }}>
                {m.title}</span>
              <span style={{ fontSize: "var(--fs-hint)", color: C.muted }}>
                {m.at || fmt(m.createdAt)}</span>
              <button style={btn(true, OK)} onClick={() => onOpenCall(m.id)}>Войти</button>
              <button style={{ ...btn(true, BAD) }}
                disabled={busy} onClick={() => act(() => deleteMeeting(m.id))}>✕</button>
            </div>
            <div style={{ fontSize: "var(--fs-hint)", color: ACC, marginTop: "var(--space-4)", wordBreak: "break-all",
              fontFamily: "var(--font-sans)" }}>
              {/* Ссылку собирает сервер: только он знает имя бота и
                  приложения звонка. Своя — на случай работы без сервера. */}
              {m.link || callLink(m.id)}</div>
          </div>))}
      </div>

      {/* ─────── записи созвонов ───────
          Запись делает каждый свою и кладёт на сервер. Показываем их здесь,
          рядом со встречами: искать запись во вкладке отчётов по задачам
          никому не придёт в голову. Раскрытая запись — форма (владелец,
          2026-09-21): текст расшифровки и пять кнопок — скачать и удалить
          видеозапись, транскрибировать, скачать и удалить транскрипцию.

          «Скачать» — это отправка себе в чат с ботом, и так и подписано:
          сохранить файл прямо из мини-приложения Telegram не даёт, а из
          чата он открывается и пересылается штатно. */}
      <div style={{ ...S.card, marginTop: "var(--space-8)" }}>
        <div style={S.lbl}>записи</div>
        {recs === null && <div style={{ fontSize: "var(--fs-hint)", color: C.muted, marginTop: "var(--space-4)" }}>
          Загружаю…</div>}
        {recs && !recs.length && (
          <div style={{ fontSize: "var(--fs-hint)", color: C.muted, marginTop: "var(--space-4)", lineHeight: 1.6 }}>
            Записей пока нет.</div>)}
        {(recs || []).map((r) => (
          <div key={r.id} style={{ background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: "var(--radius-sm)", padding: "var(--space-8)", marginTop: "var(--space-4)" }}>
            <button aria-label={`запись ${r.name}`}
              onClick={() => {
                setRecMsg(""); setConfirmDel("");
                setOpenRec(openRec === r.id ? "" : r.id);
              }}
              style={{ display: "flex", width: "100%", gap: "var(--space-8)", alignItems: "center",
                background: "transparent", border: 0, padding: 0, cursor: "pointer",
                color: C.text, textAlign: "left" }}>
              <span style={{ fontSize: "var(--fs-body)", fontWeight: 600, flex: 1, minWidth: 0,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.name}</span>
              <span style={{ fontSize: "var(--fs-hint)", color: C.muted, whiteSpace: "nowrap" }}>
                {mb(r.size)} · {fmt(r.savedAt)}</span>
            </button>
            {openRec === r.id && (
              <RecordingForm r={r} busy={busy} act={actRec} say={setRecMsg}
                confirm={confirmDel} setConfirm={setConfirmDel}
                onDeleted={() => setOpenRec("")} />)}
          </div>))}
        {recMsg && <div style={{ fontSize: "var(--fs-hint)", color: ACC, marginTop: "var(--space-8)", lineHeight: 1.5 }}>
          {recMsg}</div>}
      </div>
    </div>);
}


/* ─────── ФОРМА ЗАПИСИ (владелец, 2026-09-21) ───────

   Текст расшифровки — на форме, как только он есть; пока идёт — так и
   сказано, не вышло — почему. Расшифровку делает модель строки
   «расшифровка» у ассистента (Инструменты → Агенты): нет модели — сервер
   говорит об этом словами, и они показываются здесь же. Голос записан
   поканально, поэтому в тексте перед каждой репликой — кто говорит.

   «Удалить» — в два касания, как и раньше: копии у записи нет. */
function RecordingForm({ r, busy, act, say, confirm, setConfirm, onDeleted }) {
  const [tr, setTr] = useState(null);   // null — ещё не спрашивали; {status: none|pending|done|error}
  const refresh = useCallback(async () => {
    try { setTr(await getTranscript(r.id)); } catch { setTr({ status: "none" }); }
  }, [r.id]);
  useEffect(() => { refresh(); }, [refresh]);
  // Пока «идёт» — спрашиваем раз в пять секунд: расшифровка делается минуты.
  useEffect(() => {
    if (tr?.status !== "pending") return undefined;
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [tr?.status, refresh]);
  const big = r.size > MAX_BOT_FILE_BYTES;
  const pending = tr?.status === "pending";
  const base = String(r.name || "запись").replace(/\.[a-z0-9]+$/i, "");
  const twice = (key, label, ask, fn) => (
    <button style={{ ...btn(confirm === key, BAD), color: BAD, borderColor: DANGER_LINE }} disabled={busy}
      aria-label={label.toLowerCase()}
      onClick={() => {
        if (confirm !== key) { setConfirm(key); say(""); return; }
        setConfirm("");
        act(fn);
      }}>{confirm === key ? ask : label}</button>);
  return (
    <div aria-label={`форма записи ${r.name}`}>
      <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-8)" }}>
        <button style={btn(true, OK)} disabled={busy} aria-label="скачать видеозапись"
          onClick={() => act(async () => {
            const out = await sendRecording(r.id);
            say(out?.sent === "link"
              ? "Запись великовата для файла — отправил в чат ссылку на неё."
              : "Отправил видеозапись в чат с ботом.");
          })}>
          {big ? "Прислать ссылку на видеозапись" : "Скачать видеозапись"}</button>
        {twice(`video:${r.id}`, "Удалить видеозапись", "Удалить видеозапись насовсем?", async () => {
          await deleteRecording(r.scope, r.id);
          onDeleted(); say("Видеозапись удалена с сервера.");
        })}
        <button style={btn(pending, ACC)} disabled={busy || pending} aria-label="транскрибировать"
          onClick={() => act(async () => {
            await transcribeRecording(r.id);
            setTr({ status: "pending" });
          })}>{pending ? "Транскрибирую…" : "Транскрибировать"}</button>
        {tr?.status === "done" && (
          <Download text={tr.text} name={`${base} — транскрипция.txt`} label="Скачать транскрипцию"
            aria-label="скачать транскрипцию" />)}
        {tr && tr.status !== "none" && twice(`text:${r.id}`, "Удалить транскрипцию", "Удалить транскрипцию насовсем?",
          async () => { await deleteTranscript(r.id); setTr({ status: "none" }); say("Транскрипция удалена."); })}
      </div>
      {pending && (
        <div style={{ fontSize: "var(--fs-hint)", color: C.muted, marginTop: "var(--space-8)" }}>
          Расшифровка идёт{tr.model ? ` · ${tr.model}` : ""}…</div>)}
      {tr?.status === "error" && (
        <div role="status" style={{ fontSize: "var(--fs-hint)", color: BAD, marginTop: "var(--space-8)", lineHeight: 1.5 }}>
          Расшифровка не удалась: {tr.error}</div>)}
      {tr?.status === "done" && (
        <div aria-label="транскрипция" style={{ fontSize: "var(--fs-hint)", lineHeight: 1.6, marginTop: "var(--space-8)",
          whiteSpace: "pre-wrap", background: C.panel, border: `1px solid ${C.line}`, borderRadius: "var(--radius-sm)",
          padding: "var(--space-8)", maxHeight: 320, overflowY: "auto" }}>{tr.text}</div>)}
    </div>);
}
