import React, { useEffect, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, TxtField } from "./ui.jsx";
import {
  ALL_TABS, addRole, listOrg, removeRole, removeUser, setRoleContract, setRoleTabs,
  setUserRoles,
} from "../identity.js";
import { putReportFile, reportSrc } from "../storage.js";

/* ════════════════════════════════════════════════════════════════
   ЛЮДИ И РОЛИ · панель владельца

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

export default function PeoplePanel({ onPeople }) {
  const [org, setOrg] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [newRole, setNewRole] = useState("");

  const load = async () => {
    try {
      const o = await listOrg();
      setOrg(o);
      onPeople?.(o.users || []);
    } catch (e) { setMsg(e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const act = async (fn) => {
    setBusy(true); setMsg("");
    try { await fn(); await load(); }
    catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  if (!org) {
    return (
      <div style={{ ...S.card, marginBottom: 10 }}>
        <div style={S.lbl}>люди и роли</div>
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
          {msg || "Загружаю…"}</div>
      </div>);
  }

  const roleName = (id) => org.roles.find((r) => r.id === id)?.name;

  return (
    <div style={{ ...S.card, marginBottom: 10 }}>
      <div style={S.lbl}>люди и роли</div>
      <div style={{ fontSize: 11.5, color: C.muted, margin: "6px 0 10px", lineHeight: 1.6 }}>
        Участником человек становится, подписав договор роли: он открывает
        приложение, выбирает роль, читает договор и присылает подписанный
        экземпляр — роль выдаётся сама. Здесь настраивается, что роль
        открывает и какой по ней договор.
      </div>

      <div style={S.lbl}>кто есть</div>
      <div style={{ margin: "6px 0 12px" }}>
        {org.users.map((u) => {
          const owner = u.id === org.ownerId;
          return (
            <div key={u.id} className="flex flex-wrap gap-2"
              style={{ alignItems: "center", padding: "6px 0",
                borderBottom: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 12.5, flex: "1 1 130px" }}>
                {u.name}
                {u.username ? <span style={{ color: C.muted }}> @{u.username}</span> : null}
              </span>
              {owner
                ? <span style={{ fontSize: 10.5, color: ACC, border: `1px solid ${ACC}66`,
                    borderRadius: 3, padding: "1px 5px" }}>владелец</span>
                : <>
                    {/* Ролей у человека несколько — отметки, а не выбор
                        одной: выпадающий список молча снимал остальные.
                        Рядом с ролью — подписанный ли договор: участие
                        держится на нём, и «роль есть, договора нет» надо
                        видеть, а не выяснять. */}
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
                    {/* Подписанные договоры — ссылками: акцепт должен
                        открываться, а не значиться. */}
                    {!!Object.keys(u.contracts || {}).length && (
                      <div className="flex flex-wrap gap-2" style={{ flexBasis: "100%",
                        alignItems: "center" }}>
                        <span style={{ fontSize: 10, color: C.muted }}>договоры:</span>
                        {Object.entries(u.contracts || {}).map(([rid, f]) => (
                          <a key={rid} href={reportSrc(f)} target="_blank" rel="noreferrer"
                            download={f?.name || "договор"}
                            aria-label={`договор «${roleName(rid) || rid}»: ${u.name}`}
                            style={{ fontSize: 10.5, color: ACC }}>
                            {roleName(rid) || rid} — {f?.name || "файл"}</a>))}
                      </div>)}
                  </>}
            </div>);})}
        {org.users.length <= 1 && (
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
            Кроме вас пока никого. Перешлите боту сообщение от человека —
            он предложит выбрать роль.
          </div>)}
      </div>

      <div style={S.lbl}>роли и что они открывают</div>
      <div style={{ margin: "6px 0 10px" }}>
        {org.roles.map((r) => (
          <div key={r.id} style={{ background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: 8, padding: 8, marginBottom: 6 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>{r.name}</span>
              <span style={{ fontSize: 10, color: C.muted }}>
                людей: {org.users.filter((u) => (u.roles || []).includes(r.id)).length}</span>
              {r.builtin && <span style={{ fontSize: 9.5, color: C.muted }}>встроенная</span>}
              <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
                disabled={busy || org.roles.length <= 1}
                title={org.roles.length <= 1 ? "Последнюю роль удалить нельзя — позвать станет некого" : ""}
                onClick={() => act(() => removeRole(r.id))}>Удалить роль</button>
            </div>
            <Contract role={r} busy={busy} onSet={(f) => act(() => setRoleContract(r.id, f))} />
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
      </div>

      <div className="flex flex-wrap gap-2" style={{ alignItems: "center" }}>
        <TxtField value={newRole} placeholder="название новой роли"
          style={{ flex: "2 1 170px" }} onCommit={setNewRole} />
        <button style={btn(true)} disabled={busy || !newRole.trim()}
          onClick={() => act(async () => { await addRole(newRole.trim()); setNewRole(""); })}>
          + роль</button>
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
        Новая роль открывает только «Задачи» — остальное добавьте кнопками выше.
      </div>
      {msg && <div style={{ fontSize: 11.5, color: WARN, marginTop: 6 }}>{msg}</div>}
    </div>);
}
