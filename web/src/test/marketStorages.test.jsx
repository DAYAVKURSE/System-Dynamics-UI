import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import MarketPanel from "../components/MarketPanel.jsx";

/* Рынок между хранилищами (владелец, 2026-09-21): роль соискателя в
   заказе, услуга приватна по умолчанию, работа для другого открывается
   в его хранилище. */

const ME = { id: "200", known: true, isOwner: true, tabs: ["market"] };
const ROLES = [{ id: "r1", name: "верстальщик" }, { id: "r2", name: "дизайнер" }];
let log;
/* Сервер помнит, что ему прислали: после сохранения панель перечитывает
   рынок, и новое должно в нём быть. */
const server = (view0) => {
  log = [];
  const view = { ...view0, orders: [...view0.orders], services: [...view0.services] };
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    log.push({ url: u, method: opts.method || "GET", body });
    if (u.endsWith("/api/market")) return { ok: true, json: async () => view };
    if (u.endsWith("/orders") && opts.method === "POST") {
      const o = { id: "o1", by: "200", at: "2026-09-21T10:00:00Z", offers: [], status: "open", ...body };
      view.orders.push(o);
      return { ok: true, status: 201, json: async () => o };
    }
    if (u.endsWith("/services") && opts.method === "POST") {
      const s = { id: "s9", by: "200", at: "2026-09-21T10:00:00Z", ...body };
      view.services.push(s);
      return { ok: true, status: 201, json: async () => s };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
};
const VIEW = { me: "200", people: { 200: "вы", 300: "Иван" }, faces: {}, orders: [],
  services: [{ id: "s1", by: "200", at: "2026-09-21T10:00:00Z", name: "Сайт", text: "",
    takes: [], gives: [], days: null, private: true, customer: "300", storage: "300", taskId: "t1" }] };

beforeEach(() => { server(VIEW); });
afterEach(() => { vi.restoreAllMocks(); delete global.fetch; });

describe("заказ с двумя ролями нанятого (владелец, 2026-09-26)", () => {
  it("роли в техпроцессе (несколько) и роль в сценарии из своих ролей уезжают с заказом", async () => {
    render(<MarketPanel me={ME} roles={ROLES} />);
    await screen.findByRole("tab", { name: /Услуги · 1/ });
    fireEvent.click(screen.getByRole("button", { name: "+ заказ" }));
    expect(screen.queryByLabelText("роль соискателя")).toBeNull();
    /* Ролей в техпроцессе несколько (владелец, 2026-09-26): исполнитель
       бывает и постановщиком, и проверяющим. По умолчанию — исполнитель. */
    const proc = screen.getByRole("group", { name: "роль в техпроцессе" });
    const boxes = within(proc).getAllByRole("checkbox");
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual(["постановщик", "исполнитель", "проверяющий"]);
    expect(boxes.map((b) => b.checked)).toEqual([false, true, false]);
    fireEvent.click(within(proc).getByLabelText("проверяющий"));
    fireEvent.click(within(proc).getByLabelText("постановщик"));
    const sel = screen.getByLabelText("роль в сценарии");
    expect(sel).toHaveValue("r1");
    fireEvent.change(sel, { target: { value: "r2" } });
    fireEvent.change(screen.getByLabelText("название заказа"), { target: { value: "Логотип" } });
    fireEvent.click(screen.getByRole("button", { name: "Оставить заказ" }));
    await screen.findByLabelText("заказ Логотип");
    const post = log.find((r) => r.method === "POST" && r.url.endsWith("/orders"));
    expect(post.body).toMatchObject({ name: "Логотип", procRoles: ["setter", "assignee", "reviewer"], roleId: "r2" });
  });
});

describe("услуги", () => {
  it("приватна по умолчанию; галочку можно снять", async () => {
    render(<MarketPanel me={ME} roles={ROLES} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Услуги · 1/ }));
    await screen.findByLabelText("услуга Сайт");
    fireEvent.click(screen.getByRole("button", { name: "+ услуга" }));
    const priv = screen.getByLabelText("приватная услуга");
    expect(priv).toBeChecked();
    fireEvent.change(screen.getByLabelText("название услуги"), { target: { value: "Вёрстка" } });
    fireEvent.click(priv);
    fireEvent.click(screen.getByRole("button", { name: "Выложить услугу" }));
    await screen.findByLabelText("услуга Вёрстка");
    const post = log.find((r) => r.method === "POST" && r.url.endsWith("/services"));
    expect(post.body).toMatchObject({ name: "Вёрстка", private: false });
  });

  it("работа для другого: отмечена приватной с заказчиком и открывается в его хранилище", async () => {
    const onOpenStorage = vi.fn();
    render(<MarketPanel me={ME} roles={ROLES} onOpenStorage={onOpenStorage} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Услуги · 1/ }));
    const card = await screen.findByLabelText("услуга Сайт");
    expect(within(card).getByText("приватная")).toBeInTheDocument();
    expect(within(card).getByText(/заказчик: Иван/)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Открыть у заказчика" }));
    expect(onOpenStorage).toHaveBeenCalledWith("300");
  });
});
