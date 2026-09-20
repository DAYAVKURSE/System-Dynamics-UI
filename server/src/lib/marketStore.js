import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { withModel, writeModel } from "./workspaceStore.js";

/* ════════════════════════════════════════════════════════════════
   РЫНОК УСЛУГ · заказы, услуги, отклики, чат, бриф, сделка

   Владелец (2026-09-13): «новая вкладка «Рынок услуг», первая, перед
   анкетой; внутри две: «Заказы» и «Услуги». Любой зарегистрированный
   пользователь может оставить заказ: название, содержание, стоимость и
   другие предоставляемые ресурсы. В настройках функции — «Сделать заказ»
   (заказ появляется у всех в заказах) и «Сделать услугой» (функция
   выкладывается в услуги). В услуге: название, описание, какие ресурсы
   берёт, какие выдаёт, за какое время выполняется. Заказчику при
   создании заказа показываются подходящие услуги, одну можно выбрать.
   Пользователи оставляют предложения, видные только автору заказа. При
   открытии отклика — чат между заказчиком и исполнителем. У обоих —
   кнопка «Договорились»: выбор, какие ресурсы и сколько отдать, какой
   получить и ожидаемое время. После заполнения одной из сторон у обоих
   — «Есть предложение»: отредактировать (кнопка меняет цвет) или
   принять. После принятия заказчику предложено загрузить ресурсы, а у
   исполнителя появляются задачи».

   ─── что где лежит ───

   Один файл `market.json` на сервер — рынок общий для всех, кто
   зарегистрирован (позван в организацию); модель владельца он не трогает,
   пока не заключена сделка. Заказ и услуга — ЗАПИСИ, а не ссылки на
   функцию: функция даёт им начальные слова (название, описание, ресурсы,
   срок), дальше запись живёт своей жизнью и правится автором. Функция
   помнится по `funcId` — по нему сделка заводит задачу.

   Отклик виден ДВОИМ: автору заказа и своему автору; остальным откликов
   не существует — так просил владелец, и так честно: отклик — это
   предложение одному человеку, а не объявление. Чат живёт внутри
   отклика — он и есть разговор этих двоих. Бриф — тоже внутри: одна
   запись на отклик, кто последний правил — тот и `by`; принять её может
   только другая сторона (своё предложение принимать не у кого).

   Сделка (`accept`) заводит задачу в модели владельца: постановщик и
   проверяющий — заказчик, исполнитель — откликнувшийся, функция — из
   услуги или заказа. Заводится сразу в бэклог: постановка уже была —
   это бриф. Что заказчик отдаёт, он загружает после сделки
   (`deliveries`): файл — через хранилище отчётов, текст — тут же.

   Имена людей здесь не хранятся — только id; кто есть кто, маршрут
   спрашивает у организации при ответе.
   ════════════════════════════════════════════════════════════════ */

export const ORDER_STATUS = ["open", "deal", "done"];

const MAX_NAME = 120;
const MAX_TEXT = 4000;
const MAX_CHAT = 2000;
const MAX_ROWS = 30;
const MAX_LIST = 2000;

export class BadInput extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function baseDir() {
  return process.env.MARKET_DIR
    ? path.resolve(process.env.MARKET_DIR)
    : path.resolve(process.cwd(), "data", "market");
}
const file = () => path.join(baseDir(), "market.json");

const EMPTY = () => ({ orders: [], services: [] });

export async function readMarket() {
  try {
    const parsed = JSON.parse(await fs.readFile(file(), "utf8"));
    return {
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      services: Array.isArray(parsed.services) ? parsed.services : [],
    };
  } catch { return EMPTY(); }
}

