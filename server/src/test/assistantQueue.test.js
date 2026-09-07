import { describe, expect, it } from "vitest";
import {
  MAX_CLIENT_CONTEXT, STALE_ERROR, SYSTEM_PROMPT, TTL_MS, WAITED_ERROR, createQueue,
} from "../lib/assistantQueue.js";
import { NOT_CONFIGURED } from "../lib/assistantSettings.js";

/* Вопрос — в два шага: положить и спрашивать ответ. Очередь живёт в
   памяти, ответ — три минуты, обрабатывается по одному, контекст
   собирается в момент обработки. */

const tick = () => new Promise((r) => setTimeout(r, 0));
const settled = async (q, id, user) => {
  for (let i = 0; i < 50; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await tick();
    const st = q.find(id, user);
    if (st && st.status !== "pending") return st;
  }
  return q.find(id, user);
};

function make(over = {}) {
  const calls = [];
  let t = 1_000_000;
  const q = createQueue({
    now: () => t,
    currentSettings: () => ({ provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test-0123456789" }),
    contextFor: async (userId) => `## Задачи\nзадачи пользователя ${userId}`,
    complete: async (p) => { calls.push(p); return `ответ для ${p.messages[0].content}`; },
    log: () => {},
    ...over,
  });
  return { q, calls, advance: (ms) => { t += ms; } };
}

describe("очередь вопросов", () => {
  it("два шага: положить → pending → done с текстом", async () => {
    const { q, calls } = make();
    const { id } = q.ask({ userId: "200", question: "что у меня сегодня?" });
    expect(id).toBeTruthy();
    expect(q.find(id, "200")).toEqual({ status: "pending" });
    const st = await settled(q, id, "200");
    expect(st).toEqual({ status: "done", text: "ответ для что у меня сегодня?" });
    // Системная подсказка по-русски, контекст спрашивающего внутри.
    expect(calls[0].system).toContain(SYSTEM_PROMPT);
    expect(calls[0].system).toContain("задачи пользователя 200");
    expect(calls[0].provider).toBe("openai");
    expect(calls[0].messages).toEqual([{ role: "user", content: "что у меня сегодня?" }]);
  });

  it("ответ отдаётся только тому, кто спросил", async () => {
    const { q } = make();
    const { id } = q.ask({ userId: "200", question: "?" });
    await settled(q, id, "200");
    expect(q.find(id, "300")).toBeNull();
    expect(q.find("нет-такого", "200")).toBeNull();
  });

  it("через три минуты ответ забыт", async () => {
    const { q, advance } = make();
    const { id } = q.ask({ userId: "200", question: "?" });
    await settled(q, id, "200");
    advance(TTL_MS - 1);
    expect(q.find(id, "200").status).toBe("done");
    advance(2);
    expect(q.find(id, "200")).toBeNull();
    expect(q.size()).toBe(0);
  });

  it("не настроен — ошибка теми самыми словами, модель не вызывается", async () => {
    const { q, calls } = make({ currentSettings: () => null });
    const { id } = q.ask({ userId: "200", question: "?" });
    const st = await settled(q, id, "200");
    expect(st).toEqual({ status: "error", error: NOT_CONFIGURED });
    expect(calls).toHaveLength(0);
  });

  it("ошибка провайдера — словами в статусе, а не 500", async () => {
    const { q } = make({ complete: async () => { throw new Error("OpenAI ответил 401: bad key"); } });
    const { id } = q.ask({ userId: "200", question: "?" });
    const st = await settled(q, id, "200");
    expect(st).toEqual({ status: "error", error: "OpenAI ответил 401: bad key" });
  });

  it("непозванный — контекст не собрался, и это тоже слова", async () => {
    const { q } = make({ contextFor: async () => { throw new Error("Вас ещё не звали в модель"); } });
    const { id } = q.ask({ userId: "777", question: "?" });
    expect((await settled(q, id, "777")).error).toMatch(/не звали/);
  });

  it("контекст собирается в момент обработки, а не постановки", async () => {
    let calls = 0;
    let release;
    const first = new Promise((r) => { release = r; });
    const { q } = make({
      contextFor: async () => { calls += 1; return "ctx"; },
      complete: async (p) => { if (p.messages[0].content === "1") await first; return "ok"; },
    });
    q.ask({ userId: "200", question: "1" });
    const second = q.ask({ userId: "200", question: "2" });
    await tick();
    // Второй вопрос лежит в очереди, и его контекст ещё не собирался:
    // права проверятся тогда, когда до него дойдёт дело.
    expect(calls).toBe(1);
    release();
    await settled(q, second.id, "200");
    expect(calls).toBe(2);
  });

  it("что человек прислал с вопросом — добавляется к контексту, но ограничено", async () => {
    const { q, calls } = make();
    const { id } = q.ask({ userId: "200", question: "?", context: "блок: " + "x".repeat(MAX_CLIENT_CONTEXT * 2) });
    await settled(q, id, "200");
    expect(calls[0].system).toContain("Что человек прислал вместе с вопросом");
    expect(calls[0].system.length).toBeLessThan(MAX_CLIENT_CONTEXT + 3000);
  });

  it("по одному: второй вопрос ждёт первого", async () => {
    const order = [];
    let release;
    const first = new Promise((r) => { release = r; });
    const { q } = make({
      complete: async (p) => {
        order.push(`start ${p.messages[0].content}`);
        if (p.messages[0].content === "1") await first;
        order.push(`end ${p.messages[0].content}`);
        return "ok";
      },
    });
    const a = q.ask({ userId: "200", question: "1" });
    const b = q.ask({ userId: "200", question: "2" });
    await tick(); await tick();
    expect(order).toEqual(["start 1"]);
    release();
    await settled(q, b.id, "200");
    expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"]);
    expect(q.find(a.id, "200").status).toBe("done");
  });

  it("askNow — тот же путь, но ответ на месте; отказ — исключением", async () => {
    const { q } = make();
    expect(await q.askNow("200", "как дела?")).toBe("ответ для как дела?");
    const bad = make({ currentSettings: () => null });
    await expect(bad.q.askNow("200", "?")).rejects.toThrow(NOT_CONFIGURED);
  });

  it("пустой вопрос не принимается", () => {
    const { q } = make();
    expect(() => q.ask({ userId: "200", question: "   " })).toThrow(/required/);
  });
});

/* ─── ничто не ждёт вечно ───

   Бот ждёт обещание askNow, и на нём стоял весь цикл опроса: вопрос,
   до которого очередь не дошла за TTL, стирался sweep'ом молча, обещание
   не завершалось никогда. Теперь у каждого пути есть конец словами. */
describe("очередь не молчит и не виснет", () => {
  it("не начатый вопрос, пролежавший дольше TTL, завершается ошибкой словами, а не стирается", async () => {
    let release;
    const first = new Promise((r) => { release = r; });
    const { q, advance } = make({
      complete: async (p) => { if (p.messages[0].content === "1") await first; return "ok"; },
    });
    const a = q.ask({ userId: "200", question: "1" });     // занял очередь
    const waiting = q.askNow("200", "2");                   // ждёт за ним
    await tick();
    advance(TTL_MS + 1);
    // Опрос из приложения дёргает sweep — раньше он и стирал ждущий вопрос.
    q.find("нет-такого", "200");
    await expect(waiting).rejects.toThrow(STALE_ERROR);
    release();
    // Первый доделан и ещё три минуты доступен приложению; второй не ожил.
    expect((await settled(q, a.id, "200")).status).toBe("done");
    expect(q.size()).toBe(1);
  });

  it("начатый вопрос sweep не трогает: приложение видит «pending», а не «не найдено»", async () => {
    let release;
    const first = new Promise((r) => { release = r; });
    const { q, advance } = make({ complete: async () => { await first; return "ok"; } });
    const { id } = q.ask({ userId: "200", question: "?" });
    await tick();
    advance(TTL_MS + 1);
    expect(q.find(id, "200")).toEqual({ status: "pending" });
    release();
    expect((await settled(q, id, "200")).status).toBe("done");
  });

  it("модель молчит дольше предела — ошибка словами, и очередь идёт дальше", async () => {
    const { q } = make({
      answerTimeoutMs: 20,
      complete: async (p) => {
        if (p.messages[0].content === "1") await new Promise(() => {});   // никогда
        return "ok";
      },
    });
    const a = q.ask({ userId: "200", question: "1" });
    const b = q.ask({ userId: "200", question: "2" });
    const stB = await settled(q, b.id, "200");
    expect(stB).toEqual({ status: "done", text: "ok" });
    expect(q.find(a.id, "200")).toMatchObject({ status: "error", error: expect.stringMatching(/не ответила/) });
  });

  it("askNow не висит дольше TTL, даже если модель молчит", async () => {
    const { q } = make({
      ttlMs: 30, answerTimeoutMs: 60_000,
      complete: async () => { await new Promise(() => {}); },
    });
    await expect(q.askNow("200", "?")).rejects.toThrow(WAITED_ERROR);
  });
});
