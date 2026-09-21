import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AgentsPanel, { preview } from "../components/AgentsPanel.jsx";
import { addMemory, askAssistant } from "../assistant.js";

/* АГЕНТЫ: «Ассистент» по умолчанию, провайдеры с моделями чекбоксами,
   коллекция моделей агента, память у каждого своя, вопрос в два шага.

   Владелец (2026-09-13): «вкладка «Помощник» должна называться «Агенты»;
   одна форма «Ассистент» по умолчанию (которого нельзя удалить) и внизу
   кнопка для добавления новых агентов; на форме агента — провайдер,
   коллекция моделей и память; в коллекции чекбоксом отмечаем модели,
   которые агент может использовать; на форме провайдера чекбоксами
   выбираем нужные модели из списка доступных; выбранные модели должны
   появиться в коллекции». Ключ наружу не уходит никогда. */

const IVAN = { id: "2", name: "Иван", isOwner: false, known: true, tabs: ["tools"] };
const OWNER = { ...IVAN, id: "1", name: "Владелец", isOwner: true };

const KINDS = [
  { id: "openai", name: "Совместимый с OpenAI", defaultBaseUrl: "https://api.openai.com/v1" },
  { id: "anthropic", name: "Anthropic (Claude)", defaultBaseUrl: "https://api.anthropic.com" },
];
const USES = [
  { id: "main", name: "Основная" },
  { id: "voice", name: "Отправка голосовых сообщений" },
  { id: "draw", name: "Рисование изображений" },
  { id: "vision", name: "Распознавание изображений" },
  { id: "transcribe", name: "Расшифровка голоса" },
];
const NO_USES = { main: null, voice: null, draw: null, vision: null, transcribe: null };
const ASSISTANT = { id: "assistant", name: "Ассистент", builtin: true, models: [],
  transcribe: null, uses: { ...NO_USES }, mcp: [], ask: true };
const P1 = { id: "p_1", name: "Мой OpenAI", kind: "openai", baseUrl: "", models: ["gpt-4.1", "gpt-4o-mini"], hasKey: true };

/** Подменный сервер: отвечает по адресу и методу, запоминает запросы. */
function server(routes, log = []) {
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const method = opts.method || "GET";
    log.push({ url, method, headers: opts.headers || {}, body: opts.body });
    const key = `${method} ${String(url).split("?")[0]}`;
    const hit = routes[key] || routes[`${method} *`];
    if (!hit) return { ok: false, status: 404, json: async () => ({ error: "not found" }) };
    const out = typeof hit === "function" ? hit({ url, opts, log }) : hit;
    return { ok: (out.status || 200) < 400, status: out.status || 200,
      json: async () => out.body ?? out };
  }));
  return log;
}
afterEach(() => vi.restoreAllMocks());

const agentOf = (url) => new URL(String(url), "http://x").searchParams.get("agent") || "assistant";

