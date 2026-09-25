import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import BrainstormPanel from "../components/BrainstormPanel.jsx";
import BoardApp from "../components/BoardApp.jsx";
import { ALL_TABS, TAB_NAMES, resetIdentity } from "../identity.js";
import { PLAN_TABS } from "../plans.js";
import { TAB_LIST } from "../components/SystemModel.jsx";
import { boardServer, member } from "./boardServer.js";
import { openTab } from "./openTab.js";

/* ════════════════════════════════════════════════════════════════
   ВКЛАДКА «БРЕЙНШТОРМ» И МИНИ-ПРИЛОЖЕНИЕ ДОСКИ (владелец, 2026-09-25)

   «В основном приложении должна быть вкладка Brainstorm. При нажатии я
   должен видеть те же самые доски со стикерами, но слева под участниками
   у меня должно быть меню доски, в котором я должен списком видеть все
   созданные доски и кнопку "+ новая" над ними.»
   ════════════════════════════════════════════════════════════════ */

const ME = "100";
const B1 = {
  id: "b1", name: "Идеи", color: "#1B2430", by: ME, byName: "Иван", createdAt: "2", rev: 1,
  members: [member(ME, "Иван", "#9BCB5A")],
  stickers: [{ id: "a", by: ME, text: "первая", createdAt: "1", updatedAt: "1" }],
};
const B2 = {
  id: "b2", name: "Ретро", color: "#2A2033", by: ME, byName: "Иван", createdAt: "1", rev: 1,
  members: [member(ME, "Иван", "#9BCB5A")],
  stickers: [{ id: "x", by: ME, text: "из ретро", createdAt: "1", updatedAt: "1" }],
};
const summary = (b) => ({ id: b.id, name: b.name, color: b.color, by: b.by, byName: b.byName,
  stickers: b.stickers.length, createdAt: b.createdAt });

let srv;
const setUrl = (search) => {
  delete window.location;
  window.location = new URL(`https://example.test/${search}`);
};
beforeEach(() => {
  sessionStorage.clear();
  srv = boardServer(B1, { me: ME, list: [summary(B1), summary(B2)] });
  srv.addBoard(B2);
  global.fetch = srv.fetch;
});
afterEach(() => { vi.restoreAllMocks(); delete window.Telegram; setUrl(""); resetIdentity(); });

describe("вкладка в списках", () => {
  it("«Брейншторм» — сразу за «Отчётами», перед «Инструментами», везде одинаково", () => {
    expect(ALL_TABS.indexOf("brainstorm")).toBe(ALL_TABS.indexOf("reports") + 1);
    expect(ALL_TABS.indexOf("tools")).toBe(ALL_TABS.indexOf("brainstorm") + 1);
    expect(TAB_NAMES.brainstorm).toBe("Брейншторм");
    const keys = TAB_LIST.map(([k]) => k);
    expect(keys.slice(keys.indexOf("reports"), keys.indexOf("reports") + 3))
      .toEqual(["reports", "brainstorm", "tools"]);
    expect(TAB_LIST.find(([k]) => k === "brainstorm")[1]).toBe("Брейншторм");
    // Max открывает всё, free и pro — как были.
    expect(PLAN_TABS.max).toContain("brainstorm");
    expect(PLAN_TABS.free).not.toContain("brainstorm");
    expect(PLAN_TABS.pro).not.toContain("brainstorm");
  });
});