async function writeMarket(m) {
  await fs.mkdir(baseDir(), { recursive: true });
  const tmp = `${file()}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(m), "utf8");
    await fs.rename(tmp, file());
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  return m;
}

/* Очередь правок — одна на процесс, как `withModel`: два отклика в одну
   секунду не должны затирать друг друга. */
let chain = Promise.resolve();
function withMarket(job) {
  const run = async () => job(await readMarket());
  const next = chain.then(run, run);
  chain = next.then(() => {}, () => {});
  return next;
}

/* ─────── чистка входа ─────── */

const uid = (p) => `${p}_${crypto.randomBytes(5).toString("hex")}`;
const now = () => new Date().toISOString();
const str = (v, max) => String(v ?? "").trim().slice(0, max);
const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
/* Строка ресурса — «что» и «сколько»; без имени строки нет. */
const rows = (list) => (Array.isArray(list) ? list : [])
  .map((r) => ({ name: str(r?.name, MAX_NAME), qty: num(r?.qty) }))
  .filter((r) => r.name)
  .slice(0, MAX_ROWS);
const one = (r) => (r && str(r.name, MAX_NAME) ? { name: str(r.name, MAX_NAME), qty: num(r.qty) } : null);
const sid = (v) => (v == null || v === "" ? null : str(v, 80));

/* ─────── кто что видит ─────── */

const mine = (a, b) => String(a) === String(b);

/** Отклик глазами человека: только автору заказа и автору отклика. */
export const canSeeOffer = (order, offer, userId) =>
  mine(order.by, userId) || mine(offer.by, userId);

/** Заказ глазами человека: чужие отклики убраны, свои — целиком. */
export function orderViewFor(order, userId) {
  return {
    ...order,
    offers: (order.offers || []).filter((o) => canSeeOffer(order, o, userId)),
    offerCount: (order.offers || []).length,
  };
}

export async function viewFor(userId) {
  const m = await readMarket();
  return {
    orders: m.orders.map((o) => orderViewFor(o, userId)),
    services: m.services,
  };
}

/** Чьи имена нужны ответу: авторы заказов, услуг, откликов и реплик. */
export function peopleOf(view) {
  const ids = new Set();
  (view.orders || []).forEach((o) => {
    ids.add(String(o.by));
    (o.offers || []).forEach((f) => {
      ids.add(String(f.by));
      (f.chat || []).forEach((c) => ids.add(String(c.by)));
      if (f.brief?.by != null) ids.add(String(f.brief.by));
    });
  });
  (view.services || []).forEach((s) => ids.add(String(s.by)));
  return ids;
}

/* ─────── заказы ─────── */

export function addOrder(userId, fields = {}) {
  return withMarket(async (m) => {
    const name = str(fields.name, MAX_NAME);
    if (!name) throw new BadInput("У заказа должно быть название");
    if (m.orders.length >= MAX_LIST) throw new BadInput("Заказов слишком много — удалите старые");
    const order = {
      id: uid("ord"), by: String(userId), at: now(),
      name, text: str(fields.text, MAX_TEXT), price: num(fields.price),
      resources: rows(fields.resources),
      funcId: sid(fields.funcId), serviceId: sid(fields.serviceId),
      status: "open", offers: [],
    };
    m.orders.push(order);
    await writeMarket(m);
    return orderViewFor(order, userId);
  });
}

export function updateOrder(userId, id, fields = {}) {
  return withMarket(async (m) => {
    const order = m.orders.find((o) => o.id === String(id));
    if (!order) throw new BadInput("Заказ не найден", 404);
    if (!mine(order.by, userId)) throw new BadInput("Править заказ может только его автор", 403);
    if (order.status !== "open") throw new BadInput("По заказу уже договорились — он не правится");
    if ("name" in fields) {
      const name = str(fields.name, MAX_NAME);
      if (!name) throw new BadInput("У заказа должно быть название");
      order.name = name;
    }
    if ("text" in fields) order.text = str(fields.text, MAX_TEXT);
    if ("price" in fields) order.price = num(fields.price);
    if ("resources" in fields) order.resources = rows(fields.resources);
    if ("serviceId" in fields) order.serviceId = sid(fields.serviceId);
    await writeMarket(m);
    return orderViewFor(order, userId);
  });
}

export function removeOrder(userId, id, { isOwner = false } = {}) {
  return withMarket(async (m) => {
    const order = m.orders.find((o) => o.id === String(id));
    if (!order) throw new BadInput("Заказ не найден", 404);
    if (!isOwner && !mine(order.by, userId)) throw new BadInput("Удалить заказ может только его автор", 403);
    m.orders = m.orders.filter((o) => o !== order);
    await writeMarket(m);
    return { ok: true };
  });
}

/* ─────── услуги ─────── */

export function addService(userId, fields = {}) {
  return withMarket(async (m) => {
    const name = str(fields.name, MAX_NAME);
    if (!name) throw new BadInput("У услуги должно быть название");
    if (m.services.length >= MAX_LIST) throw new BadInput("Услуг слишком много — удалите старые");
    const s = {
      id: uid("svc"), by: String(userId), at: now(),
      name, text: str(fields.text, MAX_TEXT),
      takes: rows(fields.takes), gives: rows(fields.gives),
      days: num(fields.days), funcId: sid(fields.funcId),
      /* «Принять автоматически в рабочее время» (владелец, 2026-09-20):
         заказ по такой услуге не ждёт отклика — он его получает сам.
         Рабочее время проверяет маршрут: часы лежат в анкете. */
      auto: fields.auto === true,
    };
    m.services.push(s);
    await writeMarket(m);
    return s;
  });
}

export function updateService(userId, id, fields = {}) {
  return withMarket(async (m) => {
    const s = m.services.find((x) => x.id === String(id));
    if (!s) throw new BadInput("Услуга не найдена", 404);
    if (!mine(s.by, userId)) throw new BadInput("Править услугу может только её автор", 403);
    if ("name" in fields) {
      const name = str(fields.name, MAX_NAME);
      if (!name) throw new BadInput("У услуги должно быть название");
      s.name = name;
    }
    if ("text" in fields) s.text = str(fields.text, MAX_TEXT);
    if ("takes" in fields) s.takes = rows(fields.takes);
    if ("gives" in fields) s.gives = rows(fields.gives);
    if ("days" in fields) s.days = num(fields.days);
    if ("auto" in fields) s.auto = fields.auto === true;
    await writeMarket(m);
    return s;
  });
}

export function removeService(userId, id, { isOwner = false } = {}) {
  return withMarket(async (m) => {
    const s = m.services.find((x) => x.id === String(id));
    if (!s) throw new BadInput("Услуга не найдена", 404);
    if (!isOwner && !mine(s.by, userId)) throw new BadInput("Удалить услугу может только её автор", 403);
    m.services = m.services.filter((x) => x !== s);
    await writeMarket(m);
    return { ok: true };
  });
}

/* ─────── отклики и чат ─────── */

const findOffer = (m, orderId, offerId) => {
  const order = m.orders.find((o) => o.id === String(orderId));
  if (!order) throw new BadInput("Заказ не найден", 404);
  const offer = (order.offers || []).find((f) => f.id === String(offerId));
  if (!offer) throw new BadInput("Отклик не найден", 404);
  return { order, offer };
};
const party = (order, offer, userId) => {
  if (!canSeeOffer(order, offer, userId)) throw new BadInput("Это не ваш отклик", 403);
};

/** Отклик — предложение заказчику. Один на человека: второй правит первый. */
export function addOffer(userId, orderId, fields = {}) {
  return withMarket(async (m) => {
    const order = m.orders.find((o) => o.id === String(orderId));
    if (!order) throw new BadInput("Заказ не найден", 404);
    if (mine(order.by, userId)) throw new BadInput("На свой заказ не откликаются");
    if (order.status !== "open") throw new BadInput("По заказу уже договорились");
    const text = str(fields.text, MAX_TEXT);
    if (!text) throw new BadInput("Напишите, что предлагаете");
    let offer = (order.offers || []).find((f) => mine(f.by, userId));
    if (offer) {
      offer.text = text;
      if ("serviceId" in fields) offer.serviceId = sid(fields.serviceId);
    } else {
      offer = { id: uid("off"), by: String(userId), at: now(), text,
        serviceId: sid(fields.serviceId), chat: [], brief: null, accepted: false,
        taskId: null, deliveries: [] };
      order.offers = [...(order.offers || []), offer];
    }
    await writeMarket(m);
    return offer;
  });
}

export function addChat(userId, orderId, offerId, text) {
  return withMarket(async (m) => {
    const { order, offer } = findOffer(m, orderId, offerId);
    party(order, offer, userId);
    const t = str(text, MAX_CHAT);
    if (!t) throw new BadInput("Пустое сообщение не отправляется");
    const line = { id: uid("msg"), by: String(userId), at: now(), text: t };
    offer.chat = [...(offer.chat || []), line];
    await writeMarket(m);
    return offer;
  });
}

/* ─────── бриф: «Договорились» → «Есть предложение» ─────── */

/**
 * Бриф пишет любая из сторон; кто писал последним — тот и `by`, и у
 * другой стороны кнопка «Есть предложение» окрашена: ей есть что принять.
 * Правка после принятия невозможна — сделка заключена.
 */
export function setBrief(userId, orderId, offerId, fields = {}) {
  return withMarket(async (m) => {
    const { order, offer } = findOffer(m, orderId, offerId);
    party(order, offer, userId);
    if (offer.accepted) throw new BadInput("Предложение уже принято — бриф закрыт");
    const gives = rows(fields.gives);
    const gets = one(fields.gets);
    const days = num(fields.days);
    if (!gives.length && !gets) throw new BadInput("Назовите хотя бы что отдаёте или что получаете");
    offer.brief = {
      by: String(userId), at: now(), rev: (offer.brief?.rev || 0) + 1,
      gives, gets, days, note: str(fields.note, MAX_TEXT),
    };
    await writeMarket(m);
    return offer;
  });
}

/**
 * Принять предложение может только та сторона, что его НЕ писала: своё
 * предложение принимать не у кого. Сделка: заказ закрывается для других
 * откликов, у исполнителя заводится задача в модели владельца.
 */
export function acceptBrief(userId, orderId, offerId) {
  return withMarket(async (m) => {
    const { order, offer } = findOffer(m, orderId, offerId);
    party(order, offer, userId);
    if (!offer.brief) throw new BadInput("Предложения ещё нет — сначала «Договорились»");
    if (offer.accepted) throw new BadInput("Уже принято");
    if (mine(offer.brief.by, userId)) throw new BadInput("Это ваше предложение — принять его должна другая сторона");
    if (order.status !== "open") throw new BadInput("По заказу уже договорились с другим исполнителем");
    const svc = m.services.find((s) => s.id === (offer.serviceId || order.serviceId));
    const task = await withModel(async (model) => {
      const t = taskOf(order, offer, svc);
      model.tasks = [...(model.tasks || []), t];
      await writeModel(model);
      return t;
    });
    offer.accepted = true;
    offer.acceptedBy = String(userId);
    offer.acceptedAt = now();
    offer.taskId = task.id;
    order.status = "deal";
    await writeMarket(m);
    return { offer, task };
  });
}

/* Задача сделки: постановка уже была — это бриф, поэтому сразу в бэклог.
   Постановщик и проверяющий — заказчик: он и ставил, и примет. Срок — по
   брифу, назначен рукой: это обещание, а не производная от начала. */
export function taskOf(order, offer, svc) {
  const b = offer.brief || {};
  const start = new Date();
  const days = b.days != null ? b.days : (svc?.days ?? null);
  const end = days != null ? new Date(start.getTime() + days * 86400000) : null;
  const lines = [];
  if (order.text) lines.push(order.text);
  if (b.gives?.length) lines.push(`Заказчик отдаёт: ${b.gives.map(rowText).join(", ")}.`);
  if (b.gets) lines.push(`Исполнитель выдаёт: ${rowText(b.gets)}.`);
  if (b.note) lines.push(b.note);
  return {
    id: uid("tk"), funcId: svc?.funcId || order.funcId || null,
    title: order.name, body: lines.join("\n"),
    status: "backlog", taken: false, canceled: false, deferredAt: null,
    setter: String(order.by), assignee: String(offer.by), reviewer: String(order.by),
    start: start.toISOString(), end: end ? end.toISOString() : null, endBy: "hand",
    market: { orderId: order.id, offerId: offer.id },
    submissions: [], reviews: [], chat: [],
  };
}
const rowText = (r) => (r.qty != null ? `${r.name} × ${r.qty}` : r.name);

/* ─────── что заказчик отдаёт после сделки ─────── */

export function addDelivery(userId, orderId, offerId, fields = {}) {
  return withMarket(async (m) => {
    const { order, offer } = findOffer(m, orderId, offerId);
    if (!mine(order.by, userId)) throw new BadInput("Ресурсы по сделке загружает заказчик", 403);
    if (!offer.accepted) throw new BadInput("Сделки ещё нет — загружать пока нечего");
    const name = str(fields.name, MAX_NAME);
    const text = str(fields.text, MAX_TEXT);
    const f = fields.file && typeof fields.file === "object"
      ? { id: str(fields.file.id, 80), name: str(fields.file.name, MAX_NAME), url: str(fields.file.url, 400) }
      : null;
    if (!name && !text && !f) throw new BadInput("Назовите ресурс, приложите файл или напишите текст");
    offer.deliveries = [...(offer.deliveries || []),
      { id: uid("dlv"), by: String(userId), at: now(), name, text, file: f?.id || f?.url ? f : null }];
    await writeMarket(m);
    return offer;
  });
}
