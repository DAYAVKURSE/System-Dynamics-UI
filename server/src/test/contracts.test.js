import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/* ДОГОВОРЫ: документ Word с версиями, приглашение с подписью владельца,
   привязка по ссылке, подпись позванного, роль действует по сроку. */

const TOKEN = "test-token";
let app, tmp, prev, docx, org;

function initDataFor(id, name = "Кто-то") {
  const user = JSON.stringify({ id, first_name: name });
  const params = { auth_date: String(Math.floor(Date.now() / 1000)), user };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
}
const NAMES = { 100: "Владелец", 200: "Пётр", 300: "Третий" };
const as = (id, name = NAMES[id]) => ({ "X-Telegram-Init-Data": initDataFor(id, name), "X-Storage": "main" });

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sd-contracts-"));
  prev = { node: process.env.NODE_ENV, token: process.env.TELEGRAM_BOT_TOKEN, bot: process.env.BOT_NAME };
  process.env.ORG_DIR = path.join(tmp, "org");
  process.env.WORKSPACE_DIR = path.join(tmp, "ws");
  process.env.REPORTS_DIR = path.join(tmp, "reports");
  process.env.NODE_ENV = "production";
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.BOT_NAME = "sd_bot";
  const { createApp } = await import("../app.js");
  app = createApp();
  docx = await import("../lib/docx.js");
  org = await import("../lib/orgStore.js");
});
afterAll(async () => {
  process.env.NODE_ENV = prev.node;
  if (prev.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prev.token;
  if (prev.bot === undefined) delete process.env.BOT_NAME; else process.env.BOT_NAME = prev.bot;
  await fs.rm(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  for (const d of ["ORG_DIR", "WORKSPACE_DIR", "REPORTS_DIR"]) {
    await fs.rm(process.env[d], { recursive: true, force: true });
  }
  await request(app).get("/api/org/me").set(as(100));
});

/* Договор: плейсхолдеры, рамки подписей сторон. */
const CONTRACT = [
  "ДОГОВОР ПОДРЯДА",
  "Заказчик поручает исполнителю [(fio): ФИО исполнителя] работу в городе [(city): город].",
  "Сумма договора: [(sum): сумма] руб. Действует с [(start): начало] по [(end): окончание].",
  { text: "Подпись стороны 1:", border: "single" },
  { text: "Подпись стороны 2:", border: "dashed" },
];
const dataOf = (buf) => `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${buf.toString("base64")}`;
const PNG = "data:image/png;base64," + Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0, 0, 0, 0x02, 0, 0, 0, 0x01, 0x08, 0x06, 0, 0, 0, 0x72, 0xb6, 0x0d, 0x24,
  0, 0, 0, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05,
  0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]).toString("base64");
const sig = (by) => ({ by, at: "2026-09-14T10:00:00Z", w: 300, h: 200, ua: "test",
  strokes: [Array.from({ length: 14 }, (_, i) => ({ x: i * 5, y: 10 + (i % 3), t: i * 30, p: 0.5 }))],
  png: PNG, hash: "clienthash" });

const uploadDoc = async (name = "Договор подряда", paras = CONTRACT) => {
  const buf = await docx.buildDocx(paras);
  return request(app).post("/api/org/docs").set(as(100))
    .send({ name, note: "первая", file: { name: `${name}.docx`, data: dataOf(buf) } });
};

