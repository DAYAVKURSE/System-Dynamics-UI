import React, { useEffect, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, TxtField } from "./ui.jsx";
import {
  ALL_TABS, addRole, listOrg, removeRole, removeUser, setRoleContract, setRoleTabs,
  setUserRoles,
} from "../identity.js";
import { putReportFile, reportSrc } from "../storage.js";
import { FormsSection, RoleFormPick } from "./FormsPanel.jsx";
import { DocsSection, InviteModal, dayText } from "./ContractsPanel.jsx";
import { setRoleDoc } from "../identity.js";

/* ════════════════════════════════════════════════════════════════
   РОЛИ · панель владельца: участники, роли, анкеты

   Звать людей — дело бота: там пересылаешь сообщение и выбираешь роль
   в два касания. Здесь то, что в переписку не помещается: кто уже есть,
   какие роли, что каждая роль открывает, и как это поменять.

   Права проверяет сервер. Панель просто не рисуется никому, кроме
   владельца, — но если бы и нарисовалась, каждый запрос отсюда получил бы
   отказ.

   ─── договор ───

   Участником человек становится не потому, что его добавили, а потому,
   что подписал ДОГОВОР. Договор — у роли: под каждую свой, и ролей у
   человека бывает несколько. Здесь владелец кладёт ШАБЛОН («что
   подписать»), а подписанный экземпляр приносит сам человек, когда
   регистрируется, — и по нему система сама выдаёт ему роль.

   Роль без шаблона выдаётся без акцепта: подписывать нечего. Так и
   написано рядом с ней — молчание было бы обещанием, которого нет.
   ════════════════════════════════════════════════════════════════ */

/* Имена вкладок — те же слова, что на самих кнопках приложения: роль
   открывает «Отчёты», и в списке она должна называться «Отчёты», а не
   «reports». Список один со `SystemModel.TAB_LIST`. */
const TAB_NAMES = {
  tasks: "Задачи", review: "Проверка", scheme: "Схема",
  reports: "Отчёты", tools: "Инструменты",
};

/**
 * Договор роли: что человек подписывает, вступая в неё.
 *
 * Шаблон кладёт владелец, а подписанный экземпляр приносит сам человек
 * при регистрации — и по нему система выдаёт ему роль. Нет шаблона —
 * роль выдаётся без акцепта, и это сказано словами: молчание читалось бы
 * как «договор есть, просто не показан».
 */
function Contract({ role, busy, onSet }) {
  const [load, setLoad] = useState(false);
  const [err, setErr] = useState("");
  const pick = async (file) => {
    setErr("");
    if (!file) return;
    setLoad(true);
    try { await onSet(await putReportFile(file, { kind: "contract" })); }
    catch (e) { setErr(e.message || "не удалось загрузить"); }
    setLoad(false);
  };
  return (
    <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginBottom: 6 }}>
      <span style={{ fontSize: 10.5, color: C.muted }}>договор:</span>
      {role.contract
        ? <a href={reportSrc(role.contract)} target="_blank" rel="noreferrer"
          download={role.contract.name || "договор"}
          aria-label={`договор роли «${role.name}»`}
          style={{ fontSize: 11, color: ACC }}>{role.contract.name || "файл"}</a>
        : <span style={{ fontSize: 10.5, color: WARN }}>
          нет — роль выдаётся без акцепта</span>}
      <label style={{ ...btn(false), fontSize: 11, padding: "2px 8px",
        cursor: load || busy ? "default" : "pointer", opacity: load || busy ? 0.6 : 1 }}>
        {load ? "Загружаю…" : role.contract ? "Заменить" : "Загрузить договор"}
        <input type="file" style={{ display: "none" }} disabled={load || busy}
          aria-label={`загрузить договор роли «${role.name}»`}
          onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      {role.contract && (
        <button style={{ ...btn(false), fontSize: 10.5, padding: "2px 6px", color: BAD }}
          disabled={load || busy} aria-label={`убрать договор роли «${role.name}»`}
          onClick={() => onSet(null)}>×</button>)}
      {err && <span style={{ fontSize: 10.5, color: BAD }}>{err}</span>}
    </div>);
}

