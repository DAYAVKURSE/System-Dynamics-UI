import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import VirtualPanel from "../components/VirtualPanel.jsx";
import JoinPanel from "../components/JoinPanel.jsx";
import MarketPanel from "../components/MarketPanel.jsx";
import { actingAs, resetIdentity, setActingAs } from "../identity.js";

/* ВИРТУАЛЬНЫЙ СОТРУДНИК (владелец, 2026-09-20).

   Страница, за которой ещё нет человека. Её заводит рекрутер, зовётся
   она фразой из двух слов, и делать с ней можно ровно три вещи: выбрать
   роль, войти под её именем и получить ссылку для регистрации. */

const ME = { id: "1", name: "Иван", known: true, solo: false, isOwner: false,
  tabs: ["tools"], profile: {} };
const VIEW = {
  isOwner: false,
  roles: [{ id: "executor", name: "исполнитель" }, { id: "reviewer", name: "проверяющий" }],
  users: [{ id: "vt_abc", name: "wise oyster", virtual: true, roles: ["executor"],
    link: "https://t.me/bot?startapp=join_k1" }],
  code: null,
};

const server = (over = {}) => {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || "GET",
      body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers || {} });
    if (u.includes("/api/org/virtual/") && u.endsWith("/link")) {
      return { ok: true, status: 200,
        json: async () => ({ token: "k1", link: "https://t.me/bot?startapp=join_k1" }) };
    }
    if (u.includes("/api/org/join/")) {
      return { ok: true, status: 200, json: async () => ({ name: "wise oyster",
        role: { id: "executor", name: "исполнитель" },
        profile: { about: "верстальщик" }, forms: [] }) };
    }
    if (u.includes("/api/org/join")) {
      return over.joinFails
        ? { ok: false, status: 409,
          json: async () => ({ error: "Вы уже зарегистрированы в системе" }) }
        : { ok: true, status: 200, json: async () => ({ id: "vt_abc", known: true }) };
    }
    if (u.includes("/api/org/access-code")) {
      if ((opts.method || "GET") === "POST") {
        return { ok: true, status: 201,
          json: async () => ({ code: { code: "AB12CD34", minutes: 20, access: "r",
            tabs: ["tasks"], expiresAt: new Date(Date.now() + 20 * 60000).toISOString() } }) };
      }
      return { ok: true, status: 200,
        json: async () => ({ code: over.code || null, tabs: [], mine: [] }) };
    }
    return { ok: true, status: 200, json: async () => (over.view || VIEW) };
  }));
  return calls;
};

beforeEach(() => { sessionStorage.clear(); resetIdentity(); });
afterEach(() => { vi.restoreAllMocks(); setActingAs(""); });

describe("вкладка «Виртуальные»", () => {
  it("зовётся фразой из двух слов, и лица у неё нет", async () => {
    server();
    render(<VirtualPanel me={ME} />);
    const row = await screen.findByLabelText("виртуальный wise oyster");
    expect(row.textContent).toContain("wise oyster");
    expect(row.textContent).toContain("человека ещё нет");
    // Вместо лица — знак приложения (вектор): человека за страницей нет.
    expect(row.querySelector("svg")).toBeTruthy();
  });

  it("роли — кнопками, как у обычного участника, и их несколько", async () => {
    const calls = server();
    render(<VirtualPanel me={ME} />);
    await screen.findByLabelText("виртуальный wise oyster");
    const exec = screen.getByRole("button", { name: "роль «исполнитель»: wise oyster" });
    const rev = screen.getByRole("button", { name: "роль «проверяющий»: wise oyster" });
    expect(exec).toHaveAttribute("aria-pressed", "true");
    expect(rev).toHaveAttribute("aria-pressed", "false");
    // Вторая роль ДОБАВЛЯЕТСЯ к первой, а не заменяет её.
    fireEvent.click(rev);
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT");
    expect(put.url).toBe("/api/org/virtual/vt_abc/role");
    expect(put.body).toEqual({ roles: ["executor", "reviewer"] });
  });

  it("ссылка показана внизу формы сразу, без кнопки", async () => {
    server();
    render(<VirtualPanel me={ME} />);
    const field = await screen.findByLabelText("ссылка wise oyster");
    expect(field).toHaveValue("https://t.me/bot?startapp=join_k1");
    expect(screen.queryByRole("button", { name: /Сгенерировать ссылку/ })).toBeNull();
  });

  it("между ролями и «Войти под его именем» — пропуск строки", async () => {
    server();
    render(<VirtualPanel me={{ ...ME, isOwner: true }} />);
    const card = await screen.findByLabelText("виртуальный wise oyster");
    const enter = within(card).getByRole("button", { name: "войти под именем wise oyster" });
    expect(enter.parentElement.style.marginTop).toBe("var(--space-24)");
  });

  it("«Войти под его именем» переводит под эту страницу всё приложение", async () => {
    server();
    const entered = vi.fn();
    render(<VirtualPanel me={ME} onEnter={entered} />);
    fireEvent.click(await screen.findByRole("button",
      { name: "войти под именем wise oyster" }));
    expect(actingAs()).toBe("vt_abc");
    expect(entered).toHaveBeenCalled();
  });

  it("под чужой страницей запросы уходят с её адресом", async () => {
    setActingAs("vt_abc");
    const calls = server();
    render(<MarketPanel me={ME} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].headers["X-Act-As"]).toBe("vt_abc");
    setActingAs("");
  });
});

