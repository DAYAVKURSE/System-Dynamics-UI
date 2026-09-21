import { PLANS, METHODS, PRICE, methodOf, pay, planOf } from "./plans.js";
import { hashKey, newKey, newUid, normKey, readUsers, serviceKeys, withUsers } from "./store.js";
import { TOKEN_TTL_S, signToken } from "./token.js";

/* ════════════════════════════════════════════════════════════════
   СЕРВИС КОДОВ · что он умеет

   Один на всех и всегда на сервере владельца (владелец, 2026-09-21):
   код должен быть уникальным и неподделываемым, а это возможно, только
   если подписывает его один и тот же закрытый ключ. Хранилища же могут
   стоять где угодно — им нужен лишь открытый ключ.

   · POST /register {plan, method}  → {uid, key, plan, token, exp}
       Регистрация: платёж (замокан), новый ключ, первый токен.
   · POST /token {key}              → {uid, plan, token, exp}
       Короткий токен по постоянному ключу.
   · POST /plan {key, plan, method} → {uid, plan, token, exp}
       Смена плана (платёж замокан).
   · POST /rotate {key}             → {uid, key, plan, token, exp}
       Новый ключ взамен прежнего: прежний перестаёт действовать.
   · GET  /public-key               → {alg, kid, key}
   · GET  /revoked                  → {uids, at}
       Кого больше нет: хранилища сверяются с этим списком.
   · GET  /plans                    → {plans, price, methods}
   ════════════════════════════════════════════════════════════════ */
class Bad extends Error { constructor(status, message) { super(message); this.status = status; } }

const byKey = (users, key) => {
  const k = normKey(key);
  if (k.length < 16) throw new Bad(400, "key is required");
  const h = hashKey(k);
  const u = users.find((x) => x.keyHash === h);
  if (!u) throw new Bad(401, "unknown key");
  if (u.revokedAt) throw new Bad(401, "key revoked");
  return u;
};

async function issue(u, now) {
  const { privateKey, kid } = await serviceKeys();
  const token = signToken({ uid: u.uid, plan: u.plan, kid }, privateKey, now);
  return { uid: u.uid, plan: u.plan, token, exp: Math.floor(now / 1000) + TOKEN_TTL_S };
}

export async function handle(method, url, body = {}, now = Date.now()) {
  try {
    const path = String(url || "").split("?")[0].replace(/\/+$/, "") || "/";
    const b = body && typeof body === "object" ? body : {};
    if (method === "GET" && path === "/health") return { status: 200, body: { ok: true } };
    if (method === "GET" && path === "/plans") {
      return { status: 200, body: { plans: [...PLANS], price: { ...PRICE }, methods: [...METHODS] } };
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
      const plan = planOf(b.plan) || "free";
      const pm = methodOf(b.method);
      if (PRICE[plan] && !pm) throw new Bad(400, "payment method is required");
      const key = newKey();
      const paid = pay({ plan, method: pm });
      const u = await withUsers(async (users) => {
        let uid = newUid();
        while (users.some((x) => x.uid === uid)) uid = newUid();
        const user = { uid, keyHash: hashKey(key), plan, createdAt: new Date(now).toISOString(),
          payments: [{ plan, ...paid }] };
        return { write: true, users: [...users, user], result: user };
      });
      return { status: 201, body: { key, ...(await issue(u, now)) } };
    }
    if (method === "POST" && path === "/token") {
      const users = await readUsers();
      const u = byKey(users, b.key);
      return { status: 200, body: await issue(u, now) };
    }
    if (method === "POST" && path === "/plan") {
      const plan = planOf(b.plan);
      if (!plan) throw new Bad(400, "unknown plan");
      const pm = methodOf(b.method);
      if (PRICE[plan] && !pm) throw new Bad(400, "payment method is required");
      const u = await withUsers(async (users) => {
        const user = byKey(users, b.key);
        if (user.plan !== plan) {
          user.plan = plan;
          user.payments = [...(user.payments || []), { plan, ...pay({ plan, method: pm }) }];
        }
        return { write: true, users, result: user };
      });
      return { status: 200, body: await issue(u, now) };
    }
    if (method === "POST" && path === "/rotate") {
      const key = newKey();
      const u = await withUsers(async (users) => {
        const user = byKey(users, b.key);
        user.keyHash = hashKey(key);
        user.rotatedAt = new Date(now).toISOString();
        return { write: true, users, result: user };
      });
      return { status: 200, body: { key, ...(await issue(u, now)) } };
    }
    return { status: 404, body: { error: "not found" } };
  } catch (e) {
    if (e instanceof Bad) return { status: e.status, body: { error: e.message } };
    return { status: 500, body: { error: e.message || "error" } };
  }
}
