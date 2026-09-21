import crypto from "node:crypto";
import { METHODS, levelOf } from "./plans.js";
import { hashKey, newKey, newUid, normKey, readUsers, serviceKeys, withUsers } from "./store.js";
import { TOKEN_TTL_S, signToken } from "./token.js";
import * as billing from "./billing.js";
import { Bad } from "./billing.js";
import { verifyInitData } from "./initData.js";

/* ════════════════════════════════════════════════════════════════
   СЕРВИС КОДОВ · что он умеет

   Один на всех и всегда на сервере владельца (владелец, 2026-09-21):
   код должен быть уникальным и неподделываемым, а это возможно, только
   если подписывает его один и тот же закрытый ключ. Хранилища же могут
   стоять где угодно — им нужен лишь открытый ключ. Здесь же — биллинг
   (billing.js) и админ-панель (admin.html).

   Для приложения (наружу через основной сервер, /api/codes/…):
   · POST /register {plan, method, tg}   → {uid, key, plan, token, exp, payment}
   · POST /token {key, tg}               → {uid, plan, token, exp}
   · POST /plan {key, plan, method}      → {payment | uid, plan, token, exp}
   · POST /rotate {key}                  → {uid, key, plan, token, exp}
   · GET  /payment/<id>                  → платёж и, если оплачен, свежий токен по ключу
   · GET  /plans                         → планы, способы, курс
   · GET  /public-key, GET /revoked
   Для основного сервера (только localhost):
   · POST /internal/paid {id, tx}        → Stars оплачены — подписка включена
   · GET  /internal/expiring, POST /internal/reminded {uid, mark}
   Для админ-панели (заголовок X-Admin-Init-Data админ-бота, только владелец):
   · /admin/users, /admin/plans, /admin/issue, /admin/wallets, /admin/stars
   ════════════════════════════════════════════════════════════════ */
const byKey = (users, key) => {
  const k = normKey(key);
  if (k.length < 16) throw new Bad(400, "key is required");
  const h = hashKey(k);
  const u = users.find((x) => x.keyHash === h);
  if (!u) throw new Bad(401, "unknown key");
  if (u.revokedAt) throw new Bad(401, "key revoked");
  return u;
};
const tgOf = (b) => (b?.tg && typeof b.tg === "object" && b.tg.id
  ? { id: String(b.tg.id), username: String(b.tg.username || ""), name: String(b.tg.name || "").slice(0, 80) }
  : null);

async function issueToken(u, now) {
  const { privateKey, kid } = await serviceKeys();
  // В токене — и план, и срок: приложению не нужен второй запрос за ними.
  const token = signToken({ uid: u.uid, plan: u.plan || "free", planId: u.planId || u.plan || "free",
    until: u.until || null, kid }, privateKey, now);
  return { uid: u.uid, plan: u.plan || "free", planId: u.planId || u.plan || "free", until: u.until || null,
    token, exp: Math.floor(now / 1000) + TOKEN_TTL_S };
}
/** Запомнить, с какого Telegram пришли: по нему админ узнаёт человека. */
async function noteTg(uidOf, tg) {
  if (!tg) return;
  await withUsers(async (users) => {
    const u = users.find((x) => x.uid === uidOf);
    if (!u) return { write: false };
    const was = JSON.stringify(u.tg || null);
    u.tg = { ...(u.tg || {}), ...tg };
    return { write: was !== JSON.stringify(u.tg), users };
  });
}

/* Кто зовёт наружу — уведомление владельцу и прочее задаёт index.js. */
const hooks = { onPaid: null, adminToken: () => process.env.ADMIN_BOT_TOKEN || "", ownerId: () => process.env.OWNER_TELEGRAM_ID || "" };
export const setHooks = (h) => Object.assign(hooks, h);

const adminOnly = (headers = {}) => {
  const token = hooks.adminToken();
  const owner = String(hooks.ownerId() || "").trim();
  if (!token) throw new Bad(503, "токен админ-бота не задан: пришлите основному боту /adminbot <токен>");
  if (!owner) throw new Bad(503, "владелец не определён: задайте OWNER_TELEGRAM_ID или откройте приложение владельцем");
  const init = String(headers["x-admin-init-data"] || headers["X-Admin-Init-Data"] || "");
  const r = verifyInitData(init, token);
  if (!r.ok) throw new Bad(401, "нужен вход через админ-бота");
  if (String(r.userId) !== owner) throw new Bad(403, "панель только для владельца");
  return r;
};