/** Подменный сервер настроек: провайдеры, агенты и память, как настоящий. */
function settingsServer(providers = [], agents = [ASSISTANT], extra = {}) {
  const state = { providers: providers.map((p) => ({ ...p })), agents: agents.map((a) => ({ ...a })),
    memory: {}, mcp: (extra.mcp || []).map((m) => ({ ...m })) };
  const view = (p) => ({ ...p, hasKey: true });
  const log = server({
    "GET /api/assistant/settings": () => ({ body: { providers: state.providers.map(view),
      agents: state.agents.map((a) => ({ ...a })), kinds: KINDS, tasks: {}, taskList: [],
      mcp: state.mcp.map((m) => ({ ...m })), uses: USES } }),
    "GET /api/assistant/mcp/registry": () => ({ body: { url: "https://registry.example",
      servers: extra.registry || [{ id: "io.github.x/weather", name: "weather",
        full: "io.github.x/weather", description: "погода по городу", version: "1.0.0",
        repo: "https://github.com/x/y", url: "https://x/mcp", transport: "streamable-http" }] } }),
    "POST /api/assistant/mcp": ({ opts }) => {
      const b = JSON.parse(opts.body);
      const m = { id: `mcp${state.mcp.length + 1}`, name: b.name || b.url, url: b.url,
        repo: b.repo || "", tools: [] };
      state.mcp.push(m);
      return { status: 201, body: m };
    },
    "GET /api/assistant/memory": ({ url }) => ({ body: [...(state.memory[agentOf(url)] || [])] }),
    "POST /api/assistant/memory": ({ opts }) => {
      const b = JSON.parse(opts.body);
      const item = { id: `m${Date.now()}`, title: b.title, text: b.text, file: null, at: "2026-09-07T10:00:00Z" };
      (state.memory[b.agent] = state.memory[b.agent] || []).push(item);
      return { status: 201, body: item };
    },
    "POST /api/assistant/providers": ({ opts }) => {
      const b = JSON.parse(opts.body);
      if (!b.key) return { status: 400, body: { error: "Ключ обязателен: без него провайдер не ответит" } };
      const p = { id: `p_${state.providers.length + 1}`, name: b.name, kind: b.kind, baseUrl: b.baseUrl || "", models: [] };
      state.providers.push(p);
      return { status: 201, body: view(p) };
    },
    "POST /api/assistant/agents": ({ opts }) => {
      const b = JSON.parse(opts.body);
      const a = { id: `a_${state.agents.length}`, name: b.name, builtin: false, models: [], transcribe: null };
      state.agents.push(a);
      return { status: 201, body: a };
    },
    "PUT *": ({ url, opts }) => {
      const b = JSON.parse(opts.body);
      const a = state.agents.find((x) => url.endsWith(`/agents/${x.id}`));
      if (a) {
        const { uses, ...rest } = b;
        Object.assign(a, rest);
        if (uses) a.uses = { ...a.uses, ...uses };
        return { body: { ...a } };
      }
      const p = state.providers.find((x) => url.endsWith(`/providers/${x.id}`));
      if (!p) return { status: 404, body: { error: "не найдено" } };
      if (b.models) p.models = b.models;
      if (b.name !== undefined) p.name = b.name;
      return { body: view(p) };
    },
    "DELETE *": ({ url }) => {
      state.agents = state.agents.filter((x) => !url.endsWith(`/agents/${x.id}`));
      state.providers = state.providers.filter((x) => !url.endsWith(`/providers/${x.id}`));
      return { status: 204, body: null };
    },
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "mcp")),
  });
  return { log, state };
}

