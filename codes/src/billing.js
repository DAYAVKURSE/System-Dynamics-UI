import crypto from "node:crypto";
import { CURRENCY, DEFAULT_PLANS, STARS_PER_USD_DEFAULT, cleanPlan, methodOf } from "./plans.js";
import { dataFile, readJson, readUsers, serial, writeJson, withUsers } from "./store.js";
import { accountBalance, findIncoming, jettonBalance, tonUsd } from "./chain.js";

/* ════════════════════════════════════════════════════════════════
   БИЛЛИНГ · планы, подписки, кошельки, платежи (владелец, 2026-09-21)

   · планы — `plans.json`: название, цена в долларах, срок в днях,
     уровень (что открывает);
   · подписка — у человека в `users.json`: `planId`, `plan` (уровень —
     он и уходит в токен), `until`, `price`/`currency` последней оплаты;
   · кошельки — `wallets.json`: по каждой валюте их может быть несколько,
     при оплате берётся случайный; Stars — «кошелёк» самого бота с
     курсом «звёзд за доллар»;
   · платежи — `payments.json`: ожидающие и состоявшиеся; TON и USDT
     проверяются по цепочке (chain.js), Stars — подтверждает основной
     бот, ручная выдача — админ-панель.

   Владелец узнаёт о каждой оплате: `onPaid` зовёт админ-бот.
   ════════════════════════════════════════════════════════════════ */
const now = () => new Date().toISOString();
const uid = (p) => `${p}_${crypto.randomBytes(6).toString("base64url")}`;
const DAY = 86400000;

/* ─────── планы ─────── */
export async function listPlans() {
  const list = await readJson(dataFile("plans.json"), null);
  return Array.isArray(list) && list.length ? list.map((p) => cleanPlan(p, p)) : DEFAULT_PLANS.map((p) => ({ ...p }));
}
const writePlans = (list) => writeJson(dataFile("plans.json"), list);
export const planById = async (id) => (await listPlans()).find((p) => p.id === String(id)) || null;
export function addPlan() {
  return serial(async () => {
    const list = await listPlans();
    const p = { id: uid("plan"), name: "новый план", price: 0, days: 30, level: "pro" };
    await writePlans([...list, p]);
    return p;
  });
}
export function savePlan(id, fields) {
  return serial(async () => {
    const list = await listPlans();
    const was = list.find((p) => p.id === String(id));
    if (!was) throw new Bad(404, "план не найден");
    const next = cleanPlan(fields, was);
    // Уровень free — без цены и срока: он открыт всем и всегда.
    if (next.level === "free") { next.price = 0; next.days = 0; }
    await writePlans(list.map((p) => (p === was ? next : p)));
    return next;
  });
}
export function removePlan(id) {
  return serial(async () => {
    const list = await listPlans();
    if (String(id) === "free") throw new Bad(400, "план free не удаляется");
    if (!list.some((p) => p.id === String(id))) throw new Bad(404, "план не найден");
    await writePlans(list.filter((p) => p.id !== String(id)));
    return { ok: true };
  });
}

