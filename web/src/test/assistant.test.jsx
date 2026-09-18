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
const ASSISTANT = { id: "assistant", name: "Ассистент", builtin: true, models: [], transcribe: null };
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
    memory: {} };
  const view = (p) => ({ ...p, hasKey: true });
  const log = server({
    "GET /api/assistant/settings": () => ({ body: { providers: state.providers.map(view),
      agents: state.agents.map((a) => ({ ...a })), kinds: KINDS, tasks: {}, taskList: [] } }),
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
      if (a) { Object.assign(a, b); return { body: { ...a } }; }
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
    ...extra,
  });
  return { log, state };
}

describe("агенты", () => {
  it("«Ассистент» есть всегда и без кнопки удаления; две формы: провайдер, память", async () => {
    settingsServer([P1]);
    render(<AgentsPanel me={IVAN} />);
    const tabs = await screen.findByRole("tablist", { name: "агенты" });
    expect(within(tabs).getByRole("tab", { name: "Ассистент" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: /удалить агента/ })).toBeNull();
    expect(screen.getByText("1 · провайдер")).toBeInTheDocument();
    // «Коллекция моделей» убрана (владелец, 2026-09-13): коллекция — галочки у провайдера.
    expect(screen.queryByText(/коллекция моделей/)).toBeNull();
    expect(screen.getByText("2 · память")).toBeInTheDocument();
  });

  it("«+ агент» внизу — POST с именем, новая вкладка, у неё есть «Удалить агента»", async () => {
    const { log } = settingsServer([P1]);
    render(<AgentsPanel me={OWNER} />);
    await screen.findByRole("tab", { name: "Ассистент" });
    const name = screen.getByPlaceholderText("имя нового агента");
    fireEvent.change(name, { target: { value: "Закупщик" } });
    fireEvent.blur(name);
    fireEvent.click(screen.getByRole("button", { name: "+ агент" }));
    // На CI ответ POST и перечитывание списка иногда дольше секунды по умолчанию.
    await screen.findByRole("tab", { name: "Закупщик · агент" }, { timeout: 5000 });
    const post = log.find((r) => r.method === "POST" && r.url === "/api/assistant/agents");
    expect(JSON.parse(post.body)).toEqual({ name: "Закупщик" });
    expect(screen.getByRole("button", { name: "удалить агента Закупщик" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Закупщик · агент" })).toHaveAttribute("aria-selected", "true");
  });

  it("провайдер: модели списком после «Загрузить»; нажатие — галочка: PUT models провайдера и агента; повтор снимает", async () => {
    const { log } = settingsServer([{ ...P1, models: [] }], [ASSISTANT], {
      "GET /api/assistant/providers/p_1/models": [{ id: "gpt-4.1", name: "gpt-4.1" }, { id: "o3", name: "o3" }],
    });
    render(<AgentsPanel me={IVAN} />);
    await screen.findByRole("tab", { name: "Мой OpenAI ✓" });
    // Ручного ввода и «Добавить модель» больше нет (владелец, 2026-09-13).
    expect(screen.queryByLabelText("имя модели")).toBeNull();
    expect(screen.queryByRole("button", { name: "Добавить модель" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Загрузить список моделей" }));
    const row = await screen.findByRole("checkbox", { name: "модель gpt-4.1" });
    expect(row).toHaveAttribute("aria-checked", "false");
    fireEvent.click(row);
    // Сперва модель отмечается у провайдера, затем пара — в коллекцию агента.
    await waitFor(() => expect(log.some((r) => r.method === "PUT" && r.url.endsWith("/agents/assistant"))).toBe(true));
    const pp = log.find((r) => r.method === "PUT" && r.url.endsWith("/providers/p_1"));
    expect(JSON.parse(pp.body).models).toEqual(["gpt-4.1"]);
    const pa = log.find((r) => r.method === "PUT" && r.url.endsWith("/agents/assistant"));
    expect(JSON.parse(pa.body)).toEqual({ models: [{ providerId: "p_1", model: "gpt-4.1" }] });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "модель gpt-4.1" }))
      .toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("button", { name: "Обновить список" })).toBeInTheDocument();
    // Повторное нажатие снимает: пара уходит из коллекции, и модель — с провайдера
    // (другой агент её не держит).
    log.length = 0;
    fireEvent.click(screen.getByRole("checkbox", { name: "модель gpt-4.1" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "модель gpt-4.1" }))
      .toHaveAttribute("aria-checked", "false"));
    expect(JSON.parse(log.find((r) => r.method === "PUT" && r.url.endsWith("/agents/assistant")).body))
      .toEqual({ models: [] });
    expect(JSON.parse(log.find((r) => r.method === "PUT" && r.url.endsWith("/providers/p_1")).body).models)
      .toEqual([]);
  });

  it("галочки — про открытого агента; расшифровка у Ассистента — из его коллекции", async () => {
    const { log } = settingsServer([P1], [{ ...ASSISTANT, models: [{ providerId: "p_1", model: "gpt-4.1" }] },
      { id: "a_1", name: "Закупщик", builtin: false, models: [], transcribe: null }]);
    render(<AgentsPanel me={OWNER} />);
    await screen.findByRole("tab", { name: "Ассистент" });
    // Отмеченные ранее модели провайдера видны и до «Загрузить»; у Ассистента gpt-4.1 отмечена.
    expect(screen.getByRole("checkbox", { name: "модель gpt-4.1" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "модель gpt-4o-mini" })).toHaveAttribute("aria-checked", "false");
    // У другого агента та же модель не отмечена — коллекция своя.
    fireEvent.click(screen.getByRole("tab", { name: "Закупщик · агент" }));
    expect(screen.getByRole("checkbox", { name: "модель gpt-4.1" })).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByLabelText("модель для расшифровки")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "модель gpt-4o-mini" }));
    await waitFor(() => expect(log.some((r) => r.method === "PUT" && r.url.endsWith("/agents/a_1"))).toBe(true));
    expect(JSON.parse(log.find((r) => r.method === "PUT" && r.url.endsWith("/agents/a_1")).body))
      .toEqual({ models: [{ providerId: "p_1", model: "gpt-4o-mini" }] });
    // Расшифровка — только у Ассистента и только из его коллекции.
    fireEvent.click(screen.getByRole("tab", { name: "Ассистент" }));
    const sel = screen.getByLabelText("модель для расшифровки");
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(["", "p_1|gpt-4.1"]);
    fireEvent.change(sel, { target: { value: "p_1|gpt-4.1" } });
    await waitFor(() => expect(log.some((r) => r.body?.includes("transcribe"))).toBe(true));
    expect(JSON.parse(log.find((r) => r.body?.includes("transcribe")).body))
      .toEqual({ transcribe: { providerId: "p_1", model: "gpt-4.1" } });
  });

  it("память у каждого агента своя: GET ?agent=, POST с agent", async () => {
    const other = { id: "a_1", name: "Закупщик", builtin: false, models: [], transcribe: null };
    const { log, state } = settingsServer([P1], [ASSISTANT, other]);
    state.memory.assistant = [{ id: "m1", title: "памятка", text: "клиент любит звонки", file: null, at: "2026-09-07T10:00:00Z" }];
    render(<AgentsPanel me={IVAN} />);
    await screen.findByText("памятка");
    expect(log.some((r) => r.method === "GET" && r.url === "/api/assistant/memory?agent=assistant")).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Закупщик · агент" }));
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