describe("вступление по ссылке", () => {
  it("показывает, что за страница и какая роль, и даёт вступить", async () => {
    const calls = server();
    const joined = vi.fn();
    render(<JoinPanel me={{ known: false, solo: false }} token="k1" onJoined={joined} />);
    const box = await screen.findByLabelText("вступление по ссылке");
    await waitFor(() => expect(box.textContent).toContain("wise oyster"));
    expect(box.textContent).toContain("исполнитель");
    expect(box.textContent).toContain("верстальщик");
    fireEvent.click(screen.getByRole("button", { name: "Вступить" }));
    await waitFor(() => expect(joined).toHaveBeenCalled());
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/org/join")).toBe(true);
  });

  it("зарегистрированному — ошибка, а не вторая страница", async () => {
    server();
    render(<JoinPanel me={{ known: true, solo: false }} token="k1" />);
    const box = await screen.findByLabelText("вступление по ссылке");
    expect(box.textContent).toContain("Вы уже зарегистрированы в системе");
    expect(screen.queryByRole("button", { name: "Вступить" })).toBeNull();
  });

  it("отказ сервера показывается словами", async () => {
    server({ joinFails: true });
    render(<JoinPanel me={{ known: false, solo: false }} token="k1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Вступить" }));
    expect(await screen.findByText(/уже зарегистрированы/)).toBeInTheDocument();
  });
});

/* ════════════════════════════════════════════════════════════════
   КОД ДОСТУПА (владелец, 2026-09-20)

   «При нажатии „+ сотрудник" сначала должно появляться модальное окно, в
   котором можно ввести определённый код»; «добавь кнопку „Удалить
   сотрудника" на его форму»; «форма кода доступа… кнопка „Сгенерировать
   код для техподдержки"… время действия кода в минутах и radio button
   r/rw… ниже кнопки с вкладками».
   ════════════════════════════════════════════════════════════════ */

describe("код доступа", () => {
  it("«+ сотрудник» сначала спрашивает код, и с кодом заводит чужую страницу", async () => {
    const calls = server();
    render(<VirtualPanel me={ME} />);
    await screen.findByLabelText("виртуальный wise oyster");
    fireEvent.click(screen.getByRole("button", { name: "+ сотрудник" }));
    // Сначала окно, а не запрос.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(screen.getByLabelText("код доступа сотрудника"),
      { target: { value: "AB12CD34" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST"
      && c.url.endsWith("/api/org/virtual") && c.body?.code === "AB12CD34")).toBe(true));
  });

  it("без кода — пустая страница, как раньше", async () => {
    const calls = server();
    render(<VirtualPanel me={ME} />);
    await screen.findByLabelText("виртуальный wise oyster");
    fireEvent.click(screen.getByRole("button", { name: "+ сотрудник" }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST"
      && c.url.endsWith("/api/org/virtual") && c.body?.roleId === "executor")).toBe(true));
  });

  it("«Удалить сотрудника» спрашивает и удаляет", async () => {
    const calls = server();
    render(<VirtualPanel me={ME} />);
    await screen.findByLabelText("виртуальный wise oyster");
    fireEvent.click(screen.getByLabelText("удалить сотрудника wise oyster"));
    expect(screen.getByText("Вы уверены? Это действие необратимо")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Да" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE"
      && c.url.endsWith("/api/org/virtual/vt_abc"))).toBe(true));
  });

  it("форма кода: кнопка, поле, «срок действия кода», «права» r/rw и кнопки вкладок", async () => {
    const calls = server();
    render(<VirtualPanel me={{ ...ME, isOwner: true }} />);
    const box = await screen.findByLabelText("форма кода доступа");
    // Поле пустое, пока код не выдан.
    const field = screen.getByLabelText("код доступа");
    expect(field.value).toBe("");
    /* Подписи — как заказано (владелец, 2026-09-21): «срок действия кода»
       вместо «минут», «права» перед r/rw, и отступ перед вкладками больше
       обычного. */
    expect(within(box).getByText("срок действия кода")).toBeInTheDocument();
    expect(within(box).queryByText("минут")).toBeNull();
    const rights = within(box).getByText("права");
    expect(rights.compareDocumentPosition(screen.getByLabelText("r")) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    const tabsRow = within(box).getByLabelText("вкладки по коду");
    expect(tabsRow.style.marginTop).toBe("var(--space-16)");
    // Один шрифт на все вкладки — ни у одной нет своего размера.
    within(tabsRow).getAllByRole("button").forEach((b) => expect(b.style.fontSize).toBe("var(--fs-btn)"));
    fireEvent.change(screen.getByLabelText("срок действия кода"), { target: { value: "20" } });
    fireEvent.click(screen.getByLabelText("r"));
    fireEvent.click(screen.getByLabelText("вкладка Задачи"));
    fireEvent.click(screen.getByRole("button", { name: "Сгенерировать код для техподдержки" }));
    await waitFor(() => expect(field.value).toBe("AB12CD34"));
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/api/org/access-code"));
    expect(post.body).toEqual({ minutes: 20, access: "r", tabs: ["tasks"] });
  });
});