describe("документы", () => {
  it("загрузка находит плейсхолдеры и рамки; без sum/start/end — отказ; не Word — отказ", async () => {
    const r = await uploadDoc();
    expect(r.status).toBe(201);
    const v = r.body.versions[0];
    expect(v.placeholders.map((p) => p.key)).toEqual(["fio", "city", "sum", "start", "end"]);
    expect(v.frames).toEqual({ p1: 3, p2: 4 });
    expect(v.file.url).toMatch(/^\/api\/reports\//);
    const bad = await docx.buildDocx(["Договор без суммы [(fio): ФИО]"]);
    const r2 = await request(app).post("/api/org/docs").set(as(100))
      .send({ name: "плохой", file: { name: "плохой.docx", data: dataOf(bad) } });
    expect(r2.status).toBe(400);
    expect(r2.body.error).toMatch(/sum/);
    const r3 = await request(app).post("/api/org/docs").set(as(100))
      .send({ name: "pdf", file: { name: "d.pdf", data: "data:application/pdf;base64,QUJD" } });
    expect(r3.status).toBe(400);
    // Список организации несёт документы, но не штрихи подписей.
    const list = await request(app).get("/api/org").set(as(100));
    expect(list.body.docs.map((d) => d.name)).toEqual(["Договор подряда"]);
  });

  it("версии: правка через HTML даёт новую версию с описанием; удалить можно старую, не последнюю; текст читается", async () => {
    const doc = (await uploadDoc()).body;
    const html = await request(app).get(`/api/org/docs/${doc.id}/html`).set(as(100));
    expect(html.status).toBe(200);
    expect(html.body.html).toContain("[(fio): ФИО исполнителя]");
    expect(html.body.html).toContain("border:1px dashed");
    const edited = html.body.html.replace("ДОГОВОР ПОДРЯДА", "ДОГОВОР ПОДРЯДА № 2");
    const v2 = await request(app).post(`/api/org/docs/${doc.id}/versions`).set(as(100))
      .send({ html: edited, note: "номер договора" });
    expect(v2.status).toBe(201);
    expect(v2.body.versions).toHaveLength(2);
    expect(v2.body.versions[1].note).toBe("номер договора");
    expect(v2.body.versions[1].frames).toEqual({ p1: 3, p2: 4 });
    const html2 = await request(app).get(`/api/org/docs/${doc.id}/html`).set(as(100));
    expect(html2.body.html).toContain("№ 2");
    // Последнюю удалить нельзя, старую — можно.
    const [v1, last] = v2.body.versions;
    expect((await request(app).delete(`/api/org/docs/${doc.id}/versions/${last.id}`).set(as(100))).status).toBe(400);
    const del = await request(app).delete(`/api/org/docs/${doc.id}/versions/${v1.id}`).set(as(100));
    expect(del.status).toBe(200);
    expect(del.body.versions).toHaveLength(1);
    // Значения плейсхолдеров — у документа.
    const upd = await request(app).put(`/api/org/docs/${doc.id}`).set(as(100)).send({ values: { city: "Казань" } });
    expect(upd.body.values).toEqual({ city: "Казань" });
    // Не владельцу — отказ.
    expect((await request(app).get(`/api/org/docs/${doc.id}/html`).set(as(200))).status).toBe(403);
  });
});

describe("приглашение и подпись", () => {
  const setup = async () => {
    const doc = (await uploadDoc()).body;
    const role = await org.addRole({ name: "подрядчик", tabs: ["tasks"] });
    await request(app).put(`/api/org/roles/${role.id}/doc`).set(as(100)).send({ docId: doc.id });
    await request(app).put(`/api/org/docs/${doc.id}`).set(as(100)).send({ values: { city: "Москва" } });
    return { doc, role };
  };

  it("владелец выдаёт договор: сумма, даты и подпись обязательны; ссылка на бота; позванный подписывает и получает роль", async () => {
    const { doc, role } = await setup();
    const base = { docId: doc.id, roleId: role.id, values: {}, sum: "50000", start: "2026-01-01", end: "2099-12-31" };
    expect((await request(app).post("/api/org/agreements").set(as(100)).send({ ...base, sum: "" })).status).toBe(400);
    expect((await request(app).post("/api/org/agreements").set(as(100)).send({ ...base, end: "2025-01-01", sign1: sig("100") })).status).toBe(400);
    expect((await request(app).post("/api/org/agreements").set(as(100)).send(base)).status).toBe(400);
    const a = await request(app).post("/api/org/agreements").set(as(100)).send({ ...base, sign1: sig("100") });
    expect(a.status).toBe(201);
    expect(a.body.link).toBe(`https://t.me/sd_bot?start=agr_${a.body.token}`);
    expect(a.body.sign1.serverHash).toHaveLength(64);
    expect(a.body.sign1.strokes).toBeUndefined();   // штрихи наружу списком не уходят

    // Человек открыл бота по ссылке — договор его, роль приготовлена.
    const { claimAgreement } = await import("../lib/contractStore.js");
    await claimAgreement(a.body.token, { id: "200", name: "Пётр", username: "petr" });
    const me = await request(app).get("/api/org/me").set(as(200));
    expect(me.body.known).toBe(true);
    expect(me.body.tabs).toEqual([]);   // роль не действует, пока не подписан
    expect(me.body.agreement).toMatchObject({ id: a.body.id, docName: "Договор подряда", roleName: "подрядчик",
      sum: "50000" });
    const left = me.body.agreement.placeholders.filter((p) => !p.value).map((p) => p.key);
    expect(left).toEqual(["fio"]);   // city — от владельца, sum/start/end — из выдачи
    // Текст договора — с заполненным.
    const html = await request(app).get(`/api/org/agreements/${a.body.id}/html`).set(as(200));
    expect(html.body.html).toContain("Москва");
    expect(html.body.html).toContain("50000");
    expect((await request(app).get(`/api/org/agreements/${a.body.id}/html`).set(as(300))).status).toBe(403);

    // Подписать без ФИО нельзя: договор выдаётся только заполненным.
    const no = await request(app).post(`/api/org/agreements/${a.body.id}/sign`).set(as(200))
      .send({ values: {}, sign2: sig("200") });
    expect(no.status).toBe(400);
    expect(no.body.error).toMatch(/ФИО/);
    const ok = await request(app).post(`/api/org/agreements/${a.body.id}/sign`).set(as(200))
      .send({ values: { fio: "Пётр Петров" }, sign2: sig("200") });
    expect(ok.status).toBe(200);
    expect(ok.body.agreement.status).toBe("signed");
    expect(ok.body.agreement.file.url).toMatch(/^\/api\/reports\//);
    expect(ok.body.me.tabs).toEqual(["tasks"]);
    expect(ok.body.me.agreement).toBeNull();

    // Готовый файл: плейсхолдеры заполнены, обе подписи внутри.
    const file = await request(app).get(ok.body.agreement.file.url).buffer().parse((res, cb) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(file.status).toBe(200);
    const text = (await docx.docxText(Buffer.from(file.body))).join("\n");
    expect(text).toContain("Пётр Петров");
    expect(text).not.toContain("[(");
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(Buffer.from(file.body));
    expect(Object.keys(zip.files).filter((f) => /^word\/media\/.+\.png$/.test(f))).toHaveLength(2);

    // На «Участниках» — договор с датами и суммой, роль действует.
    const list = await request(app).get("/api/org").set(as(100));
    const petr = list.body.users.find((u) => u.id === "200");
    expect(petr.agreements[0]).toMatchObject({ roleId: role.id, sum: "50000", start: "2026-01-01", end: "2099-12-31" });
    expect(petr.active).toEqual([role.id]);
  });

  it("роль не действует вне срока договора или когда отключена на «Участниках»", async () => {
    const { doc, role } = await setup();
    const { claimAgreement, signAgreement } = await import("../lib/contractStore.js");
    const a = (await request(app).post("/api/org/agreements").set(as(100))
      .send({ docId: doc.id, roleId: role.id, values: { fio: "Пётр" }, sum: "1", start: "2020-01-01", end: "2020-12-31", sign1: sig("100") })).body;
    await claimAgreement(a.token, { id: "200", name: "Пётр" });
    await signAgreement("200", a.id, { values: {}, sign2: sig("200") });
    const me = await request(app).get("/api/org/me").set(as(200));
    expect(me.body.tabs).toEqual([]);
    expect(me.body.inactive).toEqual([{ id: role.id, name: "подрядчик", why: "срок договора закончился" }]);
    // Новый договор на будущее — тоже не действует, но по другой причине.
    const b = (await request(app).post("/api/org/agreements").set(as(100))
      .send({ docId: doc.id, roleId: role.id, values: { fio: "Пётр" }, sum: "2", start: "2099-01-01", end: "2099-12-31", sign1: sig("100") })).body;
    await claimAgreement(b.token, { id: "200", name: "Пётр" });
    await signAgreement("200", b.id, { values: {}, sign2: sig("200") });
    expect((await request(app).get("/api/org/me").set(as(200))).body.inactive[0].why).toBe("срок договора ещё не начался");
    // Действующий — открывает; отключили роль на «Участниках» — закрыт.
    const c = (await request(app).post("/api/org/agreements").set(as(100))
      .send({ docId: doc.id, roleId: role.id, values: { fio: "Пётр" }, sum: "3", start: "2026-01-01", end: "2099-12-31", sign1: sig("100") })).body;
    await claimAgreement(c.token, { id: "200", name: "Пётр" });
    await signAgreement("200", c.id, { values: {}, sign2: sig("200") });
    expect((await request(app).get("/api/org/me").set(as(200))).body.tabs).toEqual(["tasks"]);
    await request(app).put("/api/org/users/200/roles").set(as(100)).send({ roles: [] });
    expect((await request(app).get("/api/org/me").set(as(200))).body.tabs).toEqual([]);
  });

  it("добавление по пересылке привязывает ждущий договор роли; чужой токен и повтор — отказ", async () => {
    const { doc, role } = await setup();
    const { bindLatestAgreement, claimAgreement } = await import("../lib/contractStore.js");
    const a = (await request(app).post("/api/org/agreements").set(as(100))
      .send({ docId: doc.id, roleId: role.id, values: {}, sum: "5", start: "2026-01-01", end: "2099-12-31", sign1: sig("100") })).body;
    await org.addUser({ id: "300", name: "Третий", roleId: role.id, addedBy: "100" });
    const bound = await bindLatestAgreement("300", role.id, { name: "Третий" });
    expect(bound.to.id).toBe("300");
    await expect(claimAgreement(a.token, { id: "200", name: "Пётр" })).rejects.toThrow(/другому/);
    await expect(claimAgreement("nope", { id: "200" })).rejects.toThrow(/не открывает/);
    const me = await request(app).get("/api/org/me").set(as(300));
    expect(me.body.agreement.id).toBe(a.id);
    // Отзыв — пока не подписан.
    expect((await request(app).delete(`/api/org/agreements/${a.id}`).set(as(100))).status).toBe(200);
    expect((await request(app).get("/api/org/me").set(as(300))).body.agreement).toBeNull();
  });
});
