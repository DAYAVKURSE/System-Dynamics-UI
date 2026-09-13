import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MAX_MEMORY_ITEMS, MAX_MEMORY_TEXT, addMemory, listMemory, removeMemory,
} from "../lib/memoryStore.js";
import { listReports } from "../lib/reportStore.js";

/* Память помощника — только своя. Файлы ложатся в то же хранилище, что и
   файлы отчётов, а здесь остаётся ссылка. */

let tmp;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-memory-"));
  process.env.MEMORY_DIR = path.join(tmp, "memory");
  process.env.REPORTS_DIR = path.join(tmp, "reports");
});
afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
beforeEach(async () => {
  await fs.rm(process.env.MEMORY_DIR, { recursive: true, force: true });
  await fs.rm(process.env.REPORTS_DIR, { recursive: true, force: true });
});

describe("память помощника", () => {
  it("текст запоминается, название берётся из первой строки, если не названо", async () => {
    const m = await addMemory("200", { text: "Клиент просил счёт до пятницы.\nПодробности в письме." });
    expect(m.title).toBe("Клиент просил счёт до пятницы.");
    expect(m.text).toContain("Подробности");
    expect(m.file).toBeNull();
    expect(m.at).toBeTruthy();
    const list = await listMemory("200");
    expect(list.map((x) => x.id)).toEqual([m.id]);
  });

  it("только своё: чужая память не читается и не стирается даже по id", async () => {
    const mine = await addMemory("200", { title: "моё", text: "секрет" });
    await addMemory("300", { title: "чужое", text: "чужой секрет" });
    expect((await listMemory("200")).map((x) => x.title)).toEqual(["моё"]);
    expect((await listMemory("300")).map((x) => x.title)).toEqual(["чужое"]);
    expect(await removeMemory("300", mine.id)).toBe(false);
    expect((await listMemory("200")).length).toBe(1);
    expect((await listMemory("999")).length).toBe(0);
  });

  it("файл уходит в хранилище отчётов с меткой memory, а в записи остаётся ссылка", async () => {
    const m = await addMemory("200", {
      title: "договор",
      file: { name: "договор.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-1.4 ...") },
    });
    expect(m.file.name).toBe("договор.pdf");
    expect(m.file.url).toMatch(/^\/api\/reports\/[a-f0-9]{32}\//);
    expect(m.file.size).toBe(12);
    // Текста у PDF нет — и запись этого не скрывает.
    expect(m.text).toBe("");
    const files = await listReports("200", { kind: "memory" });
    expect(files).toHaveLength(1);
    expect(files[0].url).toBe(m.file.url);
    // Наружу не уходит внутренний id файла — только то, что нужно ссылке.
    expect(Object.keys(m.file).sort()).toEqual(["name", "size", "type", "url"]);
  });

  it("текстовый файл читается в запись: помощник понимает слова, а не байты", async () => {
    const m = await addMemory("200", {
      file: { name: "заметки.txt", type: "text/plain", bytes: Buffer.from("встреча в 15:00", "utf8") },
    });
    expect(m.text).toBe("встреча в 15:00");
    expect(m.title).toBe("встреча в 15:00");
  });

  it("удаление стирает и запись, и её файл", async () => {
    const m = await addMemory("200", {
      file: { name: "a.txt", type: "text/plain", bytes: Buffer.from("x") },
    });
    expect(await removeMemory("200", m.id)).toBe(true);
    expect(await listMemory("200")).toEqual([]);
    expect(await listReports("200", { kind: "memory" })).toEqual([]);
    expect(await removeMemory("200", m.id)).toBe(false);
  });

  it("пустая запись не заводится", async () => {
    await expect(addMemory("200", { title: "только название" })).rejects.toThrow(/required/);
  });

  it("длинный текст обрезается с пометкой, а не молча", async () => {
    const m = await addMemory("200", { text: "a".repeat(MAX_MEMORY_TEXT + 500) });
    expect(m.text.length).toBeLessThan(MAX_MEMORY_TEXT + 100);
    expect(m.text).toMatch(/текст обрезан/);
  });

  it("предел записей назван числом и соблюдается", async () => {
    await Promise.all(Array.from({ length: MAX_MEMORY_ITEMS },
      (_, i) => addMemory("200", { text: `запись ${i}` })));
    await expect(addMemory("200", { text: "лишняя" })).rejects.toThrow(/limit of 200/);
    expect((await listMemory("200")).length).toBe(MAX_MEMORY_ITEMS);
  });

  it("две одновременные записи не затирают друг друга", async () => {
    await Promise.all([addMemory("200", { text: "первая" }), addMemory("200", { text: "вторая" })]);
    expect((await listMemory("200")).map((m) => m.title).sort()).toEqual(["вторая", "первая"].sort());
  });
});

/* Память — у агента: без агента — ассистента, как было всегда. */
describe("память по агентам", () => {
  it("без агента — ассистент; прежние записи без поля читаются как его", async () => {
    const m = await addMemory("200", { text: "общее" });
    expect(m.agent).toBe("assistant");
    await fs.writeFile(path.join(process.env.MEMORY_DIR, "200.json"),
      JSON.stringify([{ id: "old", title: "старая", text: "до агентов", file: null, at: "2024-01-01T00:00:00.000Z" }]));
    const list = await listMemory("200");
    expect(list.map((x) => [x.id, x.agent])).toEqual([["old", "assistant"]]);
    expect(await listMemory("200", "assistant")).toEqual(list);
  });

  it("свой агент видит только своё, ассистент — своё; предел — на человека", async () => {
    await addMemory("200", { text: "ассистенту" });
    await addMemory("200", { text: "юристу", agent: "a_1" });
    await addMemory("200", { text: "юристу ещё", agent: "a_1" });
    expect((await listMemory("200")).map((m) => m.text)).toEqual(["ассистенту"]);
    expect((await listMemory("200", "a_1")).map((m) => m.text).sort()).toEqual(["юристу", "юристу ещё"]);
    expect(await listMemory("200", "a_2")).toEqual([]);
    await Promise.all(Array.from({ length: MAX_MEMORY_ITEMS - 3 },
      (_, i) => addMemory("200", { text: `запись ${i}`, agent: i % 2 ? "a_1" : "assistant" })));
    await expect(addMemory("200", { text: "лишняя", agent: "a_2" })).rejects.toThrow(/limit of 200/);
  });

  it("удаление — по id, чей бы агент ни был", async () => {
    const m = await addMemory("200", { text: "юристу", agent: "a_1" });
    expect(await removeMemory("200", m.id)).toBe(true);
    expect(await listMemory("200", "a_1")).toEqual([]);
  });
});
