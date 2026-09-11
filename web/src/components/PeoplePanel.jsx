import React, { useEffect, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, TxtField } from "./ui.jsx";
import {
  ALL_TABS, addRole, listOrg, removeRole, removeUser, setRoleTabs, setUserRole,
} from "../identity.js";

/* ════════════════════════════════════════════════════════════════
   ЛЮДИ И РОЛИ · панель владельца

   Звать людей — дело бота: там пересылаешь сообщение и выбираешь роль
   в два касания. Здесь то, что в переписку не помещается: кто уже есть,
   какие роли, что каждая роль открывает, и как это поменять.

   Права проверяет сервер. Панель просто не рисуется никому, кроме
   владельца, — но если бы и нарисовалась, каждый запрос отсюда получил бы
   отказ.
   ════════════════════════════════════════════════════════════════ */

/* Имена вкладок — те же слова, что на самих кнопках приложения: роль
   открывает «Отчёты», и в списке она должна называться «Отчёты», а не
   «reports». Список один со `SystemModel.TAB_LIST`. */
const TAB_NAMES = {
  tasks: "Задачи", review: "Проверка", scheme: "Схема",
  reports: "Отчёты", tools: "Инструменты",
};

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
        Звать людей — через бота: перешлите ему сообщение от человека и
        выберите роль. Здесь настраивается, что роль открывает.
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
                    <select style={{ ...S.inp, flex: "0 1 150px" }} value={u.roleId || ""}
                      disabled={busy}
                      onChange={(e) => act(() => setUserRole(u.id, e.target.value))}>
                      <option value="" disabled>— без роли —</option>
                      {org.roles.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>))}
                    </select>
                    <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
                      disabled={busy}
                      onClick={() => act(() => removeUser(u.id))}>✕</button>
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
                людей: {org.users.filter((u) => u.roleId === r.id).length}</span>
              {r.builtin && <span style={{ fontSize: 9.5, color: C.muted }}>встроенная</span>}
              <button style={{ ...btn(false), color: BAD, borderColor: "#5A2436" }}
                disabled={busy || org.roles.length <= 1}
                title={org.roles.length <= 1 ? "Последнюю роль удалить нельзя — позвать станет некого" : ""}
                onClick={() => act(() => removeRole(r.id))}>Удалить роль</button>
            </div>
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
