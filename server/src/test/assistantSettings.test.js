import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  KEY_VARS, currentFor, isConfigured, readSettings, saveSettings, settingsView,
} from "../lib/assistantSettings.js";
import { DEFAULT_MODELS } from "../lib/aiProviders.js";

/* Провайдер, модель и ключи живут в .env через envStore. Главное, что
   проверяется: ключ не уходит наружу ни в каком виде — только «есть/нет». */

const VARS = ["AI_PROVIDER", "AI_MODEL", ...Object.values(KEY_VARS)];
let tmp;
let n = 0;

beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sd-ai-")); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
afterEach(() => { VARS.forEach((v) => delete process.env[v]); });

const envFile = () => path.join(tmp, `env-${n += 1}`);

describe("настройки помощника", () => {
  it("ничего не выбрано — так и сказано, а не подставлен первый попавшийся", () => {
    expect(readSettings({})).toEqual({ provider: "", model: "" });
    expect(settingsView({})).toEqual({
      provider: "", model: "",
      hasKey: { openai: false, claude: false, hf: false },
      defaults: DEFAULT_MODELS,
    });
    expect(isConfigured({})).toBe(false);
  });

  it("сохранение кладёт провайдера, модель и ключ в .env и в процесс", () => {
    const f = envFile();
    const view = saveSettings({ provider: "claude", model: "claude-opus-4-1", key: "sk-ant-abcdef0123" }, f);
    const body = fs.readFileSync(f, "utf8");
    expect(body).toMatch(/^AI_PROVIDER=claude$/m);
    expect(body).toMatch(/^AI_MODEL=claude-opus-4-1$/m);
    expect(body).toMatch(/^ANTHROPIC_API_KEY=sk-ant-abcdef0123$/m);
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-abcdef0123");
    expect(view.provider).toBe("claude");
    expect(view.hasKey.claude).toBe(true);
    expect(view.hasKey.openai).toBe(false);
  });

  it("ключ наружу не уходит никогда — даже строкой внутри ответа", () => {
    saveSettings({ provider: "openai", key: "sk-openai-verysecret-123" }, envFile());
    const json = JSON.stringify(settingsView());
    expect(json).not.toContain("verysecret");
    expect(json).toContain("\"hasKey\"");
  });

  it("пустой ключ в форме значит «не трогать», а не «стереть»", () => {
    const f = envFile();
    saveSettings({ provider: "hf", key: "hf_abcdefghijk" }, f);
    saveSettings({ provider: "hf", model: "mistralai/Mistral-7B-Instruct-v0.3", key: "" }, f);
    expect(process.env.HF_API_KEY).toBe("hf_abcdefghijk");
    expect(readSettings().model).toBe("mistralai/Mistral-7B-Instruct-v0.3");
  });

  it("ключи трёх провайдеров хранятся порознь: переключение назад не теряет ключ", () => {
    const f = envFile();
    saveSettings({ provider: "openai", key: "sk-openai-0123456789" }, f);
    saveSettings({ provider: "claude", key: "sk-ant-0123456789" }, f);
    const view = settingsView();
    expect(view.hasKey).toEqual({ openai: true, claude: true, hf: false });
    saveSettings({ provider: "openai" }, f);
    expect(currentFor().apiKey).toBe("sk-openai-0123456789");
  });

  it("модель по умолчанию подставляется только при вызове модели, а не в настройки", () => {
    saveSettings({ provider: "openai", key: "sk-openai-0123456789" }, envFile());
    expect(readSettings().model).toBe("");
    expect(currentFor().model).toBe(DEFAULT_MODELS.openai);
  });

  it("не настроен — когда нет провайдера ИЛИ нет ключа у выбранного", () => {
    process.env.AI_PROVIDER = "claude";
    process.env.OPENAI_API_KEY = "sk-openai-0123456789";
    expect(isConfigured()).toBe(false);
    process.env.ANTHROPIC_API_KEY = "sk-ant-0123456789";
    expect(isConfigured()).toBe(true);
  });

  it("неизвестный провайдер, ключ с переводом строки и странная модель отклоняются", () => {
    const f = envFile();
    expect(() => saveSettings({ provider: "gemini" }, f)).toThrow(/must be one of/);
    expect(() => saveSettings({ provider: "openai", key: "sk-abc\nTURN_SECRET=x" }, f))
      .toThrow(/looks wrong/);
    expect(() => saveSettings({ provider: "openai", model: "gpt 4o;rm -rf" }, f))
      .toThrow(/looks wrong/);
    // Ничего из этого в файл не попало.
    expect(fs.existsSync(f)).toBe(false);
  });
});
