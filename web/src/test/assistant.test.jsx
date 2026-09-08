import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AssistantSettings, { preview, rowFrom, rowValue } from "../components/AssistantSettings.jsx";
import { addMemory, askAssistant } from "../assistant.js";

/* ПОМОЩНИК: свои провайдеры и модели в «Инструментах», память, вопрос в
   два шага.

   Провайдер — вид API + адрес + ключ, у каждого свои; наружу ключ не
   уходит никогда — карточка показывает лишь «есть/нет». Таблица «задача →
   модель» говорит, какая модель на что отвечает. Память — только своя.
   Вопрос кладётся и опрашивается короткими запросами: длинный запрос
   рвут nginx и WebView. */

const IVAN = { id: "2", name: "Иван", isOwner: false, known: true, tabs: ["tools"] };

const KINDS = [
  { id: "openai", name: "Совместимый с OpenAI", defaultBaseUrl: "https://api.openai.com/v1" },
  { id: "anthropic", name: "Anthropic (Claude)", defaultBaseUrl: "https://api.anthropic.com" },
  { id: "hf", name: "Hugging Face", defaultBaseUrl: "https://router.huggingface.co/v1" },
];
const TASKS = [
  { id: "chat", name: "Помощник (по умолчанию)" }, { id: "space", name: "Вопрос в пространстве" },
  { id: "bot", name: "Помощник в чате бота" }, { id: "transcribe", name: "Расшифровка записей звонков" },
];
const EMPTY_TASKS = { chat: null, space: null, bot: null, transcribe: null };
const settingsOf = (providers, tasks = EMPTY_TASKS) => ({ providers, tasks, kinds: KINDS, taskList: TASKS });
const SETTINGS = settingsOf([]);
const P1 = { id: "p_1", name: "Мой OpenAI", kind: "openai", baseUrl: "", models: ["gpt-4.1", "gpt-4o-mini"], hasKey: true };

/** Подменный сервер: отвечает по адресу и методу, запоминает запросы.
 *  Ответ — либо тело как есть, либо `{status, body}`, когда важен HTTP-статус
 *  или у самого тела есть поле status (как у ответа на вопрос). */
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

/** Подменный сервер настроек: хранит провайдеров и таблицу, как настоящий. */
function settingsServer(providers = [], tasks = { ...EMPTY_TASKS }, extra = {}) {
  const state = { providers: [...providers], tasks: { ...tasks } };
  const view = (p) => ({ ...p, hasKey: true });
  const log = server({
    "GET /api/assistant/settings": () => ({ body: settingsOf(state.providers.map(view), { ...state.tasks }) }),
    "GET /api/assistant/memory": [],
    "POST /api/assistant/providers": ({ opts }) => {
      const b = JSON.parse(opts.body);
      if (!b.key) return { status: 400, body: { error: "Ключ обязателен: без него провайдер не ответит" } };
      const p = { id: `p_${state.providers.length + 1}`, name: b.name, kind: b.kind, baseUrl: b.baseUrl || "", models: [] };
      state.providers.push(p);
      return { status: 201, body: view(p) };
    },
    "PUT *": ({ url, opts }) => {
      const b = JSON.parse(opts.body);
      if (url === "/api/assistant/tasks") { Object.assign(state.tasks, b); return { body: { ...state.tasks } }; }
      const p = state.providers.find((x) => url.endsWith(`/${x.id}`));
      if (!p) return { status: 404, body: { error: "Провайдер не найден" } };
      if (b.models) p.models = b.models;
      if (b.name !== undefined) p.name = b.name;
      return { body: view(p) };
    },
    "DELETE *": ({ url }) => {
      state.providers = state.providers.filter((x) => !url.endsWith(`/${x.id}`));
      for (const t of Object.keys(state.tasks)) {
        if (state.tasks[t] && !state.providers.some((x) => x.id === state.tasks[t].providerId)) state.tasks[t] = null;
      }
      return { status: 204, body: null };
    },
    ...extra,
  });
  return { log, state };
}

