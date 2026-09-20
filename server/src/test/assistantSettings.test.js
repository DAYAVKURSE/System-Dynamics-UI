import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  KEY_VARS, MAX_AGENTS, NOT_CONFIGURED, TASKS, addAgent, addProvider, agentFor, fromLegacyEnv,
  modelFor, providerFor, readUserSettings, removeAgent, removeProvider, setTasks, settingsView,
  updateAgent, updateProvider, writeUserSettings,
} from "../lib/assistantSettings.js";

/* Провайдеры, ключи и модели — у каждого свои, в файле на человека.
   Главное, что проверяется: настройки не текут между людьми, ключ не
   уходит наружу ни в каком виде, а modelFor выбирает по правилу. */

const VARS = ["AI_PROVIDER", "AI_MODEL", "OWNER_TELEGRAM_ID", ...Object.values(KEY_VARS)];
let tmp;

beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sd-ai-")); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
beforeEach(() => {
  process.env.ASSISTANT_DIR = path.join(tmp, "assistant");
  process.env.ORG_DIR = path.join(tmp, "org");
  fs.rmSync(process.env.ASSISTANT_DIR, { recursive: true, force: true });
  fs.rmSync(process.env.ORG_DIR, { recursive: true, force: true });
});
afterEach(() => { VARS.forEach((v) => delete process.env[v]); });

const KEY = "sk-secret-0123456789";
const add = (user, over = {}) => addProvider(user, { name: "OpenAI", kind: "openai", key: KEY, ...over });
const withModels = (user, over = {}, models = ["gpt-4.1", "gpt-4o-mini"]) => {
  const p = add(user, over);
  return updateProvider(user, p.id, { models });
};

describe("файл на человека", () => {
  it("пусто — так и сказано: ни провайдеров, ни строк таблицы, и modelFor — null", () => {
    expect(readUserSettings("200")).toEqual({ providers: [], mcp: [],
      tasks: { chat: null, bot: null, transcribe: null },
      agents: [{ id: "assistant", name: "Ассистент", builtin: true, models: [], transcribe: null, uses: { main: null, voice: null, draw: null, vision: null, transcribe: null }, mcp: [], ask: true }] });
    expect(settingsView("200").providers).toEqual([]);
    expect(modelFor("200", "chat")).toBeNull();
    expect(NOT_CONFIGURED).toMatch(/добавьте провайдера/);
    expect(TASKS.map((t) => t.id)).toEqual(["chat", "bot", "transcribe"]);
  });

  it("настройки не текут между людьми: у Ивана свой файл, у владельца — свой", () => {
    add("200", { name: "Мой OpenRouter", baseUrl: "https://openrouter.ai/api/v1" });
    expect(settingsView("100").providers).toEqual([]);
    expect(settingsView("200").providers.map((p) => p.name)).toEqual(["Мой OpenRouter"]);
    expect(modelFor("100", "chat")).toBeNull();
    expect(fs.existsSync(path.join(process.env.ASSISTANT_DIR, "200.json"))).toBe(true);
    expect(fs.existsSync(path.join(process.env.ASSISTANT_DIR, "100.json"))).toBe(false);
  });

  it("id человека не выводит за каталог настроек", () => {
    add("../../evil");
    const files = fs.readdirSync(process.env.ASSISTANT_DIR);
    expect(files).toEqual(["______evil.json"]);
  });

  it("ключ наружу не уходит никогда — только hasKey; в файле он есть, права 0600", () => {
    const p = add("200");
    expect(p).toEqual({ id: p.id, name: "OpenAI", kind: "openai", baseUrl: "", models: [], hasKey: true });
    expect(JSON.stringify(settingsView("200"))).not.toContain(KEY);
    expect(JSON.stringify(updateProvider("200", p.id, { name: "OpenAI 2" }))).not.toContain(KEY);
    const file = path.join(process.env.ASSISTANT_DIR, "200.json");
    expect(fs.readFileSync(file, "utf8")).toContain(KEY);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    // Для вызова API ключ достаётся отдельной функцией, и только она его знает.
    expect(providerFor("200", p.id).key).toBe(KEY);
    expect(providerFor("100", p.id)).toBeNull();
  });
});

