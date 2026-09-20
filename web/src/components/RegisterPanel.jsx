import React, { useEffect, useState } from "react";
import { C, OK, WARN, BAD, ACC, S, btn } from "./ui.jsx";
import { agreementHtml, openRoles, registerRemote, signAgreement } from "../identity.js";
import { reportSrc } from "../storage.js";
import { DocViewer, PlaceholderFields, dayText } from "./ContractsPanel.jsx";
import { FormAnswers } from "./FormsPanel.jsx";
import SignaturePad from "./SignaturePad.jsx";

/* ════════════════════════════════════════════════════════════════
   РЕГИСТРАЦИЯ · участником становятся, подписав договор

   Экран СВОЙ, а не карточка поверх вкладки: договор роли не часть «Рынка
   услуг», а рисовался он именно там — панель стояла выше содержимого
   вкладок и показывалась на той, что открыта (владелец, 2026-09-20).
   Отсюда же и «Назад»: с выбранной роли — обратно к выбору, а тому, у
   кого доступ уже есть, — обратно в приложение.

   Путей два, и решает их то, звали ли человека:

     — ПОЗВАЛИ (`pending`). Роль ему назначил владелец, и показывают ему
       ТОЛЬКО её договор — выбирать не из чего. Нет у роли договора —
       подписывать нечего, и роль выдана сразу.

     — НЕ ЗВАЛИ. Роль он выбирает сам, подписывает её договор, отвечает на
       её анкету — и ждёт: доступ ему открывает владелец на «Участниках».
   ════════════════════════════════════════════════════════════════ */

/* «Назад» и заголовок одной строкой: кнопка слева от названия шага. */
function Head({ title, onBack }) {
  return (
    <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
      {onBack && (
        <button type="button" style={{ ...btn(false), padding: "2px 8px" }}
          aria-label="назад" onClick={onBack}>← Назад</button>)}
      <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{title}</span>
    </div>);
}

/* ════════════════════════════════════════════════════════════════
   ДОГОВОР ОТ ВЛАДЕЛЬЦА · заполнить, подписать, отправить

   Владелец (2026-09-14): «когда пользователь добавляется, ему должно
   быть предложено заполнить оставшиеся плейсхолдеры при открытии
   приложения, после чего подписать и отправить договор; подписи — по
   нажатию «Поставить подпись» на экране телефона; после подписания
   становится доступен интерфейс роли». Соглашение (`me.agreement`)
   приходит вместе с «кто я»: владелец уже заполнил часть полей, сумму и
   даты и подписал; человек видит документ с заполненным, дописывает
   пустое, ставит свою подпись — и договор готов, роль действует.
   ════════════════════════════════════════════════════════════════ */
export function AgreementSign({ me, onBack, onDone }) {
  const a = me.agreement;
  const [values, setValues] = useState(() => Object.fromEntries(
    (a.placeholders || []).filter((p) => !p.value).map((p) => [p.key, a.userValues?.[p.key] || ""])));
  const [html, setHtml] = useState(null);
  const [open, setOpen] = useState(false);
  const [sig, setSig] = useState(null);
  const [pad, setPad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let live = true;
    agreementHtml(a.id).then((r) => { if (live) setHtml(r.html); }).catch(() => {});
    return () => { live = false; };
  }, [a.id]);
  const empty = (a.placeholders || []).filter((p) => !p.value);
  const left = empty.filter((p) => !String(values[p.key] || "").trim());
  const ready = !left.length && !!sig && !busy;
  const send = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await signAgreement(a.id, { values, sign2: sig });
      onDone?.(r?.me || null);
    } catch (e) { setMsg(e.message || "не удалось отправить"); }
    setBusy(false);
  };
  const step = { ...S.lbl, marginTop: 10 };
  return (
    <div style={{ ...S.card, marginBottom: 10 }} aria-label="договор к подписи">
      <Head onBack={onBack}
        title={`Договор «${a.docName}» — роль «${a.roleName}»`} />
      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
        Сумма {a.sum} · действует с {dayText(a.start)} по {dayText(a.end)}
      </div>
      <div style={step}>1 · заполнить</div>
      {!empty.length && (
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>Всё уже заполнено владельцем.</div>)}
      <div style={{ marginTop: 4 }}>
        <PlaceholderFields placeholders={empty} values={values} onChange={setValues} required
          label="договор" />
      </div>
      <div style={step}>2 · прочитать</div>
      <button style={{ ...btn(false), marginTop: 4 }} disabled={!html} onClick={() => setOpen(true)}>
        {html ? "Открыть договор" : "Загружаю договор…"}</button>
      <div style={step}>3 · подписать</div>
      <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 4 }}>
        <button style={btn(true, sig ? OK : ACC)} onClick={() => setPad(true)}>
          {sig ? "Подпись поставлена ✓ — переподписать" : "Поставить подпись"}</button>
      </div>
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 12 }}>
        <button style={{ ...btn(true, OK), opacity: ready ? 1 : 0.5 }} disabled={!ready} onClick={send}>
          {busy ? "Отправляю…" : "Подписать и отправить"}</button>
        <span style={{ fontSize: 10.5, color: C.muted }}>
          {left.length ? `заполните: ${left.map((p) => p.desc || p.key).join(", ")}`
            : !sig ? "поставьте подпись" : ""}</span>
      </div>
      {msg && <div style={{ fontSize: 11.5, color: BAD, marginTop: 8 }}>{msg}</div>}
      {open && html && (
        <DocViewer title={a.docName} html={html} editable={false} onClose={() => setOpen(false)} />)}
      {pad && (
        <SignaturePad by={me.id} docHash={a.docHash} title="Подпись стороны 2"
          onDone={(rec) => { setSig(rec); setPad(false); }} onCancel={() => setPad(false)} />)}
    </div>);
}

