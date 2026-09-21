import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/* ═══════════════════════════════════════════════════════════════
   ЗАПИСИ СОЗВОНОВ

   Лежат в том же хранилище файлов, что и вложения к задачам, но помечены
   видом «call» — иначе вкладка звонков показывала бы всё подряд.

   Главное, что здесь проверяется, — своё и чужое. Список, отправка в чат и
   удаление обязаны выводить каталог из подписи Telegram, а не из запроса:
   иначе знание id превращалось бы в право прочитать чужую запись. Поэтому
   проверка идёт на боевом режиме, где пользователи различимы.
   ═══════════════════════════════════════════════════════════════ */

/* Модель для расшифровки берётся из настроек помощника (assistantSettings,
   `modelFor`) — здесь она подменена: настроек в тесте нет, а нужна ровно
   развилка «модель есть / модели нет». */
vi.mock("../lib/assistantSettings.js", async (importOriginal) => ({
  ...(await importOriginal()),
  modelFor: vi.fn(async () => null),
}));

const TOKEN = "test-token";
let app, tmp, prev;

function initDataFor(id) {
  const user = JSON.stringify({ id, first_name: "Кто-то" });
  const params = { auth_date: String(Math.floor(Date.now() / 1000)), user };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
}
const as = (id) => ({ "X-Telegram-Init-Data": initDataFor(id), "X-Storage": "main" });
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

const upload = (who, bytes, { name = "звонок.webm", type = "video/webm", kind = "call", meta = null } = {}) => {
  const r = request(app).post("/api/reports")
    .set(as(who))
    .set("X-Report-Name", b64(name))
    .set("X-Report-Type", type)
    .set("Content-Type", "application/octet-stream");
  if (kind) r.set("X-Report-Kind", kind);
  if (meta) r.set("X-Report-Meta", b64(JSON.stringify(meta)));
  return r.send(bytes);
};

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-recordings-"));
  prev = { node: process.env.NODE_ENV, token: process.env.TELEGRAM_BOT_TOKEN,
    url: process.env.PUBLIC_URL, owner: process.env.OWNER_TELEGRAM_ID,
    org: process.env.ORG_DIR, calls: process.env.CALLS_DIR };
  process.env.REPORTS_DIR = tmp;
  process.env.ORG_DIR = path.join(tmp, "org");
  // Расшифровки записей ложатся в хранилище звонков — оно тоже во временном
  // каталоге, иначе тест писал бы в data/ рабочего каталога.
  process.env.CALLS_DIR = path.join(tmp, "calls");
  process.env.NODE_ENV = "production";
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.PUBLIC_URL = "https://x.test";
  // 100 — владелец, 200 — позванный в модель, 777 — посторонний. Файлы на
  // сервере есть только у тех, кто в модели: иначе любой, кому дали ссылку
  // на звонок, получал бы личное хранилище на нашем диске.
  process.env.OWNER_TELEGRAM_ID = "100";
  const org = await import("../lib/orgStore.js");
  await org.identify("100", { name: "Хозяин", username: "boss" });
  await org.addUser({ id: "200", name: "Иван", username: "ivan", roleId: "executor", addedBy: "100" });
  const { createApp } = await import("../app.js");
  app = createApp();
});
afterAll(async () => {
  process.env.NODE_ENV = prev.node;
  if (prev.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prev.token;
  if (prev.url === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = prev.url;
  if (prev.owner === undefined) delete process.env.OWNER_TELEGRAM_ID;
  else process.env.OWNER_TELEGRAM_ID = prev.owner;
  if (prev.org === undefined) delete process.env.ORG_DIR;
  else process.env.ORG_DIR = prev.org;
  if (prev.calls === undefined) delete process.env.CALLS_DIR;
  else process.env.CALLS_DIR = prev.calls;
  await fs.rm(tmp, { recursive: true, force: true });
});
afterEach(() => { vi.restoreAllMocks(); });

/** Telegram в тестах поддельный: настоящему боту тут звонить нечем и незачем. */
const fakeTelegram = () => {
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
    calls.push({ url: String(url), body: opts?.body });
    return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
  });
  return calls;
};

