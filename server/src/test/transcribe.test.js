import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_OPENAI_BASE, NO_MODEL, NOT_SUPPORTED, transcribeFile, transcribeRecording,
} from "../lib/transcribe.js";
import {
  createMeeting, dropTranscript, getMeeting, listTranscripts, putTranscript, transcriptFor,
} from "../lib/callStore.js";

/* ═══════════════════════════════════════════════════════════════
   РАСШИФРОВКА ЗАПИСЕЙ ЗВОНКОВ

   Проверяется то, что уходит в сеть (multipart-тело, адрес, ключ в
   заголовке) и что остаётся на диске: текст у файла и у встречи, ошибка
   словами, а без модели — ничего, кроме фразы в контексте.
   ═══════════════════════════════════════════════════════════════ */

let tmp;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-transcribe-"));
  process.env.CALLS_DIR = path.join(tmp, "calls");
});
afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
beforeEach(async () => { await fs.rm(process.env.CALLS_DIR, { recursive: true, force: true }); });

const KEY = "sk-secret-key-1234";
const ok = (body) => ({ ok: true, status: 200, text: async () => body });
const fail = (status, body) => ({ ok: false, status, text: async () => body });
const file = (over = {}) => ({
  kind: "openai", baseUrl: "", key: KEY, model: "whisper-1",
  bytes: Buffer.from("webm-bytes"), name: "звонок.webm", type: "video/webm", ...over,
});

