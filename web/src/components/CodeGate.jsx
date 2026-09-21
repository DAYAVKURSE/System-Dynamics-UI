import React, { useEffect, useState } from "react";
import { C, OK, WARN, ACC, BAD, S, btn, Download, FoldCard, DANGER_LINE } from "./ui.jsx";
import { TAB_NAMES } from "../identity.js";
import { DEFAULT_PLANS, METHODS, METHOD_NAMES, PLAN_TABS } from "../plans.js";
import { changePlan, fetchPlans, forgetKey, loginWithKey, registerCode, savedKey } from "../codes.js";
import PayScreen from "./PayScreen.jsx";

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

const topTabs = (level) => (PLAN_TABS[level] || PLAN_TABS.free).filter((t) => !t.includes(":"));
const innerTabs = (level) => (PLAN_TABS[level] || PLAN_TABS.free).filter((t) => t.includes(":"));
const priceText = (p) => (p.price ? `${p.price} $ за ${p.days} дн.` : "0 $");

/* Планы и способы — с сервера (их правит владелец); до ответа — те, что
   встроены. */
export function usePlans() {
  const [state, setState] = useState({ plans: DEFAULT_PLANS, methods: [...METHODS] });
  useEffect(() => {
    let live = true;
    fetchPlans().then((j) => {
      if (!live || !Array.isArray(j?.plans) || !j.plans.length) return;
      setState({ plans: j.plans, methods: Array.isArray(j.methods) && j.methods.length ? j.methods : [...METHODS] });
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  return state;
}

/* Список планов с тем, что каждый открывает. Один и тот же — на входе и в
   анкете при смене плана. */
export function PlanPick({ plans = DEFAULT_PLANS, plan, onPick, current = null, label = "план" }) {
  const chosen = plans.find((p) => p.id === plan) || plans[0];
  return (
    <div>
      {label && <div style={S.lbl}>{label}</div>}
      {/* Планы — ровными ячейками в ряд. */}
      <div className="flex gap-2" style={{ "--cell": "96px", marginTop: label ? "var(--space-4)" : "var(--space-8)",
        marginBottom: "var(--space-8)" }}>
        {plans.map((p) => (
          <button key={p.id} type="button" style={btn(chosen?.id === p.id, OK)} aria-pressed={chosen?.id === p.id}
            onClick={() => onPick(p.id)}>
            {p.name}{current === p.id ? " ✓" : ""}</button>))}
      </div>
      {chosen && (
        <div aria-label={`план ${chosen.name}`}
          style={{ fontSize: "var(--fs-body)", lineHeight: "20px" }}>
          <div><span style={{ color: C.muted }}>{priceText(chosen)}</span></div>
          <div>{topTabs(chosen.level).map((t) => TAB_NAMES[t]).join(", ")}</div>
          {chosen.level !== "max" && innerTabs(chosen.level).length > 0 && (
            <div style={{ color: C.muted }}>
              {TAB_NAMES.tools}: {innerTabs(chosen.level).map((t) => TAB_NAMES[t]).join(", ")}</div>)}
        </div>)}
    </div>);
}

export function MethodPick({ methods = METHODS, method, onPick }) {
  return (
    <div style={{ marginTop: "var(--space-8)" }}>
      <div style={S.lbl}>способ оплаты</div>
      <div className="flex gap-2" style={{ marginTop: "var(--space-4)" }}>
        {methods.map((m) => (
          <button key={m} type="button" style={btn(method === m, ACC)} aria-pressed={method === m}
            onClick={() => onPick(m)}>{METHOD_NAMES[m] || m}</button>))}
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
  const { plans, methods } = usePlans();
  const [key, setKey] = useState("");
  const [plan, setPlan] = useState("free");
  const [method, setMethod] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [issued, setIssued] = useState(null);
  // Ключ показан, «Продолжить» нажали — дальше оплата, если план платный.
  const [paying, setPaying] = useState(false);
  const paid = (plans.find((p) => p.id === plan)?.price || 0) > 0;

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

  if (issued && paying && issued.payment) return (
    <PayScreen payment={issued.payment} onPaid={() => onDone?.()} onLater={() => onDone?.()} />);
  if (issued) return (
    <div style={{ ...S.card, marginBottom: "var(--space-8)" }} aria-label="ключ выдан">
      <KeyView value={issued.key} label="ваш ключ" />
      <div className="flex gap-2" style={{ marginTop: "var(--space-12)" }}>
        <button type="button" style={btn(true, OK)}
          onClick={() => (issued.payment ? setPaying(true) : onDone?.())}>Продолжить</button>
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
        <PlanPick plans={plans} plan={plan} onPick={setPlan} />
        {paid && <MethodPick methods={methods} method={method} onPick={setMethod} />}
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
  const { plans, methods } = usePlans();
  const cur = me?.code?.planId || me?.plan || "free";
  const [plan, setPlan] = useState(cur);
  const [method, setMethod] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [shown, setShown] = useState(false);
  const [payment, setPayment] = useState(null);
  const paid = (plans.find((p) => p.id === plan)?.price || 0) > 0;
  const run = async (fn, ok) => {
    setBusy(true); setMsg("");
    try { await fn(); setMsg(ok); onChanged?.(); }
    catch (e) { setMsg(e.message || "не удалось"); }
    setBusy(false);
  };
  const change = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await changePlan(plan, paid ? method : undefined);
      if (r.payment) setPayment(r.payment);
      else { setMsg("План изменён."); onChanged?.(); }
    } catch (e) { setMsg(e.message || "не удалось"); }
    setBusy(false);
  };
  const until = me?.code?.until ? new Date(me.code.until) : null;
  return (
    <FoldCard title="мой план" open={false}>
      <PlanPick plans={plans} plan={plan} onPick={setPlan} current={cur} label="" />
      {until && !isNaN(until) && (
        <div style={{ color: C.muted, marginTop: "var(--space-4)" }} aria-label="срок подписки">
          до {until.toLocaleDateString("ru-RU")}</div>)}
      {/* Платный план: способ оплаты и «Продлить» (тот же план) или
          «Оплатить и сменить план»; бесплатный — просто «Сменить план». */}
      {paid && !payment && <MethodPick methods={methods} method={method} onPick={setMethod} />}
      {(plan !== cur || paid) && !payment && (
        <div className="flex gap-2" style={{ marginTop: "var(--space-12)" }}>
          <button type="button" style={btn(true, OK)} disabled={busy || (paid && !method)} onClick={change}>
            {!paid ? "Сменить план" : plan === cur ? "Продлить" : "Оплатить и сменить план"}</button>
        </div>)}
      {payment && (
        <div style={{ marginTop: "var(--space-12)" }}>
          <PayScreen payment={payment} onPaid={() => { setPayment(null); setMsg("Оплачено."); onChanged?.(); }}
            onLater={() => setPayment(null)} />
        </div>)}
      <div style={{ marginTop: "var(--space-12)" }}>
        {shown
          ? <KeyView value={savedKey()} />
          : (
            <div className="flex gap-2">
              {/* Ключ выдаётся один раз и навсегда (владелец, 2026-09-21):
                  замены нет. */}
              <button type="button" style={btn(false)} onClick={() => setShown(true)}>Показать ключ</button>
              <button type="button" style={{ ...btn(false, BAD), borderColor: DANGER_LINE }}
                onClick={() => { forgetKey(); onChanged?.(); }}>Выйти</button>
            </div>)}
      </div>
      {msg && <div style={{ color: msg.endsWith(".") ? OK : WARN, marginTop: "var(--space-4)" }}>{msg}</div>}
    </FoldCard>);
}
