import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { resetIdentity } from "../identity.js";
import { openTab } from "./openTab.js";

/* Обновление у позванного без перезагрузки.

   Модель приезжала один раз при открытии: назначенную только что задачу
   человек видел, лишь открыв приложение заново. Теперь позванный
   переспрашивает срез раз в полминуты — пока вкладка на виду — и сразу,
   когда она снова на виду. Владелец не переспрашивает: его модель живёт
   у него в окне и уезжает на сервер сама, и подставлять серверную поверх
   его правок нельзя. */

const ws = (tasks) => ({
  entities: [{ id: "a", name: "Актив", color: "#fff", x: 0, y: 0 }],
  traits: [], kinds: [], funcs: [], goals: [], factors: [], published: [],
  tasks: tasks.map((title, i) => ({ id: `t${i}`, funcId: "", title, status: "backlog",
    assignee: "2", reviewer: "1", submissions: [], comments: [] })),
});

let calls;
const server = (me, state) => {
  calls = [];
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || "GET" });
    if (u.includes("/api/health")) {
      return { ok: true, headers: { get: () => "application/json" },
        json: async () => ({ ok: true, scenarios: true, reports: true, org: true }) };
    }
    if (u.includes("/api/org/me")) return { ok: true, json: async () => me };
    if (u.includes("/api/workspace/ratings")) return { ok: true, json: async () => ({ mine: { comments: [] }, others: {} }) };
    if (u.includes("/api/workspace")) return { ok: true, json: async () => state.current };
    if (u.includes("/api/org")) return { ok: true, json: async () => ({ ownerId: "1", roles: [], users: [] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  });
};
const gets = () => calls.filter((c) => c.method === "GET" && /\/api\/workspace$/.test(c.url)).length;

const fresh = async () => {
  vi.resetModules();
  resetIdentity();
  const { default: SystemModel } = await import("../components/SystemModel.jsx");
  const out = render(<SystemModel />);
  // Открывается анкета (владелец, 2026-09-26); задачи — докрутив барабан.
  await waitFor(() => openTab("Задачи"));
  return out;
};

const EXEC = { id: "2", isOwner: false, known: true,
  role: { id: "executor", name: "исполнитель" }, tabs: ["tasks"] };
const OWNER = { id: "1", isOwner: true, known: true, role: null,
  tabs: ["tasks", "review", "scheme", "reports", "tools"] };

beforeEach(() => {
  localStorage.clear(); resetIdentity();
  // Только интервал: setTimeout остаётся настоящим — на нём живут и
  // ожидания в тесте, и черновик с автосохранением приложения.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete global.fetch; resetIdentity(); });

describe("позванный видит новое без перезагрузки", () => {
  it("задача, поставленная после открытия, появляется через полминуты", async () => {
    const state = { current: ws(["Первая задача"]) };
    server(EXEC, state);
    await fresh();
    await waitFor(() => expect(screen.getByText("Первая задача")).toBeTruthy());
    const before = gets();
    state.current = ws(["Первая задача", "Новая задача"]);
    await vi.advanceTimersByTimeAsync(31000);
    await waitFor(() => expect(screen.getByText("Новая задача")).toBeTruthy());
    expect(gets()).toBe(before + 1);
  });

  it("срез без изменений ничего не перерисовывает, но спрашивается снова", async () => {
    const state = { current: ws(["Первая задача"]) };
    server(EXEC, state);
    await fresh();
    await waitFor(() => expect(screen.getByText("Первая задача")).toBeTruthy());
    const before = gets();
    await vi.advanceTimersByTimeAsync(61000);
    expect(gets()).toBe(before + 2);
    expect(screen.getByText("Первая задача")).toBeTruthy();
  });

  it("скрытая вкладка не спрашивает; показавшаяся — спрашивает сразу", async () => {
    const state = { current: ws(["Первая задача"]) };
    server(EXEC, state);
    await fresh();
    await waitFor(() => expect(screen.getByText("Первая задача")).toBeTruthy());
    const before = gets();
    const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await vi.advanceTimersByTimeAsync(31000);
    expect(gets()).toBe(before);
    state.current = ws(["Первая задача", "Новая задача"]);
    vis.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(screen.getByText("Новая задача")).toBeTruthy());
    expect(gets()).toBe(before + 1);
  });

  it("владелец не переспрашивает: серверную модель поверх его правок не кладут", async () => {
    const state = { current: ws(["Первая задача"]) };
    server(OWNER, state);
    await fresh();
    await waitFor(() => expect(gets()).toBeGreaterThan(0));
    // Дать автозагрузке дойти до конца, прежде чем считать.
    await new Promise((r) => setTimeout(r, 200));
    const before = gets();
    await vi.advanceTimersByTimeAsync(61000);
    expect(gets()).toBe(before);
  });
});
