import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AssistantSettings, { preview } from "../components/AssistantSettings.jsx";
import { addMemory, askAssistant } from "../assistant.js";

/* ПОМОЩНИК: ключи и модели в «Инструментах», память, вопрос в два шага.

   Ключ ставит только владелец; наружу он не уходит никогда — карточка
   показывает лишь «есть/нет». Память — только своя. Вопрос кладётся и
   опрашивается короткими запросами: длинный запрос рвут nginx и WebView. */

const OWNER = { id: "1", name: "Владелец", isOwner: true, known: true, tabs: ["tools"] };
const IVAN = { id: "2", name: "Иван", isOwner: false, known: true, tabs: ["tools"] };

const SETTINGS = { provider: "openai", model: "", hasKey: { openai: true, claude: false, hf: false },
  defaults: { openai: "gpt-4o-mini", claude: "claude-sonnet-4-5", hf: "meta-llama/Llama-3.1-8B-Instruct" } };

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

describe("чем думает помощник", () => {
  it("владелец видит три провайдера, поле модели с подсказкой и поле ключа; ключа в ответе нет", async () => {
    server({ "GET /api/assistant/settings": SETTINGS, "GET /api/assistant/memory": [] });
    render(<AssistantSettings me={OWNER} />);
    await screen.findByRole("button", { name: /OpenAI/ });
    expect(screen.getByRole("button", { name: /Claude/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hugging Face/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /OpenAI/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("модель")).toHaveAttribute("placeholder", "gpt-4o-mini");
    expect(screen.getByLabelText("ключ")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("ключ")).toHaveValue("");
    expect(screen.getByText(/ключ есть/)).toBeInTheDocument();
  });

  it("сохранение уходит одним PUT с провайдером, моделью и ключом", async () => {
    const log = server({
      "GET /api/assistant/settings": SETTINGS,
      "GET /api/assistant/memory": [],
      "PUT /api/assistant/settings": ({ opts }) => {
        const b = JSON.parse(opts.body);
        return { ...SETTINGS, provider: b.provider, model: b.model,
          hasKey: { ...SETTINGS.hasKey, [b.provider]: true } };
      },
    });
    render(<AssistantSettings me={OWNER} />);
    fireEvent.click(await screen.findByRole("button", { name: /Claude/ }));
    expect(screen.getByLabelText("модель")).toHaveAttribute("placeholder", "claude-sonnet-4-5");
    expect(screen.getByText(/ключа нет/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("модель"), { target: { value: "claude-opus-4-1" } });
    fireEvent.change(screen.getByLabelText("ключ"), { target: { value: "sk-ant-0123456789" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByText("Сохранено.");
    const put = log.find((r) => r.method === "PUT");
    expect(put.url).toBe("/api/assistant/settings");
    expect(JSON.parse(put.body)).toEqual({ provider: "claude", model: "claude-opus-4-1", key: "sk-ant-0123456789" });
    expect(put.headers["X-Telegram-Init-Data"]).toBeDefined();
    // После сохранения поле ключа пустое: ключ не хранится в браузере.
    expect(screen.getByLabelText("ключ")).toHaveValue("");
    expect(screen.getByText(/ключ есть/)).toBeInTheDocument();
  });

  it("не-владельцу — «ключ ставит владелец», без поля ключа и без «Сохранить»", async () => {
    server({ "GET /api/assistant/settings": SETTINGS, "GET /api/assistant/memory": [] });
    render(<AssistantSettings me={IVAN} />);
    await screen.findByText(/Ключ ставит владелец/);
    expect(screen.getByText("Ключ есть.")).toBeInTheDocument();
    expect(screen.queryByLabelText("ключ")).toBeNull();
    expect(screen.queryByRole("button", { name: "Сохранить" })).toBeNull();
    expect(screen.getByRole("button", { name: /OpenAI/ })).toBeDisabled();
  });

  it("провайдер не выбран — так и сказано, а не подсвечен первый попавшийся", async () => {
    server({ "GET /api/assistant/settings": { ...SETTINGS, provider: "", hasKey: { openai: false, claude: false, hf: false } },
      "GET /api/assistant/memory": [] });
    render(<AssistantSettings me={OWNER} />);
    await screen.findByText(/Провайдер не выбран/);
    ["OpenAI", "Claude", "Hugging Face"].forEach((n) =>
      expect(screen.getByRole("button", { name: n })).toHaveAttribute("aria-pressed", "false"));
    expect(screen.getByLabelText("ключ")).toBeDisabled();
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
      "GET /api/assistant/ask/q1": { body: { status: "error", error: "Помощник не настроен: владелец должен указать ключ в Инструментах" } },
    });
    await expect(askAssistant("?", "", { intervalMs: 1 }))
      .rejects.toThrow(/Помощник не настроен: владелец должен указать ключ/);
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
