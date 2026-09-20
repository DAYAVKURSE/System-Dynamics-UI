import React, { useEffect, useState } from "react";
import { ACC, Avatar, BAD, C, OK, S, WARN, btn } from "./ui.jsx";
import { addVirtual, listVirtual, setActingAs, setVirtualRoles } from "../identity.js";

/* ════════════════════════════════════════════════════════════════
   ВИРТУАЛЬНЫЕ СОТРУДНИКИ (владелец, 2026-09-20)

   Третий вид участника, помимо человека и агента: СТРАНИЦА, за которой
   ещё нет человека. Нужна двоим:

   · рекрутеру или рефереру — провести онбординг самому, заполнив за
     будущего сотрудника всё, что можно заполнить заранее;
   · тому, кто работает с незарегистрированным заказчиком, — заполнять
     за него в приложении то, что тот не заполнит сам.

   Форма почти как у участников, и в ней ровно три действия: выбрать
   роль, войти под этой страницей и сгенерировать ссылку для регистрации.
   Всё остальное делается уже НА самой странице — тем же приложением.

   Имени у страницы нет: есть ФРАЗА ИЗ ДВУХ СЛОВ, та же, что у рук в
   тексте технологического процесса. Звать чьим-то именем страницу, за
   которой никого нет, значило бы обещать человека, которого ещё нет.
   ════════════════════════════════════════════════════════════════ */

const card = { ...S.card, marginBottom: 10 };

export default function VirtualPanel({ me, onEnter }) {
  const [view, setView] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
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

  if (!known) {
    return (
      <div style={card}>
        <div style={S.lbl}>виртуальные сотрудники</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
          Виртуальные сотрудники живут на сервере: откройте приложение через Telegram.
        </div>
      </div>);
  }

  const roles = view?.roles || [];
  return (
    <div style={card} aria-label="виртуальные сотрудники">
      <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
        <span style={{ ...S.lbl, flex: 1 }}>виртуальные сотрудники</span>
        <span style={{ fontSize: 10.5, color: C.muted }}>{(view?.users || []).length}</span>
        <button type="button" style={btn(true, OK)} disabled={busy}
          onClick={() => act(() => addVirtual(roles[0]?.id || null))}>
          + сотрудник</button>
      </div>

      {!view && !msg && <div style={{ fontSize: 12, color: C.muted }}>Загружаю…</div>}
      {view && !view.users.length && (
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
          Пока никого. Заведите страницу — и заполняйте её за будущего сотрудника,
          пока он не придёт по ссылке и не заберёт её себе.
        </div>)}

      {(view?.users || []).map((u) => (
        <div key={u.id} aria-label={`виртуальный ${u.name}`}
          style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8,
            padding: 8, marginTop: 8 }}>
          <div className="flex flex-wrap items-center gap-2">
            {/* Лица у страницы нет — знак приложения, как у незнакомца. */}
            <Avatar name={u.name} size={28} logo title={`страница: ${u.name}`} />
            <span style={{ fontSize: 12.5, fontWeight: 700, flex: "1 1 120px",
              fontFamily: "ui-monospace, monospace" }}>{u.name}</span>
            <span style={{ fontSize: 10, color: C.muted }}>
              {u.tg ? "страницу забрали" : "человека ещё нет"}</span>
          </div>

          {/* Роли — кнопками, как у обычного участника (владелец,
              2026-09-20): их может быть несколько, он и дизайнер, и
              проверяющий. */}
          <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 8 }}>
            {roles.map((r) => {
              const has = (u.roles || []).includes(r.id);
              return (
                <button key={r.id} type="button" aria-pressed={has} disabled={busy}
                  aria-label={`роль «${r.name}»: ${u.name}`}
                  style={{ ...btn(has, has ? OK : undefined), fontSize: 11, padding: "2px 7px" }}
                  onClick={() => act(() => setVirtualRoles(u.id, has
                    ? (u.roles || []).filter((x) => x !== r.id)
                    : [...(u.roles || []), r.id]))}>
                  {r.name}</button>);
            })}
            {!roles.length && (
              <span style={{ fontSize: 10.5, color: WARN }}>ролей ещё нет</span>)}
          </div>

          <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
            <button type="button" style={btn(true, ACC)} disabled={busy}
              aria-label={`войти под именем ${u.name}`}
              onClick={() => enter(u)}>Войти под его именем</button>
          </div>

          {/* Ссылка — внизу формы и сразу: страница заводится вместе с
              ней, и отдельной кнопки для этого нет. */}
          {u.link && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10.5, color: C.muted }}>ссылка для регистрации:</div>
              <input readOnly value={u.link} aria-label={`ссылка ${u.name}`}
                onFocus={(e) => e.target.select()}
                style={{ ...S.inp, width: "100%", fontSize: 11, marginTop: 3,
                  fontFamily: "ui-monospace, monospace" }} />
            </div>)}
        </div>))}

      {msg && <div role="status" style={{ fontSize: 12, color: BAD, marginTop: 8 }}>{msg}</div>}
    </div>);
}
