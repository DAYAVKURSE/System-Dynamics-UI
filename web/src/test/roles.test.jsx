import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { resetIdentity } from "../identity.js";

/* Роли решают, какие вкладки видны; задачи фильтруются по человеку.
   Настоящая проверка стоит на сервере — здесь проверяется, что интерфейс
   не показывает того, чего показывать не должен. */

// Сервер отвечает ровно тем, чем ответил бы настоящий: здоровьем и «кто я».
const server = (me, model = null) => {
  global.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (model && u.includes("/api/workspace")) {
      return { ok: true, json: async () => model };
    }
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
  /* Ни «Прогноз», ни «Деятельность» больше не главные вкладки: обе про ту же
     модель во времени и живут под схемой, с общим ползунком месяца. */
  .filter((t) => ["Задачи", "Проверка", "Схема", "Инструменты"].includes(t));

beforeEach(() => { localStorage.clear(); resetIdentity(); });
afterEach(() => { vi.restoreAllMocks(); delete global.fetch; resetIdentity(); });

describe("человек открывается окном, а не уходом со схемы", () => {
  it("нажатие на воркера показывает анкету и рейтинг и закрывается назад", async () => {
    /* Прежде нажатие переключало вкладку, и вернуться к активу, который
       сейчас собирают, было некуда. */
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("/api/health")) {
        return { ok: true, headers: { get: () => "application/json" },
          json: async () => ({ ok: true, scenarios: true, reminders: true,
            reports: true, org: true }) };
      }
      if (u.includes("/api/org/me")) {
        return { ok: true, json: async () => ({ id: "1", isOwner: true, known: true,
          role: null, profile: { about: "" },
          tabs: ["tasks", "review", "timeline", "scheme", "sim", "tools"] }) };
      }
      if (u.includes("/api/org")) {
        return { ok: true, json: async () => ({ ownerId: "1", roles: [],
          users: [{ id: "1", name: "Владелец" }, { id: "2", name: "Иван" }] }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    await fresh();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Схема" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    fireEvent.click(screen.getByRole("button", { name: /^Воркеры/ }));
    // В списке сразу все люди схемы: воркер актива — выбор из них.
    await waitFor(() =>
      expect(screen.getByLabelText("воркер актива: Иван")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Иван"));
    const box = document.querySelector("[role=dialog]");
    expect(box).not.toBeNull();
    expect(within(box).getByText("рейтинг и работы")).toBeInTheDocument();
    // Чужая анкета только читается: писать там нечего.
    expect(within(box).queryByRole("button", { name: "Сохранить анкету и график" })).toBeNull();

    fireEvent.click(within(box).getByRole("button", { name: "закрыть" }));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    // Схема осталась на месте: с неё никуда не уходили.
    expect(screen.getByText("воркеры актива")).toBeInTheDocument();
  });
});

describe("вкладки по роли", () => {
  it("владельцу видны все четыре, а «Прогноз» и «Деятельность» — под схемой", async () => {
    server({ id: "1", isOwner: true, known: true, role: null,
      tabs: ["tasks", "review", "timeline", "scheme", "sim", "tools"] });
    const { container } = await fresh();
    await waitFor(() => expect(tabNames(container)).toHaveLength(4));
    expect(tabNames(container)).toEqual(["Задачи", "Проверка", "Схема", "Инструменты"]);
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    expect(screen.getByRole("button", { name: "Управление" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Прогноз" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Деятельность" })).toBeTruthy();
  });

  it("исполнителю — только «Задачи»", async () => {
    server({ id: "2", isOwner: false, known: true,
      role: { id: "executor", name: "исполнитель" }, tabs: ["tasks"] });
    const { container } = await fresh();
    await waitFor(() => expect(tabNames(container)).toEqual(["Задачи"]));
    // Ни схемы, ни выгрузки: модель ему не принадлежит.
    expect(screen.queryByRole("button", { name: "Схема" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Инструменты" })).toBeNull();
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
    await waitFor(() => expect(tabNames(container)).toHaveLength(4));
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
    await waitFor(() => expect(tabNames(container)).toHaveLength(4));
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
      tabs: ["tasks", "review", "timeline", "scheme", "sim", "tools"] });
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
    entities: [{ id: "a", name: "Актив", color: "#fff", x: 0, y: 0,
      setters: ["1"], owners: ["2"], reviewers: ["3"] }],
    traits: [{ id: "t1", e: "a", k: "growth", l: "ресурс", unit: "шт", have: 0, want: 10 }],
    kinds: [{ id: "growth", sign: "↑", name: "рост", color: "#3DDC97", dir: "up" }],
    funcs: [{ id: "fn1", e: "a", name: "Работа", dur: 1, durUnit: "ч",
      takes: [], gives: [], setters: ["1"], owners: ["2"], reviewers: ["3"] }],
    tasks,
  });
  const TASKS = [
    { id: "t-mine", funcId: "fn1", title: "Моя задача", status: "backlog",
      setter: "1", assignee: "2", reviewer: "3", submissions: [], comments: [] },
    { id: "t-alien", funcId: "fn1", title: "Чужая задача", status: "backlog",
      setter: "1", assignee: "8", reviewer: "9", submissions: [], comments: [] },
  ];
  /* Владелец грузит модель через «Выгрузку»; не-владельцу её отдаёт сервер —
     у него схема одна, та, где его назначили, и сценариев нет вовсе. */
  const load = (container, m) => {
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
    const area = container.querySelector("textarea");
    fireEvent.change(area, { target: { value: JSON.stringify(m) } });
    fireEvent.blur(area);
    fireEvent.click(screen.getAllByRole("button", { name: "Загрузить" })[0]);
  };

  it("владелец видит и свои, и чужие", async () => {
    server({ id: "1", isOwner: true, known: true, role: null,
      tabs: ["tasks", "review", "timeline", "scheme", "sim", "tools"] });
    const { container } = await fresh();
    await waitFor(() => expect(tabNames(container)).toHaveLength(4));
    load(container, model(TASKS));
    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    expect(screen.getByText("Моя задача")).toBeTruthy();
    expect(screen.getByText("Чужая задача")).toBeTruthy();
  });

  it("исполнитель видит только свою — чужой нет нигде на странице", async () => {
    // Схема у него одна и приезжает с сервера: грузить свою ему нечем.
    server({ id: "2", isOwner: false, known: true,
      role: { id: "executor", name: "исполнитель" }, tabs: ["tasks"] },
    model(TASKS));
    await fresh();
    await waitFor(() => expect(screen.getByText("Моя задача")).toBeTruthy());
    expect(screen.queryByText("Чужая задача")).toBeNull();
  });

  it("проверяющий видит на «Проверке» только то, что проверяет он", async () => {
    server({ id: "3", isOwner: false, known: true,
      role: { id: "reviewer", name: "проверяющий" }, tabs: ["review"] },
    model(TASKS));
    await fresh();
    // Стартовая вкладка — «Задачи», а у него её нет: открываем свою.
    await waitFor(() => expect(screen.getByRole("button", { name: "Проверка" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Проверка" }));
    await waitFor(() => expect(screen.getByText("Моя задача")).toBeTruthy());
    expect(screen.queryByText("Чужая задача")).toBeNull();
  });

  it("принятое проверяющим становится «Готово»", async () => {
    server({ id: "3", isOwner: false, known: true,
      role: { id: "reviewer", name: "проверяющий" }, tabs: ["review"] },
    model([{ ...TASKS[0], status: "review",
      submissions: [{ id: "s1", at: new Date().toISOString(), hours: 3,
        takes: {}, gives: {}, text: "" }] }]));
    await fresh();
    await waitFor(() => expect(screen.getByRole("button", { name: "Проверка" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Проверка" }));
    await waitFor(() => expect(screen.getByText("Моя задача")).toBeTruthy());
    fireEvent.click(screen.getByText("Моя задача"));
    // Принять без оценки и без слов нельзя: и то и другое идёт в историю
    // исполнителя, а история из пустот не складывается.
    expect(screen.getByRole("button", { name: "Принять" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "оценка 5" }));
    fireEvent.change(screen.getByLabelText("комментарий к оценке"),
      { target: { value: "сделано как надо" } });
    fireEvent.click(screen.getByRole("button", { name: "Принять" }));
    // Задача ушла из ожидающих проверки — решение принято.
    await waitFor(() => expect(screen.getByText(/Ничего не ждёт проверки/)).toBeTruthy());
  });
});