export default function PeoplePanel({ me, onPeople, onChanged }) {
  const [org, setOrg] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [newRole, setNewRole] = useState("");
  const [invite, setInvite] = useState(null);   // роль, в которую зовём

  const load = async () => {
    try {
      const o = await listOrg();
      setOrg(o);
      onPeople?.(o.users || []);
    } catch (e) { setMsg(e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /* `quiet` — ошибку покажет сама форма, на месте (владелец, 2026-09-15:
     «предупреждение было в самом низу страницы, а не на форме»); общая
     строка внизу — для действий без своего места. Ошибка при этом
     пробрасывается, чтобы форма её увидела. */
  const act = async (fn, { quiet = false } = {}) => {
    setBusy(true); setMsg("");
    try { await fn(); await load(); onChanged?.(); }
    catch (e) { if (!quiet) setMsg(e.message); setBusy(false); if (quiet) throw e; }
    setBusy(false);
  };

  if (!org) {
    return (
      <div style={{ ...S.card, marginBottom: 10 }}>
        <div style={S.lbl}>роли</div>
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
          {msg || "Загружаю…"}</div>
      </div>);
  }

  const roleName = (id) => org.roles.find((r) => r.id === id)?.name;
  const people = org.users.filter((u) => !u.agent);
  const agents = org.users.filter((u) => u.agent);
  /* Три формы — три вопроса (2026-09-13): КТО участвует, какие есть РОЛИ
     и что они открывают, о чём спрашивают АНКЕТЫ. Каждая — своей
     карточкой с заголовком и подсказкой, чтобы глазом было видно, где
     что правится. */
  const card = { ...S.card, marginBottom: 10, borderColor: `${ACC}55` };
  const title = (t, n) => (
    <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
      <span style={{ ...S.lbl, color: ACC }}>{t}</span>
      {n != null && <span style={{ fontSize: 10.5, color: C.muted }}>{n}</span>}
    </div>);

  const userRow = (u) => {
    const owner = u.id === org.ownerId;
    return (
      /* Каждый участник — своей формой внутри формы участников (владелец,
         2026-09-13: «чтобы визуально достаточно это всё отделить»), а не
         строкой с чертой снизу: у человека две-три строки (имя, роли,
         договоры), и черта между ними не отделяла одного от другого. */
      <div key={u.id} className="flex flex-wrap gap-2" aria-label={`участник ${u.name}`}
        style={{ alignItems: "center", padding: 8, marginBottom: 6,
          background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8 }}>
        <span style={{ fontSize: 12.5, flex: "1 1 130px" }}>
          {u.name}
          {u.username ? <span style={{ color: C.muted }}> @{u.username}</span> : null}
          {u.agent && (
            <span style={{ fontSize: 10, color: WARN, border: `1px solid ${WARN}66`,
              borderRadius: 3, padding: "1px 5px", marginLeft: 6 }}>агент</span>)}
        </span>
        {owner
          ? <span style={{ fontSize: 10.5, color: ACC, border: `1px solid ${ACC}66`,
              borderRadius: 3, padding: "1px 5px" }}>владелец</span>
          : <>
              {/* Ролей у человека несколько — отметки, а не выбор одной:
                  выпадающий список молча снимал остальные. Рядом с ролью
                  — подписанный ли договор: участие держится на нём, и
                  «роль есть, договора нет» надо видеть, а не выяснять.
                  Агенту договор не нужен — роль выдаётся сразу. */}
              <div className="flex flex-wrap gap-2" style={{ flexBasis: "100%",
                alignItems: "center" }}>
                {org.roles.map((r) => {
                  const has = (u.roles || []).includes(r.id);
                  const signed = (u.contracts || {})[r.id];
                  return (
                    <button key={r.id} aria-pressed={has} disabled={busy}
                      aria-label={`роль «${r.name}»: ${u.name}`}
                      style={{ ...btn(has, has ? OK : undefined), fontSize: 11,
                        padding: "2px 7px" }}
                      onClick={() => act(() => setUserRoles(u.id, has
                        ? (u.roles || []).filter((x) => x !== r.id)
                        : [...(u.roles || []), r.id]))}>
                      {r.name}{has && signed ? " ✓" : ""}</button>);
                })}
                {!!u.pending && (
                  <span style={{ fontSize: 10.5, color: WARN }}>
                    ждёт договора: {roleName(u.pending) || u.pending}</span>)}
                <span style={{ flex: 1 }} />
                <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
                  disabled={busy} aria-label={`убрать: ${u.name}`}
                  onClick={() => act(() => removeUser(u.id))}>✕</button>
              </div>
              {/* Договоры участника — под ролями (владелец, 2026-09-14):
                  начало, окончание, сумма; недействующий срок — жёлтым. */}
              {!!(u.agreements || []).length && (
                <div style={{ flexBasis: "100%" }} aria-label={`договоры: ${u.name}`}>
                  {u.agreements.map((a) => {
                    const on = (u.active || []).includes(a.roleId);
                    return (
                      <div key={a.id} className="flex flex-wrap gap-2"
                        style={{ fontSize: 10.5, color: on ? C.text : WARN, alignItems: "center" }}>
                        <span>{roleName(a.roleId) || a.roleId} · {a.docName || "договор"}</span>
                        <span>с {dayText(a.start)}</span>
                        <span>по {dayText(a.end)}</span>
                        <span>сумма {a.sum}</span>
                        {a.file?.url && (
                          <a href={a.file.url} download={a.file.name} style={{ color: ACC }}>файл</a>)}
                        {!on && <span>· не действует</span>}
                      </div>);
                  })}
                </div>)}
              {!!Object.keys(u.contracts || {}).filter((rid) => !(u.agreements || []).some((a) => a.roleId === rid)).length && (
                <div className="flex flex-wrap gap-2" style={{ flexBasis: "100%",
                  alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: C.muted }}>договоры:</span>
                  {Object.entries(u.contracts || {}).filter(([rid]) => !(u.agreements || []).some((a) => a.roleId === rid)).map(([rid, f]) => (
                    <a key={rid} href={reportSrc(f)} target="_blank" rel="noreferrer"
                      download={f?.name || "договор"}
                      aria-label={`договор «${roleName(rid) || rid}»: ${u.name}`}
                      style={{ fontSize: 10.5, color: ACC }}>
                      {roleName(rid) || rid} — {f?.name || "файл"}</a>))}
                </div>)}
            </>}
      </div>);
  };

  return (
    <div>
      <div style={{ fontSize: 11.5, color: C.muted, margin: "0 0 10px", lineHeight: 1.6 }}>
        Участником человек становится, подписав договор роли: он открывает
        приложение, выбирает роль, читает договор и присылает подписанный
        экземпляр — роль выдаётся сама. Ниже три формы: кто участвует, какие
        есть роли и что они открывают (права сотрудников), какие есть договоры, о чём
        спрашивают анкеты.
      </div>

      {/* ═══ 1. УЧАСТНИКИ ═══ */}
      <div style={card} aria-label="участники">
        {title("участники", org.users.length)}
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, lineHeight: 1.5 }}>
          Люди и агенты с их ролями. Роли ставятся и снимаются отметками; ✓ — договор подписан.
        </div>
        {people.map(userRow)}
        {!!agents.length && (
          <div style={{ ...S.lbl, marginTop: 8 }}>агенты</div>)}
        {agents.map(userRow)}
        {org.users.length <= 1 && (
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
            Кроме вас пока никого. Перешлите боту сообщение от человека —
            он предложит выбрать роль. Агентов заводят во вкладке «Агенты».
          </div>)}
      </div>

      {/* ═══ 2. ПРАВА СОТРУДНИКОВ (владелец, 2026-09-14: так называется
          форма ролей и того, что они открывают) ═══ */}
      <div style={card} aria-label="права сотрудников">
        {title("права сотрудников", org.roles.length)}
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, lineHeight: 1.5 }}>
          У роли — договор, анкета и вкладки, которые она открывает. Роль действует, пока
          действует подписанный договор; «Пригласить участника» выдаёт договор роли.
        </div>
        {org.roles.map((r) => (
          <div key={r.id} style={{ background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: 8, padding: 8, marginBottom: 6 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>{r.name}</span>
              <span style={{ fontSize: 10, color: C.muted }}>
                участников: {org.users.filter((u) => (u.roles || []).includes(r.id)).length}</span>
              {r.builtin && <span style={{ fontSize: 9.5, color: C.muted }}>встроенная</span>}
              <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
                disabled={busy || org.roles.length <= 1}
                title={org.roles.length <= 1 ? "Последнюю роль удалить нельзя — позвать станет некого" : ""}
                onClick={() => act(() => removeRole(r.id))}>Удалить роль</button>
            </div>
            {/* Договор роли — документ из формы «договоры» ниже; прежний
                файл-шаблон показывается, пока он есть у роли. */}
            <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 10.5, color: C.muted }}>договор:</span>
              <select style={{ ...S.inp, flex: "0 1 220px", fontSize: 11.5, padding: "3px 6px" }}
                value={r.doc || ""} disabled={busy} aria-label={`договор роли «${r.name}»`}
                onChange={(e) => act(() => setRoleDoc(r.id, e.target.value || null))}>
                <option value="">— нет: роль выдаётся без договора —</option>
                {(org.docs || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              {r.doc && (
                <button type="button" style={btn(true, OK)} disabled={busy}
                  aria-label={`пригласить участника: ${r.name}`}
                  onClick={() => setInvite(r)}>Пригласить участника</button>)}
            </div>
            {r.contract && !r.doc && (
              <Contract role={r} busy={busy} onSet={(f) => act(() => setRoleContract(r.id, f))} />)}
            {/* Анкета — тоже свойство роли: о чём спрашивать человека, решает
                то, кем он здесь является. */}
            <RoleFormPick role={r} forms={org.forms || []} busy={busy} act={act} />
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>открывает вкладки:</div>
            <div className="flex flex-wrap gap-2">
              {ALL_TABS.map((t) => {
                const on = (r.tabs || []).includes(t);
                return (
                  <button key={t} style={btn(on, on ? OK : undefined)} disabled={busy}
                    onClick={() => act(() => setRoleTabs(r.id,
                      on ? r.tabs.filter((x) => x !== t) : [...(r.tabs || []), t]))}>
                    {TAB_NAMES[t] || t}</button>);})}
            </div>
          </div>))}
        <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 6 }}>
          <TxtField value={newRole} placeholder="название новой роли"
            style={{ flex: "2 1 170px" }} onCommit={setNewRole} />
          <button style={btn(true)} disabled={busy || !newRole.trim()}
            onClick={() => act(async () => { await addRole(newRole.trim()); setNewRole(""); })}>
            + роль</button>
        </div>
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
          Новая роль открывает только «Задачи» — остальное добавьте кнопками выше.
        </div>
      </div>

      {/* ═══ 3. ДОГОВОРЫ ═══ */}
      <div style={card} aria-label="договоры">
        {title("договоры", (org.docs || []).length)}
        <DocsSection docs={org.docs || []} busy={busy} act={act} />
      </div>

      {/* ═══ 4. АНКЕТЫ ═══ */}
      <div style={card} aria-label="анкеты">
        {title("анкеты", (org.forms || []).length)}
        <FormsSection forms={org.forms || []} busy={busy} act={act} />
      </div>
      {invite && (
        <InviteModal role={invite} doc={(org.docs || []).find((d) => d.id === invite.doc) || null}
          me={me} onClose={() => setInvite(null)} onDone={() => load()} />)}
      {msg && <div style={{ fontSize: 11.5, color: WARN, marginTop: 6 }}>{msg}</div>}
    </div>);
}
