import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { resetIdentity } from "../identity.js";

/* Какая схема открывается при запуске.

   Здесь проверяется не «правильно ли выбрана» схема — за это отвечает
   pickScenario, — а то, что автозагрузка вообще доходит до конца. Она
   гонится с ответом «кто я»: тот приходит одним запросом, а список схем —
   двумя, и приходит позже. Стоит ответу «кто я» изменить состояние, как
   эффект автозагрузки перезапускается, и незавершённая загрузка не должна
   от этого отменяться. */

const scheme = (name) => ({
  entities: [{ id: "A", name, color: "#fff", x: 0, y: 0 }],
  traits: [{ id: "a1", e: "A", k: "growth", l: "ресурс", unit: "шт", have: 1 }],
  kinds: [{ id: "growth", sign: "↑", name: "рост", color: "#3DDC97", dir: "up" }],
  funcs: [], tasks: [], goals: [], factors: [],
});

/* Сервер отвечает как настоящий, но с задержками: «кто я» — сразу, список
   схем — через тик. Именно так и выходит в жизни: до списка нужны два
   запроса подряд, а до «кто я» — один. */
const server = ({ meDelay = 0, listDelay = 30 } = {}) => {
  const wait = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
  global.fetch = vi.fn(async (url) => {
    const u = String(url);
    const json = (body) => ({ ok: true, status: 200,
      headers: { get: () => "application/json" }, json: async () => body });
    if (u.includes("/api/health")) {
      return wait(listDelay, json({ ok: true, scenarios: true, reports: true, org: true }));
    }
    if (u.includes("/api/org/me")) {
      return wait(meDelay, json({ id: "1", isOwner: true, known: true, role: null,
        tabs: ["tasks", "review", "scheme", "reports", "tools"] }));
    }
    if (u.endsWith("/api/scenarios")) {
      return wait(listDelay, json([{ id: "s1", name: "Моя схема",
        savedAt: "2026-01-01T00:00:00.000Z", openedAt: "2026-03-01T00:00:00.000Z" }]));
    }
    if (u.includes("/api/scenarios/s1/open")) return json({ id: "s1" });
    if (u.includes("/api/scenarios/s1")) {
      return json({ id: "s1", name: "Моя схема", savedAt: "2026-01-01T00:00:00.000Z",
        data: scheme("МОЯ СХЕМА") });
    }
    if (u.includes("/api/org")) return json({ ownerId: "1", roles: [], users: [] });
    if (u.includes("/api/workspace")) return json({ savedAt: null });
    return json({});
  });
};

const fresh = async () => {
  vi.resetModules();
  resetIdentity();
  const { default: SystemModel } = await import("../components/SystemModel.jsx");
  return render(<SystemModel />);
};
const names = (container) => [...container.querySelectorAll("svg g text")]
  .map((t) => t.textContent);

beforeEach(() => { localStorage.clear(); resetIdentity(); });
afterEach(() => { vi.restoreAllMocks(); delete global.fetch; resetIdentity(); });

describe("автозагрузка последней схемы", () => {
  it("доходит до конца, даже если ответ «кто я» приходит раньше списка схем", async () => {
    /* Ответ «кто я» меняет состояние — и эффект автозагрузки
       перезапускается. Прежде его уборка гасила незавершённую загрузку, а
       повторный заход упирался в «уже открывали» и не делал ничего:
       человек оставался на встроенной демонстрационной схеме. */
    server({ meDelay: 0, listDelay: 30 });
    const { container } = await fresh();
    fireEvent.click(await screen.findByRole("button", { name: "Схема" }));
    await waitFor(() => expect(names(container)).toContain("МОЯ СХЕМА"), { timeout: 3000 });
  });

  it("и если список приходит раньше — тоже", async () => {
    server({ meDelay: 40, listDelay: 0 });
    const { container } = await fresh();
    fireEvent.click(await screen.findByRole("button", { name: "Схема" }));
    await waitFor(() => expect(names(container)).toContain("МОЯ СХЕМА"), { timeout: 3000 });
  });
});


