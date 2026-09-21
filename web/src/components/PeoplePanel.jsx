import React, { useEffect, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn, Download, TxtField , statusEdge} from "./ui.jsx";
import { renameRole,
  ALL_TABS, TAB_NAMES, addRole, listOrg, removeRole, removeUser, setRoleContract, setRoleTabs,
  setUserRoles,
} from "../identity.js";
import { putReportFile, reportSrc } from "../storage.js";
import { FormsSection, RoleFormPick } from "./FormsPanel.jsx";
import { DocViewer, DocsSection, InviteModal, dayText } from "./ContractsPanel.jsx";
import { agreementHtml, contractHtml, setRoleDoc } from "../identity.js";
import Modal from "./Modal.jsx";

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

/* Право роли на вкладке — нажатиями по кругу: закрыта → «r» (жёлтая,
   только смотреть) → «rw» (зелёная, ещё и править) → снова закрыта
   (владелец, 2026-09-20). Право пишется справа от названия, чтобы не
   угадывать его по цвету. */
const NEXT_ACCESS = { "": "r", r: "rw", rw: "" };
const accessIn = (role, tab) => (role.access || {})[tab]
  || ((role.tabs || []).includes(tab) ? "rw" : "");

/* ─── ПОЛОСКА УЧАСТНИКА (владелец, 2026-09-20) ───

   Слева у каждого — цвет его договора. КРАСНАЯ: договора нет, срок ещё не
   начался или уже вышел. ЖЁЛТАЯ: действует, но до конца меньше двух
   недель. ЗЕЛЁНАЯ: действует. Так видно, с кем продлевать, не открывая
   каждого. Подписанный экземпляр без сроков — договор есть, а срока у него
   нет: он действует, пока его не отозвали. */
const DAY = 86400000;
const SOON = 14 * DAY;
const dayMs = (v) => { const t = Date.parse(String(v || "")); return Number.isFinite(t) ? t : null; };
const inForce = (a, now) => {
  const from = dayMs(a.start), to = dayMs(a.end);
  if (from != null && now < from) return false;
  if (to != null && now > to + DAY - 1) return false;
  return true;
};
export const userTone = (u = {}, now = Date.now()) => {
  /* У владельца и агента договор бессрочный — полоска у них всегда
     зелёная (владелец, 2026-09-20). Правило одно на всех, разнится только
     срок. */
  if (u.owner || u.agent) return OK;
  /* Договор — и выданный владельцем (`agreements`), и принесённый файлом
     (`contracts`): срок есть у обоих, и считается он одинаково. */
  const all = [
    ...(u.agreements || []),
    ...Object.values(u.contracts || {}).filter((c) => c && (c.start || c.end)),
  ];
  const live = all.filter((a) => inForce(a, now));
  if (!live.length) return BAD;
  const ends = live.map((a) => dayMs(a.end)).filter((t) => t != null);
  if (!ends.length) return OK;
  return Math.min(...ends) + DAY - 1 - now < SOON ? WARN : OK;
};

/* Не Word — показываем сам файл тем же окном: картинку картинкой,
   остальное — страницей внутри окна. */
const fileHtml = (url, type) => (/^image\//.test(String(type || ""))
  ? `<img src="${url}" alt="" style="max-width:100%">`
  : `<iframe src="${url}" title="договор" style="width:100%;height:78vh;border:0"></iframe>`);

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