/* ─────── кошельки ─────── */
const EMPTY_WALLETS = () => ({ stars: { name: "Telegram Stars", starsPerUsd: STARS_PER_USD_DEFAULT }, wallets: [] });
export async function readWallets() {
  const w = await readJson(dataFile("wallets.json"), null);
  if (!w || typeof w !== "object") return EMPTY_WALLETS();
  return { stars: { ...EMPTY_WALLETS().stars, ...(w.stars || {}) },
    wallets: Array.isArray(w.wallets) ? w.wallets : [] };
}
const writeWallets = (w) => writeJson(dataFile("wallets.json"), w);
const cleanAddress = (v) => String(v || "").trim().slice(0, 80);
export function addWallet({ currency, name, address }) {
  return serial(async () => {
    const cur = String(currency || "").toLowerCase();
    if (!["ton", "usdt"].includes(cur)) throw new Bad(400, "валюта: ton или usdt");
    const w = await readWallets();
    const wallet = { id: uid("w"), currency: cur, name: String(name || "").trim().slice(0, 60) || `${CURRENCY[cur]} кошелёк`,
      address: cleanAddress(address), createdAt: now() };
    w.wallets.push(wallet);
    await writeWallets(w);
    return wallet;
  });
}
export function saveWallet(id, fields = {}) {
  return serial(async () => {
    const w = await readWallets();
    const wallet = w.wallets.find((x) => x.id === String(id));
    if (!wallet) throw new Bad(404, "кошелёк не найден");
    if ("name" in fields) wallet.name = String(fields.name || "").trim().slice(0, 60) || wallet.name;
    if ("address" in fields) wallet.address = cleanAddress(fields.address);
    await writeWallets(w);
    return wallet;
  });
}
export function removeWallet(id) {
  return serial(async () => {
    const w = await readWallets();
    if (!w.wallets.some((x) => x.id === String(id))) throw new Bad(404, "кошелёк не найден");
    w.wallets = w.wallets.filter((x) => x.id !== String(id));
    await writeWallets(w);
    return { ok: true };
  });
}
export function saveStars(fields = {}) {
  return serial(async () => {
    const w = await readWallets();
    if ("name" in fields) w.stars.name = String(fields.name || "").trim().slice(0, 60) || w.stars.name;
    if ("starsPerUsd" in fields) {
      const n = Number(fields.starsPerUsd);
      if (Number.isFinite(n) && n > 0) w.stars.starsPerUsd = Math.round(n * 100) / 100;
    }
    await writeWallets(w);
    return w.stars;
  });
}
/** Случайный кошелёк валюты с адресом — так просил владелец. */
export async function pickWallet(currency) {
  const w = await readWallets();
  const fit = w.wallets.filter((x) => x.currency === currency && x.address);
  if (!fit.length) return null;
  return fit[crypto.randomInt(fit.length)];
}
/** Какие способы сейчас доступны: Stars всегда, TON/USDT — если есть кошелёк. */
export async function methodsAvailable() {
  const w = await readWallets();
  const has = (c) => w.wallets.some((x) => x.currency === c && x.address);
  return ["stars", ...(has("ton") ? ["ton"] : []), ...(has("usdt") ? ["usdt"] : [])];
}

/* ─────── платежи ─────── */
export async function readPayments() {
  const list = await readJson(dataFile("payments.json"), []);
  return Array.isArray(list) ? list : [];
}
const writePayments = (list) => writeJson(dataFile("payments.json"), list);

/** Сколько это в валюте способа. */
export async function quote(usd, method) {
  const w = await readWallets();
  if (method === "stars") return { amount: Math.max(1, Math.round(usd * (w.stars.starsPerUsd || STARS_PER_USD_DEFAULT))), currency: "XTR" };
  if (method === "usdt") return { amount: Math.round(usd * 100) / 100, currency: "USDT" };
  const rate = await tonUsd();
  if (!rate) throw new Bad(503, "курс TON сейчас недоступен");
  return { amount: Math.ceil((usd / rate) * 1000) / 1000, currency: "TON" };
}