describe("рабочая модель владельца", () => {
  /* Владелец пишет модель на сервер сам, при каждой правке. Значит она и
     есть «то, с чем он закончил»: открывать вместо неё встроенную
     демонстрационную — значит каждый раз терять его работу, которую сервер
     при этом исправно хранит. */
  const serverWith = ({ scenarios = [], workspace = null, onPut } = {}) => {
    global.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      const json = (body) => ({ ok: true, status: 200,
        headers: { get: () => "application/json" }, json: async () => body });
      if (u.includes("/api/health")) {
        return json({ ok: true, scenarios: true, reports: true, org: true });
      }
      if (u.includes("/api/org/me")) {
        return json({ id: "1", isOwner: true, known: true, role: null,
          tabs: ["tasks", "review", "scheme", "reports", "tools"] });
      }
      if (u.endsWith("/api/scenarios")) return json(scenarios);
      if (u.includes("/api/workspace")) {
        if ((opts.method || "GET") === "PUT") {
          onPut?.(JSON.parse(opts.body).model);
          return json({ ok: true });
        }
        return json(workspace || { savedAt: null });
      }
      if (u.includes("/api/org")) return json({ ownerId: "1", roles: [], users: [] });
      return json({});
    });
  };

  it("сохранённых схем нет — открывается его же модель с сервера", async () => {
    serverWith({ workspace: { savedAt: "2026-01-01T00:00:00.000Z", ...scheme("С СЕРВЕРА") } });
    const { container } = await fresh();
    fireEvent.click(await screen.findByRole("button", { name: "Схема" }));
    await waitFor(() => expect(names(container)).toContain("С СЕРВЕРА"), { timeout: 3000 });
  });

  it("демонстрационная модель не уезжает на сервер поверх настоящей", async () => {
    /* Это была потеря данных, а не неудобство: приложение поднималось на
       встроенной модели и через полторы секунды выгружало её ПОВЕРХ работы
       владельца — раньше, чем та успевала оттуда приехать. Чинить нечем:
       сервер хранит одну модель, прежней там уже нет. */
    vi.useFakeTimers();
    const put = [];
    serverWith({ workspace: { savedAt: "2026-01-01T00:00:00.000Z", ...scheme("С СЕРВЕРА") },
      onPut: (m) => put.push(m.entities.map((e) => e.name)) });
    await fresh();
    // Полторы секунды — прежний срок выгрузки. За это время на сервер не
    // должно уехать ничего, кроме того, что оттуда же и пришло.
    await vi.advanceTimersByTimeAsync(4000);
    vi.useRealTimers();
    expect(put.every((names2) => names2.includes("С СЕРВЕРА"))).toBe(true);
  });

  it("черновик не глушит автозагрузку — схема грузится под плашкой", async () => {
    /* Прежде при несохранённых правках автозагрузка не запускалась вовсе:
       под плашкой оставалась демонстрационная модель, и человек, не
       заметивший плашку, каждый раз видел не свою схему. */
    localStorage.setItem("sd_draft", JSON.stringify({ v: 5,
      savedAt: new Date().toISOString(), name: "черновик",
      doc: scheme("ИЗ ЧЕРНОВИКА") }));
    serverWith({ workspace: { savedAt: "2026-01-01T00:00:00.000Z", ...scheme("С СЕРВЕРА") } });
    const { container } = await fresh();
    expect(await screen.findByText(/Остались правки от/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    await waitFor(() => expect(names(container)).toContain("С СЕРВЕРА"), { timeout: 3000 });
  });

  it("а «Восстановить» перебивает её: черновик новее всего на диске", async () => {
    localStorage.setItem("sd_draft", JSON.stringify({ v: 5,
      savedAt: new Date().toISOString(), name: "черновик",
      doc: scheme("ИЗ ЧЕРНОВИКА") }));
    serverWith({ workspace: { savedAt: "2026-01-01T00:00:00.000Z", ...scheme("С СЕРВЕРА") } });
    const { container } = await fresh();
    fireEvent.click(await screen.findByRole("button", { name: "Восстановить" }));
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    await waitFor(() => expect(names(container)).toContain("ИЗ ЧЕРНОВИКА"));
    // И приехавшая следом модель с сервера её не затирает.
    await new Promise((r) => setTimeout(r, 200));
    expect(names(container)).toContain("ИЗ ЧЕРНОВИКА");
    expect(names(container)).not.toContain("С СЕРВЕРА");
  });
});
