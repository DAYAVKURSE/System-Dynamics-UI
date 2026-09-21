import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REGISTRY, listRegistry, registryUrl } from "../lib/mcpRegistry.js";
import { skillNote } from "../lib/assistantAgent.js";

/* ════════════════════════════════════════════════════════════════
   РЕЕСТР MCP И ИНСТРУКЦИЯ-СКИЛЛ (владелец, 2026-09-20)

   «Сделай, чтобы у меня был просто добавлен MCP registry, и на форме
   MCP-серверов я видел список доступных серверов и мог обновить»;
   «введённая инструкция должна применяться как скилл».

   У реестра проверяем главное: берутся только те серверы, к которым
   приложение может подключиться САМО, и всё чужое режется по длине.
   ════════════════════════════════════════════════════════════════ */

const urls = [];
const reply = (body, ok = true, status = null) => {
  urls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    urls.push(String(url));
    return { ok, status: status || (ok ? 200 : 503), json: async () => body };
  }));
};
afterEach(() => { vi.restoreAllMocks(); delete process.env.MCP_REGISTRY_URL; });

describe("реестр MCP", () => {
  it("адрес по умолчанию — общий реестр, и его можно сменить", () => {
    expect(registryUrl()).toBe(DEFAULT_REGISTRY);
    process.env.MCP_REGISTRY_URL = "https://свой.реестр/";
    expect(registryUrl()).toBe("https://свой.реестр");
  });

  it("берёт только то, к чему можно подключиться, и чистит чужие данные", async () => {
    reply({ servers: [
      { server: { name: "io.github.x/weather", title: "weather", description: "погода",
        version: "1.2.3", repository: { url: "https://github.com/x/weather" },
        remotes: [{ type: "streamable-http", url: "https://x/mcp" }] },
      _meta: { "io.modelcontextprotocol.registry/official": { status: "active" } } },
      // Снятое с публикации не показывается: «Добавить» под ним лгало бы.
      { server: { name: "io.github.z/gone",
        remotes: [{ type: "streamable-http", url: "https://z/mcp" }] },
      _meta: { "io.modelcontextprotocol.registry/official": { status: "deleted" } } },
      // Ставится пакетом и запускается у себя — подключиться нечем.
      { server: { name: "io.github.y/local", description: "локальный",
        packages: [{ registryType: "npm", identifier: "y" }] } },
      // Повтор той же записи — одной строкой.
      { server: { name: "io.github.x/weather",
        remotes: [{ type: "sse", url: "https://x/mcp" }] } },
    ] });
    const r = await listRegistry();
    expect(r.servers).toHaveLength(1);
    expect(r.servers[0]).toMatchObject({
      name: "weather", full: "io.github.x/weather", description: "погода",
      url: "https://x/mcp", transport: "streamable-http",
      repo: "https://github.com/x/weather", version: "1.2.3",
    });
  });

  it("реестр молчит — это ответ, а не пустой список", async () => {
    reply({}, false);
    await expect(listRegistry()).rejects.toThrow(/503/);
  });

  /* СТРАНИЦА — СТО (владелец, 2026-09-21: «MCP-сервер выдаёт ошибку при
     нажатии „Обновить": Реестр ответил 422»). Реестр отдаёт не больше
     сотни за раз и на просьбу о большем отвечает отказом; нужное число
     набирается курсором. */
  it("просит не больше ста за раз и идёт по курсору за остальными", async () => {
    const srv = (n) => ({ server: { name: `io.x/s${n}`, title: `s${n}`,
      remotes: [{ type: "streamable-http", url: `https://x/${n}` }] } });
    const pages = [
      { servers: Array.from({ length: 100 }, (_, i) => srv(i)),
        metadata: { nextCursor: "io.x/s99" } },
      { servers: [srv(100)], metadata: {} },
    ];
    let n = 0;
    urls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      urls.push(String(url));
      const body = pages[Math.min(n, pages.length - 1)];
      n += 1;
      return { ok: true, status: 200, json: async () => body };
    }));
    const r = await listRegistry();
    expect(urls).toHaveLength(2);
    urls.forEach((u) => expect(u).toMatch(/limit=100(&|$)/));
    expect(urls[0]).not.toMatch(/cursor=/);
    expect(urls[1]).toMatch(/cursor=io\.x%2Fs99/);
    expect(r.servers).toHaveLength(101);
  });

  it("отказ реестра пересказывается его же словами, а не одним номером", async () => {
    reply({ title: "Unprocessable Entity", detail: "validation failed" }, false, 422);
    await expect(listRegistry()).rejects.toThrow(/422: validation failed/);
  });
});

describe("инструкция агента — скилл", () => {
  it("пустая ничего не добавляет, заполненная становится разделом подсказки", () => {
    expect(skillNote("")).toBe("");
    expect(skillNote("   ")).toBe("");
    expect(skillNote(" Отвечай кратко ")).toBe("# Инструкция\nОтвечай кратко");
  });
});