describe("список записей", () => {
  it("показывает свои записи и не показывает вложения к задачам", async () => {
    await upload(100, Buffer.from("видео"), { name: "звонок-1.webm" });
    await upload(100, Buffer.from("картинка"), { name: "снимок.png", type: "image/png", kind: "" });

    const all = await request(app).get("/api/reports").set(as(100));
    expect(all.status).toBe(200);
    expect(all.body.map((f) => f.name).sort()).toEqual(["звонок-1.webm", "снимок.png"]);

    const rec = await request(app).get("/api/reports?kind=call").set(as(100));
    expect(rec.body).toHaveLength(1);
    expect(rec.body[0]).toMatchObject({ name: "звонок-1.webm", kind: "call" });
    // Ссылка на файл и каталог нужны интерфейсу, чтобы открыть и удалить.
    expect(rec.body[0].url).toMatch(/^\/api\/reports\/[a-f0-9]{32}\//);
    expect(rec.body[0].scope).toMatch(/^[a-f0-9]{32}$/);
  });

  it("другой участник модели видит своё, а не чужое", async () => {
    await upload(100, Buffer.from("моё"), { name: "моя.webm" });
    const res = await request(app).get("/api/reports?kind=call").set(as(200));
    expect(res.status).toBe(200);
    expect(res.body.map((f) => f.name)).not.toContain("моя.webm");
  });

  it("посторонний со ссылкой на звонок хранилища не получает вовсе", async () => {
    // Иначе любой, кого позвали на один созвон, заводил бы себе на нашем
    // диске две тысячи файлов по сто мегабайт и бота-курьера к ним.
    expect((await request(app).get("/api/reports").set(as(777))).status).toBe(403);
    expect((await upload(777, Buffer.from("чужое"))).status).toBe(403);
  });

  it("без подписи список не отдаётся вовсе", async () => {
    expect((await request(app).get("/api/reports")).status).toBe(401);
  });

  it("непонятный вид не превращается в «показать всё»", async () => {
    await upload(100, Buffer.from("видео"), { name: "звонок-9.webm" });
    const res = await request(app).get("/api/reports?kind=НЕ-ВИД").set(as(100));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("запись, сделанная до появления метки, всё равно находится", async () => {
    // Иначе у людей на диске остались бы файлы по сотне мегабайт, которые
    // видно в чате, но нельзя ни найти, ни удалить.
    const { saveReport } = await import("../lib/reportStore.js");
    await saveReport("100", {
      name: "звонок-старый.webm", type: "video/webm", bytes: Buffer.from("старое"),
    });
    const res = await request(app).get("/api/reports?kind=call").set(as(100));
    expect(res.body.map((f) => f.name)).toContain("звонок-старый.webm");
  });

  it("тип записи не теряется из-за кодеков в MIME", async () => {
    // MediaRecorder всегда отдаёт «video/webm;codecs=vp9,opus». Без отсечения
    // параметров запись сохранялась безымянным потоком байтов и не игралась.
    const up = await upload(100, Buffer.from("видео"),
      { name: "звонок-кодеки.webm", type: "video/webm;codecs=vp9,opus" });
    expect(up.body.type).toBe("video/webm");
  });
});

describe("«Скачать» — отправка себе в чат", () => {
  it("запись уходит документом в чат тому же человеку", async () => {
    const calls = fakeTelegram();
    const up = await upload(100, Buffer.from("видеозапись"), { name: "звонок-2.webm" });
    const res = await request(app).post(`/api/reports/${up.body.id}/send`).set(as(100));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: "file" });

    const sent = calls.find((c) => c.url.includes("/sendDocument"));
    expect(sent).toBeTruthy();
    // Адресат — тот же подписанный пользователь, а не что-то из запроса.
    expect(sent.body.get("chat_id")).toBe("100");
    expect(sent.body.get("document").name).toBe("звонок-2.webm");
  });

  it("слишком большая запись уходит ссылкой, а не молчанием", async () => {
    // Бот отправляет документ не больше 50 МБ, а сорок минут созвона весят
    // под сотню. Файл кладём мимо HTTP: гонять сто мегабайт через supertest
    // ради одной ветки незачем.
    const { saveReport } = await import("../lib/reportStore.js");
    const { MAX_BOT_DOCUMENT_BYTES } = await import("../lib/telegram.js");
    const big = await saveReport("100", {
      name: "длинная.webm", type: "video/webm", kind: "call",
      bytes: Buffer.alloc(MAX_BOT_DOCUMENT_BYTES + 1),
    });
    const calls = fakeTelegram();
    const res = await request(app).post(`/api/reports/${big.id}/send`).set(as(100));
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe("link");
    expect(res.body.link).toBe(`https://x.test${big.url}`);

    expect(calls.find((c) => c.url.includes("/sendDocument"))).toBeFalsy();
    const msg = calls.find((c) => c.url.includes("/sendMessage"));
    expect(JSON.parse(msg.body).text).toContain(`https://x.test${big.url}`);
  }, 20000);

  it("чужую запись отправить нельзя, даже зная её id", async () => {
    const calls = fakeTelegram();
    const up = await upload(100, Buffer.from("чужое"), { name: "чужая.webm" });
    const res = await request(app).post(`/api/reports/${up.body.id}/send`).set(as(200));
    expect(res.status).toBe(404);
    expect(calls.find((c) => c.url.includes("/sendDocument"))).toBeFalsy();
  });

  it("несуществующая запись — 404, а не пятисотка", async () => {
    fakeTelegram();
    const res = await request(app).post("/api/reports/нет-такой/send").set(as(100));
    expect(res.status).toBe(404);
  });
});

describe("«Удалить» — с сервера насовсем", () => {
  it("своя запись исчезает и из списка, и с диска", async () => {
    const up = await upload(100, Buffer.from("на удаление"), { name: "лишняя.webm" });
    const { scope, id } = up.body;
    expect((await request(app).get(`/api/reports/${scope}/${id}`)).status).toBe(200);

    const del = await request(app).delete(`/api/reports/${scope}/${id}`).set(as(100));
    expect(del.status).toBe(204);
    expect((await request(app).get(`/api/reports/${scope}/${id}`)).status).toBe(404);
    const left = await request(app).get("/api/reports?kind=call").set(as(100));
    expect(left.body.map((f) => f.name)).not.toContain("лишняя.webm");
  });

  it("чужую запись не удалить: каталог берётся из подписи, а не из ссылки", async () => {
    const up = await upload(100, Buffer.from("не трогать"), { name: "чужая-2.webm" });
    const { scope, id } = up.body;
    const del = await request(app).delete(`/api/reports/${scope}/${id}`).set(as(200));
    expect(del.status).toBe(404);
    expect((await request(app).get(`/api/reports/${scope}/${id}`)).status).toBe(200);
  });
});

describe("расшифровка после сохранения записи", () => {
  const GROQ = { kind: "openai", baseUrl: "https://api.groq.com/openai/v1", key: "sk-key-12345678",
    model: "whisper-large-v3-turbo", providerName: "Groq" };
  /** Ждёт, пока фоновая расшифровка допишет своё; иначе тест гонялся бы с ней. */
  const settled = async (fileId, want) => {
    const { transcriptFor } = await import("../lib/callStore.js");
    for (let i = 0; i < 50; i += 1) {
      const t = await transcriptFor(fileId);
      if (t && t.status === want) return t;
      await new Promise((r) => setTimeout(r, 40));
    }
    return transcriptFor(fileId);
  };
  const fakeProviders = (transcript) => {
    const calls = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
      calls.push({ url: String(url), body: opts?.body, headers: opts?.headers });
      if (String(url).includes("/audio/transcriptions")) {
        return { ok: true, status: 200, text: async () => transcript };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
    });
    return calls;
  };

  /* РАСШИФРОВКА — ПО КНОПКЕ (владелец, 2026-09-21): «транскрибировать» на
     форме записи, моделью строки «расшифровка» у ассистента того, кто
     нажал. При сохранении ничего не запускается: дорожки приезжают
     отдельными файлами после записи. */
  it("«транскрибировать» расшифровывает моделью того, кто нажал; текст ложится у встречи и отдаётся форме", async () => {
    const { modelFor } = await import("../lib/assistantSettings.js");
    const { createMeeting, getMeeting } = await import("../lib/callStore.js");
    modelFor.mockClear();
    modelFor.mockResolvedValue(GROQ);
    const calls = fakeProviders("Договорились о скидке.");
    const m = await createMeeting({ title: "Разбор", by: "100" });

    const up = await upload(100, Buffer.from("видео"), { name: "звонок-р.webm" }).set("X-Report-Meeting", m.id);
    expect(up.status).toBe(201);
    // Само сохранение ничего не расшифровывает.
    await new Promise((r) => setTimeout(r, 80));
    expect(calls.find((c) => c.url.includes("/audio/transcriptions"))).toBeFalsy();
    expect((await request(app).get(`/api/reports/${up.body.id}/transcript`).set(as(100))).body).toEqual({ status: "none" });

    const go = await request(app).post(`/api/reports/${up.body.id}/transcribe`).set(as(100));
    // Ответ приходит сразу: расшифровку человек не ждёт.
    expect(go.status).toBe(202);
    expect(go.body).toMatchObject({ status: "pending", tracks: 0 });

    const t = await settled(up.body.id, "done");
    expect(t).toMatchObject({ by: "100", status: "done", text: "Договорились о скидке.", meetingId: m.id });
    // Модель — того, кто нажал, для задачи «расшифровка» и БЕЗ отката на
    // модель чата: та записи не расшифровывает.
    expect(modelFor).toHaveBeenCalledWith("100", "transcribe", { fallback: false });
    const sent = calls.find((c) => c.url.includes("/audio/transcriptions"));
    expect(sent.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(sent.headers.Authorization).toBe("Bearer sk-key-12345678");
    expect(sent.body.get("file").name).toBe("звонок-р.webm");
    expect((await getMeeting(m.id)).transcripts[0]).toMatchObject({ fileId: up.body.id, text: "Договорились о скидке." });
    // Форма записи читает текст здесь — и без «by»: чьё, знает подпись.
    const got = await request(app).get(`/api/reports/${up.body.id}/transcript`).set(as(100));
    expect(got.body).toMatchObject({ status: "done", text: "Договорились о скидке." });
    expect(got.body.by).toBeUndefined();
    // Чужую расшифровку не прочитать даже по id.
    expect((await request(app).get(`/api/reports/${up.body.id}/transcript`).set(as(200))).status).toBe(404);
    // «Удалить транскрипцию» — текста нет, запись на месте.
    expect((await request(app).delete(`/api/reports/${up.body.id}/transcript`).set(as(100))).status).toBe(204);
    expect((await request(app).get(`/api/reports/${up.body.id}/transcript`).set(as(100))).body).toEqual({ status: "none" });
    expect((await request(app).get("/api/reports?kind=call").set(as(100))).body.some((f) => f.id === up.body.id)).toBe(true);
  });

  it("модель для расшифровки не выбрана — кнопка отвечает словами, в сеть ничего не уходит", async () => {
    const { modelFor } = await import("../lib/assistantSettings.js");
    const { transcriptFor } = await import("../lib/callStore.js");
    modelFor.mockResolvedValue(null);
    const calls = fakeProviders("не должно случиться");
    const up = await upload(100, Buffer.from("видео"), { name: "звонок-без.webm" });
    const go = await request(app).post(`/api/reports/${up.body.id}/transcribe`).set(as(100));
    expect(go.status).toBe(409);
    expect(go.body.error).toMatch(/модель для задачи «расшифровка записей звонков» не выбрана/);
    await new Promise((r) => setTimeout(r, 80));
    expect(await transcriptFor(up.body.id)).toBeNull();
    expect(calls.find((c) => c.url.includes("/audio/transcriptions"))).toBeFalsy();
  });

  it("вложение к задаче — не запись: расшифровывать нечего", async () => {
    const { modelFor } = await import("../lib/assistantSettings.js");
    modelFor.mockClear();
    modelFor.mockResolvedValue(GROQ);
    fakeProviders("");
    const up = await upload(100, Buffer.from("картинка"), { name: "снимок-2.png", type: "image/png", kind: "" });
    expect((await request(app).post(`/api/reports/${up.body.id}/transcribe`).set(as(100))).status).toBe(404);
    expect(modelFor).not.toHaveBeenCalled();
  });

  it("не похожий на id встречи заголовок отбрасывается: текст остаётся при файле", async () => {
    const { modelFor } = await import("../lib/assistantSettings.js");
    modelFor.mockResolvedValue(GROQ);
    fakeProviders("текст");
    const up = await upload(100, Buffer.from("видео"), { name: "звонок-х.webm" }).set("X-Report-Meeting", "not-an/id?x=1");
    expect(up.body.meta?.meeting).toBeUndefined();
    await request(app).post(`/api/reports/${up.body.id}/transcribe`).set(as(100));
    const t = await settled(up.body.id, "done");
    expect(t.meetingId).toBeNull();
  });

  /* ГОЛОС ПОКАНАЛЬНО (владелец, 2026-09-21): дорожки уезжают файлами
     вида «track» с подписью — чья и к какой записи. Чья — сервер узнаёт
     при загрузке по псевдониму звонка (пока он жив) и подставляет имя из
     анкеты и username; расшифровка идёт по дорожкам, реплики складываются
     по времени, и перед каждой — кто говорит. */
  it("по дорожкам: перед репликой — имя из анкеты и username; дорожки уходят вместе с записью", async () => {
    const { modelFor } = await import("../lib/assistantSettings.js");
    const { createMeeting, aliasFor } = await import("../lib/callStore.js");
    modelFor.mockResolvedValue(GROQ);
    const m = await createMeeting({ title: "Разбор", by: "100" });
    // Провайдер отвечает verbose_json — по имени файла дорожки.
    const calls = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
      calls.push({ url: String(url), body: opts?.body });
      if (String(url).includes("/audio/transcriptions")) {
        const name = opts.body.get("file").name;
        const segs = name.startsWith("дорожка-я")
          ? [{ start: 0.2, end: 1.5, text: "Привет, Иван." }, { start: 6, end: 8, text: "Тогда до завтра." }]
          : [{ start: 0.5, end: 2, text: "Здравствуй." }, { start: 1.2, end: 3, text: "Скидку дадим." }];
        return { ok: true, status: 200, text: async () => JSON.stringify({ text: segs.map((x) => x.text).join(" "), segments: segs }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
    });

    const video = await upload(100, Buffer.from("видео"), { name: "звонок-д.webm" }).set("X-Report-Meeting", m.id);
    const mine = await upload(100, Buffer.from("мой голос"), { name: "дорожка-я.webm", type: "audio/webm", kind: "track",
      meta: { of: video.body.id, who: { id: "xx", name: "Я", me: true }, offsetMs: 0 } });
    // Собеседник в звонке — псевдонимом; сервер узнаёт в нём участника 200.
    const theirs = await upload(100, Buffer.from("его голос"), { name: "дорожка-п.webm", type: "audio/webm", kind: "track",
      meta: { of: video.body.id, who: { id: aliasFor(m.id, "200"), name: "Иван из привета" }, offsetMs: 2000 } });
    // Имя — из анкеты (её обновляет подпись Telegram: в тесте это «Кто-то»), username — оттуда же.
    expect(mine.body.meta.who).toMatchObject({ userId: "100", name: "Кто-то", username: "boss" });
    expect(theirs.body.meta.who).toMatchObject({ userId: "200", name: "Кто-то", username: "ivan" });
    // Дорожки — не записи: во вкладке звонков их нет.
    expect((await request(app).get("/api/reports?kind=call").set(as(100))).body.map((f) => f.id)).not.toContain(mine.body.id);

    const go = await request(app).post(`/api/reports/${video.body.id}/transcribe`).set(as(100));
    expect(go.body).toMatchObject({ status: "pending", tracks: 2 });
    const t = await settled(video.body.id, "done");
    // Сдвиг дорожки собеседника — две секунды: его «Здравствуй» на 2,5 с.
    expect(t.text.split("\n")).toEqual([
      "[00:00] Кто-то @boss: Привет, Иван.",
      "[00:03] Кто-то @ivan: Здравствуй. Скидку дадим.",
      "[00:06] Кто-то @boss: Тогда до завтра.",
    ]);
    const sent = calls.filter((c) => c.url.includes("/audio/transcriptions"));
    expect(sent).toHaveLength(2);
    expect(sent.every((c) => c.body.get("response_format") === "verbose_json")).toBe(true);

    // Удаление видеозаписи уносит и дорожки, и текст.
    const del = await request(app).delete(`/api/reports/${video.body.scope}/${video.body.id}`).set(as(100));
    expect(del.status).toBe(204);
    expect((await request(app).get("/api/reports?kind=track").set(as(100))).body).toEqual([]);
    expect((await request(app).get(`/api/reports/${video.body.id}/transcript`).set(as(100))).status).toBe(404);
  });

  it("удаление записи уносит и расшифровку", async () => {
    const { modelFor } = await import("../lib/assistantSettings.js");
    const { transcriptFor } = await import("../lib/callStore.js");
    modelFor.mockResolvedValue(GROQ);
    fakeProviders("удаляемый текст");
    const up = await upload(100, Buffer.from("видео"), { name: "звонок-у.webm" });
    await request(app).post(`/api/reports/${up.body.id}/transcribe`).set(as(100));
    expect((await settled(up.body.id, "done")).status).toBe("done");
    const del = await request(app).delete(`/api/reports/${up.body.scope}/${up.body.id}`).set(as(100));
    expect(del.status).toBe(204);
    expect(await transcriptFor(up.body.id)).toBeNull();
  });
});