describe("агенты", () => {
  /* Владелец (2026-09-20): три формы — агенты, провайдеры с моделями и
     MCP-серверы; «+ агент» справа от вкладок; имя правится двойным
     нажатием; «Удалить» внизу формы и с вопросом «Вы уверены?». */
  it("«Ассистент» есть всегда, удалить его нечем, и форм три", async () => {
    settingsServer([P1]);
    render(<AgentsPanel me={IVAN} />);
    const tabs = await screen.findByRole("tablist", { name: "агенты" });
    expect(within(tabs).getByRole("tab", { name: "Ассистент" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: /удалить агента/ })).toBeNull();
    expect(screen.getByLabelText("провайдеры и модели")).toBeInTheDocument();
    expect(screen.getByLabelText("mcp-серверы")).toBeInTheDocument();
    expect(screen.getByText("2 · память")).toBeInTheDocument();
  });

  it("«+ агент» стоит справа от вкладок и заводит агента сразу", async () => {
    const { log } = settingsServer([P1]);
    render(<AgentsPanel me={OWNER} />);
    const tabs = await screen.findByRole("tablist", { name: "агенты" });
    const add = within(tabs).getByRole("button", { name: "добавить агента" });
    // Справа: кнопка — последняя в ряду вкладок.
    expect([...tabs.children].indexOf(add)).toBe(tabs.children.length - 1);
    fireEvent.click(add);
    await waitFor(() => expect(log.some((r) => r.method === "POST"
      && r.url === "/api/assistant/agents")).toBe(true));
    await screen.findByRole("tab", { name: "Агент 1" });
    expect(screen.getByRole("tab", { name: "Агент 1" })).toHaveAttribute("aria-selected", "true");
  });

  it("имя правится двойным нажатием по нему в шапке", async () => {
    const other = { ...ASSISTANT, id: "a_1", name: "Закупщик", builtin: false };
    const { log } = settingsServer([P1], [ASSISTANT, other]);
    render(<AgentsPanel me={OWNER} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Закупщик" }));
    // Одно нажатие ничего не меняет: поле появляется по двойному.
    const title = screen.getByLabelText("имя агента: Закупщик");
    fireEvent.click(title);
    expect(screen.queryByLabelText("имя агента")).toBeNull();
    fireEvent.doubleClick(title);
    const field = screen.getByLabelText("имя агента");
    fireEvent.change(field, { target: { value: "Снабженец" } });
    fireEvent.blur(field);
    await waitFor(() => expect(log.some((r) => r.method === "PUT"
      && r.url.endsWith("/agents/a_1"))).toBe(true));
    expect(JSON.parse(log.find((r) => r.method === "PUT"
      && r.url.endsWith("/agents/a_1")).body)).toEqual({ name: "Снабженец" });
  });

  it("«Удалить» внизу формы спрашивает «Вы уверены?» и слушается «Нет»", async () => {
    const other = { ...ASSISTANT, id: "a_1", name: "Закупщик", builtin: false };
    const { log } = settingsServer([P1], [ASSISTANT, other]);
    render(<AgentsPanel me={OWNER} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Закупщик" }));
    fireEvent.click(screen.getByRole("button", { name: "удалить агента Закупщик" }));
    expect(screen.getByText("Вы уверены? Это действие необратимо")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Нет" }));
    expect(screen.queryByText("Вы уверены? Это действие необратимо")).toBeNull();
    expect(log.some((r) => r.method === "DELETE")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "удалить агента Закупщик" }));
    fireEvent.click(screen.getByRole("button", { name: "Да" }));
    await waitFor(() => expect(log.some((r) => r.method === "DELETE"
      && r.url.endsWith("/agents/a_1"))).toBe(true));
  });

  it("галочка у модели ПОДКЛЮЧАЕТ её — правится провайдер, а не агент", async () => {
    const { log } = settingsServer([{ ...P1, models: [] }], [ASSISTANT], {
      "GET /api/assistant/providers/p_1/models": [{ id: "gpt-4.1", name: "gpt-4.1" }, { id: "o3", name: "o3" }],
    });
    render(<AgentsPanel me={IVAN} />);
    await screen.findByRole("tab", { name: "Мой OpenAI ✓" });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить список моделей" }));
    const row = await screen.findByRole("checkbox", { name: "модель gpt-4.1" });
    expect(row).toHaveAttribute("aria-checked", "false");
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "модель gpt-4.1" }))
      .toHaveAttribute("aria-checked", "true"));
    expect(JSON.parse(log.find((r) => r.method === "PUT"
      && r.url.endsWith("/providers/p_1")).body).models).toEqual(["gpt-4.1"]);
    // Коллекция агента при подключении не трогается: это разные вопросы.
    expect(log.some((r) => r.method === "PUT" && r.url.endsWith("/agents/assistant"))).toBe(false);
  });

  it("у агента пять назначений, и выбор — из подключённых моделей", async () => {
    const { log } = settingsServer([P1]);
    render(<AgentsPanel me={IVAN} />);
    await screen.findByRole("tab", { name: "Ассистент" });
    USES.forEach((u) => expect(screen.getByLabelText(`модель: ${u.name}`)).toBeInTheDocument());
    const main = screen.getByLabelText("модель: Основная");
    expect([...main.options].map((o) => o.value))
      .toEqual(["", "p_1|gpt-4.1", "p_1|gpt-4o-mini"]);
    fireEvent.change(main, { target: { value: "p_1|gpt-4o-mini" } });
    await waitFor(() => expect(log.some((r) => r.method === "PUT"
      && r.url.endsWith("/agents/assistant"))).toBe(true));
    expect(JSON.parse(log.find((r) => r.method === "PUT"
      && r.url.endsWith("/agents/assistant")).body))
      .toEqual({ uses: { main: { providerId: "p_1", model: "gpt-4o-mini" } } });
  });

  it("переключатель «спрашивать / применять сразу» уезжает на сервер", async () => {
    const { log } = settingsServer([P1]);
    render(<AgentsPanel me={IVAN} />);
    await screen.findByRole("tab", { name: "Ассистент" });
    const ask = screen.getByRole("button", { name: "Спрашивать перед применением" });
    expect(ask).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Применять сразу" }));
    await waitFor(() => expect(log.some((r) => r.method === "PUT"
      && r.body?.includes("ask"))).toBe(true));
    expect(JSON.parse(log.find((r) => r.body?.includes("ask")).body)).toEqual({ ask: false });
  });

  /* ═══ MCP У АГЕНТА: ВЫБИРАЮТ ИНСТРУМЕНТЫ, А НЕ СЕРВЕР (владелец,
     2026-09-21) ═══

     «Клик по кнопке MCP-сервера обновляет список инструментов и
     раскрывает список с ними. Повторный клик скрывает список»; «кнопки
     выделить всё и снять выделение должны быть не кнопками, а первыми
     строками в списке инструментов. У каждого элемента списка должен быть
     checkbox слева»; «при выборе всех — зелёная с галочкой, части —
     жёлтая с кружком, ни одного — серая с пустым кружочком». */
  const WEATHER = { id: "mcp1", name: "Погода", url: "https://x/mcp", repo: "",
    tools: ["forecast", "alerts"] };

  it("нажатие на сервер спрашивает инструменты и раскрывает список; второе — скрывает", async () => {
    const { log } = settingsServer([P1], [ASSISTANT], { mcp: [WEATHER] });
    render(<AgentsPanel me={IVAN} />);
    const box = await screen.findByLabelText("mcp-серверы агента");
    const pick = within(box).getByRole("button", { name: /^mcp Погода/ });
    expect(screen.queryByLabelText("инструменты Погода")).toBeNull();

    fireEvent.click(pick);
    const tools = await screen.findByLabelText("инструменты Погода");
    // Заодно спросили у сервера заново: список мог смениться.
    await waitFor(() => expect(log.some((r) => r.method === "POST"
      && r.url === "/api/assistant/mcp/mcp1/tools")).toBe(true));
    // Первые СТРОКИ списка — «Выделить всё» и «Снять выделение», и у
    // каждой строки checkbox слева.
    const rows = [...tools.querySelectorAll("label")];
    expect(rows.map((r) => r.textContent).slice(0, 3))
      .toEqual(["Выделить всё", "Снять выделение", "forecast"]);
    rows.forEach((r) => {
      const box = r.querySelector("input[type=checkbox]");
      expect(box).not.toBeNull();
      // «Слева» — checkbox идёт в строке первым.
      expect(r.firstElementChild).toBe(box);
    });
    // Кнопкой в форме осталась одна — «Опросить».
    expect([...tools.querySelectorAll("button")].map((b) => b.textContent))
      .toEqual(["Опросить"]);

    fireEvent.click(within(box).getByRole("button", { name: /^mcp Погода/ }));
    await waitFor(() => expect(screen.queryByLabelText("инструменты Погода")).toBeNull());
  });

  it("цвет кнопки сервера: ни одного — пустой кружок, часть — кружок, все — галочка", async () => {
    const { log, state } = settingsServer([P1], [ASSISTANT], { mcp: [WEATHER] });
    render(<AgentsPanel me={IVAN} />);
    const box = await screen.findByLabelText("mcp-серверы агента");
    const pick = () => within(box).getByRole("button", { name: /^mcp Погода/ });
    // Ни одного: пустой кружок.
    expect(pick().textContent).toContain("○");
    expect(pick()).toHaveAttribute("aria-label", "mcp Погода: ни одного инструмента");

    fireEvent.click(pick());
    await screen.findByLabelText("инструменты Погода");
    fireEvent.click(screen.getByRole("checkbox", { name: "инструмент forecast" }));
    await waitFor(() => expect(state.agents[0].mcp).toEqual({ mcp1: ["forecast"] }));
    await waitFor(() => expect(pick().textContent).toContain("●"));
    expect(pick()).toHaveAttribute("aria-label", "mcp Погода: часть инструментов");

    fireEvent.click(screen.getByRole("checkbox", { name: "выделить всё: Погода" }));
    await waitFor(() => expect(state.agents[0].mcp).toEqual({ mcp1: ["forecast", "alerts"] }));
    await waitFor(() => expect(pick().textContent).toContain("✓"));
    expect(pick()).toHaveAttribute("aria-label", "mcp Погода: все инструменты");

    fireEvent.click(screen.getByRole("checkbox", { name: "снять выделение: Погода" }));
    await waitFor(() => expect(state.agents[0].mcp).toEqual({ mcp1: [] }));
    await waitFor(() => expect(pick().textContent).toContain("○"));
    expect(log.filter((r) => r.method === "PUT").length).toBeGreaterThan(2);
  });

  it("отказ сервера читается там, где нажали, а не в чужой карточке", async () => {
    const { log } = settingsServer([P1], [ASSISTANT], { mcp: [WEATHER],
      "POST /api/assistant/mcp/mcp1/tools": () => ({ status: 502,
        body: { error: "MCP-сервер ответил 401: он требует авторизации" } }) });
    render(<AgentsPanel me={IVAN} />);
    const box = await screen.findByLabelText("mcp-серверы агента");
    fireEvent.click(within(box).getByRole("button", { name: /^mcp Погода/ }));
    const said = await within(box).findByText(/401/);
    expect(said.textContent).toMatch(/требует авторизации/);
    expect(log.some((r) => r.url === "/api/assistant/mcp/mcp1/tools")).toBe(true);
  });

  /* ВХОД — ОКНОМ (владелец, 2026-09-21: «вход должен появляться в виде
     модального окна при нажатии кнопки… на форме управления ассистентом
     или агентами»). 401 с признаком needsAuth — не строчка с номером. */
  it("сервер требует входа: окно, ключ уходит на сервер, список спрашивается заново", async () => {
    let asked = 0;
    const { log } = settingsServer([P1], [ASSISTANT], { mcp: [WEATHER],
      "POST /api/assistant/mcp/mcp1/tools": () => {
        asked += 1;
        return asked === 1
          ? { status: 401, body: { error: "Сервер требует входа", needsAuth: true,
            where: "https://x/login", server: "Погода" } }
          : { ...WEATHER };
      },
      "PUT /api/assistant/mcp/mcp1/auth": () => ({ ...WEATHER, auth: "bearer", hasAuth: true }) });
    render(<AgentsPanel me={IVAN} />);
    const box = await screen.findByLabelText("mcp-серверы агента");
    fireEvent.click(within(box).getByRole("button", { name: /^mcp Погода/ }));

    await screen.findByText("Вход в «Погода»");
    // Номер отказа на форме не показан — на него открыли окно.
    expect(within(box).queryByText(/401/)).toBeNull();
    expect(screen.getByRole("link", { name: "https://x/login" })).toBeInTheDocument();
    // Схему сервер не назвал — просят ключ, логина с паролем не предлагают.
    expect(screen.getByLabelText("сервер запросил").textContent).toMatch(/ключ/);
    expect(screen.queryByLabelText("логин")).toBeNull();

    fireEvent.change(screen.getByLabelText("ключ"), { target: { value: "sk-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    await waitFor(() => expect(log.some((r) => r.method === "PUT"
      && r.url === "/api/assistant/mcp/mcp1/auth")).toBe(true));
    expect(JSON.parse(log.find((r) => r.url === "/api/assistant/mcp/mcp1/auth").body))
      .toEqual({ kind: "bearer", token: "sk-1" });
    // Окно закрылось, и инструменты спросили ещё раз.
    await waitFor(() => expect(screen.queryByText("Вход в «Погода»")).toBeNull());
    await waitFor(() => expect(asked).toBe(2));
  });

  /* ЧТО СПРАШИВАТЬ — РЕШИЛ СЕРВЕР (владелец, 2026-09-21: «ввод данных
     должен зависеть от того, что запросил сервер»): Basic — логин и
     пароль, и никакого выбора «чем войти» у человека нет. */
  it("сервер сказал Basic — окно просит логин и пароль, и только их", async () => {
    const { log } = settingsServer([P1], [ASSISTANT], { mcp: [WEATHER],
      "POST /api/assistant/mcp/mcp1/tools": () => ({ status: 401,
        body: { error: "Сервер требует входа", needsAuth: true, where: "", server: "Погода",
          scheme: "basic", realm: "weather", hint: 'Basic realm="weather"' } }),
      "PUT /api/assistant/mcp/mcp1/auth": () => ({ ...WEATHER, auth: "basic", hasAuth: true }) });
    render(<AgentsPanel me={IVAN} />);
    const box = await screen.findByLabelText("mcp-серверы агента");
    fireEvent.click(within(box).getByRole("button", { name: /^mcp Погода/ }));
    await screen.findByText("Вход в «Погода» · weather");
    // Ровно то, что запросил сервер: логин и пароль, ключа не предлагают.
    expect(screen.getByLabelText("сервер запросил").textContent).toMatch(/логин и пароль/);
    expect(screen.getByLabelText("заголовок сервера").textContent).toBe('Basic realm="weather"');
    expect(screen.queryByLabelText("ключ")).toBeNull();
    expect(screen.queryByRole("tab", { name: /Логин/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("логин"), { target: { value: "ivan" } });
    fireEvent.change(screen.getByLabelText("пароль"), { target: { value: "s3cret" } });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    await waitFor(() => expect(log.some((r) => r.url === "/api/assistant/mcp/mcp1/auth")).toBe(true));
    expect(JSON.parse(log.find((r) => r.url === "/api/assistant/mcp/mcp1/auth").body))
      .toEqual({ kind: "basic", login: "ivan", password: "s3cret" });
  });

  it("«Опросить» стоит на форме агента, а не в форме MCP-серверов", async () => {
    settingsServer([P1], [ASSISTANT], { mcp: [WEATHER] });
    render(<AgentsPanel me={IVAN} />);
    const list = await screen.findByLabelText("mcp-серверы");
    expect(within(list).queryByLabelText(/опросить/)).toBeNull();
    const box = screen.getByLabelText("mcp-серверы агента");
    fireEvent.click(within(box).getByRole("button", { name: /^mcp Погода/ }));
    expect(await within(box).findByLabelText("опросить Погода")).toBeInTheDocument();
  });

  /* РЕЕСТР ВМЕСТО ПОЛЕЙ (владелец, 2026-09-20: «убери описание и все три
     поля… я видел список доступных серверов и мог обновить; при нажатии
     на каждый из серверов его форма должна раскрываться»). */
  it("MCP: список из реестра, раскрытие сервера и «Добавить»", async () => {
    const { log } = settingsServer([P1]);
    render(<AgentsPanel me={IVAN} />);
    await screen.findByLabelText("mcp-серверы");
    // Полей больше нет — есть список и «Обновить».
    expect(screen.queryByLabelText("адрес сервера")).toBeNull();
    expect(screen.queryByLabelText("репозиторий сервера")).toBeNull();
    await waitFor(() => expect(log.some((r) => r.method === "GET"
      && r.url === "/api/assistant/mcp/registry")).toBe(true));
    const row = await screen.findByRole("button", { name: "сервер weather" });
    // Свёрнут: формы с описанием ещё нет.
    expect(screen.queryByLabelText("форма сервера weather")).toBeNull();
    fireEvent.click(row);
    const card = await screen.findByLabelText("форма сервера weather");
    expect(card.textContent).toContain("погода по городу");
    expect(card.textContent).toContain("https://x/mcp");
    fireEvent.click(screen.getByRole("button", { name: "добавить сервер weather" }));
    await waitFor(() => expect(log.some((r) => r.method === "POST"
      && r.url === "/api/assistant/mcp")).toBe(true));
    expect(JSON.parse(log.find((r) => r.url === "/api/assistant/mcp").body))
      .toEqual({ name: "weather", url: "https://x/mcp", repo: "https://github.com/x/y" });
    // Кнопка «Обновить» спрашивает реестр заново.
    fireEvent.click(screen.getByRole("button", { name: "обновить список серверов" }));
    await waitFor(() => expect(log.filter((r) => r.method === "GET"
      && r.url === "/api/assistant/mcp/registry").length).toBeGreaterThan(1));
  });

  /* ИНСТРУКЦИИ — ПЕРЕД ПАМЯТЬЮ, MCP — СРАЗУ ПОСЛЕ НЕЁ (владелец,
     2026-09-20). Инструкция применяется как скилл: она уходит агенту. */
  it("инструкции: поле, «Сохранить» и «Удалить» — перед памятью", async () => {
    const { log } = settingsServer([P1]);
    render(<AgentsPanel me={IVAN} />);
    const field = await screen.findByLabelText("инструкция агента");
    const mem = screen.getByText("2 · память");
    const mcp = screen.getByText("3 · MCP-серверы");
    expect(field.compareDocumentPosition(mem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mem.compareDocumentPosition(mcp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const box = screen.getByLabelText("инструкции агента");
    // Пока не меняли — сохранять нечего.
    expect(within(box).getByRole("button", { name: "Сохранить" })).toBeDisabled();
    fireEvent.change(field, { target: { value: "Отвечай только по-русски" } });
    fireEvent.click(within(box).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(log.some((r) => r.method === "PUT"
      && /agents\/assistant$/.test(r.url))).toBe(true));
    expect(JSON.parse(log.find((r) => r.method === "PUT").body).skill)
      .toBe("Отвечай только по-русски");
    fireEvent.click(within(box).getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(log.filter((r) => r.method === "PUT"
      && JSON.parse(r.body).skill === "").length).toBe(1));
  });

  it("память у каждого агента своя: GET ?agent=, POST с agent", async () => {
    const other = { ...ASSISTANT, id: "a_1", name: "Закупщик", builtin: false };
    const { log, state } = settingsServer([P1], [ASSISTANT, other]);
    state.memory.assistant = [{ id: "m1", title: "памятка", text: "клиент любит звонки", file: null, at: "2026-09-07T10:00:00Z" }];
    render(<AgentsPanel me={IVAN} />);
    await screen.findByText("памятка");
    expect(log.some((r) => r.method === "GET" && r.url === "/api/assistant/memory?agent=assistant")).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Закупщик" }));
    await screen.findByText("Память пуста.");
    expect(log.some((r) => r.method === "GET" && r.url === "/api/assistant/memory?agent=a_1")).toBe(true);
    fireEvent.change(screen.getByLabelText("текст записи"), { target: { value: "цены поставщиков" } });
    fireEvent.click(screen.getByRole("button", { name: "Запомнить" }));
    await screen.findByText("Запомнено.");
    const post = log.find((r) => r.method === "POST" && r.url === "/api/assistant/memory");
    expect(JSON.parse(post.body)).toEqual({ title: "", text: "цены поставщиков", agent: "a_1" });
    expect(screen.getByText("цены поставщиков")).toBeInTheDocument();
  });
});

describe("память", () => {
  it("список: название, начало текста, файл ссылкой; удаление — DELETE по id", async () => {
    let stored = [
      { id: "m1", title: "памятка", text: "клиент любит звонки утром ".repeat(10), file: null, at: "2026-09-07T10:00:00Z" },
      { id: "m2", title: "договор", text: "", file: { name: "договор.pdf", type: "application/pdf", size: 10, url: "/api/reports/abc/1" }, at: "2026-09-07T09:00:00Z" },
    ];
    const log = server({
      "GET /api/assistant/settings": { providers: [], agents: [ASSISTANT], kinds: KINDS, tasks: {}, taskList: [] },
      "GET /api/assistant/memory": () => ({ body: [...stored] }),
      "DELETE /api/assistant/memory/m1": () => { stored = stored.filter((m) => m.id !== "m1"); return { status: 204, body: null }; },
    });
    render(<AgentsPanel me={IVAN} />);
    await screen.findByText("памятка");
    const start = screen.getByText(/клиент любит звонки утром/);
    expect(start.textContent.length).toBeLessThanOrEqual(80);
    expect(start.textContent.endsWith("…")).toBe(true);
    expect(screen.getByText(/договор\.pdf/)).toHaveAttribute("href", "/api/reports/abc/1");
    fireEvent.click(screen.getByLabelText("удалить из памяти: памятка"));
    await waitFor(() => expect(screen.queryByText("памятка")).toBeNull());
    expect(log.some((r) => r.method === "DELETE" && r.url === "/api/assistant/memory/m1")).toBe(true);
  });

  it("пустой текст не отправляется", async () => {
    const log = server({
      "GET /api/assistant/settings": { providers: [], agents: [ASSISTANT], kinds: KINDS, tasks: {}, taskList: [] },
      "GET /api/assistant/memory": [],
    });
    render(<AgentsPanel me={IVAN} />);
    await screen.findByText("Память пуста.");
    fireEvent.click(screen.getByRole("button", { name: "Запомнить" }));
    expect(await screen.findByText(/пустую запись запоминать нечего/)).toBeInTheDocument();
    expect(log.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("добавить файлом — сырые байты, имя и агент в заголовках, base64 от UTF-8", async () => {
    const log = server({
      "GET /api/assistant/settings": { providers: [], agents: [ASSISTANT], kinds: KINDS, tasks: {}, taskList: [] },
      "GET /api/assistant/memory": [],
      "POST /api/assistant/memory": { status: 201, body: { id: "m1", title: "договор.txt", text: "x", file: null } },
    });
    render(<AgentsPanel me={IVAN} />);
    await screen.findByText("Память пуста.");
    const file = new File(["пункт 1"], "договор.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("файл в память"), { target: { files: [file] } });
    await screen.findByText(/Файл «договор\.txt» в памяти/);
    const post = log.find((r) => r.method === "POST");
    expect(post.body).toBe(file);
    expect(post.headers["Content-Type"]).toBe("application/octet-stream");
    expect(post.headers["X-Memory-Type"]).toBe("text/plain");
    expect(post.headers["X-Memory-Agent"]).toBe("assistant");
    expect(post.headers["X-Memory-Name"]).toBe(btoa(String.fromCharCode(...new TextEncoder().encode("договор.txt"))));
    expect(post.headers["X-Telegram-Init-Data"]).toBeDefined();
  });

  it("addMemory({title, text}) — JSON с агентом; addMemory(File, agent) — байты", async () => {
    const log = server({ "POST /api/assistant/memory": { status: 201, body: { id: "m1" } } });
    await addMemory({ title: "a", text: "b" });
    expect(JSON.parse(log[0].body)).toEqual({ title: "a", text: "b", agent: "assistant" });
    const f = new File(["x"], "a.txt", { type: "text/plain" });
    await addMemory(f, "a_1");
    expect(log[1].body).toBe(f);
    expect(log[1].headers["X-Memory-Agent"]).toBe("a_1");
    const j = new File(['{"a":1}'], "данные.json", { type: "application/json" });
    await addMemory(j);
    expect(log[2].headers["Content-Type"]).toBe("application/octet-stream");
    expect(log[2].headers["X-Memory-Type"]).toBe("application/json");
  });

  it("начало текста режется по 80 знакам и в одну строку", () => {
    expect(preview("а\nб")).toBe("а б");
    expect(preview("x".repeat(100)).length).toBe(80);
  });
});

describe("вопрос в два шага", () => {
  it("POST → id, потом GET, пока не done; интервал короткий", async () => {
    let polls = 0;
    const log = server({
      "POST /api/assistant/ask": { status: 202, body: { id: "q1" } },
      "GET /api/assistant/ask/q1": () => { polls += 1; return { body: polls < 3 ? { status: "pending" } : { status: "done", text: "Задач нет." } }; },
    });
    const text = await askAssistant("что у меня?", "блок «заметка»", { intervalMs: 1 });
    expect(text).toBe("Задач нет.");
    expect(JSON.parse(log[0].body)).toEqual({ question: "что у меня?", context: "блок «заметка»" });
    expect(log.filter((r) => r.method === "GET")).toHaveLength(3);
    expect(log[0].headers["X-Telegram-Init-Data"]).toBeDefined();
  });

  it("ошибка приходит словами из статуса", async () => {
    server({
      "POST /api/assistant/ask": { status: 202, body: { id: "q1" } },
      "GET /api/assistant/ask/q1": { body: { status: "error", error: "Помощник не настроен: добавьте провайдера и ключ в Инструментах → Агенты" } },
    });
    await expect(askAssistant("?", "", { intervalMs: 1 }))
      .rejects.toThrow(/Помощник не настроен: добавьте провайдера/);
  });

  it("task уходит в POST полем; без task поля нет", async () => {
    const log = server({
      "POST /api/assistant/ask": { status: 202, body: { id: "q1" } },
      "GET /api/assistant/ask/q1": { body: { status: "done", text: "ок" } },
    });
    await askAssistant("?", "блок", { intervalMs: 1, task: "bot" });
    expect(JSON.parse(log[0].body)).toEqual({ question: "?", context: "блок", task: "bot" });
  });

  it("отмена и срок ожидания — тоже словами", async () => {
    server({
      "POST /api/assistant/ask": { status: 202, body: { id: "q1" } },
      "GET /api/assistant/ask/q1": { body: { status: "pending" } },
    });
    await expect(askAssistant("?", "", { intervalMs: 1, timeoutMs: 5 }))
      .rejects.toThrow(/не ответил вовремя/);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(askAssistant("?", "", { intervalMs: 1, signal: ctrl.signal }))
      .rejects.toThrow(/отменено/);
  });
});
