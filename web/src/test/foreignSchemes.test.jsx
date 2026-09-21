import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { resetIdentity } from "../identity.js";
import { openTab } from "./openTab.js";

/* Чужие схемы в окне схемы (владелец, 2026-09-21): плакард с именем
   владельца и «свернуть» справа; свёрнутые — полосами внизу с
   «развернуть». */

let calls;
const OWN = { entities: [{ id: "owner", name: "Владелец", x: 24, y: 300, fixed: true },
  { id: "system", name: "Система", x: 24, y: 560, fixed: true }],
traits: [], funcs: [], tasks: [], kinds: [], materials: [], procs: [] };
const THEIRS = { entities: [{ id: "e9", name: "Цех Ивана", x: 40, y: 40 }],
  traits: [{ id: "t9", e: "e9", k: "res", l: "детали", unit: "шт." }],
  funcs: [], tasks: [], kinds: [], materials: [], procs: [] };
const ME = { id: "1", isOwner: true, known: true, role: null, profile: { about: "" },
  tabs: ["market", "me", "tasks", "review", "scheme", "reports", "tools"],
  storage: "1", ownStorage: "1",
  storages: [{ id: "1", own: true, owner: "Я" }, { id: "300", own: false, owner: "Иван" }] };

const server = () => {
  calls = [];
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const h = opts.headers || {};
    calls.push({ url: u, headers: h });
    if (u.includes("/api/health")) {
      return { ok: true, headers: { get: () => "application/json" },
        json: async () => ({ ok: true, scenarios: true, reminders: true, reports: true, org: true }) };
    }
    if (u.includes("/api/org/me")) return { ok: true, json: async () => ME };
    if (u.includes("/api/workspace")) {
      return { ok: true, json: async () => (h["X-Storage"] === "300" ? THEIRS : OWN) };
    }
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

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); resetIdentity(); server(); });
afterEach(() => { vi.restoreAllMocks(); delete global.fetch; resetIdentity(); });

describe("чужие схемы", () => {
  it("плакард с именем владельца и его активами; «свернуть» уводит в полосу внизу, «развернуть» — обратно", async () => {
    await fresh();
    await waitFor(() => expect(calls.some((c) => c.url.includes("/api/workspace"))).toBe(true));
    openTab("Схема");
    const card = await screen.findByLabelText("схема Иван");
    // Срез чужого хранилища спрошен с его заголовком, а своё — без.
    const theirs = calls.find((c) => c.url.includes("/api/workspace") && c.headers["X-Storage"] === "300");
    expect(theirs).toBeTruthy();
    await within(card).findByText("Цех Ивана");
    expect(within(card).getByText("Иван")).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "свернуть" }));
    const strips = screen.getByLabelText("свёрнутые схемы");
    const strip = within(strips).getByLabelText("схема Иван");
    expect(within(strip).queryByText("Цех Ивана")).toBeNull();
    expect(JSON.parse(localStorage.getItem("sd_foreign_closed"))).toEqual(["300"]);

    fireEvent.click(within(strip).getByRole("button", { name: "развернуть" }));
    expect(screen.queryByLabelText("свёрнутые схемы")).toBeNull();
    await within(screen.getByLabelText("схема Иван")).findByText("Цех Ивана");
  });

  it("без чужих хранилищ плакардов нет", async () => {
    const me = { ...ME, storages: [{ id: "1", own: true, owner: "Я" }] };
    global.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("/api/health")) {
        return { ok: true, headers: { get: () => "application/json" },
          json: async () => ({ ok: true, scenarios: true, reminders: true, reports: true, org: true }) };
      }
      if (u.includes("/api/org/me")) return { ok: true, json: async () => me };
      if (u.includes("/api/workspace")) return { ok: true, json: async () => OWN };
      if (u.includes("/api/org")) return { ok: true, json: async () => ({ ownerId: "1", roles: [], users: [] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    });
    await fresh();
    openTab("Схема");
    await screen.findByText("Система");
    expect(screen.queryByLabelText(/^схема /)).toBeNull();
  });
});
