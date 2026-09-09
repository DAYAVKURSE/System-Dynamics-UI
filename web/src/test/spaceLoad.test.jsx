import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { resetIdentity } from "../identity.js";

/* Сбой достройки пространства не роняет загрузку модели.

   Пространство — вспомогательный слой. Раньше исключение из
   normalizeSpace в openScenario уходило в .catch(() => {}), .finally
   ставило ready=true — и через полторы секунды на сервер уезжала
   ВСТРОЕННАЯ демонстрационная модель поверх рабочей. Сама достройка
   теперь терпит мусор (space.test.js), а здесь проверяется страховка в
   SystemModel: даже если достройка упадёт, модель откроется с пустым
   пространством, и на сервер уедет она, а не демонстрация. */

/* Достройку роняем нарочно: после починки normalizeSpace настоящих данных,
   на которых она падает, не осталось, а страховку проверить надо. */
vi.mock("../lib/space.js", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, normalizeSpace: (v) => {
    if (v && typeof v === "object" && v.boom) throw new Error("сломанная запись");
    return orig.normalizeSpace(v);
  } };
});

const scheme = (name, space) => ({
  entities: [{ id: "A", name, color: "#fff", x: 0, y: 0 }],
  traits: [{ id: "a1", e: "A", k: "growth", l: "ресурс", unit: "шт", have: 1 }],
  kinds: [{ id: "growth", sign: "↑", name: "рост", color: "#3DDC97", dir: "up" }],
  funcs: [], tasks: [], goals: [], factors: [], space,
});

const server = ({ puts }) => {
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const json = (body) => ({ ok: true, status: 200,
      headers: { get: () => "application/json" }, json: async () => body });
    if (u.includes("/api/health")) return json({ ok: true, scenarios: true, reports: true, org: true });
    if (u.includes("/api/org/me")) {
      return json({ id: "1", isOwner: true, known: true, role: null,
        tabs: ["tasks", "review", "timeline", "scheme", "sim", "tools"] });
    }
    if (u.endsWith("/api/scenarios")) {
      return json([{ id: "s1", name: "Моя схема",
        savedAt: "2026-01-01T00:00:00.000Z", openedAt: "2026-03-01T00:00:00.000Z" }]);
    }
    if (u.includes("/api/scenarios/s1/open")) return json({ id: "s1" });
    if (u.includes("/api/scenarios/s1")) {
      return json({ id: "s1", name: "Моя схема", savedAt: "2026-01-01T00:00:00.000Z",
        data: scheme("МОЯ СХЕМА", { boom: true }) });
    }
    if (u.includes("/api/org")) return json({ ownerId: "1", roles: [], users: [] });
    if (u.includes("/api/workspace")) {
      if (opts.method === "PUT") puts.push(JSON.parse(opts.body).model);
      return json({ savedAt: null });
    }
    return json({});
  });
};

const fresh = async () => {
  vi.resetModules();
  resetIdentity();
  const { default: SystemModel } = await import("../components/SystemModel.jsx");
  return render(<SystemModel />);
};
const names = (container) => [...container.querySelectorAll("svg g text")].map((t) => t.textContent);

beforeEach(() => { localStorage.clear(); resetIdentity(); });
afterEach(() => { vi.restoreAllMocks(); delete global.fetch; resetIdentity(); });

describe("сценарий со сломанным пространством", () => {
  it("модель открывается с пустым пространством, и на сервер уезжает она, а не демонстрация", async () => {
    const puts = [];
    server({ puts });
    const { container } = await fresh();
    fireEvent.click(await screen.findByRole("button", { name: "Схема" }));
    await waitFor(() => expect(names(container)).toContain("МОЯ СХЕМА"), { timeout: 3000 });
    expect(names(container)).not.toContain("Пользователи");
    await waitFor(() => expect(puts.length).toBeGreaterThan(0), { timeout: 4000 });
    expect(puts[0].entities.map((e) => e.name)).toEqual(["МОЯ СХЕМА"]);
    expect(puts[0].space).toEqual({ notes: [], pos: {}, qa: {}, hidden: [], arrows: [],
      view: { x: 0, y: 0, zoom: 1 } });
  });
});