export default function RegisterPanel({ me, onBack, onDone }) {
  const [roles, setRoles] = useState(null);
  const [pick, setPick] = useState(me?.pending || "");
  const [file, setFile] = useState(null);
  const [answers, setAnswers] = useState(() => ({ ...(me?.profile?.answers || {}) }));
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

  /* Позванному роль уже назначена: выбора нет, и роль подменить нельзя —
     ему показывают договор ТОЙ роли, на которую его позвали. */
  const invited = !!me?.pending;
  const cur = (roles || []).find((r) => r.id === (invited ? me.pending : pick)) || null;
  const needs = !!cur?.contract;
  const ready = !!cur && (!needs || !!file);

  const send = async () => {
    if (!ready || busy) return;
    setBusy(true); setMsg("");
    try {
      const r = await registerRemote(cur.id, file, answers);
      onDone?.(r?.me || null);
    } catch (e) { setMsg(e.message || "не удалось отправить"); }
    setBusy(false);
  };

  const step = { ...S.lbl, marginTop: 10 };
  // Договор от владельца — свой путь: заполнить, подписать, отправить.
  if (me?.agreement) return <AgreementSign me={me} onBack={onBack} onDone={onDone} />;

  /* Заявка подана — дальше решает владелец. Своего действия у человека
     здесь нет, и формы тоже: показывать её значило бы звать подписать
     второй раз то, что уже подписано. */
  if (me?.waiting) {
    return (
      <div style={{ ...S.card, marginBottom: 10 }} aria-label="заявка отправлена">
        <Head title="Заявка отправлена" onBack={onBack} />
        <div style={{ fontSize: 11.5, color: WARN, lineHeight: 1.6 }}>
          Роль «{me.waiting.name}» · ждёт владельца.
        </div>
      </div>);
  }

  /* «Назад» с выбранной роли — к выбору роли; у позванного выбора нет, и
     назад ему только туда, откуда пришёл (если есть куда). */
  const back = !invited && pick
    ? () => { setPick(""); setFile(null); setMsg(""); }
    : onBack;

  return (
    <div style={{ ...S.card, marginBottom: 10 }} aria-label="регистрация">
      <Head onBack={back}
        title={invited ? "Вас позвали — осталось подписать договор" : "Вступить в модель"} />
      {/* ─── 1. роль ─── */}
      {!invited && (<>
        <div style={step}>1 · какая роль</div>
        {roles === null && (
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>Загружаю…</div>)}
        {roles !== null && !roles.length && (
          <div style={{ fontSize: 11.5, color: WARN, marginTop: 4, lineHeight: 1.6 }}>
            Ролей ещё нет.
          </div>)}
        <div className="flex flex-wrap gap-2" style={{ marginTop: 4 }}>
          {(roles || []).map((r) => (
            <button key={r.id} aria-pressed={pick === r.id}
              aria-label={`роль: ${r.name}`}
              style={{ ...btn(pick === r.id, pick === r.id ? ACC : null), fontSize: 12 }}
              onClick={() => { setPick(r.id); setFile(null); setMsg(""); }}>
              {r.name}</button>))}
        </div>
      </>)}
      {invited && roles !== null && !cur && (
        <div style={{ fontSize: 11.5, color: WARN, marginTop: 4, lineHeight: 1.6 }}>
          Роли, на которую вас позвали, больше нет.
        </div>)}

      {/* ─── 2. договор ─── */}
      {cur && (<>
        <div style={step}>{invited ? "1 · договор" : "2 · договор"}</div>
        {needs ? (
          <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 4 }}>
            <a href={reportSrc(cur.contract)} target="_blank" rel="noreferrer"
              download={cur.contract.name || "договор"}
              aria-label={`скачать договор роли «${cur.name}»`}
              style={{ fontSize: 12, color: ACC }}>
              📄 {cur.contract.name || "договор"}</a>
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4, lineHeight: 1.6 }}>
            У этой роли договора нет.
          </div>)}

        {/* ─── 3. подписанный экземпляр ─── */}
        {needs && (<>
          <div style={step}>{invited ? "2 · подписанный экземпляр" : "3 · подписанный экземпляр"}</div>
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
        </>)}

        {/* ─── 4. анкета роли ─── */}
        {!!(cur.form?.questions || []).length && (<>
          <div style={step}>анкета</div>
          <div style={{ marginTop: 4 }}>
            <FormAnswers forms={[cur.form]} answers={answers} mine onChange={setAnswers} />
          </div>
        </>)}

        {/* ─── 5. отправка ─── */}
        <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginTop: 12 }}>
          <button style={{ ...btn(true, OK), opacity: ready && !busy ? 1 : 0.5 }}
            disabled={!ready || busy} onClick={send}>
            {busy ? "Отправляю…" : "Вступить"}</button>
          <span style={{ fontSize: 10.5, color: C.muted }}>
            {ready ? "" : "нет подписанного договора"}</span>
        </div>
      </>)}

      {msg && <div style={{ fontSize: 11.5, color: BAD, marginTop: 8 }}>{msg}</div>}
    </div>);
}
