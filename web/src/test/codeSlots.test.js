import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Ключ — под id Telegram-аккаунта (владелец, 2026-09-22): хранилище
   устройства одно на все аккаунты, и чужой ключ не должен подхватываться.
   Сохранённый раньше без id забирает только его аккаунт. */
const KEY = "ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789";
const EXP = Math.floor(Date.now() / 1000) + 3600;
let status;
const asAccount = (id) => { window.Telegram = { WebApp: { initData: `sig${id}`, initDataUnsafe: { user: { id } } } }; };
const load = async () => { vi.resetModules(); return import("../codes.js"); };

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  status = 200;
  global.fetch = vi.fn(async (_url, opts) => ({ ok: status < 400, status,
    json: async () => (status < 400 ? { uid: "u1", plan: "free", token: "t.t", exp: EXP, body: JSON.parse(opts.body) }
      : { error: "ключ другого аккаунта" }) }));
});
afterEach(() => { delete window.Telegram; delete global.fetch; });

describe("ключ по аккаунтам", () => {
  it("ключ одного аккаунта не виден другому", async () => {
    asAccount(1);
    const c = await load();
    await c.loginWithKey(KEY);
    expect(c.savedKey()).toBe(KEY);
    expect(localStorage.getItem("sd_code_key:1")).toBe(KEY);
    asAccount(2);
    expect(c.savedKey()).toBe("");
    expect(c.codeToken()).toBe("");
    expect(await c.ensureToken()).toBe("");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("старый ключ: чужой аккаунт получает отказ и ключ остаётся, свой — забирает", async () => {
    localStorage.setItem("sd_code_key", KEY);
    asAccount(2);
    status = 409;
    let c = await load();
    expect(await c.ensureToken()).toBe("");
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent).toEqual({ key: KEY, adopt: true });
    expect(localStorage.getItem("sd_code_key")).toBe(KEY);
    expect(c.savedKey()).toBe("");
    asAccount(1);
    status = 200;
    c = await load();
    expect(await c.ensureToken()).toBe("t.t");
    expect(localStorage.getItem("sd_code_key")).toBeNull();
    expect(localStorage.getItem("sd_code_key:1")).toBe(KEY);
  });
});