describe("провайдер = вид API + адрес + ключ", () => {
  it("вид обязателен из трёх, ключ обязателен, адрес — только http(s)", () => {
    expect(() => addProvider("200", { name: "x", kind: "gemini", key: KEY })).toThrow(/Неизвестный вид API/);
    expect(() => addProvider("200", { name: "x", kind: "openai", key: "" })).toThrow(/Ключ обязателен/);
    expect(() => addProvider("200", { name: "x", kind: "openai", key: "с пробелом и кириллицей" })).toThrow(/Ключ выглядит неверно/);
    expect(() => addProvider("200", { name: "", kind: "openai", key: KEY })).toThrow(/Название провайдера обязательно/);
    expect(() => addProvider("200", { name: "x", kind: "openai", key: KEY, baseUrl: "ftp://x" })).toThrow(/http/);
    expect(settingsView("200").providers).toEqual([]);
  });

  it("адрес хранится без хвостового слэша; пустой адрес значит умолчание вида", () => {
    const p = add("200", { baseUrl: "https://api.groq.com/openai/v1/" });
    expect(p.baseUrl).toBe("https://api.groq.com/openai/v1");
    const q = addProvider("200", { name: "Claude", kind: "anthropic", key: KEY });
    expect(q.baseUrl).toBe("");
    updateProvider("200", q.id, { models: ["claude-sonnet-4-5"] });
    setTasks("200", { chat: { providerId: q.id, model: "claude-sonnet-4-5" } });
    expect(modelFor("200", "chat").baseUrl).toBe("https://api.anthropic.com");
  });

  it("пустой ключ в правке значит «не трогать», новый — заменить; модели — списком без повторов", () => {
    const p = add("200");
    updateProvider("200", p.id, { key: "", models: ["gpt-4.1", "gpt-4.1", "o3-mini"] });
    expect(providerFor("200", p.id).key).toBe(KEY);
    expect(providerFor("200", p.id).models).toEqual(["gpt-4.1", "o3-mini"]);
    updateProvider("200", p.id, { key: "sk-new-0123456789" });
    expect(providerFor("200", p.id).key).toBe("sk-new-0123456789");
    expect(() => updateProvider("200", p.id, { models: ["gpt 4;rm -rf"] })).toThrow(/Имя модели выглядит неверно/);
    expect(() => updateProvider("200", "нет-такого", { name: "x" })).toThrow(/Провайдер не найден/);
  });

  it("удаление провайдера уносит ключ и обнуляет строки таблицы на него", () => {
    const p = withModels("200");
    const q = withModels("200", { name: "Второй" }, ["gpt-4o"]);
    setTasks("200", { chat: { providerId: p.id, model: "gpt-4.1" }, bot: { providerId: q.id, model: "gpt-4o" } });
    expect(removeProvider("200", p.id)).toBe(true);
    expect(removeProvider("200", p.id)).toBe(false);
    expect(providerFor("200", p.id)).toBeNull();
    expect(settingsView("200").tasks).toEqual({ chat: null, bot: { providerId: q.id, model: "gpt-4o" }, transcribe: null });
    expect(fs.readFileSync(path.join(process.env.ASSISTANT_DIR, "200.json"), "utf8")).not.toContain(p.id);
  });
});