export default function PeoplePanel({ me, onPeople, onChanged, onRoleRenamed }) {
  const [renaming, setRenaming] = useState(null);   // какую роль переименовывают
  const [org, setOrg] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [newRole, setNewRole] = useState("");
  const [invite, setInvite] = useState(null);   // роль, в которую зовём
  const [add, setAdd] = useState(null);         // {user, role} — кого добавляем
  const [shown, setShown] = useState("");       // раскрытый договор в списке
  const [doc, setDoc] = useState(null);         // {title, html} — окно просмотра
  const [docErr, setDocErr] = useState({});     // почему договор не открылся

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

  /* ─── договор в списке участника ───

     Кнопка, а не ссылка с подписью «файл»: что договор — файл, и так
     видно (владелец, 2026-09-20). Нажатие раскрывает «Скачать» и
     «Посмотреть»; скачивание идёт по ссылке на сам файл, а просмотр
     открывает то же окно, что и правка документа, только без правки. */
  const openDoc = async (key, title, load) => {
    setDocErr({});
    try {
      const r = await load();
      setDoc({ title, html: r.html || fileHtml(r.url, r.type) });
    } catch (e) {
      // Ошибку видно У СТРОКИ, а не общей строчкой внизу страницы: туда
      // никто не смотрит, и нажатие выглядело как «кнопка не работает».
      setDocErr({ [key]: e.message || "не удалось открыть договор" });
    }
  };
  const docRow = (key, { label, tone, url, name, view }) => (
    <div key={key} style={{ flexBasis: "100%" }}>
      <button type="button" aria-label={`договор ${label}`}
        onClick={() => setShown(shown === key ? "" : key)}
        style={{ background: "transparent", border: "none", padding: 0, textAlign: "left",
          color: tone || C.text, fontSize: 10.5, cursor: "pointer" }}>{label}</button>
      {shown === key && (
        <div className="flex flex-wrap gap-2" style={{ margin: "4px 0 6px" }}>
          <Download url={url} name={name || "договор"}
            aria-label={`скачать договор ${label}`}
            style={{ fontSize: 10.5, padding: "2px 8px" }} />
          <button type="button" aria-label={`посмотреть договор ${label}`}
            style={{ ...btn(false), fontSize: 10.5, padding: "2px 8px" }}
            onClick={view}>Посмотреть</button>
          {docErr[key] && (
            <span style={{ fontSize: 10.5, color: BAD }}>{docErr[key]}</span>)}
        </div>)}
    </div>);

  const userRow = (u) => {
    const owner = u.id === org.ownerId;
    return (
      /* Каждый участник — своей формой внутри формы участников (владелец,
         2026-09-13: «чтобы визуально достаточно это всё отделить»), а не
         строкой с чертой снизу: у человека две-три строки (имя, роли,
         договоры), и черта между ними не отделяла одного от другого. */
      <div key={u.id} className="flex flex-wrap gap-2" aria-label={`участник ${u.name}`}
        style={{ alignItems: "center", padding: "var(--space-12)",
          marginBottom: "var(--space-8)", background: C.panel2,
          borderRadius: "var(--radius-md)",
          /* Состояние участника — свечением по контуру, у ВСЕХ (владелец,
             2026-09-20); полоска слева ушла вместе с прежним дизайном. */
          ...statusEdge(userTone({ ...u, owner })) }}>
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
                  /* ЖЁЛТАЯ роль — договор по ней подписан, а роли нет:
                     человек пришёл сам, и впустить его решает владелец
                     (владелец, 2026-09-20). Нажатие спрашивает, а не
                     впускает молча. */
                  const asks = !!signed && !has;
                  return (
                    <button key={r.id} aria-pressed={has} disabled={busy}
                      aria-label={`роль «${r.name}»: ${u.name}`}
                      style={{ ...btn(has || asks, has ? OK : asks ? WARN : undefined),
                        fontSize: 11, padding: "2px 7px" }}
                      onClick={() => (asks ? setAdd({ user: u, role: r })
                        : act(() => setUserRoles(u.id, has
                          ? (u.roles || []).filter((x) => x !== r.id)
                          : [...(u.roles || []), r.id])))}>
                      {r.name}{has && signed ? " ✓" : ""}</button>);
                })}
                {!!u.pending && (
                  <span style={{ fontSize: 10.5, color: WARN }}>
                    ждёт договора: {roleName(u.pending) || u.pending}</span>)}
                <span style={{ flex: 1 }} />
                <button style={{ ...btn(true, BAD) }}
                  disabled={busy} aria-label={`убрать: ${u.name}`}
                  onClick={() => act(() => removeUser(u.id))}>✕</button>
              </div>
              {/* Договоры участника — под ролями (владелец, 2026-09-14):
                  начало, окончание, сумма; недействующий срок — жёлтым. */}
              {!!(u.agreements || []).length && (
                <div style={{ flexBasis: "100%" }} aria-label={`договоры: ${u.name}`}>
                  {u.agreements.map((a) => {
                    const on = (u.active || []).includes(a.roleId);
                    const label = `${roleName(a.roleId) || a.roleId} · ${a.docName || "договор"}`
                      + ` · с ${dayText(a.start)} по ${dayText(a.end)} · сумма ${a.sum}`
                      + (on ? "" : " · не действует");
                    return docRow(`a:${a.id}`, { label, tone: on ? C.text : WARN,
                      url: a.file?.url, name: a.file?.name,
                      view: () => openDoc(`a:${a.id}`, label, () => agreementHtml(a.id)) });
                  })}
                </div>)}
              {!!Object.keys(u.contracts || {}).filter((rid) => !(u.agreements || []).some((a) => a.roleId === rid)).length && (
                <div style={{ flexBasis: "100%" }} aria-label={`подписанные договоры: ${u.name}`}>
                  {Object.entries(u.contracts || {}).filter(([rid]) => !(u.agreements || []).some((a) => a.roleId === rid)).map(([rid, f]) => {
                    /* Сроки — у каждого пункта (владелец, 2026-09-20). У
                       подписанного экземпляра их нет: его принесли файлом,
                       без дат, — так и сказано. */
                    const label = `${roleName(rid) || rid}${f?.name ? ` · ${f.name}` : ""}`
                      + ` · с ${dayText(f?.start)} по ${dayText(f?.end)}`;
                    return docRow(`${u.id}:${rid}`, { label, tone: ACC,
                      url: reportSrc(f), name: f?.name,
                      view: () => openDoc(`${u.id}:${rid}`, label,
                        () => contractHtml(u.id, rid)) });
                  })}
                </div>)}
            </>}
      </div>);
  };

  return (
    <div>
      {/* ═══ 1. УЧАСТНИКИ ═══ */}
      <div style={card} aria-label="участники">
        {title("участники", org.users.length)}
        {people.map(userRow)}
        {!!agents.length && (
          <div style={{ ...S.lbl, marginTop: 8 }}>агенты</div>)}
        {agents.map(userRow)}
        {org.users.length <= 1 && (
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
            Кроме вас пока никого.
          </div>)}
      </div>

      {/* ═══ 2. ПРАВА СОТРУДНИКОВ (владелец, 2026-09-14: так называется
          форма ролей и того, что они открывают) ═══ */}
      {/* Форма называется «роли» (владелец, 2026-09-18), прежде — «права сотрудников». */}
      <div style={card} aria-label="роли">
        {title("роли", org.roles.length)}
        {org.roles.map((r) => (
          <div key={r.id} style={{ background: C.panel2, border: `1px solid ${C.line}`,
            borderRadius: 8, padding: 8, marginBottom: 6 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
              {/* Название роли правится на месте (владелец, 2026-09-18): Enter
                  или уход из поля записывает, пустое — не записывается. */}
              {renaming === r.id ? (
                <input autoFocus defaultValue={r.name} aria-label={`новое название роли «${r.name}»`}
                  style={{ ...S.inp, flex: 1, fontSize: 12.5, fontWeight: 700, padding: "3px 6px" }}
                  onBlur={(e) => { const v = e.target.value.trim(); setRenaming(null); if (v && v !== r.name) act(async () => { await renameRole(r.id, v); onRoleRenamed?.(r.id, r.name, v); }); }}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenaming(null); }} />
              ) : (
                <button type="button" aria-label={`переименовать роль «${r.name}»`} title="нажмите, чтобы переименовать"
                  onClick={() => setRenaming(r.id)} disabled={busy}
                  style={{ flex: 1, minWidth: 0, textAlign: "left", background: "transparent", border: "none", padding: 0,
                    color: C.text, fontSize: 12.5, fontWeight: 700, cursor: "text" }}>{r.name} <span style={{ color: C.muted, fontWeight: 400, fontSize: 11 }}>✎</span></button>)}
              <span style={{ fontSize: 10, color: C.muted }}>
                участников: {org.users.filter((u) => (u.roles || []).includes(r.id)).length}</span>
              {r.builtin && <span style={{ fontSize: 9.5, color: C.muted }}>встроенная</span>}
              <button style={{ ...btn(true, BAD) }}
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
                const acc = accessIn(r, t);
                const inner = t.includes(":");
                return (
                  <button key={t} disabled={busy}
                    aria-label={`вкладка ${TAB_NAMES[t] || t}: ${acc || "закрыта"}`}
                    style={{ ...btn(!!acc, acc === "rw" ? OK : acc === "r" ? WARN : undefined),
                      ...(inner ? { fontSize: 10.5, padding: "3px 8px" } : {}) }}
                    onClick={() => act(() => setRoleTabs(r.id, (() => {
                      const map = {};
                      ALL_TABS.forEach((x) => { const a = accessIn(r, x); if (a) map[x] = a; });
                      const next = NEXT_ACCESS[acc];
                      if (next) map[t] = next; else delete map[t];
                      return map;
                    })()))}>
                    {TAB_NAMES[t] || t}{acc ? ` ${acc}` : ""}</button>);})}
            </div>
          </div>))}
        <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 6 }}>
          <TxtField value={newRole} placeholder="название новой роли"
            style={{ flex: "2 1 170px" }} onCommit={setNewRole} />
          <button style={btn(true)} disabled={busy || !newRole.trim()}
            onClick={() => act(async () => { await addRole(newRole.trim()); setNewRole(""); })}>
            + роль</button>
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

      {/* Нажали жёлтую роль — спрашиваем: добавить или отменить. Впустить
          человека молча одним нажатием нельзя (владелец, 2026-09-20). */}
      {add && (
        <Modal title={`${add.user.name} · роль «${add.role.name}»`}
          onClose={() => setAdd(null)}>
          <div className="flex flex-wrap gap-2" style={{ marginTop: 4 }}>
            <button type="button" style={btn(true, OK)} disabled={busy}
              aria-label={`добавить участника: ${add.user.name}`}
              onClick={() => {
                const u = add.user, r = add.role;
                setAdd(null);
                act(() => setUserRoles(u.id, [...(u.roles || []), r.id]));
              }}>Добавить участника</button>
            <button type="button" style={btn(false)}
              onClick={() => setAdd(null)}>Отменить</button>
          </div>
        </Modal>)}

      {/* Просмотр договора — то же окно, что и правка документа, без правки. */}
      {doc && (
        <DocViewer title={doc.title} html={doc.html} editable={false}
          onClose={() => setDoc(null)} />)}
      {msg && <div style={{ fontSize: 11.5, color: WARN, marginTop: 6 }}>{msg}</div>}
    </div>);
}
