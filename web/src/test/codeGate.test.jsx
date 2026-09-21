import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { resetIdentity } from "../identity.js";
import { PLAN_TABS, planAllows, tabLocked } from "../plans.js";
import { normKey } from "../codes.js";

/* Ключ и план (владелец, 2026-09-21): сервис кодов включён — сначала
   ключ; план гасит вкладки, которых в нём нет. */

const KEY = "ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789";
const TOKEN_EXP = Math.floor(Date.now() / 1000) + 3600;
let calls;
const server = (me, { codes = true } = {}) => {
  calls = [];
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || "GET", headers: opts.headers || {},
      body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes("/api/health")) {
      return { ok: true, headers: { get: () => "application/json" },
        json: async () => ({ ok: true, scenarios: true, reminders: true, reports: true,
          org: true, codes }) };
    }
    if (u.includes("/api/codes/register")) {
      return { ok: true, status: 201, json: async () => ({ key: KEY, uid: "u1",
        plan: JSON.parse(opts.body).plan, token: "t.t", exp: TOKEN_EXP }) };
    }
    if (u.includes("/api/codes/token")) {
      const ok = JSON.parse(opts.body).key === KEY;
      return { ok, status: ok ? 200 : 401,
        json: async () => (ok ? { uid: "u1", plan: "free", token: "t.t", exp: TOKEN_EXP }
          : { error: "unknown key" }) };
    }
    if (u.includes("/api/org/me")) return { ok: true, json: async () => me };
    if (u.includes("/api/assistant/")) {
      return { ok: true, json: async () => ({ providers: [], agents: [], kinds: [], tasks: {},
        taskList: [], mcp: [], uses: [], servers: [] }) };
    }
    if (u.includes("/api/org")) {
      return { ok: true, json: async () => ({ ownerId: "1", roles: [], users: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
};
const fresh = async () => {
  vi.resetModules();
  resetIdentity();
  const { default: SystemModel } = await import("../components/SystemModel.jsx");
  return render(<SystemModel />);
};
const OWNER = { id: "1", isOwner: true, known: true, role: null, profile: { about: "" },
  tabs: ["market", "me", "tasks", "review", "scheme", "reports", "tools"],
  code: { uid: "u1", plan: "free" }, plan: "free" };

beforeEach(() => { localStorage.clear(); resetIdentity(); });
afterEach(() => { vi.restoreAllMocks(); delete global.fetch; resetIdentity(); });

describe("планы", () => {
  it("free — анкета, рынок, задачи; pro добавляет проверку, звонки и агентов; max — всё", () => {
    expect(PLAN_TABS.free).toEqual(["market", "me", "tasks"]);
    expect(planAllows("free", "review")).toBe(false);
    expect(planAllows("pro", "review")).toBe(true);
    expect(planAllows("pro", "tools:assistant")).toBe(true);
    expect(planAllows("pro", "tools:people")).toBe(false);
    expect(planAllows("max", "tools:export")).toBe(true);
    // Без плана (сервис кодов выключен) ничего не гаснет.
    expect(tabLocked({ tabs: [] }, "review")).toBe(false);
    expect(tabLocked({ plan: "free" }, "review")).toBe(true);
    // Вкладки плана, выбранные владельцем (planTabs с сервера), важнее уровня.
    expect(tabLocked({ plan: "free", planTabs: ["me", "review"] }, "review")).toBe(false);
    expect(tabLocked({ plan: "max", planTabs: ["me"] }, "review")).toBe(true);
  });
  it("ключ приводится к одному виду", () => {
    expect(normKey(" abcd efgh-jkmn ")).toBe("ABCD-EFGH-JKMN");
  });
});

describe("экран ключа", () => {
  it("без ключа показывается вход, а «кто я» не спрашивается", async () => {
    server(OWNER);
    await fresh();
    expect(await screen.findByLabelText("вход по ключу")).toBeInTheDocument();
    expect(screen.getByLabelText("регистрация")).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("/api/org/me"))).toBe(false);
  });

  it("регистрация: план, способ оплаты для платного, ключ на сохранение, вход", async () => {
    server(OWNER);
    await fresh();
    const reg = await screen.findByLabelText("регистрация");
    // Бесплатному плану способ оплаты не нужен.
    expect(within(reg).queryByText("способ оплаты")).toBeNull();
    fireEvent.click(within(reg).getByRole("button", { name: "Pro" }));
    expect(within(reg).getByText("способ оплаты")).toBeInTheDocument();
    const pay = within(reg).getByRole("button", { name: "Оплатить и зарегистрироваться" });
    expect(pay).toBeDisabled();
    fireEvent.click(within(reg).getByRole("button", { name: "USDT (TON)" }));
    fireEvent.click(pay);

    expect(await screen.findByLabelText("ваш ключ")).toHaveTextContent(KEY);
    const r = calls.find((c) => c.url.includes("/api/codes/register"));
    expect(r.body).toEqual({ plan: "pro", method: "usdt" });
    expect(localStorage.getItem("sd_code_key")).toBe(KEY);
    expect(screen.getByRole("button", { name: "Скопировать" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/api/org/me"))).toBe(true));
    const me = calls.find((c) => c.url.includes("/api/org/me"));
    expect(me.headers["X-User-Token"]).toBe("t.t");
  });

  it("вход по сохранённому ключу: неверный не пускает, верный ведёт в приложение", async () => {
    server(OWNER);
    await fresh();
    const box = await screen.findByLabelText("вход по ключу");
    fireEvent.change(within(box).getByLabelText("ключ"), { target: { value: "0000-0000-0000-0000" } });
    fireEvent.click(within(box).getByRole("button", { name: "Войти" }));
    expect(await screen.findByText("Ключ не подходит.")).toBeInTheDocument();

    fireEvent.change(within(box).getByLabelText("ключ"), { target: { value: KEY.toLowerCase() } });
    fireEvent.click(within(box).getByRole("button", { name: "Войти" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/api/org/me"))).toBe(true));
    const t = calls.filter((c) => c.url.includes("/api/codes/token")).pop();
    expect(t.body.key).toBe(KEY);
  });

  it("с ключом на устройстве экран ключа не показывается", async () => {
    localStorage.setItem("sd_code_key", KEY);
    server(OWNER);
    await fresh();
    await waitFor(() => expect(calls.some((c) => c.url.includes("/api/org/me"))).toBe(true));
    expect(screen.queryByLabelText("вход по ключу")).toBeNull();
  });
});

describe("план гасит вкладки", () => {
  it("на free «Проверка» и «Схема» погашены, а «Задачи» открыты", async () => {
    localStorage.setItem("sd_code_key", KEY);
    server(OWNER);
    await fresh();
    const review = await screen.findByRole("button", { name: "Проверка" });
    await waitFor(() => expect(review).toHaveAttribute("aria-disabled", "true"));
    expect(screen.getByRole("button", { name: "Схема" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Задачи" })).not.toHaveAttribute("aria-disabled");
    // «Мой план» — в настройках, за шестерёнкой на анкете (владелец, 2026-09-21).
    const { openTab } = await import("./openTab.js");
    openTab("Анкета");
    expect(screen.queryByRole("button", { name: "мой план" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "настройки" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "язык" })).toHaveValue("ru");
    expect(await within(dialog).findByRole("button", { name: "мой план" })).toBeInTheDocument();
  });

  it("на pro в инструментах открыты только звонки и агенты", async () => {
    localStorage.setItem("sd_code_key", KEY);
    server({ ...OWNER, plan: "pro", code: { uid: "u1", plan: "pro" } });
    const { openTab } = await import("./openTab.js");
    await fresh();
    const review = await screen.findByRole("button", { name: "Проверка" });
    await waitFor(() => expect(review).not.toHaveAttribute("aria-disabled"));
    openTab("Инструменты");
    expect(await screen.findByRole("button", { name: "Звонки" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Агенты" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Роли" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Выгрузка" })).toBeDisabled();
  });
});
