import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { resetIdentity } from "../identity.js";

/* Роли решают, какие вкладки видны; задачи фильтруются по человеку.
   Настоящая проверка стоит на сервере — здесь проверяется, что интерфейс
   не показывает того, чего показывать не должен. */

// Сервер отвечает ровно тем, чем ответил бы настоящий: здоровьем и «кто я».
const server = (me) => {
  global.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("/api/health")) {
      return { ok: true, headers: { get: () => "application/json" },
        json: async () => ({ ok: true, scenarios: true, reminders: true,
          reports: true, org: true }) };
    }
    if (u.includes("/api/org/me")) return { ok: true, json: async () => me };
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
const tabNames = (container) => [...container.querySelectorAll("button")]
  .map((b) => b.textContent)
  .filter((t) => ["Задачи", "Проверка", "Timeline", "Схема", "Прогноз",
    "Выгрузить"].includes(t));

beforeEach(() => { localStorage.clear(); resetIdentity(); });
afterEach(() => { vi.restoreAllMocks(); delete global.fetch; resetIdentity(); });

describe("вкладки по роли", () => {
  it("владельцу видны все шесть", async () => {
    server({ id: "1", isOwner: true, known: true, role: null,
      tabs: ["tasks", "review", "timeline", "scheme", "sim", "json"] });
    const { container } = await fresh();
    await waitFor(() => expect(tabNames(container)).toHaveLength(6));
    expect(tabNames(container)).toEqual(["Задачи", "Проверка", "Timeline",
      "Схема", "Прогноз", "Выгрузить"]);
  });

  it("исполнителю — только «Задачи»", async () => {
    server({ id: "2", isOwner: false, known: true,
      role: { id: "executor", name: "исполнитель" }, tabs: ["tasks"] });
    const { container } = await fresh();
    await waitFor(() => expect(tabNames(container)).toEqual(["Задачи"]));
    // Ни схемы, ни выгрузки: модель ему не принадлежит.
    expect(screen.queryByRole("button", { name: "Схема" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Выгрузить" })).toBeNull();
  });

  it("проверяющему — только «Проверка»", async () => {
    server({ id: "3", isOwner: false, known: true,
      role: { id: "reviewer", name: "проверяющий" }, tabs: ["review"] });
    const { container } = await fresh();
    await waitFor(() => expect(tabNames(container)).toEqual(["Проверка"]));
  });

  it("незваному объясняют, что делать, а не показывают пустое приложение", async () => {
    server({ id: "9", isOwner: false, known: false, role: null, tabs: [] });
    const { container } = await fresh();
    await waitFor(() => expect(screen.getByText(/Вас ещё не позвали/)).toBeTruthy());
    expect(tabNames(container)).toEqual([]);
    expect(screen.getByText(/перешлёт боту ваше сообщение/)).toBeTruthy();
  });

  it("роль удалили — человек это видит, а не гадает", async () => {
    server({ id: "4", isOwner: false, known: true, role: null, tabs: [] });
    await fresh();
    await waitFor(() =>
      expect(screen.getByText(/Ваша роль ничего не открывает/)).toBeTruthy());
  });

  it("без сервера приложение остаётся одиночным и полным", async () => {
    global.fetch = vi.fn(async () => { throw new Error("нет сети"); });
    const { container } = await fresh();
    await waitFor(() => expect(tabNames(container)).toHaveLength(6));
  });

  it("сервер без токена бота — тоже одиночный режим, а не отказ", async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/api/health")) {
        return { ok: true, headers: { get: () => "application/json" },
          json: async () => ({ ok: true, scenarios: false, reports: false, org: false }) };
      }
      return { ok: false, status: 401, json: async () => ({}) };
    });
    const { container } = await fresh();
    await waitFor(() => expect(tabNames(container)).toHaveLength(6));
  });
});

describe("общая модель ходит через сервер", () => {
  const calls = [];
  const spyServer = (me, workspace) => {
    calls.length = 0;
    global.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      calls.push({ url: u, method: opts.method || "GET", body: opts.body });
      if (u.includes("/api/health")) {
        return { ok: true, headers: { get: () => "application/json" },
          json: async () => ({ ok: true, scenarios: true, reports: true, org: true }) };
      }
      if (u.includes("/api/org/me")) return { ok: true, json: async () => me };
      if (u.includes("/api/workspace")) {
        return { ok: true, json: async () => workspace || { savedAt: null } };
      }
      return { ok: true, json: async () => ({}) };
    });
  };

  it("владелец выкладывает модель на сервер — иначе её никто не увидит", async () => {
    vi.useFakeTimers();
    spyServer({ id: "1", isOwner: true, known: true, role: null,
      tabs: ["tasks", "review", "timeline", "scheme", "sim", "json"] });
    await fresh();
    await vi.advanceTimersByTimeAsync(2500);
    vi.useRealTimers();
    const put = calls.find((c) => c.url.includes("/api/workspace") && c.method === "PUT");
    expect(put).toBeTruthy();
    expect(JSON.parse(put.body).model).toHaveProperty("traits");
  });

  it("исполнителю модель приезжает с сервера, а не берётся из браузера", async () => {
    spyServer({ id: "2", isOwner: false, known: true,
      role: { id: "executor", name: "исполнитель" }, tabs: ["tasks"] },
    { entities: [{ id: "a", name: "Присланный актив", color: "#fff", x: 0, y: 0 }],
      traits: [{ id: "t1", e: "a", k: "growth", l: "присланный ресурс", unit: "шт",
        have: 0, want: 5, by: 3, flow: false }],
      edges: [], kinds: [], okrs: [], hypos: [],
      tasks: [{ id: "tk", goalId: "t1", title: "Присланная задача", status: "backlog",
        assignee: "2", reviewer: "1", submissions: [], comments: [] }] });
    await fresh();
    await waitFor(() => expect(screen.getByText("Присланная задача")).toBeTruthy());

    // И он ничего на сервер не пишет: модель ему не принадлежит. Ждём
    // дольше, чем задержка выгрузки, — иначе проверка сошлась бы просто
    // потому, что таймер не успел сработать.
    await new Promise((r) => setTimeout(r, 1800));
    expect(calls.some((c) => c.url.includes("/api/workspace") && c.method === "PUT"))
      .toBe(false);
  });
});

