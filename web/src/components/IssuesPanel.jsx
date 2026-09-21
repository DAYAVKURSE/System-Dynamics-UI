import React, { useEffect, useState } from "react";
import { Avatar, BAD, C, OK, S, btn } from "./ui.jsx";
import Modal from "./Modal.jsx";
import { dropIssue, listIssues } from "../identity.js";

/* ════════════════════════════════════════════════════════════════
   СООБЩЕНИЯ ОБ ОШИБКАХ (владелец, 2026-09-21)

   «Вкладка „issues", где будут в списке показаны отправленные
   пользователями сообщения, и кнопка „Удалить" рядом с каждым».

   Список и одна кнопка — больше здесь ничего нет. Ни статусов, ни
   ответов, ни важности: сообщение об ошибке прочитывают и убирают, и
   всё, что можно было бы добавить, было бы придумано за владельца.

   Новые сверху: свежая ошибка нужнее позавчерашней.
   ════════════════════════════════════════════════════════════════ */

const card = { ...S.card, marginBottom: "var(--space-8)" };

const when = (v) => {
  const d = new Date(v || "");
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("ru-RU",
    { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

export default function IssuesPanel({ me }) {
  const [list, setList] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [kill, setKill] = useState(null);
  const known = Boolean(me?.known && !me?.solo);

  const load = () => listIssues().then(setList).catch((e) => setMsg(e.message));
  useEffect(() => { if (known) load(); }, [known]);   // eslint-disable-line react-hooks/exhaustive-deps

  const drop = async (id) => {
    setBusy(true); setMsg("");
    try { await dropIssue(id); await load(); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  if (!known) {
    return (
      <div style={card}>
        <div style={S.lbl}>issues</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: "var(--space-4)", lineHeight: 1.5 }}>
          Сообщения об ошибках живут на сервере: откройте приложение через Telegram.
        </div>
      </div>);
  }

  return (
    <div style={card} aria-label="issues">
      <div className="flex items-center gap-2" style={{ marginBottom: "var(--space-8)" }}>
        <span style={{ ...S.lbl, flex: 1 }}>issues</span>
        <span style={{ fontSize: 10.5, color: C.muted }}>{(list || []).length}</span>
      </div>

      {!list && !msg && <div style={{ fontSize: 12, color: C.muted }}>Загружаю…</div>}
      {list && !list.length && (
        <div style={{ fontSize: 12, color: C.muted }}>Сообщений пока нет.</div>)}

      {(list || []).map((x) => (
        <div key={x.id} aria-label={`сообщение об ошибке от ${x.name}`}
          style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: "var(--radius-sm)",
            padding: "var(--space-8)", marginTop: "var(--space-8)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <Avatar name={x.name} src={x.avatar} size={24} logo={!x.avatar && !x.name} />
            <span style={{ fontSize: 12.5, fontWeight: 700, flex: "1 1 120px" }}>{x.name}</span>
            <span style={{ fontSize: 10.5, color: C.muted }}>{when(x.at)}</span>
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.6, marginTop: "var(--space-4)", whiteSpace: "pre-wrap" }}>
            {x.text}</div>
          <div className="flex gap-2" style={{ marginTop: "var(--space-8)" }}>
            <button type="button" disabled={busy}
              style={{ ...btn(true, BAD) }}
              aria-label={`удалить сообщение от ${x.name}`}
              onClick={() => setKill(x)}>Удалить</button>
          </div>
        </div>))}

      {msg && <div role="status" style={{ fontSize: 12, color: BAD, marginTop: "var(--space-8)" }}>{msg}</div>}

      {kill && (
        <Modal title="Удалить сообщение" onClose={() => setKill(null)}>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>Вы уверены? Это действие необратимо</div>
          <div className="flex gap-2" style={{ marginTop: "var(--space-12)" }}>
            <button type="button" style={btn(true, BAD)} disabled={busy}
              onClick={() => { const x = kill; setKill(null); drop(x.id); }}>Да</button>
            <button type="button" style={btn(false)} onClick={() => setKill(null)}>Нет</button>
          </div>
        </Modal>)}
    </div>);
}

/* ─────── ОКНО «НАПИШИТЕ СООБЩЕНИЕ ОБ ОШИБКЕ» ───────

   Открывается значком в шапке, рядом с «Отменить»: ошибку замечают
   посреди работы, и уводить за ней на отдельную вкладку значит требовать,
   чтобы человек сначала вспомнил, куда идти, а потом — что хотел
   сказать. Поле одно, и просьба над ним — ровно та, что заказана. */
export function IssueModal({ onClose, onSend }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true); setMsg("");
    try { await onSend(body); onClose(); }
    catch (e) { setMsg(e.message); setBusy(false); }
  };

  return (
    <Modal title="Сообщение об ошибке" onClose={onClose}>
      <div style={{ fontSize: 13 }}>Напишите сообщение об ошибке</div>
      <textarea autoFocus aria-label="сообщение об ошибке" rows={5} value={text}
        disabled={busy} onChange={(e) => setText(e.target.value)}
        style={{ ...S.inp, width: "100%", marginTop: "var(--space-8)", resize: "vertical",
          minHeight: 90, lineHeight: 1.5 }} />
      {msg && <div role="status" style={{ fontSize: 12, color: BAD, marginTop: "var(--space-4)" }}>{msg}</div>}
      <div className="flex gap-2" style={{ marginTop: "var(--space-8)" }}>
        <button type="button" style={btn(true, OK)} disabled={busy || !text.trim()}
          onClick={send}>{busy ? "Отправляю…" : "Отправить"}</button>
        <button type="button" style={btn(false)} disabled={busy}
          onClick={onClose}>Отмена</button>
      </div>
    </Modal>);
}
