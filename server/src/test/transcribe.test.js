import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_OPENAI_BASE, INTERRUPTED, MAX_TRANSCRIBE_BYTES, NO_MODEL, NOT_SUPPORTED, TRANSCRIBE_TIMEOUT_MS,
  isStalePending, resumeTranscripts, retranscribeFor, transcribeFile, transcribeRecording,
} from "../lib/transcribe.js";
import {
  createMeeting, dropTranscript, getMeeting, listPendingTranscripts, listTranscripts, putTranscript,
  transcriptFor,
} from "../lib/callStore.js";
import { addProvider, setTasks, updateProvider } from "../lib/assistantSettings.js";
import { saveReport } from "../lib/reportStore.js";

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
  process.env.ASSISTANT_DIR = path.join(tmp, "assistant");
  process.env.REPORTS_DIR = path.join(tmp, "reports");
  process.env.ORG_DIR = path.join(tmp, "org");
});
afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
beforeEach(async () => {
  for (const d of ["CALLS_DIR", "ASSISTANT_DIR", "REPORTS_DIR", "ORG_DIR"]) {
    await fs.rm(process.env[d], { recursive: true, force: true });
  }
});

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

  it("запись больше 25 МБ не отправляется вовсе — предел провайдера назван числом", async () => {
    const doFetch = vi.fn();
    const err = await transcribeFile(file({ bytes: Buffer.alloc(MAX_TRANSCRIBE_BYTES + 1) }), doFetch).catch((e) => e);
    expect(err.message).toMatch(/запись 25 МБ больше 25 МБ, которые принимает провайдер расшифровки/);
    expect(doFetch).not.toHaveBeenCalled();
    expect(MAX_TRANSCRIBE_BYTES).toBe(25 * 1024 * 1024);
    // Ровно предел — ещё проходит.
    await transcribeFile(file({ bytes: Buffer.alloc(MAX_TRANSCRIBE_BYTES) }), async () => ok("текст"));
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

  it("расшифровка без модели — ничего не пишется, причина названа словами и сказано, где выбрать", async () => {
    const pick = vi.fn(async () => null);
    const r = await transcribeRecording(rec(), { pick, doFetch: vi.fn() });
    expect(r).toEqual({ status: "none", reason: NO_MODEL });
    expect(NO_MODEL).toMatch(/^расшифровки нет: модель для задачи «расшифровка записей звонков» не выбрана/);
    expect(NO_MODEL).toMatch(/Инструментах → Помощник/);
    expect(await transcriptFor("f1")).toBeNull();
    // Модель — того, кто сохранил, для задачи «расшифровка» и БЕЗ отката.
    expect(pick).toHaveBeenCalledWith("100", "transcribe", { fallback: false });
  });

  /* Настоящие настройки: выбрана только модель чата. Раньше modelFor
     откатывался на неё, и запись целиком уходила туда, где расшифровывать
     не умеют, а в контексте ложилось «провайдер ответил 400» вместо
     «модель не выбрана». */
  it("выбрана только модель чата — расшифровки нет (NO_MODEL), в сеть ничего не уходит", async () => {
    const p = addProvider("100", { name: "OpenAI", kind: "openai", key: KEY });
    updateProvider("100", p.id, { models: ["gpt-4o-mini", "whisper-1"] });
    setTasks("100", { chat: { providerId: p.id, model: "gpt-4o-mini" } });
    const doFetch = vi.fn();
    expect(await transcribeRecording(rec(), { doFetch })).toEqual({ status: "none", reason: NO_MODEL });
    expect(doFetch).not.toHaveBeenCalled();
    expect(await transcriptFor("f1")).toBeNull();
    // Своя строка есть — расшифровка идёт именно ей, а не моделью чата.
    setTasks("100", { transcribe: { providerId: p.id, model: "whisper-1" } });
    const r = await transcribeRecording(rec(), { doFetch: vi.fn(async () => ok("текст")) });
    expect(r).toMatchObject({ status: "done", model: "OpenAI / whisper-1" });
  });

  it("запись больше предела — «не удалось» словами до отправки, без «идёт» и без сети", async () => {
    const doFetch = vi.fn();
    const r = await transcribeRecording(rec({ bytes: Buffer.alloc(MAX_TRANSCRIBE_BYTES + 1) }),
      { pick: async () => groq, doFetch });
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/больше 25 МБ/);
    expect(doFetch).not.toHaveBeenCalled();
    expect((await transcriptFor("f1")).status).toBe("error");
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

/* ─── повтор: после выбора модели и после перезапуска ─── */
describe("retranscribeFor — после выбора модели расшифровки", () => {
  const groq = { kind: "openai", baseUrl: "https://api.groq.com/openai/v1", key: KEY,
    model: "whisper-large-v3-turbo", providerName: "Groq" };
  const call = (who, name) => saveReport(who, { name, type: "video/webm", kind: "call", bytes: Buffer.from(name) });

  it("записи без текста (модели не было, не удалось, оборвалось) расшифровываются; готовые не трогаются", async () => {
    const none = await call("100", "без-модели.webm");
    const failed = await call("100", "не-вышло.webm");
    const stale = await call("100", "оборвалось.webm");
    const done = await call("100", "готово.webm");
    const fresh = await call("100", "идёт.webm");
    const other = await call("200", "чужая.webm");
    await putTranscript({ fileId: failed.id, by: "100", status: "error", error: "провайдер ответил 400" });
    await putTranscript({ fileId: stale.id, by: "100", status: "pending", model: "старая" });
    // «Идёт» дольше предела ожидания — оборвано; свежее «идёт» — идёт.
    const tfile = path.join(process.env.CALLS_DIR, "transcripts.json");
    const list = JSON.parse(await fs.readFile(tfile, "utf8"));
    list.find((t) => t.fileId === stale.id).at = new Date(Date.now() - TRANSCRIBE_TIMEOUT_MS - 1000).toISOString();
    await fs.writeFile(tfile, JSON.stringify(list));
    await putTranscript({ fileId: done.id, by: "100", status: "done", text: "уже есть" });
    await putTranscript({ fileId: fresh.id, by: "100", status: "pending", model: "идёт" });

    const doFetch = vi.fn(async (url, opts) => ok(`текст ${await opts.body.get("file").text()}`));
    const out = await retranscribeFor("100", { pick: async () => groq, doFetch });
    expect(out.map((o) => o.status).sort()).toEqual(["done", "done", "done"]);
    expect(doFetch).toHaveBeenCalledTimes(3);
    expect((await transcriptFor(none.id))).toMatchObject({ status: "done", text: "текст без-модели.webm" });
    expect((await transcriptFor(failed.id))).toMatchObject({ status: "done", text: "текст не-вышло.webm" });
    expect((await transcriptFor(stale.id))).toMatchObject({ status: "done", text: "текст оборвалось.webm" });
    expect((await transcriptFor(done.id)).text).toBe("уже есть");
    expect((await transcriptFor(fresh.id)).status).toBe("pending");
    // Чужие записи не трогаются: расшифровывается своё своей моделью.
    expect(await transcriptFor(other.id)).toBeNull();
  });

  it("модели так и нет — ничего не пишется, ответ «none» по записи; записей нет — пусто", async () => {
    const a = await call("100", "а.webm");
    expect(await retranscribeFor("100", { pick: async () => null, doFetch: vi.fn() }))
      .toEqual([{ fileId: a.id, status: "none" }]);
    expect(await transcriptFor(a.id)).toBeNull();
    expect(await retranscribeFor("300", { pick: async () => groq, doFetch: vi.fn() })).toEqual([]);
  });
});

describe("resumeTranscripts — при старте сервера", () => {
  const groq = { kind: "openai", baseUrl: "", key: KEY, model: "whisper-1", providerName: "OpenAI" };

  it("«идёт» с байтами на диске — расшифровка заново; без байтов — «прервана» словами", async () => {
    const m = await createMeeting({ title: "Разбор", by: "100" });
    const kept = await saveReport("100", { name: "есть.webm", type: "video/webm", kind: "call", bytes: Buffer.from("есть") });
    await putTranscript({ fileId: kept.id, by: "100", name: kept.name, meetingId: m.id, status: "pending", model: "x" });
    await putTranscript({ fileId: "удалённый", by: "100", name: "нет.webm", status: "pending", model: "x" });
    await putTranscript({ fileId: "готовый", by: "100", name: "г.webm", status: "done", text: "текст" });
    expect((await listPendingTranscripts()).map((t) => t.fileId).sort()).toEqual([kept.id, "удалённый"].sort());

    const doFetch = vi.fn(async () => ok("восстановлено"));
    const out = await resumeTranscripts({ pick: async () => groq, doFetch });
    expect(out.map((o) => o.status).sort()).toEqual(["done", "error"]);
    expect(await transcriptFor(kept.id)).toMatchObject({ status: "done", text: "восстановлено", meetingId: m.id });
    expect((await getMeeting(m.id)).transcripts[0].text).toBe("восстановлено");
    const gone = await transcriptFor("удалённый");
    expect(gone.status).toBe("error");
    expect(gone.error).toMatch(new RegExp(`^${INTERRUPTED}, а записи на диске уже нет`));
    expect((await transcriptFor("готовый")).text).toBe("текст");
    expect(await listPendingTranscripts()).toEqual([]);
  });

  it("модель с тех пор сняли — «прервана» и «модель не выбрана», а не «идёт» навечно", async () => {
    const kept = await saveReport("100", { name: "есть.webm", type: "video/webm", kind: "call", bytes: Buffer.from("есть") });
    await putTranscript({ fileId: kept.id, by: "100", name: kept.name, status: "pending", model: "x" });
    await resumeTranscripts({ pick: async () => null, doFetch: vi.fn() });
    const t = await transcriptFor(kept.id);
    expect(t.status).toBe("error");
    expect(t.error).toContain(INTERRUPTED);
    expect(t.error).toContain(NO_MODEL);
  });

  it("isStalePending: «идёт» дольше предела ожидания провайдера — оборвано", () => {
    const now = Date.parse("2026-09-08T12:00:00Z");
    const at = (ms) => new Date(now - ms).toISOString();
    expect(isStalePending({ status: "pending", at: at(TRANSCRIBE_TIMEOUT_MS + 1) }, now)).toBe(true);
    expect(isStalePending({ status: "pending", at: at(TRANSCRIBE_TIMEOUT_MS - 1) }, now)).toBe(false);
    expect(isStalePending({ status: "pending", at: "не дата" }, now)).toBe(true);
    expect(isStalePending({ status: "done", at: at(TRANSCRIBE_TIMEOUT_MS + 1) }, now)).toBe(false);
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
