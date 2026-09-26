import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ТОКЕН ОБНОВЛЯЕТСЯ САМ (владелец, 2026-09-26: «code token is required»).
   Токен живёт час; открытое дольше приложение не должно упираться в отказ:
   почти истёкший токен обновляется перед запросом, а отказ «нужен токен»
   обновляет его и повторяет запрос один раз. */
const KEY = "ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789";
const load = async () => { vi.resetModules(); return import("../codes.js"); };
const res = (status, body) => ({ ok: status < 400, status, json: async () => body,
  clone() { return res(status, body); } });

let calls, api;
/* Сам токен сервис кодов отдаёт через тот же fetch, что и всё остальное. */
const win = () => { globalThis.fetch = vi.fn(async (url, init = {}) => {
  const tokHdr = init.headers ? new Headers(init.headers).get("X-User-Token") : null;
  calls.push({ url: String(url), token: tokHdr });
  if (String(url).startsWith("/api/codes/token")) {
    return res(200, { uid: "u1", plan: "free", token: `t${calls.length}`, exp: Math.floor(Date.now() / 1000) + 3600 });
  }
  return api(String(url), tokHdr);
}); return globalThis; };

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  window.Telegram = { WebApp: { initData: "sig1", initDataUnsafe: { user: { id: 1 } } } };
  calls = [];
  api = () => res(200, { ok: true });
});
afterEach(() => { delete window.Telegram; delete globalThis.fetch; });

describe("токен кода обновляется сам", () => {
  it("истёкший токен обновляется по ключу до запроса", async () => {
    localStorage.setItem("sd_code_key:1", KEY);
    localStorage.setItem("sd_code_token:1", JSON.stringify({ token: "old", exp: Date.now() - 1000 }));
    const c = await load();
    const w = win();
    c.installTokenRefresh(w);
    const r = await w.fetch("/api/market", { headers: { "X-Telegram-Init-Data": "x" } });
    expect(r.status).toBe(200);
    expect(calls.map((x) => x.url)).toEqual(["/api/codes/token", "/api/market"]);
    expect(calls[1].token).toBe("t1");
  });

  it("отказ «нужен токен» — новый токен и один повтор", async () => {
    localStorage.setItem("sd_code_key:1", KEY);
    localStorage.setItem("sd_code_token:1", JSON.stringify({ token: "stale", exp: Date.now() + 3600e3 }));
    const c = await load();
    const w = win();
    api = (url, tok) => (tok === "stale" ? res(401, { error: "code token is required", needsCode: true }) : res(200, { ok: true }));
    c.installTokenRefresh(w);
    const r = await w.fetch("/api/boards", {});
    expect(r.status).toBe(200);
    expect(calls.map((x) => [x.url, x.token])).toEqual([
      ["/api/boards", "stale"], ["/api/codes/token", null], ["/api/boards", "t2"]]);
  });

  it("без ключа запросы идут как шли; другой отказ не повторяется", async () => {
    const c = await load();
    const w = win();
    api = () => res(401, { error: "bad signature" });
    c.installTokenRefresh(w);
    expect((await w.fetch("/api/market")).status).toBe(401);
    localStorage.setItem("sd_code_key:1", KEY);
    localStorage.setItem("sd_code_token:1", JSON.stringify({ token: "ok", exp: Date.now() + 3600e3 }));
    expect((await w.fetch("/api/market")).status).toBe(401);
    expect(calls.map((x) => x.url)).toEqual(["/api/market", "/api/market"]);
  });
});
