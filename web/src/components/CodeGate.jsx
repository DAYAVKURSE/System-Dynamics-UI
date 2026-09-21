import React, { useState } from "react";
import { C, OK, WARN, ACC, BAD, S, btn, Download, FoldCard, DANGER_LINE } from "./ui.jsx";
import { TAB_NAMES } from "../identity.js";
import { METHODS, METHOD_NAMES, PLANS, PLAN_NAMES, PLAN_TABS, PRICE } from "../plans.js";
import { changePlan, forgetKey, loginWithKey, registerCode, rotateKey, savedKey } from "../codes.js";

/* ════════════════════════════════════════════════════════════════
   КЛЮЧ · вход по сохранённому или регистрация с планом

   Первый экран, когда сервис кодов включён, а ключа на устройстве нет
   (владелец, 2026-09-21). Два пути:

     — ЕСТЬ КЛЮЧ: ввести — и войти под своей записью, с какого угодно
       Telegram.
     — НЕТ: выбрать план, для платного — способ оплаты (сам платёж пока
       считается полученным), получить ключ и СОХРАНИТЬ его: без ключа
       доступ к своему не вернуть.

   Планы — что открывает каждый — в `plans.js`; тут они только
   перечислены названиями вкладок, чтобы выбирать было из чего.
   ════════════════════════════════════════════════════════════════ */

const topTabs = (plan) => PLAN_TABS[plan].filter((t) => !t.includes(":"));
const innerTabs = (plan) => PLAN_TABS[plan].filter((t) => t.includes(":"));
const priceText = (plan) => (PRICE[plan] ? `${PRICE[plan]} $/мес` : "0 $/мес");

/* Список планов с тем, что каждый открывает. Один и тот же — на входе и в
   анкете при смене плана. */
export function PlanPick({ plan, onPick, current = null, label = "план" }) {
  return (
    <div>
      {label && <div style={S.lbl}>{label}</div>}
      {/* Три плана — три ровные ячейки в один ряд. */}
      <div className="flex gap-2" style={{ "--cell": "96px", marginTop: label ? "var(--space-4)" : "var(--space-8)",
        marginBottom: "var(--space-8)" }}>
        {PLANS.map((p) => (
          <button key={p} type="button" style={btn(plan === p, OK)} aria-pressed={plan === p}
            onClick={() => onPick(p)}>
            {PLAN_NAMES[p]}{current === p ? " ✓" : ""}</button>))}
      </div>
      <div aria-label={`план ${PLAN_NAMES[plan]}`}
        style={{ fontSize: "var(--fs-body)", lineHeight: "20px" }}>
        <div><span style={{ color: C.muted }}>{priceText(plan)}</span></div>
        <div>{topTabs(plan).map((t) => TAB_NAMES[t]).join(", ")}</div>
        {plan !== "max" && innerTabs(plan).length > 0 && (
          <div style={{ color: C.muted }}>
            {TAB_NAMES.tools}: {innerTabs(plan).map((t) => TAB_NAMES[t]).join(", ")}</div>)}
      </div>
    </div>);
}

export function MethodPick({ method, onPick }) {
  return (
    <div style={{ marginTop: "var(--space-8)" }}>
      <div style={S.lbl}>способ оплаты</div>
      <div className="flex gap-2" style={{ marginTop: "var(--space-4)" }}>
        {METHODS.map((m) => (
          <button key={m} type="button" style={btn(method === m, ACC)} aria-pressed={method === m}
            onClick={() => onPick(m)}>{METHOD_NAMES[m]}</button>))}
      </div>
    </div>);
}

/* Показ ключа: моноширинно, с копированием и файлом. */
export function KeyView({ value, label = "ключ" }) {
  const [msg, setMsg] = useState("");
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setMsg("Скопировано."); }
    catch { setMsg("Не скопировалось — выделите и скопируйте вручную."); }
  };
  return (
    <div>
      <div style={S.lbl}>{label}</div>
      <div aria-label={label} style={{ fontFamily: "var(--font-mono, monospace)",
        letterSpacing: "var(--ls-code)", fontSize: "var(--fs-body)", lineHeight: "20px",
        userSelect: "all", overflowWrap: "break-word", margin: "var(--space-4) 0 var(--space-8)" }}>
        {value}</div>
      <div className="flex gap-2">
        <button type="button" style={btn(true, ACC)} onClick={copy}>Скопировать</button>
        <Download text={`${value}\n`} name="ключ.txt" label="Скачать" style={btn(false)} />
      </div>
      {msg && <div style={{ color: msg.startsWith("Скопировано") ? OK : WARN,
        marginTop: "var(--space-4)" }}>{msg}</div>}
    </div>);
}

