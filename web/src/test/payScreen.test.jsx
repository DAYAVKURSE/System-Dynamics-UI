import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import PayScreen from "../components/PayScreen.jsx";

/* Экран оплаты (владелец, 2026-09-21): звёзды — инвойс через Telegram,
   TON/USDT — адрес, сумма и комментарий; оплаченный платёж закрывает экран. */

let status;
beforeEach(() => {
  status = "pending";
  localStorage.setItem("sd_code_key", "ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789");
  global.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("/api/codes/payment/")) {
      return { ok: true, json: async () => ({ payment: { id: "pay_1", status } }) };
    }
    if (u.includes("/api/codes/token")) {
      return { ok: true, json: async () => ({ uid: "u1", plan: "pro", token: "t.t", exp: Math.floor(Date.now() / 1000) + 3600 }) };
    }
    return { ok: true, json: async () => ({}) };
  });
});
afterEach(() => { vi.restoreAllMocks(); delete global.fetch; delete window.Telegram; localStorage.clear(); });

const STARS = { id: "pay_1", planName: "Pro", days: 30, method: "stars", currency: "XTR", amount: 500,
  status: "pending", invoiceLink: "https://t.me/$inv" };
const TON = { id: "pay_1", planName: "Max", days: 30, method: "ton", currency: "TON", amount: 6.2,
  status: "pending", address: "UQA1", comment: "SD-ABCDEF" };

describe("оплата", () => {
  it("звёзды: кнопка открывает инвойс в Telegram, «paid» — проверка и выход", async () => {
    const opened = [];
    window.Telegram = { WebApp: { openInvoice: (link, cb) => { opened.push(link); status = "paid"; cb("paid"); } } };
    const onPaid = vi.fn();
    render(<PayScreen payment={STARS} onPaid={onPaid} />);
    expect(screen.getByLabelText("сумма")).toHaveTextContent("500 ⭐");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Оплатить 500 ⭐" })); });
    expect(opened).toEqual(["https://t.me/$inv"]);
    await screen.findByText("Оплачено.");
    expect(onPaid).toHaveBeenCalled();
  });

  it("TON: адрес, сумма и комментарий к переводу; «Проверить оплату» говорит, что ещё не пришёл", async () => {
    render(<PayScreen payment={TON} onLater={() => {}} />);
    expect(screen.getByLabelText("адрес")).toHaveTextContent("UQA1");
    expect(screen.getByLabelText("сумма, TON")).toHaveTextContent("6.2");
    expect(screen.getByLabelText("комментарий к переводу")).toHaveTextContent("SD-ABCDEF");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Проверить оплату" })); });
    await screen.findByText("Платёж ещё не пришёл.");
    expect(screen.getByRole("button", { name: "Позже" })).toBeInTheDocument();
  });
});
