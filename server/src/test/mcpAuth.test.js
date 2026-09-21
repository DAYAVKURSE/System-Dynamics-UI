import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { askedFrom, authHeader, listTools } from "../lib/mcp.js";
import { addMcp, mcpFor, setMcpAuth, settingsView } from "../lib/assistantSettings.js";

/* ════════════════════════════════════════════════════════════════
   ВХОД НА MCP-СЕРВЕР (владелец, 2026-09-21)

   «Ошибка при обновлении mcp-сервера… MCP-сервер ответил 401: он требует
   авторизации, а войти в него приложение пока не умеет. Вход должен
   появляться в виде модального окна… Ассистент или агент должен сам
   запрашивать логин и пароль в чате… если это требуется непосредственно
   при выполнении задачи».

   Здесь — серверная половина: заголовок из входа, отказ 401 отдельным
   признаком (а не текстом, по которому экран угадывал бы) и хранение
   входа так, чтобы ни ключ, ни пароль наружу не возвращались.
   ════════════════════════════════════════════════════════════════ */

let tmp;
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sd-mcpauth-")); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
beforeEach(() => {
  process.env.ASSISTANT_DIR = path.join(tmp, "assistant");
  process.env.ORG_DIR = path.join(tmp, "org");
  fs.rmSync(process.env.ASSISTANT_DIR, { recursive: true, force: true });
  fs.rmSync(process.env.ORG_DIR, { recursive: true, force: true });
});
afterEach(() => vi.restoreAllMocks());

describe("заголовок входа", () => {
  it("ключ — Bearer, логин с паролем — Basic, пусто — ничего", () => {
    expect(authHeader(null)).toEqual({});
    expect(authHeader({ kind: "none" })).toEqual({});
    expect(authHeader({ kind: "bearer", token: "sk-1" }))
      .toEqual({ Authorization: "Bearer sk-1" });
    expect(authHeader({ kind: "basic", login: "ivan", password: "s3cret" }))
      .toEqual({ Authorization: `Basic ${Buffer.from("ivan:s3cret", "utf8").toString("base64")}` });
    // Ключ пустой — заголовка нет: пустой Bearer сервер отвергнет тем же 401.
    expect(authHeader({ kind: "bearer", token: "" })).toEqual({});
  });
});

/* ЧЕМ ВХОДИТЬ — ГОВОРИТ СЕРВЕР (владелец, 2026-09-21: «ввод данных должен
   зависеть от того, что запросил сервер»). Всё — из `WWW-Authenticate`. */
describe("что запросил сервер", () => {
  it("Bearer — ключ; Basic и Digest — логин с паролем; OAuth — ключ со ссылкой", () => {
    expect(askedFrom('Bearer realm="api"')).toMatchObject({ scheme: "bearer", realm: "api", where: "" });
    expect(askedFrom('Basic realm="weather"')).toMatchObject({ scheme: "basic", realm: "weather" });
    expect(askedFrom('Digest realm="x", nonce="1"').scheme).toBe("basic");
    const o = askedFrom('Bearer resource_metadata="https://x/.well-known/oauth", scope="read"');
    expect(o.scheme).toBe("oauth");
    expect(o.where).toBe("https://x/.well-known/oauth");
    expect(askedFrom("OAuth realm=x").scheme).toBe("oauth");
  });
  it("сервер промолчал — схемы нет, а подсказка — дословно и не длиннее 300", () => {
    expect(askedFrom("")).toEqual({ scheme: "", realm: "", where: "", hint: "", said: "" });
    // Слова сервера (error_description) — отдельно от сырого заголовка.
    expect(askedFrom('Bearer realm="Blopus", error="invalid_token", error_description="Provide a Blopus API key as Authorization: Bearer blp_..."'))
      .toMatchObject({ scheme: "bearer", realm: "Blopus", said: "Provide a Blopus API key as Authorization: Bearer blp_..." });
    expect(askedFrom("Custom token").scheme).toBe("custom");
    expect(askedFrom(`Bearer ${"x".repeat(500)}`).hint).toHaveLength(300);
  });
});

describe("сервер требует входа", () => {
  const reply = (status, headers = {}) => {
    const sent = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
      sent.push({ url: String(url), headers: opts.headers || {} });
      return { ok: status < 400, status,
        headers: { get: (k) => headers[String(k).toLowerCase()] || null },
        json: async () => ({}), text: async () => "" };
    }));
    return sent;
  };

  it("401 — это развилка «нужен вход», а не поломка, и адрес входа берётся у сервера", async () => {
    reply(401, { "www-authenticate": 'Bearer realm="x", authorization_uri="https://x/login"' });
    const e = await listTools("https://x/mcp").then(() => null, (err) => err);
    expect(e?.needsAuth).toBe(true);
    expect(e.status).toBe(401);
    expect(e.where).toBe("https://x/login");
    expect(e.scheme).toBe("oauth");
    expect(e.realm).toBe("x");
    expect(e.message).toMatch(/401/);
  });

  it("403 — тот же признак: и то и другое значит «войдите»", async () => {
    reply(403);
    const e = await listTools("https://x/mcp").then(() => null, (err) => err);
    expect(e?.needsAuth).toBe(true);
    expect(e.where).toBe("");
  });

  it("вход уезжает к серверу заголовком", async () => {
    const sent = reply(500);
    await listTools("https://x/mcp", { auth: { kind: "bearer", token: "sk-1" } }).catch(() => {});
    expect(sent[0].headers.Authorization).toBe("Bearer sk-1");
  });
});

describe("вход хранится, но наружу не возвращается", () => {
  it("ключ лёг в запись, а на экран ушло только «каким входом»", () => {
    const m = addMcp("7", { name: "Погода", url: "https://x/mcp" });
    expect(m.auth).toBe("none");
    expect(m.hasAuth).toBe(false);

    const saved = setMcpAuth("7", m.id, { kind: "bearer", token: "sk-1" });
    expect(saved.auth).toBe("bearer");
    expect(saved.hasAuth).toBe(true);
    // Ни ключа, ни пароля в том, что уходит на экран, нет.
    expect(JSON.stringify(settingsView("7"))).not.toContain("sk-1");
    // А работать с сервером есть чем: полная запись вход отдаёт.
    expect(mcpFor("7", m.id).auth).toEqual({ kind: "bearer", token: "sk-1" });
  });

  it("логин с паролем — так же, и пустой вход отвергается словами", () => {
    const m = addMcp("8", { name: "Погода", url: "https://x/mcp" });
    setMcpAuth("8", m.id, { kind: "basic", login: "ivan", password: "s3cret" });
    expect(mcpFor("8", m.id).auth).toEqual({ kind: "basic", login: "ivan", password: "s3cret" });
    expect(JSON.stringify(settingsView("8"))).not.toContain("s3cret");
    expect(() => setMcpAuth("8", m.id, { kind: "bearer", token: "  " })).toThrow(/[Кк]люч/);
    // Чужого сервера нет: файл свой.
    expect(setMcpAuth("9", m.id, { kind: "bearer", token: "sk-2" })).toBe(null);
  });

  it("«вход больше не нужен» снимается тем же путём", () => {
    const m = addMcp("10", { name: "Погода", url: "https://x/mcp" });
    setMcpAuth("10", m.id, { kind: "bearer", token: "sk-1" });
    const off = setMcpAuth("10", m.id, { kind: "none" });
    expect(off.auth).toBe("none");
    expect(mcpFor("10", m.id).auth).toBe(null);
  });
});
