import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  KEY_VARS, NOT_CONFIGURED, TASKS, addProvider, fromLegacyEnv, modelFor,
  providerFor, readUserSettings, removeProvider, setTasks, settingsView, updateProvider,
  writeUserSettings,
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
    expect(readUserSettings("200")).toEqual({ providers: [],
      tasks: { chat: null, space: null, bot: null, transcribe: null } });
    expect(settingsView("200").providers).toEqual([]);
    expect(modelFor("200", "chat")).toBeNull();
    expect(NOT_CONFIGURED).toMatch(/добавьте провайдера/);
    expect(TASKS.map((t) => t.id)).toEqual(["chat", "space", "bot", "transcribe"]);
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
    expect(settingsView("200").tasks).toEqual({ chat: null, space: null, bot: { providerId: q.id, model: "gpt-4o" }, transcribe: null });
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
    expect(tasks).toEqual({ chat: { providerId: p.id, model: "gpt-4.1" }, space: null, bot: null,
      transcribe: { providerId: p.id, model: "gpt-4o-mini" } });
    expect(setTasks("200", { chat: null }).chat).toBeNull();
  });

  it("modelFor: своя строка → строка chat → первый провайдер с ключом и первой моделью → null", () => {
    const p = withModels("200", { name: "Мой OpenAI" });
    // Ничего не выбрано — первый провайдер, первая модель.
    expect(modelFor("200", "space")).toEqual({ kind: "openai", baseUrl: "https://api.openai.com/v1",
      key: KEY, model: "gpt-4.1", providerName: "Мой OpenAI" });
    setTasks("200", { chat: { providerId: p.id, model: "gpt-4o-mini" } });
    // Своей строки нет — берётся chat.
    expect(modelFor("200", "space").model).toBe("gpt-4o-mini");
    expect(modelFor("200", "неизвестная задача").model).toBe("gpt-4o-mini");
    const q = withModels("200", { name: "Claude", kind: "anthropic" }, ["claude-sonnet-4-5"]);
    setTasks("200", { space: { providerId: q.id, model: "claude-sonnet-4-5" } });
    // Своя строка — она.
    expect(modelFor("200", "space")).toMatchObject({ kind: "anthropic", model: "claude-sonnet-4-5", providerName: "Claude" });
    expect(modelFor("200", "bot").model).toBe("gpt-4o-mini");
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