describe("таблица «задача → модель» и modelFor", () => {
  it("строка принимает только модель из списка провайдера; прислано — только то, что прислано", () => {
    const p = withModels("200");
    expect(() => setTasks("200", { chat: { providerId: p.id, model: "gpt-5" } })).toThrow(/модель, которой нет/);
    expect(() => setTasks("200", { chat: { providerId: "x", model: "gpt-4.1" } })).toThrow(/провайдер, которого нет/);
    setTasks("200", { chat: { providerId: p.id, model: "gpt-4.1" } });
    const tasks = setTasks("200", { transcribe: { providerId: p.id, model: "gpt-4o-mini" } });
    expect(tasks).toEqual({ chat: { providerId: p.id, model: "gpt-4.1" }, bot: null,
      transcribe: { providerId: p.id, model: "gpt-4o-mini" } });
    expect(setTasks("200", { chat: null }).chat).toBeNull();
  });

  it("modelFor: своя строка → строка chat → первый провайдер с ключом и первой моделью → null", () => {
    const p = withModels("200", { name: "Мой OpenAI" });
    // Ничего не выбрано — первый провайдер, первая модель.
    expect(modelFor("200", "bot")).toEqual({ kind: "openai", baseUrl: "https://api.openai.com/v1",
      key: KEY, model: "gpt-4.1", providerName: "Мой OpenAI" });
    setTasks("200", { chat: { providerId: p.id, model: "gpt-4o-mini" } });
    // Своей строки нет — берётся chat.
    expect(modelFor("200", "bot").model).toBe("gpt-4o-mini");
    expect(modelFor("200", "неизвестная задача").model).toBe("gpt-4o-mini");
    const q = withModels("200", { name: "Claude", kind: "anthropic" }, ["claude-sonnet-4-5"]);
    setTasks("200", { bot: { providerId: q.id, model: "claude-sonnet-4-5" } });
    // Своя строка — она; у задачи без своей строки по-прежнему chat.
    expect(modelFor("200", "bot")).toMatchObject({ kind: "anthropic", model: "claude-sonnet-4-5", providerName: "Claude" });
    expect(modelFor("200", "неизвестная задача").model).toBe("gpt-4o-mini");
  });

  it("провайдер без моделей в умолчание не попадает — выбирать у него нечего", () => {
    add("200", { name: "Пустой" });
    expect(modelFor("200", "chat")).toBeNull();
    withModels("200", { name: "С моделями" }, ["gpt-4o"]);
    expect(modelFor("200", "chat")).toMatchObject({ providerName: "С моделями", model: "gpt-4o" });
  });

  it("модель, пропавшая из списка провайдера, снимается со строк таблицы", () => {
    const p = withModels("200");
    setTasks("200", { chat: { providerId: p.id, model: "gpt-4.1" } });
    updateProvider("200", p.id, { models: ["gpt-4o-mini"] });
    expect(settingsView("200").tasks.chat).toBeNull();
    expect(modelFor("200", "chat").model).toBe("gpt-4o-mini");
  });

  it("битый файл переживается пустотой по полю, а не падением", () => {
    fs.mkdirSync(process.env.ASSISTANT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.ASSISTANT_DIR, "200.json"),
      JSON.stringify({ providers: [{ id: "a", kind: "gemini", key: "x" }, { id: "b", name: "ок", kind: "hf", key: KEY, models: ["m/1", ""] }],
        tasks: { chat: { providerId: "a", model: "x" } } }));
    const rec = readUserSettings("200");
    expect(rec.providers.map((p) => p.id)).toEqual(["b"]);
    expect(rec.providers[0].models).toEqual(["m/1"]);
    expect(rec.tasks.chat).toBeNull();
    expect(writeUserSettings("200", rec)).toEqual(rec);
  });
});