describe("панель", () => {
  it("меню досок — под участниками, слева; выбранная доска — справа", async () => {
    const { container } = render(<BrainstormPanel />);
    expect(await screen.findByText("первая")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "доски" });
    const items = within(nav).getAllByRole("button").map((b) => b.getAttribute("aria-label") || b.textContent);
    // «+ новая» — над списком досок.
    expect(items).toEqual(["+ новая", "доска: Идеи", "доска: Ретро"]);
    expect(within(nav).getByRole("button", { name: "доска: Идеи" })).toHaveAttribute("aria-current", "true");
    // Меню стоит ниже шапки с участниками.
    const all = [...container.querySelectorAll("*")];
    const people = screen.getByRole("button", { name: "Участники" });
    expect(all.indexOf(nav)).toBeGreaterThan(all.indexOf(people));
    // Другая доска — по нажатию.
    fireEvent.click(within(nav).getByRole("button", { name: "доска: Ретро" }));
    expect(await screen.findByText("из ретро")).toBeInTheDocument();
    expect(screen.queryByText("первая")).toBeNull();
    expect(within(nav).getByRole("button", { name: "доска: Ретро" })).toHaveAttribute("aria-current", "true");
  });

  it("ушёл на другую доску, не дождавшись отправки, — набранное всё равно уходит", async () => {
    render(<BrainstormPanel />);
    const box = await screen.findByDisplayValue("первая");
    fireEvent.change(box, { target: { value: "первая, дописанная" } });
    fireEvent.click(screen.getByRole("button", { name: "доска: Ретро" }));
    await screen.findByText("из ретро");
    await waitFor(() => expect(srv.board("b1").stickers[0].text).toBe("первая, дописанная"));
    expect(srv.calls.find((c) => c.method === "PATCH").path).toBe("/api/boards/b1/stickers/a");
  });

  it("«+ новая» — поле названия и «Создать»; новая доска сразу выбрана", async () => {
    render(<BrainstormPanel />);
    await screen.findByText("первая");
    fireEvent.click(screen.getByRole("button", { name: "+ новая" }));
    const input = screen.getByRole("textbox", { name: "название доски" });
    expect(input).not.toHaveAttribute("placeholder");
    // Пустое название — отказ словами, без похода на сервер.
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    expect(screen.getByText("Название доски не может быть пустым.")).toBeInTheDocument();
    expect(srv.calls.some((c) => c.path === "/api/boards" && c.method === "POST")).toBe(false);
    fireEvent.change(input, { target: { value: "  Планёрка  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    const nav = screen.getByRole("navigation", { name: "доски" });
    await waitFor(() => expect(within(nav).getByRole("button", { name: "доска: Планёрка" }))
      .toHaveAttribute("aria-current", "true"));
    expect(srv.calls.find((c) => c.path === "/api/boards" && c.method === "POST").body)
      .toEqual({ name: "Планёрка" });
    expect(screen.queryByRole("textbox", { name: "название доски" })).toBeNull();
    // Новая — сверху списка.
    expect(within(nav).getAllByRole("button")[1]).toHaveAccessibleName("доска: Планёрка");
    expect(await screen.findByText("Планёрка", { selector: "h1" })).toBeInTheDocument();
  });

  /* Доску не удалить, поэтому второй не должно появиться ни от двойного
     Enter, ни от автоповтора клавиши, ни от Enter вдогонку за «Создать». */
  it("двойной Enter, пока создание в пути, — одна доска", async () => {
    const real = srv.fetch;
    let release;
    const held = new Promise((r) => { release = r; });
    global.fetch = vi.fn(async (url, opts = {}) => {
      if (String(url) === "/api/boards" && opts.method === "POST") await held;
      return real(url, opts);
    });
    render(<BrainstormPanel />);
    await screen.findByText("первая");
    fireEvent.click(screen.getByRole("button", { name: "+ новая" }));
    const input = screen.getByRole("textbox", { name: "название доски" });
    fireEvent.change(input, { target: { value: "Планёрка" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter", repeat: true });
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    release();
    const nav = screen.getByRole("navigation", { name: "доски" });
    await waitFor(() => expect(within(nav).getByRole("button", { name: "доска: Планёрка" }))
      .toHaveAttribute("aria-current", "true"));
    expect(global.fetch.mock.calls.filter(([u, o]) => String(u) === "/api/boards" && o?.method === "POST"))
      .toHaveLength(1);
    expect(within(nav).getAllByRole("button", { name: "доска: Планёрка" })).toHaveLength(1);
  });

  it("нет прав — отказ сервера под кнопкой", async () => {
    const real = srv.fetch;
    global.fetch = vi.fn(async (url, opts = {}) => (String(url) === "/api/boards" && opts.method === "POST"
      ? { ok: false, status: 403, json: async () => ({ error: "У вас нет прав на создание досок." }) }
      : real(url, opts)));
    render(<BrainstormPanel />);
    await screen.findByText("первая");
    fireEvent.click(screen.getByRole("button", { name: "+ новая" }));
    fireEvent.change(screen.getByRole("textbox", { name: "название доски" }), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    expect(await screen.findByText("У вас нет прав на создание досок.")).toBeInTheDocument();
  });

  it("досок нет — справа пусто, а «+ новая» на месте", async () => {
    srv = boardServer(B1, { me: ME, list: [] });
    global.fetch = srv.fetch;
    const { container } = render(<BrainstormPanel />);
    expect(await screen.findByRole("button", { name: "+ новая" })).toBeInTheDocument();
    await waitFor(() => expect(srv.calls.some((c) => c.path === "/api/boards")).toBe(true));
    expect(container.querySelector("[data-sticker]")).toBeNull();
    expect(screen.queryByRole("button", { name: "добавить стикер" })).toBeNull();
    expect(srv.calls.some((c) => c.path.startsWith("/api/boards/"))).toBe(false);
  });
});

describe("в приложении", () => {
  const server = (me) => {
    const boards = srv.fetch;
    global.fetch = vi.fn(async (url, opts) => {
      const u = String(url);
      if (u.startsWith("/api/boards")) return boards(url, opts);
      if (u.includes("/api/health")) {
        return { ok: true, headers: { get: () => "application/json" },
          json: async () => ({ ok: true, scenarios: true, reminders: true, reports: true, org: true }) };
      }
      if (u.includes("/api/org/me")) return { ok: true, json: async () => me };
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
  const tabs = () => [...document.querySelectorAll("[data-tab]")].map((b) => b.textContent);

  it("вкладка открывается тем, у кого есть право, и показывает доски", async () => {
    server({ id: "7", isOwner: false, known: true, role: "r", profile: {},
      tabs: ["tasks", "brainstorm"], access: { tasks: "rw", brainstorm: "rw" } });
    await fresh();
    await waitFor(() => expect(tabs()).toContain("Брейншторм"));
    openTab("Брейншторм");
    expect(await screen.findByText("первая")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ новая" })).toBeInTheDocument();
  });

  it("без права вкладки нет", async () => {
    server({ id: "7", isOwner: false, known: true, role: "r", profile: {},
      tabs: ["tasks"], access: { tasks: "rw" } });
    await fresh();
    await waitFor(() => expect(tabs()).toContain("Задачи"));
    expect(tabs()).not.toContain("Брейншторм");
  });
});

describe("мини-приложение", () => {
  let tg;
  beforeEach(() => {
    tg = { ready: vi.fn(), expand: vi.fn(), setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(),
      disableVerticalSwipes: vi.fn(), initData: "signed",
      initDataUnsafe: { user: { id: 100 }, start_param: "board_b1" } };
    window.Telegram = { WebApp: tg };
  });

  it("доска — из startapp, на весь экран и в цвет шапки", async () => {
    setUrl("call");
    render(<BoardApp />);
    expect(await screen.findByText("первая")).toBeInTheDocument();
    expect(tg.ready).toHaveBeenCalled();
    expect(tg.expand).toHaveBeenCalled();
    await waitFor(() => expect(tg.setHeaderColor).toHaveBeenCalledWith("#1B2430"));
    expect(tg.setBackgroundColor).toHaveBeenCalledWith("#1B2430");
    // Меню досок — только во вкладке: в мини-приложении одна доска.
    expect(screen.queryByRole("navigation", { name: "доски" })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ новая" })).toBeNull();
    expect(screen.getByRole("button", { name: "добавить стикер" })).toBeInTheDocument();
  });

  it("без доски в ссылке — так и сказано", async () => {
    tg.initDataUnsafe.start_param = "";
    setUrl("board");
    render(<BoardApp />);
    expect(screen.getByText(/Ссылка на доску неполная/)).toBeInTheDocument();
    expect(srv.calls).toHaveLength(0);
  });
});
