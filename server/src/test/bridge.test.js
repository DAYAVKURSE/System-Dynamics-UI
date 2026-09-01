import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  answer, ask, chunk, find, pending, requeueStale, resetBridge, sameSecret,
  takeAnswered, takeNext,
} from "../lib/bridgeStore.js";
import { handleUpdate, resetBridgeMode, resetPending } from "../lib/bot.js";
import * as org from "../lib/orgStore.js";
import * as bridge from "../lib/bridgeStore.js";

/* Очередь моста, доступ воркера и команда бота. */

let app, tmp, prev;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-bridge-"));
  prev = { token: process.env.BRIDGE_TOKEN };
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.BRIDGE_TOKEN = "worker-secret-123";
  const { createApp } = await import("../app.js");
  app = createApp();
});
afterAll(async () => {
  if (prev.token === undefined) delete process.env.BRIDGE_TOKEN;
  else process.env.BRIDGE_TOKEN = prev.token;
  await fs.rm(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  delete process.env.OWNER_TELEGRAM_ID;
  await fs.rm(process.env.ORG_DIR, { recursive: true, force: true });
  resetBridge(); resetPending(); resetBridgeMode();
});

describe("очередь", () => {
  it("вопрос получает id, по которому придёт ответ", () => {
    const item = ask({ text: "что в логах?", from: "100", chatId: "100" });
    expect(item.id).toMatch(/^[0-9a-f]{16}$/);
    expect(item.status).toBe("pending");
    expect(find(item.id).text).toBe("что в логах?");
  });

  it("пустой вопрос не принимается", () => {
    expect(() => ask({ text: "   ", from: "100" })).toThrow(/required/);
  });

  it("слишком длинный вопрос отвергается, а не режется молча", () => {
    expect(() => ask({ text: "я".repeat(9000), from: "100" })).toThrow(/at most/);
  });

  it("взятый в работу второй раз не выдаётся", () => {
    ask({ text: "первый", from: "100" });
    expect(takeNext().text).toBe("первый");
    expect(takeNext()).toBeNull();
  });

  it("берётся самый старый вопрос — порядок ответов совпадает с порядком вопросов", () => {
    ask({ text: "первый", from: "100" });
    ask({ text: "второй", from: "100" });
    expect(takeNext().text).toBe("первый");
    expect(takeNext().text).toBe("второй");
  });

  it("ответ помечает вопрос отвеченным и запоминает сессию", () => {
    const item = ask({ text: "вопрос", from: "100", chatId: "100" });
    takeNext();
    const done = answer(item.id, { text: "ответ", sid: "sess-1" });
    expect(done.status).toBe("done");
    expect(done.answer).toBe("ответ");
    expect(done.sid).toBe("sess-1");
  });

  it("ответ на несуществующий вопрос — ничего, а не тихий успех", () => {
    expect(answer("нет-такого", { text: "ответ" })).toBeNull();
  });

  it("зависший в работе вопрос возвращается в очередь", () => {
    const t0 = Date.now();
    ask({ text: "вопрос", from: "100" }, t0);
    takeNext(t0);
    expect(pending()).toBe(0);
    // Воркер упал посреди ответа — через десять минут вопрос снова ничей.
    expect(requeueStale(600000, t0 + 700000)).toBe(1);
    expect(pending()).toBe(1);
  });

  it("отвеченное отдаётся на отправку один раз", () => {
    const item = ask({ text: "вопрос", from: "100", chatId: "100" });
    takeNext();
    answer(item.id, { text: "ответ" });
    expect(takeAnswered().map((q) => q.id)).toEqual([item.id]);
    // Второй раз тот же ответ в чат не уйдёт.
    expect(takeAnswered()).toEqual([]);
  });
});

describe("длинный ответ", () => {
  it("короткий не режется", () => {
    expect(chunk("привет")).toEqual(["привет"]);
  });

  it("длинный режется по границе абзаца, а не посреди строки", () => {
    const para = "строка ".repeat(200);
    const parts = chunk(`${para}\n\n${para}`, 1500);
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((p) => expect(p.length).toBeLessThanOrEqual(1500));
    // Склеенное обратно даёт тот же текст с точностью до переносов.
    expect(parts.join("\n").replace(/\s+/g, " ").trim())
      .toBe(`${para}\n\n${para}`.replace(/\s+/g, " ").trim());
  });

  it("текст без переносов режется по длине, а не теряется", () => {
    const parts = chunk("я".repeat(5000), 1000);
    expect(parts.join("")).toHaveLength(5000);
  });
});

describe("секрет воркера", () => {
  it("годится только латиница: кириллицу заголовок HTTP не несёт", async () => {
    const { asciiSecret } = await import("../lib/bridgeStore.js");
    expect(asciiSecret("worker-secret-123")).toBe(true);
    expect(asciiSecret("секрет-воркера")).toBe(false);
    expect(asciiSecret("short")).toBe(false);
  });

  it("совпадает только сам с собой", () => {
    expect(sameSecret("абв", "абв")).toBe(true);
    expect(sameSecret("абв", "абг")).toBe(false);
    expect(sameSecret("абв", "абвг")).toBe(false);
    expect(sameSecret("", "")).toBe(false);      // пустой секрет — не секрет
    expect(sameSecret("абв", undefined)).toBe(false);
  });

  it("без секрета воркер не получает вопросов", async () => {
    expect((await request(app).get("/api/bridge/next?wait=0")).status).toBe(401);
    expect((await request(app).get("/api/bridge/next?wait=0")
      .set("X-Bridge-Token", "wrong-secret-999")).status).toBe(401);
  });

  it("с секретом получает — и отвечает", async () => {
    const item = ask({ text: "вопрос", from: "100", chatId: "100" });
    const got = await request(app).get("/api/bridge/next?wait=0")
      .set("X-Bridge-Token", "worker-secret-123");
    expect(got.status).toBe(200);
    expect(got.body.id).toBe(item.id);
    expect(got.body.text).toBe("вопрос");

    const posted = await request(app).post(`/api/bridge/${item.id}/answer`)
      .set("X-Bridge-Token", "worker-secret-123")
      .send({ text: "ответ" });
    expect(posted.status).toBe(200);
    expect(posted.body.chatId).toBe("100");
    expect(find(item.id).answer).toBe("ответ");
  });

  it("пустая очередь отвечает пустым, а не висит вечно", async () => {
    const got = await request(app).get("/api/bridge/next?wait=0")
      .set("X-Bridge-Token", "worker-secret-123");
    expect(got.body.id).toBeNull();
  });
});

describe("команда бота", () => {
  const sent = [];
  const deps = {
    org, bridge,
    send: async (chatId, text) => { sent.push({ chatId, text }); },
    answer: async () => {},
  };
  const owner = { id: 100, first_name: "Владелец" };
  const guest = { id: 777, first_name: "Чужой" };
  const msg = (from, text) => ({ update_id: 1, message: { from, text } });
  const last = () => sent[sent.length - 1]?.text || "";

  beforeEach(async () => {
    sent.length = 0;
    await org.identify("100", { name: "Владелец" });
  });

  it("«/claude вопрос» кладёт вопрос в очередь", async () => {
    await handleUpdate(msg(owner, "/claude что в логах?"), deps);
    expect(pending()).toBe(1);
    expect(takeNext().text).toBe("что в логах?");
    expect(last()).toMatch(/Передал в Claude Code/);
  });

  it("посторонний до моста не достаёт", async () => {
    await handleUpdate(msg(guest, "/claude покажи секреты"), deps);
    expect(pending()).toBe(0);
    expect(last()).toMatch(/только владельцу/);
  });

  it("«/claude» без текста включает режим, и дальше идёт каждое сообщение", async () => {
    await handleUpdate(msg(owner, "/claude"), deps);
    expect(last()).toMatch(/Режим Claude Code включён/);
    expect(pending()).toBe(0);

    await handleUpdate(msg(owner, "а теперь поправь тест"), deps);
    expect(pending()).toBe(1);
    expect(takeNext().text).toBe("а теперь поправь тест");
  });

  it("«/stop» выключает режим, и обычные сообщения снова свои", async () => {
    await handleUpdate(msg(owner, "/claude"), deps);
    await handleUpdate(msg(owner, "/stop"), deps);
    expect(last()).toMatch(/выключен/);
    await handleUpdate(msg(owner, "привет"), deps);
    expect(pending()).toBe(0);
    expect(last()).toMatch(/Перешлите мне сообщение/);
  });

  it("вне режима обычное сообщение в мост не уходит", async () => {
    await handleUpdate(msg(owner, "привет"), deps);
    expect(pending()).toBe(0);
  });

  it("без включённого моста команда не перехватывается", async () => {
    await handleUpdate(msg(owner, "/claude вопрос"), { ...deps, bridge: null });
    expect(pending()).toBe(0);
    expect(last()).toMatch(/Перешлите мне сообщение/);
  });

  it("в режиме моста пересылка всё ещё зовёт человека, а не уходит в Claude", async () => {
    await handleUpdate(msg(owner, "/claude"), deps);
    await handleUpdate({ update_id: 2, message: { from: owner,
      forward_from: { id: 200, first_name: "Иван" } } }, deps);
    expect(pending()).toBe(0);
    expect(last()).toMatch(/Выберите роль/);
  });
});
