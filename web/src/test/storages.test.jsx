import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { resetIdentity } from "../identity.js";
import { currentStorage, sessionHeaders, setStorage } from "../session.js";
import { openTab } from "./openTab.js";

/* Личные хранилища (владелец, 2026-09-21): в каком работаем — заголовком
   в каждом запросе; активы «Владелец» и «Система» не удаляются. */

let calls;
const server = (me, model) => {
  calls = [];
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, headers: opts.headers || {} });
    if (u.includes("/api/health")) {
      return { ok: true, headers: { get: () => "application/json" },
        json: async () => ({ ok: true, scenarios: true, reminders: true, reports: true, org: true }) };
    }
    if (u.includes("/api/org/me")) {
      if ((opts.headers || {})["X-Storage"] === "gone") return { ok: false, status: 403, json: async () => ({}) };
      return { ok: true, json: async () => me };
    }
    if (u.includes("/api/workspace")) return { ok: true, json: async () => model };
    if (u.includes("/api/org")) return { ok: true, json: async () => ({ ownerId: "1", roles: [], users: [] }) };
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
  storage: "main", ownStorage: "main", storages: [{ id: "main", own: true, owner: "Я" }] };
const MODEL = { entities: [
  { id: "owner", name: "Владелец", x: 24, y: 300, fixed: true },
  { id: "system", name: "Система", x: 24, y: 560, fixed: true },
  { id: "e1", name: "Клиенты", x: 300, y: 24 }],
traits: [], funcs: [], tasks: [], kinds: [], materials: [], procs: [] };

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); resetIdentity(); });
afterEach(() => { vi.restoreAllMocks(); delete global.fetch; resetIdentity(); setStorage(""); });

describe("заголовок хранилища", () => {
  it("своё — без заголовка, чужое — X-Storage в каждом запросе", () => {
    expect(sessionHeaders()["X-Storage"]).toBeUndefined();
    setStorage("main");
    expect(sessionHeaders()["X-Storage"]).toBe("main");
    expect(currentStorage()).toBe("main");
  });

  it("хранилище, куда больше не пускают, забывается — возвращаемся в своё", async () => {
    setStorage("gone");
    server(OWNER, MODEL);
    await fresh();
    await waitFor(() => expect(calls.filter((c) => c.url.includes("/api/org/me")).length).toBe(2));
    expect(currentStorage()).toBe("");
    expect(calls.filter((c) => c.url.includes("/api/org/me"))[1].headers["X-Storage"]).toBeUndefined();
  });
});

describe("активы по умолчанию", () => {
  it("у «Владельца» и «Системы» нет кнопки удаления, у обычного актива — есть", async () => {
    server(OWNER, MODEL);
    const { container } = await fresh();
    await waitFor(() => expect(calls.some((c) => c.url.includes("/api/workspace"))).toBe(true));
    openTab("Схема");
    const pick = (name) => {
      const g = [...container.querySelectorAll("svg g")].find((el) =>
        [...el.querySelectorAll("text")].some((t) => t.textContent === name));
      if (!g) throw new Error(`актив «${name}» не найден`);
      const { fireEvent } = require("@testing-library/react");
      fireEvent.pointerDown(g, { clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.pointerUp(g, { clientX: 10, clientY: 10, pointerId: 1 });
    };
    await screen.findByText("Система");
    pick("Система");
    expect(screen.queryByRole("button", { name: "Удалить актив" })).toBeNull();
    pick("Клиенты");
    expect(screen.getByRole("button", { name: "Удалить актив" })).toBeInTheDocument();
  });
});