describe("перенос прежних настроек владельца из .env", () => {
  const legacy = () => {
    process.env.AI_PROVIDER = "claude";
    process.env.AI_MODEL = "claude-opus-4-1";
    process.env.ANTHROPIC_API_KEY = "sk-ant-0123456789";
    process.env.OPENAI_API_KEY = "sk-openai-0123456789";
  };

  it("владельцу — один раз, из всех ключей .env, с выбранным провайдером в строке chat", () => {
    legacy();
    process.env.OWNER_TELEGRAM_ID = "100";
    const view = settingsView("100");
    expect(view.providers.map((p) => [p.name, p.kind, p.hasKey])).toEqual([
      ["OpenAI", "openai", true], ["Claude", "anthropic", true]]);
    expect(view.providers[1].models).toEqual(["claude-opus-4-1"]);
    expect(view.providers[0].models).toEqual(["gpt-4o-mini"]);
    expect(view.tasks.chat).toEqual({ providerId: view.providers[1].id, model: "claude-opus-4-1" });
    expect(modelFor("100", "bot")).toMatchObject({ kind: "anthropic", key: "sk-ant-0123456789", model: "claude-opus-4-1" });
    // Один раз: после удаления провайдера .env не воскрешает его.
    removeProvider("100", view.providers[1].id);
    expect(settingsView("100").providers.map((p) => p.name)).toEqual(["OpenAI"]);
  });

  it("не-владельцу из .env ничего не переносится: чужой ключ — чужой счёт", () => {
    legacy();
    process.env.OWNER_TELEGRAM_ID = "100";
    expect(settingsView("200").providers).toEqual([]);
    expect(modelFor("200", "chat")).toBeNull();
  });

  it("владелец из org.json, когда переменной нет; без прежних ключей переносить нечего", () => {
    fs.mkdirSync(process.env.ORG_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.ORG_DIR, "org.json"), JSON.stringify({ ownerId: "100", users: [], roles: [] }));
    expect(settingsView("100").providers).toEqual([]);
    expect(fs.existsSync(path.join(process.env.ASSISTANT_DIR, "100.json"))).toBe(false);
    legacy();
    expect(settingsView("100").providers.map((p) => p.kind)).toEqual(["openai", "anthropic"]);
    expect(fromLegacyEnv({})).toBeNull();
    // Перенесённое становится моделью владельца по задаче «chat».
    expect(modelFor("100", "chat")).toMatchObject({ kind: "anthropic", model: "claude-opus-4-1", providerName: "Claude" });
  });
});

/* ─────── агенты ───────
   Встроенный «Ассистент» есть у всех и всегда первый; свои агенты — с
   коллекцией моделей из провайдеров человека. modelFor смотрит сначала в
   коллекцию ассистента, потом — в прежнюю таблицу. */