describe("кому какие задачи видны", () => {
  const model = (tasks) => ({
    entities: [{ id: "a", name: "Актив", color: "#fff", x: 0, y: 0 }],
    traits: [{ id: "t1", e: "a", k: "growth", l: "ресурс", unit: "шт",
      have: 0, want: 10, by: 6, flow: false }],
    edges: [{ id: "ed1", from: "a", to: "t1", carrier: "движение", gives: 1,
      per: "мес", sign: 1, conds: [], basis: "fact" }],
    kinds: [{ id: "growth", sign: "↑", name: "рост", color: "#3DDC97", dir: "up" }],
    okrs: [], hypos: [], tasks,
  });
  const TASKS = [
    { id: "t-mine", goalId: "t1", edgeId: "ed1", title: "Моя задача",
      status: "backlog", assignee: "2", reviewer: "3", submissions: [], comments: [] },
    { id: "t-alien", goalId: "t1", edgeId: "ed1", title: "Чужая задача",
      status: "backlog", assignee: "8", reviewer: "9", submissions: [], comments: [] },
  ];
  const load = (container, m) => {
    fireEvent.click(screen.getAllByRole("button", { name: "Выгрузить" })[0]);
    const area = container.querySelector("textarea");
    fireEvent.change(area, { target: { value: JSON.stringify(m) } });
    fireEvent.blur(area);
    fireEvent.click(screen.getAllByRole("button", { name: "Загрузить" })[0]);
  };

  it("владелец видит и свои, и чужие", async () => {
    server({ id: "1", isOwner: true, known: true, role: null,
      tabs: ["tasks", "review", "timeline", "scheme", "sim", "json"] });
    const { container } = await fresh();
    await waitFor(() => expect(tabNames(container)).toHaveLength(6));
    load(container, model(TASKS));
    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    expect(screen.getByText("Моя задача")).toBeTruthy();
    expect(screen.getByText("Чужая задача")).toBeTruthy();
  });

  it("исполнитель видит только свою — чужой нет нигде на странице", async () => {
    server({ id: "2", isOwner: false, known: true,
      role: { id: "executor", name: "исполнитель" },
      tabs: ["tasks", "json"] });          // json — чтобы загрузить модель в тесте
    const { container } = await fresh();
    await waitFor(() => expect(tabNames(container)).toContain("Задачи"));
    load(container, model(TASKS));
    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    expect(screen.getByText("Моя задача")).toBeTruthy();
    expect(screen.queryByText("Чужая задача")).toBeNull();
  });

  it("проверяющий видит на «Проверке» только то, что проверяет он", async () => {
    server({ id: "3", isOwner: false, known: true,
      role: { id: "reviewer", name: "проверяющий" }, tabs: ["review", "json"] });
    const { container } = await fresh();
    await waitFor(() => expect(tabNames(container)).toContain("Проверка"));
    load(container, model(TASKS));
    fireEvent.click(screen.getByRole("button", { name: "Проверка" }));
    expect(screen.getByText("Моя задача")).toBeTruthy();
    expect(screen.queryByText("Чужая задача")).toBeNull();
  });

  it("принятое проверяющим становится «Готово»", async () => {
    server({ id: "3", isOwner: false, known: true,
      role: { id: "reviewer", name: "проверяющий" }, tabs: ["review", "json"] });
    const { container } = await fresh();
    await waitFor(() => expect(tabNames(container)).toContain("Проверка"));
    load(container, model([{ ...TASKS[0], status: "review",
      submissions: [{ id: "s1", at: new Date().toISOString(), amount: 3, text: "" }] }]));
    fireEvent.click(screen.getByRole("button", { name: "Проверка" }));
    fireEvent.click(screen.getByText("Моя задача"));
    fireEvent.click(screen.getByRole("button", { name: "Принять" }));

    fireEvent.click(screen.getAllByRole("button", { name: "Выгрузить" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Выгрузить" })[1]);
    expect(JSON.parse(container.querySelector("textarea").value).tasks[0].status)
      .toBe("done");
  });
});
