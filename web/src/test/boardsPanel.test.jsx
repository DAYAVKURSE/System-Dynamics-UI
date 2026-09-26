import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React, { useState } from "react";
import ConceptsPanel from "../components/ConceptsPanel.jsx";
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
    expect(TAB_NAMES.brainstorm).toBe("Концепты");
    const keys = TAB_LIST.map(([k]) => k);
    expect(keys.slice(keys.indexOf("reports"), keys.indexOf("reports") + 3))
      .toEqual(["reports", "brainstorm", "tools"]);
    expect(TAB_LIST.find(([k]) => k === "brainstorm")[1]).toBe("Концепты");
    // Max открывает всё, free и pro — как были.
    expect(PLAN_TABS.max).toContain("brainstorm");
    expect(PLAN_TABS.free).not.toContain("brainstorm");
    expect(PLAN_TABS.pro).not.toContain("brainstorm");
  });
});

/* ВКЛАДКА «КОНЦЕПТЫ» (владелец, 2026-09-26): слева — меню досок, справа —
   дерево блоков; доска открывается нажатием, «Блок-схема» — назад. */
function Harness({ initial = [], procs = [], sync = true, onConcepts }) {
  const [concepts, setConcepts] = useState(initial);
  const set = (next) => setConcepts((cur) => {
    const v = typeof next === "function" ? next(cur) : next;
    onConcepts?.(v);
    return v;
  });
  return (
    <ConceptsPanel concepts={concepts} setConcepts={set} procs={procs} syncApplied={sync}
      renderProcs={(id) => <div data-testid={`procs-${id}`}>процессы {id}</div>} />);
}
const nav = () => screen.getByRole("navigation", { name: "доски" });