describe("transcribeFile — запрос к /audio/transcriptions", () => {
  it("multipart-тело собрано верно: файл, модель, response_format text, language ru; ключ — в заголовке", async () => {
    const doFetch = vi.fn(async () => ok("Привет, это расшифровка."));
    const text = await transcribeFile(file({ baseUrl: "https://api.groq.com/openai/v1/", model: "whisper-large-v3-turbo" }), doFetch);
    expect(text).toBe("Привет, это расшифровка.");

    const [url, opts] = doFetch.mock.calls[0];
    // Хвостовой слэш адреса не удваивается.
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe(`Bearer ${KEY}`);
    // Content-Type НЕ выставлен руками: границу multipart знает только FormData.
    expect(opts.headers["Content-Type"]).toBeUndefined();
    expect(opts.body).toBeInstanceOf(FormData);
    expect(opts.body.get("model")).toBe("whisper-large-v3-turbo");
    expect(opts.body.get("response_format")).toBe("text");
    expect(opts.body.get("language")).toBe("ru");
    const f = opts.body.get("file");
    expect(f.name).toBe("звонок.webm");
    expect(f.type).toBe("video/webm");
    expect(await f.text()).toBe("webm-bytes");
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("адрес не задан — OpenAI", async () => {
    const doFetch = vi.fn(async () => ok("текст"));
    await transcribeFile(file(), doFetch);
    expect(doFetch.mock.calls[0][0]).toBe(`${DEFAULT_OPENAI_BASE}/audio/transcriptions`);
  });

  it("провайдер другого вида не расшифровывает — сказано словами, в сеть ничего не уходит", async () => {
    const doFetch = vi.fn();
    await expect(transcribeFile(file({ kind: "anthropic" }), doFetch)).rejects.toThrow(NOT_SUPPORTED);
    await expect(transcribeFile(file({ kind: "hf" }), doFetch)).rejects.toThrow(NOT_SUPPORTED);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("без ключа, без модели и без байтов — отказ словами", async () => {
    const doFetch = vi.fn();
    await expect(transcribeFile(file({ key: "" }), doFetch)).rejects.toThrow(/ключ/);
    await expect(transcribeFile(file({ model: "" }), doFetch)).rejects.toThrow(/модель/);
    await expect(transcribeFile(file({ bytes: Buffer.alloc(0) }), doFetch)).rejects.toThrow(/пуста/);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("совместимый сервер ответил JSON {text} вместо голого текста — разбирается и он", async () => {
    expect(await transcribeFile(file(), async () => ok("{\"text\":\"из json\"}"))).toBe("из json");
  });

  it("ошибка провайдера — статус и объяснение, ключ вырезан", async () => {
    const doFetch = async () => fail(401, `{"error":{"message":"bad key ${KEY}"}}`);
    const err = await transcribeFile(file(), doFetch).catch((e) => e);
    expect(err.message).toMatch(/провайдер ответил 401: bad key \[ключ\]/);
    expect(err.message).not.toContain(KEY);
  });

  it("пустой ответ — ошибка, а не пустая расшифровка", async () => {
    await expect(transcribeFile(file(), async () => ok("  "))).rejects.toThrow(/пустую/);
  });

  it("сеть и предел ожидания — словами", async () => {
    await expect(transcribeFile(file(), async () => { throw new Error("ECONNREFUSED"); }))
      .rejects.toThrow(/недоступен: ECONNREFUSED/);
    await expect(transcribeFile(file(), async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    })).rejects.toThrow(/не ответил за 10 минут/);
  });
});

describe("transcribeRecording — после сохранения записи", () => {
  const groq = { kind: "openai", baseUrl: "https://api.groq.com/openai/v1", key: KEY,
    model: "whisper-large-v3-turbo", providerName: "Groq" };
  const rec = (over = {}) => ({ userId: "100", fileId: "f1", name: "звонок.webm", type: "video/webm",
    bytes: Buffer.from("webm"), ...over });

  it("расшифровка без модели — ничего не пишется, причина названа словами", async () => {
    const pick = vi.fn(async () => null);
    const r = await transcribeRecording(rec(), { pick, doFetch: vi.fn() });
    expect(r).toEqual({ status: "none", reason: NO_MODEL });
    expect(NO_MODEL).toBe("расшифровки нет: модель для задачи «расшифровка» не выбрана");
    expect(await transcriptFor("f1")).toBeNull();
    // Модель — того, кто сохранил, и именно для задачи «расшифровка».
    expect(pick).toHaveBeenCalledWith("100", "transcribe");
  });

  it("с моделью — текст ложится у файла и у встречи, только своему", async () => {
    const m = await createMeeting({ title: "Разбор", by: "100" });
    const r = await transcribeRecording(rec({ meetingId: m.id }),
      { pick: async () => groq, doFetch: async () => ok("Договорились о скидке.") });
    expect(r.status).toBe("done");
    expect((await transcriptFor("f1"))).toMatchObject({
      fileId: "f1", by: "100", meetingId: m.id, status: "done",
      text: "Договорились о скидке.", model: "Groq / whisper-large-v3-turbo",
    });
    expect((await getMeeting(m.id)).transcripts).toEqual([
      expect.objectContaining({ fileId: "f1", text: "Договорились о скидке." }),
    ]);
    expect((await listTranscripts("100")).map((t) => t.fileId)).toEqual(["f1"]);
    expect(await listTranscripts("200")).toEqual([]);
  });

  it("ошибка провайдера записывается словами, а не теряется в фоне", async () => {
    const r = await transcribeRecording(rec(), { pick: async () => groq, doFetch: async () => fail(500, "boom") });
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/провайдер ответил 500: boom/);
    expect((await transcriptFor("f1")).status).toBe("error");
  });

  it("модель не того вида — в записи «этот провайдер не расшифровывает»", async () => {
    const r = await transcribeRecording(rec(), { pick: async () => ({ ...groq, kind: "anthropic" }), doFetch: vi.fn() });
    expect(r.status).toBe("error");
    expect(r.error).toContain(NOT_SUPPORTED);
  });

  it("настройки не прочитались — тоже записано, а не брошено", async () => {
    const r = await transcribeRecording(rec(), { pick: async () => { throw new Error("файл битый"); } });
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/настройки помощника не прочитались: файл битый/);
  });
});

describe("callStore — расшифровки", () => {
  it("повторная запись того же файла заменяет прежнюю, а не дублирует", async () => {
    await putTranscript({ fileId: "f1", by: "100", name: "а", status: "pending" });
    await putTranscript({ fileId: "f1", by: "100", name: "а", status: "done", text: "готово" });
    const list = await listTranscripts("100");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "done", text: "готово" });
  });

  it("непонятное состояние считается ошибкой, а не готовностью", async () => {
    const r = await putTranscript({ fileId: "f2", by: "100", status: "что-то" });
    expect(r.status).toBe("error");
  });

  it("удаление уносит текст и у файла, и у встречи", async () => {
    const m = await createMeeting({ title: "Разбор", by: "100" });
    await putTranscript({ fileId: "f1", by: "100", meetingId: m.id, status: "done", text: "т" });
    expect(await dropTranscript("f1")).toBe(true);
    expect(await transcriptFor("f1")).toBeNull();
    expect((await getMeeting(m.id)).transcripts).toEqual([]);
    expect(await dropTranscript("f1")).toBe(false);
  });

  it("одновременные записи не затирают друг друга", async () => {
    await Promise.all(["a", "b", "c"].map((id) => putTranscript({ fileId: id, by: "100", status: "done", text: id })));
    expect((await listTranscripts("100")).map((t) => t.fileId).sort()).toEqual(["a", "b", "c"]);
  });
});
