import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/* Файлы отчётов лежат на диске, а в сценарий уезжает только ссылка. */

let app;
let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sd-reports-"));
  process.env.REPORTS_DIR = tmpDir;
  process.env.NODE_ENV = "test";
  const { createApp } = await import("../app.js");
  app = createApp();
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const upload = (bytes, { name = "отчёт.png", type = "image/png" } = {}) =>
  request(app).post("/api/reports")
    .set("X-Report-Name", b64(name))
    .set("X-Report-Type", type)
    .set("Content-Type", "application/octet-stream")
    .send(bytes);

describe("файлы отчётов", () => {
  it("здоровье сообщает, включена ли загрузка файлов", async () => {
    const res = await request(app).get("/api/health");
    expect(res.body).toHaveProperty("reports");
  });

  it("загруженный файл получает ссылку и отдаётся по ней байт в байт", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const up = await upload(bytes);
    expect(up.status).toBe(201);
    expect(up.body.url).toBe(`/api/reports/${up.body.scope}/${up.body.id}`);
    expect(up.body.size).toBe(bytes.length);
    // Русское имя не должно превратиться в мусор по дороге через заголовок.
    expect(up.body.name).toBe("отчёт.png");

    const get = await request(app).get(up.body.url).buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(get.status).toBe(200);
    expect(get.headers["content-type"]).toContain("image/png");
    expect(Buffer.from(get.body).equals(bytes)).toBe(true);
  });

  it("файл на диске лежит отдельно от сценария", async () => {
    const up = await upload(Buffer.from("текст отчёта", "utf8"),
      { name: "заметка.txt", type: "text/plain" });
    const files = await fs.readdir(path.join(tmpDir, up.body.scope));
    expect(files).toContain(up.body.id);
    expect(files).toContain("manifest.json");
  });

  it("опасный тип не отдаётся тем, чем прислан — иначе это XSS в своём origin",
    async () => {
      const up = await upload(Buffer.from("<script>alert(1)</script>", "utf8"),
        { name: "x.html", type: "text/html" });
      expect(up.body.type).toBe("application/octet-stream");
      const get = await request(app).get(up.body.url);
      expect(get.headers["content-type"]).toContain("application/octet-stream");
    });

  it("имя не может увести файл из каталога пользователя", async () => {
    const up = await upload(Buffer.from("x"), { name: "../../etc/passwd" });
    // Разделители из показываемого имени вырезаны...
    expect(up.body.name).not.toMatch(/[/\\]/);
    // ...но главное — имя вообще не участвует в пути: на диске файл назван
    // своим id, поэтому пройти вверх по каталогам через имя нечем.
    const files = await fs.readdir(path.join(tmpDir, up.body.scope));
    expect(files.every((f) => f === "manifest.json" || /^[0-9a-f-]{36}$/.test(f)))
      .toBe(true);
    expect(files).toContain(up.body.id);
  });

  it("пустое тело отвергается, а не сохраняется нулевым файлом", async () => {
    const res = await request(app).post("/api/reports")
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.alloc(0));
    expect(res.status).toBe(400);
  });

  it("несуществующая ссылка — 404, а не пустой ответ", async () => {
    const good = "0".repeat(32);
    expect((await request(app).get(`/api/reports/${good}/нет-такого`)).status).toBe(404);
  });

  it("scope из адреса не может стать путём вверх по каталогам", async () => {
    // Кладём читаемый манифест ВНЕ каталога отчётов и пробуем достать его
    // ссылкой с «../». Без проверки формата scope это сработало бы: путь
    // собирается из того, что пришло в адресе.
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "sd-outside-"));
    const id = "11111111-2222-3333-4444-555555555555";
    await fs.writeFile(path.join(outside, "manifest.json"), JSON.stringify(
      [{ id, name: "чужое.txt", type: "text/plain", size: 6 }]), "utf8");
    await fs.writeFile(path.join(outside, id), "секрет", "utf8");

    const up = path.relative(tmpDir, outside);   // «../sd-outside-XXXX»
    const res = await request(app)
      .get(`/api/reports/${encodeURIComponent(up)}/${id}`);
    expect(res.status).toBe(404);
    await fs.rm(outside, { recursive: true, force: true });
  });

  it("ссылка читается без подписи — иначе <img src> не показал бы картинку",
    async () => {
      const up = await upload(Buffer.from("видно всем, у кого ссылка", "utf8"),
        { name: "з.txt", type: "text/plain" });
      // Ни одного заголовка Telegram — так браузер и грузит картинки.
      const res = await request(app).get(up.body.url);
      expect(res.status).toBe(200);
    });

  it("по чужой ссылке нельзя удалить файл — стирает только подпись", async () => {
    const up = await upload(Buffer.from("моё", "utf8"), { name: "м.txt", type: "text/plain" });
    // scope в адресе подменён, но удаление смотрит на подписанного
    // пользователя, поэтому файл всё равно свой — и он удаляется.
    const other = "1".repeat(32);
    expect((await request(app).delete(`/api/reports/${other}/${up.body.id}`)).status)
      .toBe(204);
    expect((await request(app).get(up.body.url)).status).toBe(404);
  });

  it("удаление убирает и файл, и запись в манифесте", async () => {
    const up = await upload(Buffer.from("на удаление", "utf8"),
      { name: "мусор.txt", type: "text/plain" });
    expect((await request(app).delete(up.body.url)).status).toBe(204);
    expect((await request(app).get(up.body.url)).status).toBe(404);
    expect((await request(app).delete(up.body.url)).status).toBe(404);
  });
});
