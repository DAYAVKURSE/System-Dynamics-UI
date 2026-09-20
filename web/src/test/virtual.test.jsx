import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import VirtualPanel from "../components/VirtualPanel.jsx";
import JoinPanel from "../components/JoinPanel.jsx";
import MarketPanel from "../components/MarketPanel.jsx";
import { actingAs, resetIdentity, setActingAs } from "../identity.js";

/* ВИРТУАЛЬНЫЙ СОТРУДНИК (владелец, 2026-09-20).

   Страница, за которой ещё нет человека. Её заводит рекрутер, зовётся
   она фразой из двух слов, и делать с ней можно ровно три вещи: выбрать
   роль, войти под её именем и получить ссылку для регистрации. */

const ME = { id: "1", name: "Иван", known: true, solo: false, isOwner: false,
  tabs: ["tools"], profile: {} };
const VIEW = {
  isOwner: false,
  roles: [{ id: "executor", name: "исполнитель" }, { id: "reviewer", name: "проверяющий" }],
  users: [{ id: "vt_abc", name: "wise oyster", virtual: true, roles: ["executor"] }],
};

const server = (over = {}) => {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || "GET",
      body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers || {} });
    if (u.includes("/api/org/virtual/") && u.endsWith("/link")) {
      return { ok: true, status: 200,
        json: async () => ({ token: "k1", link: "https://t.me/bot?startapp=join_k1" }) };
    }
    if (u.includes("/api/org/join/")) {
      return { ok: true, status: 200, json: async () => ({ name: "wise oyster",
        role: { id: "executor", name: "исполнитель" },
        profile: { about: "верстальщик" }, forms: [] }) };
    }
    if (u.includes("/api/org/join")) {
      return over.joinFails
        ? { ok: false, status: 409,
          json: async () => ({ error: "Вы уже зарегистрированы в системе" }) }
        : { ok: true, status: 200, json: async () => ({ id: "vt_abc", known: true }) };
    }
    return { ok: true, status: 200, json: async () => (over.view || VIEW) };
  }));
  return calls;
};

beforeEach(() => { sessionStorage.clear(); resetIdentity(); });
afterEach(() => { vi.restoreAllMocks(); setActingAs(""); });

describe("вкладка «Виртуальные»", () => {
  it("зовётся фразой из двух слов, и лица у неё нет", async () => {
    server();
    render(<VirtualPanel me={ME} />);
    const row = await screen.findByLabelText("виртуальный wise oyster");
    expect(row.textContent).toContain("wise oyster");
    expect(row.textContent).toContain("человека ещё нет");
    // Вместо лица — знак приложения: человека за страницей нет.
    expect(row.querySelector("img")).toBeTruthy();
  });

  it("здесь ровно три действия: роль, вход и ссылка", async () => {
    server();
    render(<VirtualPanel me={ME} />);
    const row = await screen.findByLabelText("виртуальный wise oyster");
    expect(screen.getByLabelText("роль wise oyster")).toHaveValue("executor");
    expect(screen.getByRole("button", { name: "войти под именем wise oyster" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ссылка для регистрации wise oyster" }))
      .toBeInTheDocument();
    // Ни правки имени, ни удаления человека здесь нет.
    expect(row.textContent).not.toContain("Удалить");
  });

  it("роль уезжает своим маршрутом: её меняет тот, кто завёл страницу", async () => {
    const calls = server();
    render(<VirtualPanel me={ME} />);
    await screen.findByLabelText("роль wise oyster");
    fireEvent.change(screen.getByLabelText("роль wise oyster"),
      { target: { value: "reviewer" } });
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT");
    expect(put.url).toBe("/api/org/virtual/vt_abc/role");
    expect(put.body).toEqual({ roleId: "reviewer" });
  });

  it("«Сгенерировать ссылку» показывает саму ссылку", async () => {
    server();
    render(<VirtualPanel me={ME} />);
    fireEvent.click(await screen.findByRole("button",
      { name: "ссылка для регистрации wise oyster" }));
    const field = await screen.findByLabelText("ссылка wise oyster");
    expect(field).toHaveValue("https://t.me/bot?startapp=join_k1");
  });

  it("«Войти под его именем» переводит под эту страницу всё приложение", async () => {
    server();
    const entered = vi.fn();
    render(<VirtualPanel me={ME} onEnter={entered} />);
    fireEvent.click(await screen.findByRole("button",
      { name: "войти под именем wise oyster" }));
    expect(actingAs()).toBe("vt_abc");
    expect(entered).toHaveBeenCalled();
  });

  it("под чужой страницей запросы уходят с её адресом", async () => {
    setActingAs("vt_abc");
    const calls = server();
    render(<MarketPanel me={ME} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].headers["X-Act-As"]).toBe("vt_abc");
    setActingAs("");
  });
});

describe("вступление по ссылке", () => {
  it("показывает, что за страница и какая роль, и даёт вступить", async () => {
    const calls = server();
    const joined = vi.fn();
    render(<JoinPanel me={{ known: false, solo: false }} token="k1" onJoined={joined} />);
    const box = await screen.findByLabelText("вступление по ссылке");
    await waitFor(() => expect(box.textContent).toContain("wise oyster"));
    expect(box.textContent).toContain("исполнитель");
    expect(box.textContent).toContain("верстальщик");
    fireEvent.click(screen.getByRole("button", { name: "Вступить" }));
    await waitFor(() => expect(joined).toHaveBeenCalled());
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/org/join")).toBe(true);
  });

  it("зарегистрированному — ошибка, а не вторая страница", async () => {
    server();
    render(<JoinPanel me={{ known: true, solo: false }} token="k1" />);
    const box = await screen.findByLabelText("вступление по ссылке");
    expect(box.textContent).toContain("Вы уже зарегистрированы в системе");
    expect(screen.queryByRole("button", { name: "Вступить" })).toBeNull();
  });

  it("отказ сервера показывается словами", async () => {
    server({ joinFails: true });
    render(<JoinPanel me={{ known: false, solo: false }} token="k1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Вступить" }));
    expect(await screen.findByText(/уже зарегистрированы/)).toBeInTheDocument();
  });
});