export async function handle(method, url, body = {}, now = Date.now(), headers = {}) {
  try {
    const path = String(url || "").split("?")[0].replace(/\/+$/, "") || "/";
    const b = body && typeof body === "object" ? body : {};
    if (method === "GET" && path === "/health") return { status: 200, body: { ok: true } };
    if (method === "GET" && path === "/plans") {
      return { status: 200, body: { plans: await billing.listPlans(), methods: await billing.methodsAvailable(),
        levels: ["free", "pro", "max"] } };
    }
    if (method === "GET" && path === "/public-key") {
      const { publicKey, kid } = await serviceKeys();
      return { status: 200, body: { alg: "Ed25519", kid, key: publicKey } };
    }
    if (method === "GET" && path === "/revoked") {
      const users = await readUsers();
      return { status: 200, body: { uids: users.filter((u) => u.revokedAt).map((u) => u.uid),
        at: new Date(now).toISOString() } };
    }
    if (method === "POST" && path === "/register") {
      const plan = (await billing.planById(b.plan)) || (await billing.planById("free"));
      if (!plan) throw new Bad(404, "план не найден");
      if (plan.price && !METHODS.includes(String(b.method))) throw new Bad(400, "payment method is required");
      const key = newKey();
      const tg = tgOf(b);
      const u = await withUsers(async (users) => {
        let id = newUid();
        while (users.some((x) => x.uid === id)) id = newUid();
        // Регистрируют всегда free: платный план включается оплатой.
        const user = { uid: id, keyHash: hashKey(key), plan: "free", planId: "free", until: null,
          tg, createdAt: new Date(now).toISOString(), payments: [] };
        return { write: true, users: [...users, user], result: user };
      });
      const { payment } = await billing.startPayment(u, plan.id, b.method);
      return { status: 201, body: { key, ...(await issueToken(u, now)), payment } };
    }
    if (method === "POST" && path === "/token") {
      await billing.expireTick(now);
      const users = await readUsers();
      const u = byKey(users, b.key);
      await noteTg(u.uid, tgOf(b));
      return { status: 200, body: await issueToken(u, now) };
    }
    if (method === "POST" && path === "/plan") {
      await billing.expireTick(now);
      const users = await readUsers();
      const u = byKey(users, b.key);
      const plan = await billing.planById(b.plan);
      if (!plan) throw new Bad(404, "план не найден");
      if (!plan.price) {
        // Бесплатный — сразу: платить нечего.
        await billing.cancel(u.uid);
        const fresh = (await readUsers()).find((x) => x.uid === u.uid);
        return { status: 200, body: { ...(await issueToken(fresh, now)), payment: null } };
      }
      const { payment } = await billing.startPayment(u, plan.id, b.method);
      return { status: 200, body: { ...(await issueToken(u, now)), payment } };
    }
    if (method === "POST" && path === "/rotate") {
      const key = newKey();
      const u = await withUsers(async (users) => {
        const user = byKey(users, b.key);
        user.keyHash = hashKey(key);
        user.rotatedAt = new Date(now).toISOString();
        return { write: true, users, result: user };
      });
      return { status: 200, body: { key, ...(await issueToken(u, now)) } };
    }
    const pay = path.match(/^\/payment\/([A-Za-z0-9_-]+)$/);
    if (method === "GET" && pay) {
      const p = await billing.paymentById(pay[1]);
      if (!p) throw new Bad(404, "платёж не найден");
      return { status: 200, body: { payment: billing.publicPayment(p) } };
    }

    /* ─── для основного сервера ─── */
    if (method === "POST" && path === "/internal/paid") {
      const r = await billing.markPaid(b.id, { tx: b.tx ? String(b.tx) : null, onPaid: hooks.onPaid });
      return { status: 200, body: { payment: r.payment, plan: r.user?.plan || null, uid: r.payment.uid } };
    }
    if (method === "GET" && path === "/internal/expiring") {
      await billing.expireTick(now);
      return { status: 200, body: { expiring: await billing.expiring(now) } };
    }
    if (method === "POST" && path === "/internal/reminded") {
      return { status: 200, body: { ok: await billing.reminded(b.uid, Number(b.mark)) } };
    }

    /* ─── админ-панель ─── */
    if (path.startsWith("/admin/")) {
      adminOnly(headers);
      const rest = path.slice("/admin".length);
      if (method === "GET" && rest === "/users") {
        await billing.expireTick(now);
        return { status: 200, body: { users: await billing.adminUsers() } };
      }
      const cancel = rest.match(/^\/users\/([A-Za-z0-9_-]+)\/cancel$/);
      if (method === "POST" && cancel) {
        await billing.cancel(cancel[1]);
        return { status: 200, body: { user: (await billing.adminUsers()).find((u) => u.uid === cancel[1]) || null } };
      }
      if (method === "GET" && rest === "/plans") return { status: 200, body: { plans: await billing.listPlans() } };
      if (method === "POST" && rest === "/plans") return { status: 201, body: { plan: await billing.addPlan() } };
      const plan = rest.match(/^\/plans\/([A-Za-z0-9_-]+)$/);
      if (method === "PUT" && plan) return { status: 200, body: { plan: await billing.savePlan(plan[1], b) } };
      if (method === "DELETE" && plan) return { status: 200, body: await billing.removePlan(plan[1]) };
      if (method === "POST" && rest === "/issue") {
        const u = await billing.findUser(b.user);
        if (!u) throw new Bad(404, "пользователь не найден: он должен сначала открыть приложение");
        const r = await billing.issue(u.uid, { planId: b.planId, price: b.price, days: b.days });
        return { status: 200, body: { user: (await billing.adminUsers()).find((x) => x.uid === u.uid) || null,
          payment: r.payment } };
      }
      if (method === "GET" && rest === "/wallets") return { status: 200, body: await billing.adminWallets() };
      if (method === "POST" && rest === "/wallets") return { status: 201, body: { wallet: await billing.addWallet(b) } };
      const wallet = rest.match(/^\/wallets\/([A-Za-z0-9_-]+)$/);
      if (method === "PUT" && wallet) return { status: 200, body: { wallet: await billing.saveWallet(wallet[1], b) } };
      if (method === "DELETE" && wallet) return { status: 200, body: await billing.removeWallet(wallet[1]) };
      if (method === "PUT" && rest === "/stars") return { status: 200, body: { stars: await billing.saveStars(b) } };
      if (method === "GET" && rest === "/me") return { status: 200, body: { ok: true } };
    }
    return { status: 404, body: { error: "not found" } };
  } catch (e) {
    if (e instanceof Bad) return { status: e.status, body: { error: e.message } };
    return { status: 500, body: { error: e.message || "error" } };
  }
}

/** Для тестов и админ-бота: разбор initData без зависимости от сервера. */
export { verifyInitData };
export const levelOfPlan = levelOf;
export const randomId = () => crypto.randomBytes(4).toString("hex");
