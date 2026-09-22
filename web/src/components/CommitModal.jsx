import React, { useState } from "react";
import { BAD, OK, S, btn } from "./ui.jsx";
import Modal from "./Modal.jsx";

/* ─────── ОПИСАНИЕ КОММИТА (владелец, 2026-09-22) ───────

   «При сохранении сценария должен описываться коммит: модальное окно с
   полем для текста». Каждое сохранение — версия, и у неё, как у коммита,
   есть сообщение: без него список версий — одни даты. Пустое описание не
   принимается. */
export default function CommitModal({ name = "", onClose, onSave }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const save = async () => {
    const note = text.trim();
    if (!note) return;
    setBusy(true); setMsg("");
    try { await onSave(note); }
    catch (e) { setMsg(e.message); setBusy(false); }
  };
  return (
    <Modal title="Сохранение сценария" onClose={onClose}>
      {name && <div style={{ fontSize: "var(--fs-body)", fontWeight: 600 }}>{name}</div>}
      <textarea autoFocus aria-label="описание коммита" rows={4} value={text}
        disabled={busy} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); }}
        style={{ ...S.inp, width: "100%", marginTop: "var(--space-8)", resize: "vertical",
          minHeight: 72, lineHeight: 1.5 }} />
      {msg && <div role="status" style={{ fontSize: "var(--fs-hint)", color: BAD, marginTop: "var(--space-4)" }}>{msg}</div>}
      <div className="flex gap-2" style={{ marginTop: "var(--space-8)" }}>
        <button type="button" style={btn(true, OK)} disabled={busy || !text.trim()}
          onClick={save}>{busy ? "Сохраняю…" : "Сохранить"}</button>
        <button type="button" style={btn(false)} disabled={busy} onClick={onClose}>Отмена</button>
      </div>
    </Modal>);
}