describe("агенты", () => {
  const ASSISTANT = { id: "assistant", name: "Ассистент", builtin: true, models: [], transcribe: null, uses: { main: null, voice: null, draw: null, vision: null, transcribe: null }, mcp: [], ask: true };

  it("встроенный есть всегда, первым, и его нельзя удалить", () => {
    expect(settingsView("200").agents).toEqual([ASSISTANT]);
    expect(agentFor("200", "assistant")).toEqual(ASSISTANT);
    expect(() => removeAgent("200", "assistant")).toThrow(/Ассистента удалить нельзя/);
    expect(settingsView("200").agents).toEqual([ASSISTANT]);
    // Пропавший из файла — воскресает на первом месте.
    fs.mkdirSync(process.env.ASSISTANT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.ASSISTANT_DIR, "200.json"),
      JSON.stringify({ providers: [], agents: [{ id: "a_1", name: "Свой" }] }));
    expect(settingsView("200").agents.map((a) => a.id)).toEqual(["assistant", "a_1"]);
  });

  it("создание, переименование, удаление; имя обязательно; предел назван числом", () => {
    const a = addAgent("200", { name: "  Юрист   по договорам " });
    expect(a).toEqual({ id: a.id, name: "Юрист по договорам", builtin: false, models: [], transcribe: null, uses: { main: null, voice: null, draw: null, vision: null, transcribe: null }, mcp: [], ask: true });
    expect(a.id).toMatch(/^a_[0-9a-f]{8}$/);
    expect(settingsView("200").agents.map((x) => x.id)).toEqual(["assistant", a.id]);
    expect(updateAgent("200", a.id, { name: "Юрист" }).name).toBe("Юрист");
    expect(() => updateAgent("200", a.id, { name: " " })).toThrow(/Название агента обязательно/);
    expect(() => addAgent("200", { name: "" })).toThrow(/Название агента обязательно/);
    expect(updateAgent("200", "нет-такого", { name: "x" })).toBeNull();
    expect(updateAgent("100", a.id, { name: "чужой" })).toBeNull();
    expect(removeAgent("200", a.id)).toBe(true);
    expect(removeAgent("200", a.id)).toBe(false);
    expect(settingsView("200").agents).toEqual([ASSISTANT]);
    for (let i = 1; i < MAX_AGENTS; i += 1) addAgent("200", { name: `агент ${i}` });
    expect(() => addAgent("200", { name: "лишний" })).toThrow(/не больше 20/);
  });

  it("пары моделей — только из провайдеров записи и их списков; повторы убираются, порядок сохраняется", () => {
    const p = withModels("200");
    const q = withModels("200", { name: "Claude", kind: "anthropic" }, ["claude-sonnet-4-5"]);
    const a = addAgent("200", { name: "Свой" });
    expect(() => updateAgent("200", a.id, { models: [{ providerId: "x", model: "gpt-4.1" }] })).toThrow(/провайдер, которого нет/);
    expect(() => updateAgent("200", a.id, { models: [{ providerId: p.id, model: "gpt-5" }] })).toThrow(/модели «gpt-5» нет в списке провайдера «OpenAI»/);
    expect(() => updateAgent("200", a.id, { models: "gpt-4.1" })).toThrow(/должна быть списком/);
    expect(() => updateAgent("200", a.id, { transcribe: { providerId: p.id, model: "whisper" } })).toThrow(/для расшифровки: модели «whisper» нет/);
    const upd = updateAgent("200", a.id, { models: [
      { providerId: q.id, model: "claude-sonnet-4-5" }, { providerId: p.id, model: "gpt-4.1" },
      { providerId: q.id, model: "claude-sonnet-4-5" },
    ], transcribe: { providerId: p.id, model: "gpt-4o-mini" } });
    expect(upd.models).toEqual([{ providerId: q.id, model: "claude-sonnet-4-5" }, { providerId: p.id, model: "gpt-4.1" }]);
    expect(upd.transcribe).toEqual({ providerId: p.id, model: "gpt-4o-mini" });
    expect(updateAgent("200", a.id, { transcribe: null }).transcribe).toBeNull();
    // Ответ — копия: правка ответа не правит запись.
    upd.models.push({ providerId: p.id, model: "gpt-4o-mini" });
    expect(agentFor("200", a.id).models).toHaveLength(2);
  });

  it("удаление провайдера и снятие модели вычищают пары у всех агентов", () => {
    const p = withModels("200");
    const q = withModels("200", { name: "Второй" }, ["gpt-4o"]);
    const a = addAgent("200", { name: "Свой" });
    const pairs = [{ providerId: p.id, model: "gpt-4.1" }, { providerId: q.id, model: "gpt-4o" }, { providerId: p.id, model: "gpt-4o-mini" }];
    updateAgent("200", "assistant", { models: pairs, transcribe: { providerId: p.id, model: "gpt-4o-mini" } });
    updateAgent("200", a.id, { models: pairs, transcribe: { providerId: q.id, model: "gpt-4o" } });
    updateProvider("200", p.id, { models: ["gpt-4.1"] });
    let [assistant, own] = settingsView("200").agents;
    expect(assistant.models).toEqual([{ providerId: p.id, model: "gpt-4.1" }, { providerId: q.id, model: "gpt-4o" }]);
    expect(assistant.transcribe).toBeNull();
    expect(own.transcribe).toEqual({ providerId: q.id, model: "gpt-4o" });
    removeProvider("200", q.id);
    [assistant, own] = settingsView("200").agents;
    expect(assistant.models).toEqual([{ providerId: p.id, model: "gpt-4.1" }]);
    expect(own.models).toEqual([{ providerId: p.id, model: "gpt-4.1" }]);
    expect(own.transcribe).toBeNull();
  });

  it("modelFor: сначала коллекция ассистента (первая пара с ключом), потом прежняя таблица", () => {
    const p = withModels("200", { name: "Мой OpenAI" });
    const q = withModels("200", { name: "Claude", kind: "anthropic" }, ["claude-sonnet-4-5"]);
    setTasks("200", { chat: { providerId: p.id, model: "gpt-4o-mini" }, bot: { providerId: p.id, model: "gpt-4.1" } });
    // Коллекция пуста — прежняя логика.
    expect(modelFor("200", "chat").model).toBe("gpt-4o-mini");
    expect(modelFor("200", "bot").model).toBe("gpt-4.1");
    updateAgent("200", "assistant", { models: [{ providerId: q.id, model: "claude-sonnet-4-5" }, { providerId: p.id, model: "gpt-4.1" }] });
    expect(modelFor("200", "chat")).toMatchObject({ kind: "anthropic", model: "claude-sonnet-4-5", providerName: "Claude" });
    expect(modelFor("200", "bot")).toMatchObject({ model: "claude-sonnet-4-5" });
    expect(modelFor("200", "неизвестная задача")).toMatchObject({ model: "claude-sonnet-4-5" });
    // Расшифровка — только своя пара: коллекция чата записи не расшифровывает.
    expect(modelFor("200", "transcribe", { fallback: false })).toBeNull();
    setTasks("200", { transcribe: { providerId: p.id, model: "gpt-4o-mini" } });
    expect(modelFor("200", "transcribe", { fallback: false }).model).toBe("gpt-4o-mini");
    updateAgent("200", "assistant", { transcribe: { providerId: p.id, model: "gpt-4.1" } });
    expect(modelFor("200", "transcribe", { fallback: false })).toMatchObject({ model: "gpt-4.1", providerName: "Мой OpenAI" });
    // Свой агент на modelFor не влияет: отвечает ассистент.
    const a = addAgent("200", { name: "Свой" });
    updateAgent("200", a.id, { models: [{ providerId: p.id, model: "gpt-4o-mini" }] });
    expect(modelFor("200", "chat").model).toBe("claude-sonnet-4-5");
  });

  it("прежняя запись без agents: строка chat — первая модель ассистента, transcribe — его расшифровка", () => {
    fs.mkdirSync(process.env.ASSISTANT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.ASSISTANT_DIR, "200.json"), JSON.stringify({
      providers: [{ id: "p_1", name: "OpenAI", kind: "openai", key: KEY, models: ["gpt-4.1", "whisper-1"] }],
      tasks: { chat: { providerId: "p_1", model: "gpt-4.1" }, transcribe: { providerId: "p_1", model: "whisper-1" } },
    }));
    const [assistant] = settingsView("200").agents;
    expect(assistant.models).toEqual([{ providerId: "p_1", model: "gpt-4.1" }]);
    expect(assistant.transcribe).toEqual({ providerId: "p_1", model: "whisper-1" });
    expect(modelFor("200", "chat").model).toBe("gpt-4.1");
    expect(modelFor("200", "transcribe", { fallback: false }).model).toBe("whisper-1");
    // Перенос — один раз: сняли модель у ассистента, таблица её не воскрешает.
    updateAgent("200", "assistant", { models: [] });
    expect(settingsView("200").agents[0].models).toEqual([]);
    expect(settingsView("200").tasks.chat).toEqual({ providerId: "p_1", model: "gpt-4.1" });
  });

  it("перенос из .env кладёт выбранную модель и в коллекцию ассистента", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-openai-0123456789";
    process.env.OWNER_TELEGRAM_ID = "100";
    const view = settingsView("100");
    expect(view.agents[0].models).toEqual([{ providerId: view.providers[0].id, model: "gpt-4o-mini" }]);
  });
});
