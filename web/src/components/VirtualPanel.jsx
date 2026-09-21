import React, { useEffect, useMemo, useState } from "react";
import { ACC, Avatar, BAD, C, OK, S, WARN, btn } from "./ui.jsx";
import {
  ALL_TABS, TAB_NAMES, addByCode, addVirtual, dropAccessCode, getAccessCode, listVirtual,
  makeAccessCode, removeVirtual, setActingAs, setVirtualRoles,
} from "../identity.js";

/* ════════════════════════════════════════════════════════════════
   ВИРТУАЛЬНЫЕ СОТРУДНИКИ (владелец, 2026-09-20)

   Третий вид участника, помимо человека и агента: СТРАНИЦА, за которой
   ещё нет человека. Нужна двоим:

   · рекрутеру или рефереру — провести онбординг самому, заполнив за
     будущего сотрудника всё, что можно заполнить заранее;
   · тому, кто работает с незарегистрированным заказчиком, — заполнять
     за него в приложении то, что тот не заполнит сам.

   Имени у страницы нет: есть ФРАЗА ИЗ ДВУХ СЛОВ, та же, что у рук в
   тексте технологического процесса. Звать чьим-то именем страницу, за
   которой никого нет, значило бы обещать человека, которого ещё нет.

   ─── и обратный случай: ЧУЖАЯ СТРАНИЦА ПО КОДУ (владелец, 2026-09-20)

   «+ сотрудник» сначала спрашивает код. Код выдаёт сам человек — на
   форме ниже, — и тот, кто код ввёл, получает его страницу в этом же
   списке: заходит на неё так же, как на виртуальную, пока код не истёк.
   Хозяин при этом продолжает работать у себя: доступ не передаётся, а
   разделяется. Без кода «+ сотрудник» заводит пустую страницу, как
   раньше.
   ════════════════════════════════════════════════════════════════ */

const card = { ...S.card, marginBottom: "var(--space-8)" };
const mono = { fontFamily: "var(--font-sans)" };

/* Модальное окно — одно на форму: и «введите код», и «вы уверены».
   Развилка одинаковая, и рисовать её дважды значило бы разойтись в
   мелочах. */
function Modal({ children, onClose }) {
  return (
    <div role="dialog" aria-modal="true"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: "var(--space-16)" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: "var(--radius-sm)",
          padding: "var(--space-12)", width: "100%", maxWidth: 340 }}>
        {children}
      </div>
    </div>);
}

/* ─────── ФОРМА КОДА ДОСТУПА (владелец, 2026-09-20) ───────

   Кнопка, поле с кодом, минуты, «r/rw» и кнопки вкладок. Порядок тот же,
   в каком код собирают: сперва решают, НА СКОЛЬКО и ЧТО открыть, потом
   жмут кнопку и читают код. Поле только для чтения: код придумывает
   сервер — набранный руками не был бы ничьим. */