describe("чем думает помощник", () => {
  it("провайдеров нет — так и сказано; вкладка «＋ провайдер» открыта, ключ — password, ключа в ответе нет", async () => {
    settingsServer();
    render(<AssistantSettings me={IVAN} />);
    await screen.findByText(/Провайдеров нет/);
    expect(screen.getByRole("tab", { name: "＋ провайдер" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("ключ провайдера")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("вид API")).toHaveValue("openai");
    expect(screen.getByLabelText("адрес провайдера")).toHaveAttribute("placeholder", "пусто — https://api.openai.com/v1");
    // Таблица задач есть, но выбирать пока не из чего.
    expect(screen.getByLabelText("модель для: Помощник (по умолчанию)")).toBeDisabled();
    expect(screen.getByText(/Выбирать пока не из чего/)).toBeInTheDocument();
  });

  it("добавить провайдера — POST с названием, видом, адресом и ключом; он становится вкладкой, поле ключа пустое", async () => {
    const { log } = settingsServer();
    render(<AssistantSettings me={IVAN} />);
    await screen.findByText(/Провайдеров нет/);
    fireEvent.change(screen.getByLabelText("название провайдера"), { target: { value: "Мой OpenRouter" } });
    fireEvent.change(screen.getByLabelText("вид API"), { target: { value: "openai" } });
    fireEvent.change(screen.getByLabelText("адрес провайдера"), { target: { value: "https://openrouter.ai/api/v1" } });
    fireEvent.change(screen.getByLabelText("ключ провайдера"), { target: { value: "sk-or-0123456789" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить провайдера" }));
    await screen.findByText(/Провайдер «Мой OpenRouter» добавлен/);
    const post = log.find((r) => r.method === "POST");
    expect(post.url).toBe("/api/assistant/providers");
    expect(JSON.parse(post.body)).toEqual({ name: "Мой OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", key: "sk-or-0123456789" });
    expect(post.headers["X-Telegram-Init-Data"]).toBeDefined();
    // Вкладка открыта, ключ «есть», а самого ключа на экране нет.
    expect(screen.getByRole("tab", { name: /Мой OpenRouter/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("ключ есть")).toBeInTheDocument();
    expect(screen.getByLabelText("заменить ключ")).toHaveValue("");
    expect(document.body.textContent).not.toContain("sk-or-0123456789");
  });

  it("без ключа сервер отказывает словами, и слова видны", async () => {
    settingsServer();
    render(<AssistantSettings me={IVAN} />);
    await screen.findByText(/Провайдеров нет/);
    fireEvent.change(screen.getByLabelText("название провайдера"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить провайдера" }));
    expect(await screen.findByText(/Ключ обязателен/)).toBeInTheDocument();
  });

  it("модели: «список у провайдера» → выбор из списка → PUT models; вручную — тоже PUT; убрать — PUT без неё", async () => {
    const { log } = settingsServer([{ ...P1, models: [] }], EMPTY_TASKS, {
      "GET /api/assistant/providers/p_1/models": [{ id: "gpt-4.1", name: "gpt-4.1" }, { id: "o3-mini", name: "o3-mini" }],
    });
    render(<AssistantSettings me={IVAN} />);
    await screen.findByText(/Моделей нет/);
    fireEvent.click(screen.getByRole("button", { name: "Список у провайдера" }));
    const pick = await screen.findByLabelText("модель из списка провайдера");
    fireEvent.change(pick, { target: { value: "o3-mini" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить из списка" }));
    await screen.findByLabelText("убрать модель o3-mini");
    let put = log.filter((r) => r.method === "PUT").pop();
    expect(put.url).toBe("/api/assistant/providers/p_1");
    expect(JSON.parse(put.body)).toEqual({ models: ["o3-mini"] });

    fireEvent.change(screen.getByLabelText("имя модели"), { target: { value: "gpt-4.1" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить модель" }));
    await screen.findByLabelText("убрать модель gpt-4.1");
    put = log.filter((r) => r.method === "PUT").pop();
    expect(JSON.parse(put.body)).toEqual({ models: ["o3-mini", "gpt-4.1"] });
    expect(screen.getByLabelText("имя модели")).toHaveValue("");

    fireEvent.click(screen.getByLabelText("убрать модель o3-mini"));
    await waitFor(() => expect(screen.queryByLabelText("убрать модель o3-mini")).toBeNull());
    put = log.filter((r) => r.method === "PUT").pop();
    expect(JSON.parse(put.body)).toEqual({ models: ["gpt-4.1"] });
  });

  it("провайдер список не отдал — сказано словами «введите вручную», а не пустота", async () => {
    settingsServer([{ ...P1, kind: "hf", name: "HF" }], EMPTY_TASKS, { "GET /api/assistant/providers/p_1/models": [] });
    render(<AssistantSettings me={IVAN} />);
    await screen.findByRole("tab", { name: /HF/ });
    fireEvent.click(screen.getByRole("button", { name: "Список у провайдера" }));
    expect(await screen.findByText(/список не отдал — введите имя модели вручную/)).toBeInTheDocument();
    expect(screen.queryByLabelText("модель из списка провайдера")).toBeNull();
  });

  it("таблица «задача → модель»: строка на каждую задачу, выбор — PUT одной строкой, значение видно", async () => {
    const P2 = { id: "p_2", name: "Claude", kind: "anthropic", baseUrl: "", models: ["claude-sonnet-4-5"], hasKey: true };
    const { log } = settingsServer([P1, P2], { ...EMPTY_TASKS, chat: { providerId: "p_1", model: "gpt-4.1" } });
    render(<AssistantSettings me={IVAN} />);
    const chat = await screen.findByLabelText("модель для: Помощник (по умолчанию)");
    expect(chat).toHaveValue("p_1|gpt-4.1");
    TASKS.forEach((t) => expect(screen.getByLabelText(`модель для: ${t.name}`)).toBeInTheDocument());
    // Выпадающий список — «провайдер / модель» по всем провайдерам.
    const space = screen.getByLabelText("модель для: Вопрос в пространстве");
    expect([...space.options].map((o) => o.textContent)).toEqual([
      "— как по умолчанию", "Мой OpenAI / gpt-4.1", "Мой OpenAI / gpt-4o-mini", "Claude / claude-sonnet-4-5"]);
    // У расшифровки отката на «по умолчанию» нет: пустая строка так и подписана.
    const transcribe = screen.getByLabelText("модель для: Расшифровка записей звонков");
    expect(transcribe.options[0].textContent).toBe("— не выбрана (расшифровки не будет)");
    expect(chat.options[0].textContent).toBe("— не выбрана");
    fireEvent.change(space, { target: { value: "p_2|claude-sonnet-4-5" } });
    await waitFor(() => expect(screen.getByLabelText("модель для: Вопрос в пространстве")).toHaveValue("p_2|claude-sonnet-4-5"));
    const put = log.find((r) => r.method === "PUT" && r.url === "/api/assistant/tasks");
    expect(JSON.parse(put.body)).toEqual({ space: { providerId: "p_2", model: "claude-sonnet-4-5" } });
    // Снять выбор — null той же строкой.
    fireEvent.change(screen.getByLabelText("модель для: Вопрос в пространстве"), { target: { value: "" } });
    await waitFor(() => expect(log.filter((r) => r.url === "/api/assistant/tasks")).toHaveLength(2));
    expect(JSON.parse(log.filter((r) => r.url === "/api/assistant/tasks")[1].body)).toEqual({ space: null });
  });

  it("удалить провайдера — только после подтверждения словами; DELETE, вкладка исчезает, строка таблицы пуста", async () => {
    const { log } = settingsServer([P1], { ...EMPTY_TASKS, chat: { providerId: "p_1", model: "gpt-4.1" } });
    render(<AssistantSettings me={IVAN} />);
    await screen.findByRole("tab", { name: /Мой OpenAI/ });
    fireEvent.click(screen.getByRole("button", { name: "Удалить провайдера" }));
    expect(log.filter((r) => r.method === "DELETE")).toHaveLength(0);
    expect(screen.getByText(/Удалить «Мой OpenAI» вместе с ключом\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Да, удалить" }));
    await screen.findByText(/Провайдер «Мой OpenAI» удалён вместе с ключом/);
    expect(log.find((r) => r.method === "DELETE").url).toBe("/api/assistant/providers/p_1");
    expect(screen.queryByRole("tab", { name: /Мой OpenAI/ })).toBeNull();
    expect(screen.getByText(/Провайдеров нет/)).toBeInTheDocument();
  });

  it("строка таблицы в <select> и обратно", () => {
    expect(rowValue({ providerId: "p_1", model: "a/b:c" })).toBe("p_1|a/b:c");
    expect(rowFrom("p_1|a/b:c")).toEqual({ providerId: "p_1", model: "a/b:c" });
    expect(rowFrom("")).toBeNull();
    expect(rowValue(null)).toBe("");
  });
});

describe("память помощника", () => {
  const MEM = [
    { id: "m1", title: "памятка", text: "клиент любит звонки утром ".repeat(10), file: null, at: "2026-09-07T10:00:00Z" },
    { id: "m2", title: "договор", text: "", file: { name: "договор.pdf", type: "application/pdf", size: 10, url: "/api/reports/abc/1" }, at: "2026-09-07T09:00:00Z" },
  ];

  it("список: название, начало текста, файл ссылкой", async () => {
    server({ "GET /api/assistant/settings": SETTINGS, "GET /api/assistant/memory": MEM });
    render(<AssistantSettings me={IVAN} />);
    await screen.findByText("памятка");
    const start = screen.getByText(/клиент любит звонки утром/);
    expect(start.textContent.length).toBeLessThanOrEqual(80);
    expect(start.textContent.endsWith("…")).toBe(true);
    expect(screen.getByText(/договор\.pdf/)).toHaveAttribute("href", "/api/reports/abc/1");
  });

  it("добавить текстом — POST с названием и текстом, список обновляется", async () => {
    const stored = [];
    const log = server({
      "GET /api/assistant/settings": SETTINGS,
      "GET /api/assistant/memory": () => ({ body: [...stored] }),
      "POST /api/assistant/memory": ({ opts }) => {
        const b = JSON.parse(opts.body);
        const item = { id: `m${stored.length + 1}`, ...b, file: null, at: "2026-09-07T10:00:00Z" };
        stored.push(item);
        return { status: 201, body: item };
      },
    });
    render(<AssistantSettings me={IVAN} />);
    await screen.findByText("Память пуста.");
    fireEvent.change(screen.getByLabelText("название записи"), { target: { value: "клиент" } });
    fireEvent.change(screen.getByLabelText("текст записи"), { target: { value: "любит звонки утром" } });
    fireEvent.click(screen.getByRole("button", { name: "Запомнить" }));
    await screen.findByText("Запомнено.");
    const post = log.find((r) => r.method === "POST");
    expect(JSON.parse(post.body)).toEqual({ title: "клиент", text: "любит звонки утром" });
    expect(screen.getByText("клиент")).toBeInTheDocument();
    expect(screen.getByText("любит звонки утром")).toBeInTheDocument();
    // Поля очищены под следующую запись.
    expect(screen.getByLabelText("текст записи")).toHaveValue("");
  });

  it("пустой текст не отправляется", async () => {
    const log = server({ "GET /api/assistant/settings": SETTINGS, "GET /api/assistant/memory": [] });
    render(<AssistantSettings me={IVAN} />);
    await screen.findByText("Память пуста.");
    fireEvent.click(screen.getByRole("button", { name: "Запомнить" }));
    expect(await screen.findByText(/пустую запись запоминать нечего/)).toBeInTheDocument();
    expect(log.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("добавить файлом — сырые байты с именем в заголовке, base64 от UTF-8", async () => {
    const log = server({
      "GET /api/assistant/settings": SETTINGS,
      "GET /api/assistant/memory": [],
      "POST /api/assistant/memory": { status: 201, body: { id: "m1", title: "договор.txt", text: "x", file: null } },
    });
    render(<AssistantSettings me={IVAN} />);
    await screen.findByText("Память пуста.");
    const file = new File(["пункт 1"], "договор.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("файл в память"), { target: { files: [file] } });
    await screen.findByText(/Файл «договор\.txt» в памяти/);
    const post = log.find((r) => r.method === "POST");
    expect(post.body).toBe(file);
    /* Файл едет байтами без типа, тип — в своём заголовке: сервер
       разбирает JSON-тела на всех маршрутах разом, и .json-файл, посланный
       как application/json, доезжал до памяти разобранной записью, а не
       файлом. */
    expect(post.headers["Content-Type"]).toBe("application/octet-stream");
    expect(post.headers["X-Memory-Type"]).toBe("text/plain");
    expect(post.headers["X-Memory-Name"]).toBe(btoa(String.fromCharCode(...new TextEncoder().encode("договор.txt"))));
    expect(post.headers["X-Telegram-Init-Data"]).toBeDefined();
  });

  it("удаление — DELETE по id, список перечитывается", async () => {
    let stored = [...MEM];
    const log = server({
      "GET /api/assistant/settings": SETTINGS,
      "GET /api/assistant/memory": () => ({ body: [...stored] }),
      "DELETE /api/assistant/memory/m1": () => { stored = stored.filter((m) => m.id !== "m1"); return { status: 204, body: null }; },
    });
    render(<AssistantSettings me={IVAN} />);
    await screen.findByText("памятка");
    fireEvent.click(screen.getByLabelText("удалить из памяти: памятка"));
    await waitFor(() => expect(screen.queryByText("памятка")).toBeNull());
    expect(log.some((r) => r.method === "DELETE" && r.url === "/api/assistant/memory/m1")).toBe(true);
    expect(screen.getByText("договор")).toBeInTheDocument();
  });

  it("addMemory({title, text}) — JSON; addMemory(File) — байты", async () => {
    const log = server({ "POST /api/assistant/memory": { status: 201, body: { id: "m1" } } });
    await addMemory({ title: "a", text: "b" });
    expect(JSON.parse(log[0].body)).toEqual({ title: "a", text: "b" });
    const f = new File(["x"], "a.txt", { type: "text/plain" });
    await addMemory(f);
    expect(log[1].body).toBe(f);
    // .json-файл — тоже байты: как application/json он был бы съеден разбором тела.
    const j = new File(['{"a":1}'], "данные.json", { type: "application/json" });
    await addMemory(j);
    expect(log[2].body).toBe(j);
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
      "GET /api/assistant/ask/q1": { body: { status: "error", error: "Помощник не настроен: добавьте провайдера и ключ в Инструментах → Помощник" } },
    });
    await expect(askAssistant("?", "", { intervalMs: 1 }))
      .rejects.toThrow(/Помощник не настроен: добавьте провайдера/);
  });

  it("task уходит в POST полем — строка таблицы «задача → модель»; без task поля нет", async () => {
    const log = server({
      "POST /api/assistant/ask": { status: 202, body: { id: "q1" } },
      "GET /api/assistant/ask/q1": { body: { status: "done", text: "ок" } },
    });
    await askAssistant("?", "блок", { intervalMs: 1, task: "space" });
    expect(JSON.parse(log[0].body)).toEqual({ question: "?", context: "блок", task: "space" });
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
