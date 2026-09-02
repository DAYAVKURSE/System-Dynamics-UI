import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftTask } from "../identity.js";

/* Черновик от Claude: поставить вопрос и опрашивать ответ короткими
   запросами. Один длинный запрос рвали nginx и WebView Telegram. */

const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
let calls, answers;

beforeEach(() => {
  calls = [];
  answers = [];
  global.fetch = vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || "GET" });
    if (opts.method === "POST") return ok({ id: "abc", status: "pending" }, 202);
    return ok(answers.shift() || { status: "pending" });
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("черновик задачи", () => {
  it("ставит вопрос и опрашивает, пока не готово", async () => {
    answers = [{ status: "pending" }, { status: "pending" }, { status: "done", text: "Сделать то-то." }];
    const text = await draftTask({ title: "Позвонить" }, { intervalMs: 1 });
    expect(text).toBe("Сделать то-то.");
    expect(calls[0]).toEqual({ url: "/api/workspace/draft", method: "POST" });
    expect(calls.filter((c) => c.method === "GET").map((c) => c.url))
      .toEqual(Array(3).fill("/api/workspace/draft/abc"));
  });

  it("ошибка воркера — исключение с его словами, не пустой текст", async () => {
    answers = [{ status: "error", error: "Claude Code на сервере ещё не вошёл" }];
    await expect(draftTask({}, { intervalMs: 1 })).rejects.toThrow(/не вошёл/);
  });

  it("таймаут сервера — тоже исключение", async () => {
    answers = [{ status: "timeout", error: "Claude не ответил вовремя — напишите текст сами" }];
    await expect(draftTask({}, { intervalMs: 1 })).rejects.toThrow(/не ответил вовремя/);
  });

  it("свой предел ожидания: молчание дольше него — исключение, опрос прекращается", async () => {
    answers = [];
    await expect(draftTask({}, { intervalMs: 1, timeoutMs: 0 })).rejects.toThrow(/не ответил вовремя/);
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });

  it("отмена останавливает опрос", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(draftTask({}, { intervalMs: 1, signal: ctl.signal })).rejects.toThrow(/отменено/);
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(0);
  });
});