function CodeForm({ me }) {
  const [code, setCode] = useState(null);
  const [minutes, setMinutes] = useState(15);
  const [access, setAccess] = useState("rw");
  const [tabs, setTabs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    getAccessCode().then((r) => {
      if (!r?.code) return;
      setCode(r.code);
      setMinutes(r.code.minutes || 15);
      setAccess(r.code.access || "rw");
      setTabs(r.code.tabs || []);
    }).catch(() => {});
  }, []);

  /* Открыть можно только то, что есть у самого: вкладка, которой у
     хозяина нет, гостю показала бы пустое место. */
  const mine = useMemo(() => {
    if (me?.isOwner || me?.solo) return ALL_TABS;
    const has = me?.access || {};
    return ALL_TABS.filter((t) => has[t] || (me?.tabs || []).includes(t));
  }, [me]);

  const gen = async () => {
    setBusy(true); setMsg("");
    try { setCode((await makeAccessCode(minutes, access, tabs)).code); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };
  const drop = async () => {
    setBusy(true); setMsg("");
    try { await dropAccessCode(); setCode(null); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  const left = code ? Math.max(0, Math.round((Date.parse(code.expiresAt) - Date.now()) / 60000)) : 0;

  return (
    <div style={card} aria-label="форма кода доступа">
      <div style={S.lbl}>код доступа</div>

      <button type="button" style={{ ...btn(true, ACC), marginTop: "var(--space-8)" }} disabled={busy}
        onClick={gen}>Сгенерировать код для техподдержки</button>

      <div className="flex items-center gap-2" style={{ marginTop: "var(--space-8)" }}>
        <input readOnly value={code?.code || ""} aria-label="код доступа"
          onFocus={(e) => e.target.select()}
          style={{ ...S.inp, flex: 1, minWidth: 0, ...mono, fontSize: "var(--fs-title)", letterSpacing: "var(--ls-code)" }} />
        {code && (
          <>
            <span style={{ fontSize: "var(--fs-hint)", color: left ? C.muted : BAD }}>{left} мин</span>
            <button type="button" style={btn(false)} disabled={busy}
              aria-label="погасить код" onClick={drop}>×</button>
          </>)}
      </div>

      {/* «Срок действия кода» и «права» — подписями перед полем и перед
          выбором (владелец, 2026-09-21); минуты — единица у самого поля. */}
      <div className="flex items-center gap-2" style={{ marginTop: "var(--gap)" }}>
        <span style={{ fontSize: "var(--fs-body)", color: C.muted }}>срок действия кода</span>
        <input type="number" min={1} max={1440} value={minutes} aria-label="срок действия кода"
          onChange={(e) => setMinutes(Number(e.target.value))}
          style={{ ...S.inp, width: 74 }} />
        <span style={{ fontSize: "var(--fs-hint)", color: C.muted }}>мин</span>
      </div>

      <div className="flex items-center gap-3" style={{ marginTop: "var(--gap)" }}>
        <span style={{ fontSize: "var(--fs-body)", color: C.muted }}>права</span>
        {["r", "rw"].map((a) => (
          <label key={a} className="flex items-center gap-1"
            style={{ fontSize: "var(--fs-hint)", cursor: "pointer", color: access === a ? C.text : C.muted }}>
            <input type="radio" name="code-access" value={a} checked={access === a}
              aria-label={a} onChange={() => setAccess(a)} />
            {a}
          </label>))}
      </div>

      {/* Отступ перед вкладками — больше обычного, чтобы кнопки вкладок
          читались своей формой (владелец, 2026-09-21). Один шрифт на все,
          ячейки равные, зазор 3 мм — сетка ряда (index.css). */}
      <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-16)" }}
        aria-label="вкладки по коду">
        {mine.map((t) => {
          const on = tabs.includes(t);
          return (
            <button key={t} type="button" aria-pressed={on} disabled={busy}
              aria-label={`вкладка ${TAB_NAMES[t] || t}`}
              style={btn(on, on ? OK : undefined)}
              onClick={() => setTabs((p) => (on ? p.filter((x) => x !== t) : [...p, t]))}>
              {TAB_NAMES[t] || t}</button>);
        })}
      </div>

      {msg && <div role="status" style={{ fontSize: "var(--fs-hint)", color: BAD, marginTop: "var(--space-8)" }}>{msg}</div>}
    </div>);
}

export default function VirtualPanel({ me, onEnter }) {
  const [view, setView] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [kill, setKill] = useState(null);
  const known = Boolean(me?.known && !me?.solo);

  const load = () => listVirtual().then(setView).catch((e) => setMsg(e.message));
  useEffect(() => { if (known) load(); }, [known]);   // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (job) => {
    setBusy(true); setMsg("");
    try { const out = await job(); await load(); return out; }
    catch (e) { setMsg(e.message); return null; }
    finally { setBusy(false); }
  };

  /* «Войти под его именем»: приложение целиком начинает работать с этой
     страницы — та же регистрация, те же вкладки. Возвращаются кнопкой в
     шапке; здесь только вход. */
  const enter = (u) => { setActingAs(u.id); onEnter?.(u); };

  const roles = view?.roles || [];

  const submitAdd = async () => {
    const key = code.trim();
    setAdding(false); setCode("");
    await act(() => (key ? addByCode(key) : addVirtual(roles[0]?.id || null)));
  };

  if (!known) {
    return (
      <div style={card}>
        <div style={S.lbl}>виртуальные сотрудники</div>
        <div style={{ fontSize: "var(--fs-hint)", color: C.muted, marginTop: "var(--space-4)", lineHeight: 1.5 }}>
          Виртуальные сотрудники живут на сервере: откройте приложение через Telegram.
        </div>
      </div>);
  }

  return (
    <>
      <div style={card} aria-label="виртуальные сотрудники">
        <div className="flex items-center gap-2" style={{ marginBottom: "var(--space-8)" }}>
          <span style={{ ...S.lbl, flex: 1 }}>виртуальные сотрудники</span>
          <span style={{ fontSize: "var(--fs-hint)", color: C.muted }}>{(view?.users || []).length}</span>
          <button type="button" style={btn(true, OK)} disabled={busy}
            onClick={() => { setCode(""); setAdding(true); }}>
            + сотрудник</button>
        </div>

        {!view && !msg && <div style={{ fontSize: "var(--fs-hint)", color: C.muted }}>Загружаю…</div>}
        {view && !view.users.length && (
          <div style={{ fontSize: "var(--fs-hint)", color: C.muted, lineHeight: 1.5 }}>
            Пока никого. Заведите страницу — и заполняйте её за будущего сотрудника,
            пока он не придёт по ссылке и не заберёт её себе.
          </div>)}

        {(view?.users || []).map((u) => (
          <div key={u.id} aria-label={`виртуальный ${u.name}`}
            style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: "var(--radius-sm)",
              padding: "var(--space-8)", marginTop: "var(--space-8)" }}>
            <div className="flex flex-wrap items-center gap-2">
              {/* Лица у страницы нет — знак приложения, как у незнакомца.
                  У настоящего человека, пустившего по коду, лицо своё. */}
              <Avatar name={u.name} src={u.avatar || u.photo} size={28} logo={!u.real}
                title={u.real ? u.name : `страница: ${u.name}`} />
              <span style={{ fontSize: "var(--fs-body)", fontWeight: 700, flex: "1 1 120px", ...mono }}>
                {u.name}</span>
              <span style={{ fontSize: "var(--fs-hint)", color: u.real ? ACC : C.muted }}>
                {u.real ? `по коду · ${u.grant?.access || "rw"}`
                  : (u.tg ? "страницу забрали" : "человека ещё нет")}</span>
            </div>

            {/* Роли — кнопками, как у обычного участника (владелец,
                2026-09-20): их может быть несколько, он и дизайнер, и
                проверяющий. Чужие роли отсюда не правят: страница не наша. */}
            {!u.real && (
              <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: "var(--space-8)" }}>
                {roles.map((r) => {
                  const has = (u.roles || []).includes(r.id);
                  return (
                    <button key={r.id} type="button" aria-pressed={has} disabled={busy}
                      aria-label={`роль «${r.name}»: ${u.name}`}
                      style={{ ...btn(has, has ? OK : undefined), paddingTop: "calc(var(--btn-py) + var(--text-nudge))", paddingBottom: "calc(var(--btn-py) - var(--text-nudge))", paddingLeft: "var(--space-8)", paddingRight: "var(--space-8)" }}
                      onClick={() => act(() => setVirtualRoles(u.id, has
                        ? (u.roles || []).filter((x) => x !== r.id)
                        : [...(u.roles || []), r.id]))}>
                      {r.name}</button>);
                })}
                {!roles.length && (
                  <span style={{ fontSize: "var(--fs-hint)", color: WARN }}>ролей ещё нет</span>)}
              </div>)}

            {/* Пропуск строки перед «Войти под его именем» (владелец,
                2026-09-21): иначе эти кнопки читались как ещё две роли. */}
            <div className="flex flex-wrap gap-2" style={{ marginTop: "var(--space-24)" }}>
              <button type="button" style={btn(true, ACC)} disabled={busy}
                aria-label={`войти под именем ${u.name}`}
                onClick={() => enter(u)}>Войти под его именем</button>
              <button type="button" style={btn(false, BAD)} disabled={busy}
                aria-label={`удалить сотрудника ${u.name}`}
                onClick={() => setKill(u)}>Удалить сотрудника</button>
            </div>

            {/* Ссылка — внизу формы и сразу: страница заводится вместе с
                ней, и отдельной кнопки для этого нет. */}
            {u.link && (
              <div style={{ marginTop: "var(--space-8)" }}>
                <div style={{ fontSize: "var(--fs-hint)", color: C.muted }}>ссылка для регистрации:</div>
                <input readOnly value={u.link} aria-label={`ссылка ${u.name}`}
                  onFocus={(e) => e.target.select()}
                  style={{ ...S.inp, width: "100%", fontSize: "var(--fs-hint)", marginTop: "var(--space-4)", ...mono }} />
              </div>)}
          </div>))}

        {msg && <div role="status" style={{ fontSize: "var(--fs-hint)", color: BAD, marginTop: "var(--space-8)" }}>{msg}</div>}
      </div>

      <CodeForm me={me} />

      {adding && (
        <Modal onClose={() => setAdding(false)}>
          <div style={S.lbl}>код доступа</div>
          <input autoFocus value={code} aria-label="код доступа сотрудника"
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); }}
            style={{ ...S.inp, width: "100%", marginTop: "var(--space-8)", ...mono,
              fontSize: "var(--fs-title)", letterSpacing: "var(--ls-code)" }} />
          <div className="flex gap-2" style={{ marginTop: "var(--space-8)" }}>
            <button type="button" style={btn(true, OK)} onClick={submitAdd}>Добавить</button>
            <button type="button" style={btn(false)}
              onClick={() => setAdding(false)}>Отмена</button>
          </div>
        </Modal>)}

      {kill && (
        <Modal onClose={() => setKill(null)}>
          <div style={{ fontSize: "var(--fs-body)" }}>Вы уверены? Это действие необратимо</div>
          <div className="flex gap-2" style={{ marginTop: "var(--space-8)" }}>
            <button type="button" style={btn(true, BAD)}
              onClick={() => { const u = kill; setKill(null); act(() => removeVirtual(u.id)); }}>
              Да</button>
            <button type="button" style={btn(false)} onClick={() => setKill(null)}>Нет</button>
          </div>
        </Modal>)}
    </>);
}
