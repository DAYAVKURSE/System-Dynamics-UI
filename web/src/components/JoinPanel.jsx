import React, { useEffect, useState } from "react";
import { ACC, BAD, Brand, C, OK, S, btn } from "./ui.jsx";
import { joinRemote, peekJoin } from "../identity.js";

/* ════════════════════════════════════════════════════════════════
   ПРИШЛИ ПО ССЫЛКЕ (владелец, 2026-09-20)

   Ссылку присылает тот, кто завёл страницу и заполнил за будущего
   сотрудника всё, что можно заполнить заранее. Человек по ней видит, что
   его ждёт — какая роль и что уже заполнено, — и забирает страницу себе.

   Дальше всё идёт обычным путём: не хватает договора — приложение ведёт
   его подписывать, как любого позванного. Отдельной «второй регистрации»
   здесь нет: она одна на всех, и эта ссылка лишь говорит, чья страница.

   Дважды не регистрируются. У кого доступ уже есть — тот видит ошибку
   словами, а не вторую страницу: иначе один человек оказался бы в
   организации двумя участниками, и было бы неясно, которому поручать.
   ════════════════════════════════════════════════════════════════ */

export default function JoinPanel({ me, token, onJoined, onSkip }) {
  const [view, setView] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // Вошедший в систему по чужой ссылке не регистрируется заново.
  const already = Boolean(me?.known);

  useEffect(() => {
    let alive = true;
    peekJoin(token).then((v) => { if (alive) setView(v); },
      (e) => { if (alive) setErr(e.message || "ссылка не открывается"); });
    return () => { alive = false; };
  }, [token]);

  const join = async () => {
    setBusy(true); setErr("");
    /* Сперва вступаем, потом рассказываем: `onJoined?.(await …)` не
       годится — необязательный вызов не вычисляет аргументы вовсе, и без
       обработчика запрос просто не уходил бы. */
    try {
      const got = await joinRemote(token);
      onJoined?.(got);
    } catch (e) { setErr(e.message || "не удалось вступить"); }
    setBusy(false);
  };

  const card = { ...S.card, maxWidth: 520, margin: "0 auto" };
  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
        <Brand size={30} />
      </div>
      <div style={card} aria-label="вступление по ссылке">
        {already ? (<>
          <div style={{ fontSize: 13, fontWeight: 700, color: BAD, marginBottom: 6 }}>
            Вы уже зарегистрированы в системе</div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
            Эта ссылка заводит новую страницу, а у вас она уже есть. Второй раз
            зарегистрироваться нельзя: один человек — один участник.
          </div>
          <button type="button" style={{ ...btn(true, ACC), marginTop: 10 }}
            onClick={() => onSkip?.()}>Открыть приложение</button>
        </>) : (<>
          <div style={S.lbl}>вступление</div>
          {!view && !err && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Загружаю…</div>)}
          {view && (<>
            <div style={{ fontSize: 12, lineHeight: 1.8, marginTop: 6 }}>
              <div><span style={{ color: C.muted }}>страница: </span>
                <span style={{ fontFamily: "ui-monospace, monospace" }}>{view.name}</span></div>
              <div><span style={{ color: C.muted }}>роль: </span>
                {view.role?.name || "не назначена"}</div>
              {view.profile?.about && (
                <div><span style={{ color: C.muted }}>о себе: </span>{view.profile.about}</div>)}
            </div>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>
              Страница уже заполнена за вас — заберите её себе. Если по роли
              есть договор, приложение сразу предложит его прочитать и подписать.
            </div>
            <button type="button" style={{ ...btn(true, OK), marginTop: 10 }}
              disabled={busy} onClick={join}>
              {busy ? "Вступаю…" : "Вступить"}</button>
          </>)}
        </>)}
        {err && (
          <div role="status" style={{ fontSize: 12, color: BAD, marginTop: 8 }}>{err}</div>)}
      </div>
    </div>);
}