describe("панель «Концепты»", () => {
  it("слева меню досок, справа — блок-схема; доска открывается нажатием, «Блок-схема» — назад", async () => {
    render(<Harness />);
    await waitFor(() => expect(within(nav()).getAllByRole("button").map((b) => b.getAttribute("aria-label")
      || b.textContent)).toEqual(["+ новая", "доска: Идеи", "доска: Ретро"]));
    // По умолчанию — блок-схема, доски не видно.
    expect(screen.getByRole("tree", { name: "блоки" })).toBeInTheDocument();
    expect(screen.queryByText("первая")).toBeNull();
    fireEvent.click(within(nav()).getByRole("button", { name: "доска: Ретро" }));
    expect(await screen.findByText("из ретро")).toBeInTheDocument();
    expect(within(nav()).getByRole("button", { name: "доска: Ретро" })).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("tree", { name: "блоки" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Блок-схема" }));
    expect(screen.getByRole("tree", { name: "блоки" })).toBeInTheDocument();
    expect(screen.queryByText("из ретро")).toBeNull();
  });

  it("«+ новая» — поле названия и «Создать»; новая доска сразу открыта; пустое — отказ словами", async () => {
    render(<Harness />);
    await within(nav()).findByRole("button", { name: "доска: Идеи" });
    fireEvent.click(screen.getByRole("button", { name: "+ новая" }));
    const input = screen.getByRole("textbox", { name: "название доски" });
    expect(input).not.toHaveAttribute("placeholder");
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    expect(screen.getByText("Название доски не может быть пустым.")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "  Планёрка  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(within(nav()).getByRole("button", { name: "доска: Планёрка" }))
      .toHaveAttribute("aria-current", "true"));
    expect(srv.calls.find((c) => c.path === "/api/boards" && c.method === "POST").body).toEqual({ name: "Планёрка" });
    expect(await screen.findByText("Планёрка", { selector: "h1" })).toBeInTheDocument();
  });

  it("двойной Enter, пока создание в пути, — одна доска", async () => {
    const real = srv.fetch;
    let release;
    const held = new Promise((r) => { release = r; });
    global.fetch = vi.fn(async (url, opts = {}) => {
      if (String(url) === "/api/boards" && opts.method === "POST") await held;
      return real(url, opts);
    });
    render(<Harness />);
    await within(nav()).findByRole("button", { name: "доска: Идеи" });
    fireEvent.click(screen.getByRole("button", { name: "+ новая" }));
    const input = screen.getByRole("textbox", { name: "название доски" });
    fireEvent.change(input, { target: { value: "Планёрка" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    release();
    await waitFor(() => expect(within(nav()).getByRole("button", { name: "доска: Планёрка" })).toBeInTheDocument());
    expect(global.fetch.mock.calls.filter(([u, o]) => String(u) === "/api/boards" && o?.method === "POST"))
      .toHaveLength(1);
  });

  it("нет прав — отказ сервера под кнопкой", async () => {
    const real = srv.fetch;
    global.fetch = vi.fn(async (url, opts = {}) => (String(url) === "/api/boards" && opts.method === "POST"
      ? { ok: false, status: 403, json: async () => ({ error: "У вас нет прав на создание досок." }) }
      : real(url, opts)));
    render(<Harness />);
    await within(nav()).findByRole("button", { name: "доска: Идеи" });
    fireEvent.click(screen.getByRole("button", { name: "+ новая" }));
    fireEvent.change(screen.getByRole("textbox", { name: "название доски" }), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    expect(await screen.findByText("У вас нет прав на создание досок.")).toBeInTheDocument();
  });

  it("блоки — деревом: «+ блок» сверху и в блоке; название правится; удалить с подтверждением, дети встают на место", async () => {
    let last = [];
    render(<Harness onConcepts={(v) => { last = v; }} />);
    fireEvent.click(screen.getByRole("button", { name: "+ блок" }));
    const name = screen.getByRole("textbox", { name: "название блока" });
    fireEvent.change(name, { target: { value: "Продажи" } });
    fireEvent.keyDown(name, { key: "Enter" });
    const root = screen.getByRole("button", { name: "название блока: Продажи" });
    expect(root).toBeInTheDocument();
    const card = root.closest("[data-block-id]");
    fireEvent.click(within(card).getByRole("button", { name: "+ блок" }));
    fireEvent.change(screen.getByRole("textbox", { name: "название блока" }), { target: { value: "Лиды" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "название блока" }), { key: "Enter" });
    const items = screen.getAllByRole("treeitem");
    expect(items.map((i) => i.getAttribute("aria-level"))).toEqual(["1", "2"]);
    expect(last.find((b) => b.name === "Лиды").parent).toBe(last.find((b) => b.name === "Продажи").id);
    // Техпроцессы блока — справа, по его id.
    expect(within(card).getByTestId(`procs-${card.getAttribute("data-block-id")}`)).toBeInTheDocument();
    // Удалить «Продажи»: подтверждение; «Лиды» — на его место.
    fireEvent.click(within(card).getAllByRole("button", { name: "удалить блок" })[0]);
    const dlg = screen.getByRole("dialog", { name: "Удалить блок?" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Согласиться" }));
    expect(last).toEqual([expect.objectContaining({ name: "Лиды", parent: null })]);
  });

  it("блок с техпроцессом не удаляется, пока процессы не удалены", async () => {
    render(<Harness initial={[{ id: "k1", name: "С процессом", parent: null, boardId: null }]}
      procs={[{ id: "p1", blockId: "k1", text: "" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "удалить блок" }));
    const dlg = screen.getByRole("dialog", { name: "Удалить блок?" });
    expect(within(dlg).getByText("Сначала удалите техпроцессы блока.")).toBeInTheDocument();
    expect(within(dlg).queryByRole("button", { name: "Согласиться" })).toBeNull();
  });

  it("доска в блок — «+ доска» или перетаскиванием; таблица — подходящие и применённые идеи; окно — только они", async () => {
    srv.bump((b) => {
      b.stickers.push({ id: "f1", by: ME, text: "годная", status: "fit", createdAt: "2", updatedAt: "2" });
      b.stickers.push({ id: "n1", by: ME, text: "мимо", status: "no", createdAt: "3", updatedAt: "3" });
      b.stickers.push({ id: "a1", by: ME, text: "внедрена", status: "applied", createdAt: "4", updatedAt: "4" });
    }, "b1");
    let last = [];
    render(<Harness initial={[{ id: "k1", name: "Воронка", parent: null, boardId: null },
      { id: "k2", name: "Склад", parent: null, boardId: null }]} onConcepts={(v) => { last = v; }} />);
    await within(nav()).findByRole("button", { name: "доска: Идеи" });
    // «+ доска» — выбор из списка.
    const k1 = screen.getByRole("button", { name: "название блока: Воронка" }).closest("[data-block-id]");
    fireEvent.click(within(k1).getByRole("button", { name: "+ доска" }));
    fireEvent.click(within(screen.getByRole("menu", { name: "выбрать доску" })).getByRole("menuitem", { name: "Идеи" }));
    expect(last.find((b) => b.id === "k1").boardId).toBe("b1");
    // Таблица — только «подходит» и «применена».
    const table = await within(k1).findByRole("table", { name: "идеи блока" });
    await waitFor(() => expect(within(table).getByText("годная")).toBeInTheDocument());
    expect(within(table).getByText("внедрена")).toBeInTheDocument();
    expect(within(table).queryByText("мимо")).toBeNull();
    expect(within(table).queryByText("первая")).toBeNull();
    // Нажатие на доску блока — окно с теми же идеями, без «+».
    fireEvent.click(within(k1).getByRole("button", { name: "доска блока: Идеи" }));
    const dlg = await screen.findByRole("dialog", { name: "Идеи" });
    await waitFor(() => expect(within(dlg).getByText("годная")).toBeInTheDocument());
    expect(within(dlg).getByText("внедрена")).toBeInTheDocument();
    expect(within(dlg).queryByText("мимо")).toBeNull();
    expect(within(dlg).queryByRole("button", { name: "добавить стикер" })).toBeNull();
    fireEvent.click(within(dlg).getByRole("button", { name: "закрыть" }));
    // Перетаскивание: из меню — на «Склад».
    const k2 = screen.getByRole("button", { name: "название блока: Склад" }).closest("[data-block-id]");
    const prev = document.elementFromPoint;
    document.elementFromPoint = () => k2;
    try {
      const item = within(nav()).getByRole("button", { name: "доска: Ретро" });
      fireEvent.pointerDown(item, { button: 0, pointerType: "mouse", clientX: 10, clientY: 10 });
      fireEvent.pointerMove(window, { clientX: 60, clientY: 80 });
      await waitFor(() => expect(k2.style.outline).toMatch(/solid/));
      fireEvent.pointerUp(window, { clientX: 60, clientY: 80 });
    } finally { document.elementFromPoint = prev; }
    expect(last.find((b) => b.id === "k2").boardId).toBe("b2");
    // И это было перетаскивание, а не нажатие: доска не открылась.
    expect(screen.getByRole("tree", { name: "блоки" })).toBeInTheDocument();
  });

  it("у доски блока появился техпроцесс — приложение сообщает доске; не стало — снимает", async () => {
    const blocks = [{ id: "k1", name: "Воронка", parent: null, boardId: "b1" }];
    const { rerender } = render(<Harness initial={blocks} procs={[{ id: "p1", blockId: "k1", text: "" }]} />);
    await waitFor(() => expect(srv.calls.find((c) => c.method === "PUT")).toMatchObject({
      path: "/api/boards/b1/applied", body: { applied: true } }));
    rerender(<Harness initial={blocks} procs={[]} />);
    await waitFor(() => expect(srv.calls.filter((c) => c.method === "PUT").pop()).toMatchObject({
      path: "/api/boards/b1/applied", body: { applied: false } }));
  });

  it("без всей модели (позванный) — флаг досок не трогает", async () => {
    render(<Harness initial={[]} procs={[]} sync={false} />);
    await within(nav()).findByRole("button", { name: "доска: Идеи" });
    srv.bump((b) => { b.applied = true; }, "b1");
    await new Promise((r) => setTimeout(r, 30));
    expect(srv.calls.some((c) => c.method === "PUT")).toBe(false);
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
    await waitFor(() => expect(tabs()).toContain("Концепты"));
    openTab("Концепты");
    expect(await screen.findByRole("button", { name: "доска: Идеи" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ новая" })).toBeInTheDocument();
    expect(screen.getByRole("tree", { name: "блоки" })).toBeInTheDocument();
  });

  it("без права вкладки нет", async () => {
    server({ id: "7", isOwner: false, known: true, role: "r", profile: {},
      tabs: ["tasks"], access: { tasks: "rw" } });
    await fresh();
    await waitFor(() => expect(tabs()).toContain("Задачи"));
    expect(tabs()).not.toContain("Концепты");
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
