import React, { useEffect, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn } from "./ui.jsx";
import { openRoles, registerRemote } from "../identity.js";
import { reportSrc } from "../storage.js";

/* ════════════════════════════════════════════════════════════════
   РЕГИСТРАЦИЯ · участником становятся, подписав договор

   Прежде человека добавлял владелец: пересылал боту сообщение и выбирал
   роль. Человек при этом ничего не подписывал — его просто впускали, и
   на вопрос «на каких условиях он тут работает» ответа не было.

   Теперь акцепт — ДОГОВОР. Он у роли: под каждую свой. Последовательность
   одна и вся на одном экране:

     1. выбрать роль — что человек будет здесь делать;
     2. прочитать её договор — он скачивается по ссылке;
     3. прислать подписанный экземпляр;
     4. дальше система сама: видит договор, понимает, какая роль, и
        выдаёт её. Ждать чужого нажатия не нужно.

   Роль, которой владелец не приложил договор, подписывать нечем — она
   выдаётся сразу, и об этом сказано словами: молчание читалось бы как
   «договор есть, просто не показали».

   Приготовленная роль (`pending`) — когда владелец уже позвал человека:
   она выбрана заранее, и остаётся подписать.
   ════════════════════════════════════════════════════════════════ */

export default function RegisterPanel({ me, onDone }) {
  const [roles, setRoles] = useState(null);
  const [pick, setPick] = useState(me?.pending || "");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let live = true;
    openRoles().then((list) => { if (live) setRoles(list); })
      .catch((e) => { if (live) { setRoles([]); setMsg(e.message || "не удалось получить роли"); } });
    return () => { live = false; };
  }, []);
  // Позвали в роль — она и выбрана: подписывать надо именно её.
  useEffect(() => { if (me?.pending) setPick(me.pending); }, [me?.pending]);

  const cur = (roles || []).find((r) => r.id === pick) || null;
  const needs = !!cur?.contract;
  const ready = !!cur && (!needs || !!file);

  const send = async () => {
    if (!ready || busy) return;
    setBusy(true); setMsg("");
    try {
      const r = await registerRemote(cur.id, file);
      onDone?.(r?.me || null);
    } catch (e) { setMsg(e.message || "не удалось отправить"); }
    setBusy(false);
  };

  const step = { ...S.lbl, marginTop: 10 };
  return (
    <div style={{ ...S.card, marginBottom: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
        {me?.pending ? "Вас позвали — осталось подписать договор" : "Вступить в модель"}
      </div>
      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
        Участником вы становитесь, подписав договор роли: выберите роль,
        прочитайте договор и пришлите подписанный экземпляр. Роль выдастся
        сама — ждать ничьего разрешения не нужно.
      </div>

      {/* ─── 1. роль ─── */}
      <div style={step}>1 · какая роль</div>
      {roles === null && (
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>Загружаю…</div>)}
      {roles !== null && !roles.length && (
        <div style={{ fontSize: 11.5, color: WARN, marginTop: 4, lineHeight: 1.6 }}>
          Ролей ещё нет — вступать не во что. Попросите владельца завести
          роль и приложить к ней договор.
        </div>)}
      <div className="flex flex-wrap gap-2" style={{ marginTop: 4 }}>
        {(roles || []).map((r) => (
          <button key={r.id} aria-pressed={pick === r.id}
            aria-label={`роль: ${r.name}`}
            style={{ ...btn(pick === r.id, pick === r.id ? ACC : null), fontSize: 12 }}
            onClick={() => { setPick(r.id); setFile(null); setMsg(""); }}>
            {r.name}</button>))}
      </div>

      {/* ─── 2. договор ─── */}
      {cur && (<>
        <div style={step}>2 · договор</div>
        {needs ? (
          <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 4 }}>
            <a href={reportSrc(cur.contract)} target="_blank" rel="noreferrer"
              download={cur.contract.name || "договор"}
              aria-label={`скачать договор роли «${cur.name}»`}
              style={{ fontSize: 12, color: ACC }}>
              📄 {cur.contract.name || "договор"}</a>
            <span style={{ fontSize: 10.5, color: C.muted }}>
              скачайте, прочитайте и подпишите</span>
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4, lineHeight: 1.6 }}>
            У этой роли договора нет — подписывать нечего, она выдаётся сразу.
          </div>)}

        {/* ─── 3. подписанный экземпляр ─── */}
        {needs && (<>
          <div style={step}>3 · подписанный экземпляр</div>
          <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 4 }}>
            <label style={{ ...btn(false), fontSize: 12, cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1, borderColor: file ? undefined : "#5A2436" }}>
              {file ? "Заменить файл" : "Приложить подписанный договор"}
              <input type="file" style={{ display: "none" }} disabled={busy}
                aria-label="подписанный договор"
                onChange={(e) => { setFile(e.target.files?.[0] || null); setMsg(""); }} />
            </label>
            {file && <span style={{ fontSize: 11, color: OK }}>📎 {file.name}</span>}
          </div>
          {!file && (
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>
              Без него роль не выдаётся: договор и есть согласие.
            </div>)}
        </>)}

        {/* ─── 4. отправка ─── */}
        <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 12 }}>
          <button style={{ ...btn(true, OK), opacity: ready && !busy ? 1 : 0.5 }}
            disabled={!ready || busy} onClick={send}>
            {busy ? "Отправляю…" : "Вступить"}</button>
          <span style={{ fontSize: 10.5, color: C.muted }}>
            {ready ? "договор уйдёт владельцу, роль откроется сразу"
              : "приложите подписанный договор"}</span>
        </div>
      </>)}

      {msg && <div style={{ fontSize: 11.5, color: BAD, marginTop: 8 }}>{msg}</div>}
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 10, lineHeight: 1.6 }}>
        Не нашли свою роль? Её заводит владелец — попросите его добавить
        роль и приложить к ней договор.
      </div>
    </div>);
}