export default function CodeGate({ onDone }) {
  const [key, setKey] = useState("");
  const [plan, setPlan] = useState("free");
  const [method, setMethod] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [issued, setIssued] = useState(null);
  const paid = PRICE[plan] > 0;

  const login = async () => {
    setBusy(true); setMsg("");
    try { await loginWithKey(key); onDone?.(); }
    catch (e) { setMsg(e.status === 401 ? "Ключ не подходит." : (e.message || "не удалось войти")); }
    setBusy(false);
  };
  const register = async () => {
    setBusy(true); setMsg("");
    try { setIssued(await registerCode(plan, paid ? method : undefined)); }
    catch (e) { setMsg(e.message || "не удалось зарегистрироваться"); }
    setBusy(false);
  };

  if (issued) return (
    <div style={{ ...S.card, marginBottom: "var(--space-8)" }} aria-label="ключ выдан">
      <KeyView value={issued.key} label="ваш ключ" />
      <div className="flex gap-2" style={{ marginTop: "var(--space-12)" }}>
        <button type="button" style={btn(true, OK)} onClick={() => onDone?.()}>Продолжить</button>
      </div>
    </div>);

  return (
    <>
      <div style={{ ...S.card, marginBottom: "var(--space-8)" }} aria-label="вход по ключу">
        <div style={S.lbl}>ключ</div>
        <input aria-label="ключ" value={key} onChange={(e) => setKey(e.target.value)}
          autoComplete="off" spellCheck={false}
          style={{ ...S.inp, marginTop: "var(--space-4)", marginBottom: "var(--space-8)",
            fontFamily: "var(--font-mono, monospace)", letterSpacing: "var(--ls-code)" }} />
        <div className="flex gap-2">
          <button type="button" style={btn(true, ACC)} disabled={busy || !key.trim()} onClick={login}>
            Войти</button>
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: "var(--space-8)" }} aria-label="регистрация">
        <PlanPick plan={plan} onPick={setPlan} />
        {paid && <MethodPick method={method} onPick={setMethod} />}
        <div className="flex gap-2" style={{ marginTop: "var(--space-12)" }}>
          <button type="button" style={btn(true, OK)} disabled={busy || (paid && !method)}
            onClick={register}>
            {paid ? "Оплатить и зарегистрироваться" : "Зарегистрироваться"}</button>
        </div>
      </div>
      {msg && <div style={{ color: WARN }}>{msg}</div>}
    </>);
}

/* ─────── ПЛАН И КЛЮЧ В АНКЕТЕ ───────

   Сменить план (платёж пока считается полученным), посмотреть и
   скопировать ключ, заменить его новым или выйти — забыть ключ на этом
   устройстве. */
export function PlanCard({ me, onChanged }) {
  const cur = me?.plan || "free";
  const [plan, setPlan] = useState(cur);
  const [method, setMethod] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [shown, setShown] = useState(false);
  const paid = PRICE[plan] > 0;
  const run = async (fn, ok) => {
    setBusy(true); setMsg("");
    try { await fn(); setMsg(ok); onChanged?.(); }
    catch (e) { setMsg(e.message || "не удалось"); }
    setBusy(false);
  };
  return (
    <FoldCard title="план и ключ" open={false}>
      <PlanPick plan={plan} onPick={setPlan} current={cur} label="" />
      {paid && plan !== cur && <MethodPick method={method} onPick={setMethod} />}
      {plan !== cur && (
        <div className="flex gap-2" style={{ marginTop: "var(--space-12)" }}>
          <button type="button" style={btn(true, OK)} disabled={busy || (paid && !method)}
            onClick={() => run(() => changePlan(plan, paid ? method : undefined), "План изменён.")}>
            {paid ? "Оплатить и сменить план" : "Сменить план"}</button>
        </div>)}
      <div style={{ marginTop: "var(--space-12)" }}>
        {shown
          ? <KeyView value={savedKey()} />
          : (
            <div className="flex gap-2">
              <button type="button" style={btn(false)} onClick={() => setShown(true)}>Показать ключ</button>
              <button type="button" style={btn(false)} disabled={busy}
                onClick={() => run(async () => { await rotateKey(); setShown(true); }, "Ключ заменён.")}>
                Заменить ключ</button>
              <button type="button" style={{ ...btn(false, BAD), borderColor: DANGER_LINE }}
                onClick={() => { forgetKey(); onChanged?.(); }}>Выйти</button>
            </div>)}
      </div>
      {msg && <div style={{ color: msg.endsWith(".") ? OK : WARN, marginTop: "var(--space-4)" }}>{msg}</div>}
    </FoldCard>);
}
