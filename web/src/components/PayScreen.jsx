import React, { useEffect, useState } from "react";
import { C, OK, WARN, ACC, S, btn } from "./ui.jsx";
import { paymentStatus } from "../codes.js";
import { getTelegram } from "../telegram.js";
import { METHOD_NAMES } from "../plans.js";

/* ════════════════════════════════════════════════════════════════
   ОПЛАТА · звёзды или перевод на кошелёк (владелец, 2026-09-21)

   Stars: инвойс выписал основной бот, открывает его мини-приложение
   (`openInvoice`); вне Telegram — ссылка. TON/USDT: адрес случайного
   кошелька владельца, сумма и комментарий — по нему платёж узнаётся в
   цепочке. Пока платёж «ожидает», статус спрашивается раз в десять
   секунд; оплачен — токен обновлён, план открыт.
   ════════════════════════════════════════════════════════════════ */
const POLL_MS = 10000;
const money = (p) => `${p.amount} ${p.currency === "XTR" ? "⭐" : p.currency}`;

function Copy({ value, label }) {
  const [msg, setMsg] = useState("");
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setMsg("Скопировано."); }
    catch { setMsg("Не скопировалось — выделите и скопируйте вручную."); }
  };
  return (
    <div style={{ marginTop: "var(--space-8)" }}>
      <div style={S.lbl}>{label}</div>
      <div aria-label={label} style={{ fontFamily: "var(--font-mono, monospace)", letterSpacing: "var(--ls-code)",
        fontSize: "var(--fs-body)", lineHeight: "20px", userSelect: "all", overflowWrap: "anywhere",
        margin: "var(--space-4) 0" }}>{value}</div>
      <div className="flex gap-2">
        <button type="button" style={btn(false)} onClick={copy}>Скопировать</button>
      </div>
      {msg && <div style={{ color: msg.startsWith("Скопировано") ? OK : WARN, marginTop: "var(--space-4)" }}>{msg}</div>}
    </div>);
}

export default function PayScreen({ payment, onPaid, onLater }) {
  const [p, setP] = useState(payment);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      const fresh = await paymentStatus(p.id);
      setP((was) => ({ ...was, ...fresh }));
      if (fresh.status === "paid") onPaid?.(fresh);
      else if (fresh.status === "expired") setMsg("Срок платежа вышел — начните заново.");
      else setMsg("Платёж ещё не пришёл.");
    } catch (e) { setMsg(e.message || "не удалось проверить"); }
    setBusy(false);
  };
  useEffect(() => {
    if (p.status !== "pending") return undefined;
    const id = setInterval(async () => {
      try {
        const fresh = await paymentStatus(p.id);
        if (fresh.status !== "pending") { setP((was) => ({ ...was, ...fresh })); if (fresh.status === "paid") onPaid?.(fresh); }
      } catch { /* следующий раз */ }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [p.id, p.status]);   // eslint-disable-line react-hooks/exhaustive-deps

  const stars = p.method === "stars";
  const openStars = () => {
    const tg = getTelegram();
    if (!p.invoiceLink) { setMsg(p.invoiceError || "инвойс не выписан"); return; }
    if (tg?.openInvoice) {
      tg.openInvoice(p.invoiceLink, (status) => {
        if (status === "paid") check();
        else if (status === "cancelled") setMsg("Оплата отменена.");
        else if (status === "failed") setMsg("Оплата не прошла.");
      });
    } else if (typeof window !== "undefined") window.open(p.invoiceLink, "_blank");
  };
  return (
    <div style={{ ...S.card, marginBottom: "var(--space-8)" }} aria-label="оплата">
      <div style={S.lbl}>оплата</div>
      <div style={{ fontSize: "var(--fs-body)", lineHeight: "20px", marginTop: "var(--space-4)" }}>
        <div>{p.planName}{p.days ? ` · ${p.days} дн.` : ""}</div>
        <div><span style={{ color: C.muted }}>{METHOD_NAMES[p.method] || p.method}</span> · <b aria-label="сумма">{money(p)}</b></div>
      </div>
      {p.status === "paid" && <div style={{ color: OK, marginTop: "var(--space-8)" }}>Оплачено.</div>}
      {p.status === "pending" && stars && (
        <div className="flex gap-2" style={{ marginTop: "var(--space-12)" }}>
          <button type="button" style={btn(true, OK)} onClick={openStars}>Оплатить {money(p)}</button>
        </div>)}
      {p.status === "pending" && !stars && (<>
        <Copy value={p.address || ""} label="адрес" />
        <Copy value={String(p.amount)} label={`сумма, ${p.currency}`} />
        <Copy value={p.comment || ""} label="комментарий к переводу" />
      </>)}
      {p.status === "pending" && (
        <div className="flex gap-2" style={{ marginTop: "var(--space-12)" }}>
          <button type="button" style={btn(true, ACC)} disabled={busy} onClick={check}>Проверить оплату</button>
          {onLater && <button type="button" style={btn(false)} onClick={onLater}>Позже</button>}
        </div>)}
      {msg && <div style={{ color: msg === "Платёж ещё не пришёл." ? C.muted : WARN, marginTop: "var(--space-4)" }}>{msg}</div>}
    </div>);
}