/** Короткий комментарий к переводу: по нему платёж узнаётся в цепочке. */
const comment = () => `SD-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

/**
 * Начать оплату плана: запись «ожидает». Для TON/USDT — адрес случайного
 * кошелька и комментарий; для Stars — сумма в звёздах (инвойс выпишет
 * основной бот). Бесплатный план оплаты не требует — это смена сразу.
 */
export function startPayment(user, planId, method) {
  return serial(async () => {
    const plan = await planById(planId);
    if (!plan) throw new Bad(404, "план не найден");
    const m = methodOf(method);
    if (!plan.price) return { plan, payment: null };
    if (!m) throw new Bad(400, "выберите способ оплаты");
    const q = await quote(plan.price, m);
    const wallet = m === "stars" ? null : await pickWallet(m);
    if (m !== "stars" && !wallet) throw new Bad(400, `кошелёк ${CURRENCY[m]} ещё не настроен`);
    const list = await readPayments();
    // Прежние ожидающие того же человека — снимаются: платить надо один раз.
    list.forEach((p) => { if (p.uid === user.uid && p.status === "pending") p.status = "expired"; });
    const payment = { id: uid("pay"), uid: user.uid, tg: user.tg || null, planId: plan.id, level: plan.level,
      planName: plan.name, days: plan.days, method: m, currency: q.currency, amount: q.amount, usd: plan.price,
      walletId: wallet?.id || null, address: wallet?.address || null, comment: m === "stars" ? null : comment(),
      status: "pending", at: now(), paidAt: null, tx: null };
    list.push(payment);
    await writePayments(list);
    return { plan, payment: publicPayment(payment) };
  });
}
export const publicPayment = (p) => ({ id: p.id, planId: p.planId, planName: p.planName, level: p.level,
  method: p.method, currency: p.currency, amount: p.amount, usd: p.usd, address: p.address, comment: p.comment,
  status: p.status, at: p.at, paidAt: p.paidAt, days: p.days });
export async function paymentById(id) {
  return (await readPayments()).find((p) => p.id === String(id)) || null;
}

/** Подписка включена: уровень, срок (к остатку прежнего), цена. */
async function applyPlan(uidOf, plan, { price, currency, days }) {
  return withUsers(async (users) => {
    const u = users.find((x) => x.uid === uidOf);
    if (!u) return { write: false, result: null };
    const base = u.until && Date.parse(u.until) > Date.now() && u.planId === plan.id ? Date.parse(u.until) : Date.now();
    const d = days != null ? Number(days) : plan.days;
    u.planId = plan.id; u.plan = plan.level;
    u.until = plan.level === "free" || !d ? null : new Date(base + d * DAY).toISOString();
    u.price = price ?? plan.price; u.currency = currency || "USD"; u.days = d;
    u.paidAt = now(); u.reminded = {}; u.cancelledAt = null;
    return { write: true, users, result: u };
  });
}

/** Платёж состоялся: подписка включается, платёж помечается. */
export function markPaid(paymentId, { tx = null, onPaid = null } = {}) {
  return serial(async () => {
    const list = await readPayments();
    const p = list.find((x) => x.id === String(paymentId));
    if (!p) throw new Bad(404, "платёж не найден");
    if (p.status === "paid") return { payment: publicPayment(p), user: null };
    const plan = (await planById(p.planId)) || { id: p.planId, name: p.planName, level: p.level, price: p.usd, days: p.days };
    p.status = "paid"; p.paidAt = now(); p.tx = tx;
    await writePayments(list);
    const user = await applyPlan(p.uid, plan, { price: p.amount, currency: p.currency, days: p.days });
    if (onPaid) { try { await onPaid(p, user); } catch { /* уведомление — не сделка */ } }
    return { payment: publicPayment(p), user };
  });
}

/** Ручная выдача из админ-панели: без платежа, но с записью в истории. */
export function issue(uidOf, { planId, price, days }) {
  return serial(async () => {
    const plan = await planById(planId);
    if (!plan) throw new Bad(404, "план не найден");
    const money = Number(price);
    const list = await readPayments();
    const p = { id: uid("pay"), uid: uidOf, planId: plan.id, level: plan.level, planName: plan.name,
      days: days != null ? Number(days) : plan.days, method: "issued", currency: "USD",
      amount: Number.isFinite(money) ? money : plan.price, usd: Number.isFinite(money) ? money : plan.price,
      walletId: null, address: null, comment: null, status: "paid", at: now(), paidAt: now(), tx: null };
    list.push(p);
    await writePayments(list);
    const user = await applyPlan(uidOf, plan, { price: p.amount, currency: "USD", days: p.days });
    return { payment: publicPayment(p), user };
  });
}

/** Отмена: план free с этой минуты. */
export function cancel(uidOf) {
  return withUsers(async (users) => {
    const u = users.find((x) => x.uid === String(uidOf));
    if (!u) throw new Bad(404, "пользователь не найден");
    u.planId = "free"; u.plan = "free"; u.until = null; u.cancelledAt = now(); u.reminded = {};
    return { write: true, users, result: u };
  });
}

/** Срок вышел — план free. Зовётся перед выдачей токена и по таймеру. */
export function expireTick(at = Date.now()) {
  return withUsers(async (users) => {
    let changed = false;
    users.forEach((u) => {
      if (u.plan !== "free" && u.until && Date.parse(u.until) <= at) {
        u.planId = "free"; u.plan = "free"; u.expiredAt = new Date(at).toISOString(); changed = true;
      }
    });
    return { write: changed, users, result: changed };
  });
}

/* ─────── напоминания: за 5, 3 и 1 день ─────── */
export const REMIND_MARKS = [5, 3, 1];
export async function expiring(at = Date.now()) {
  const users = await readUsers();
  const out = [];
  for (const u of users) {
    if (u.plan === "free" || !u.until) continue;
    const left = (Date.parse(u.until) - at) / DAY;
    if (left <= 0) continue;
    const daysLeft = Math.ceil(left);
    const mark = REMIND_MARKS.find((m) => daysLeft <= m && !(u.reminded || {})[m]);
    if (mark) out.push({ uid: u.uid, tg: u.tg || null, daysLeft, mark, planName: u.planId, until: u.until });
  }
  return out;
}
export function reminded(uidOf, mark) {
  return withUsers(async (users) => {
    const u = users.find((x) => x.uid === String(uidOf));
    if (!u) return { write: false, result: false };
    u.reminded = { ...(u.reminded || {}), [mark]: now() };
    return { write: true, users, result: true };
  });
}

/* ─────── проверка по цепочке ─────── */
/** Ожидающие TON/USDT: ищем входящий перевод с нужным комментарием. */
export async function checkChain({ onPaid = null } = {}) {
  const list = await readPayments();
  const pending = list.filter((p) => p.status === "pending" && p.method !== "stars" && p.address);
  let found = 0;
  for (const p of pending) {
    // Ожидание не вечно: сутки — и платёж снят, чтобы не сверять его годами.
    if (Date.now() - Date.parse(p.at) > DAY) {
      await serial(async () => {
        const l = await readPayments();
        const x = l.find((y) => y.id === p.id);
        if (x && x.status === "pending") { x.status = "expired"; await writePayments(l); }
      });
      continue;
    }
    let tx = null;
    try { tx = await findIncoming(p); } catch { tx = null; }
    if (tx) { await markPaid(p.id, { tx, onPaid }); found += 1; }
  }
  return found;
}

/* ─────── что показывает админ-панель ─────── */
export async function adminUsers() {
  const users = await readUsers();
  const plans = await listPlans();
  return users.map((u) => {
    const plan = plans.find((p) => p.id === u.planId) || null;
    const untilMs = u.until ? Date.parse(u.until) : null;
    const daysLeft = untilMs ? Math.max(0, Math.ceil((untilMs - Date.now()) / DAY)) : null;
    return { uid: u.uid, tg: u.tg || null, createdAt: u.createdAt, planId: u.planId || u.plan || "free",
      planName: plan?.name || u.planId || u.plan || "free", level: u.plan || "free",
      price: u.price ?? null, currency: u.currency || null, until: u.until || null, daysLeft,
      days: u.days ?? plan?.days ?? null, paidAt: u.paidAt || null, cancelledAt: u.cancelledAt || null };
  });
}
export async function adminWallets() {
  const w = await readWallets();
  const payments = await readPayments();
  const history = (pred) => payments.filter((p) => p.status === "paid" && pred(p))
    .map((p) => ({ id: p.id, uid: p.uid, tg: p.tg || null, amount: p.amount, currency: p.currency,
      planName: p.planName, at: p.paidAt || p.at, tx: p.tx })).reverse();
  const starsHistory = history((p) => p.method === "stars");
  const wallets = [];
  for (const x of w.wallets) {
    let balance = null;
    try { balance = x.currency === "ton" ? await accountBalance(x.address) : await jettonBalance(x.address); }
    catch { balance = null; }
    wallets.push({ ...x, balance, history: history((p) => p.walletId === x.id) });
  }
  return { stars: { ...w.stars, currency: "XTR", balance: starsHistory.reduce((n, p) => n + p.amount, 0),
    history: starsHistory }, wallets };
}

/** Человек по username или Telegram-id — сервис сам понимает, что прислали. */
export async function findUser(query) {
  const q = String(query || "").trim().replace(/^@/, "");
  if (!q) return null;
  const users = await readUsers();
  if (/^\d+$/.test(q)) return users.find((u) => String(u.tg?.id || "") === q) || users.find((u) => u.uid === q) || null;
  const low = q.toLowerCase();
  return users.find((u) => String(u.tg?.username || "").toLowerCase() === low) || users.find((u) => u.uid === q) || null;
}

export class Bad extends Error { constructor(status, message) { super(message); this.status = status; } }
