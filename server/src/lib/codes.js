import crypto from "node:crypto";

/* ════════════════════════════════════════════════════════════════
   ПРОВЕРКА ТОКЕНА СЕРВИСА КОДОВ — БЕЗ ЗВОНКА СЕРВИСУ

   Сервис (codes/) подписывает токены своим закрытым ключом; здесь они
   проверяются открытым (владелец, 2026-09-21: «по подписи, без звонка
   сервису»). Открытый ключ и список отозванных берутся у сервиса и
   держатся в памяти: ключ — пока жив процесс, список — минуту. Упал
   сервис — проверка продолжает работать по тому, что уже известно.

   Сервис выключен (нет CODES_URL) — токены не спрашиваются вовсе: так
   работают локальная разработка и тесты.
   ════════════════════════════════════════════════════════════════ */
export const enabled = () => Boolean(process.env.CODES_URL);
export const codesUrl = () => String(process.env.CODES_URL || "").replace(/\/+$/, "");

const REVOKED_TTL_MS = 60 * 1000;
const state = { publicKey: null, revoked: new Set(), revokedAt: 0, fetching: null };

/** Для тестов и для случая, когда ключ известен заранее. */
export function configure({ publicKey = null, revoked = null } = {}) {
  if (publicKey !== undefined) state.publicKey = publicKey;
  if (revoked) { state.revoked = new Set(revoked); state.revokedAt = Date.now(); }
}
export function reset() {
  state.publicKey = null; state.revoked = new Set(); state.revokedAt = 0; state.fetching = null;
}

async function getJson(path) {
  const r = await fetch(`${codesUrl()}${path}`, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`codes ${path}: ${r.status}`);
  return r.json();
}

async function publicKey() {
  if (state.publicKey) return state.publicKey;
  if (!enabled()) return null;
  if (!state.fetching) {
    state.fetching = getJson("/public-key")
      .then((j) => { state.publicKey = j?.key || null; return state.publicKey; })
      .catch(() => null)
      .finally(() => { state.fetching = null; });
  }
  return state.fetching;
}

async function revokedSet() {
  if (!enabled()) return state.revoked;
  if (Date.now() - state.revokedAt < REVOKED_TTL_MS) return state.revoked;
  state.revokedAt = Date.now();
  try {
    const j = await getJson("/revoked");
    if (Array.isArray(j?.uids)) state.revoked = new Set(j.uids.map(String));
  } catch { /* остаёмся с прежним списком */ }
  return state.revoked;
}

const unb64u = (s) => Buffer.from(String(s), "base64url");

/**
 * Что сказано в токене: {uid, plan, exp} — или null, если подпись
 * чужая, срок вышел, код отозван или ключ сервиса ещё не получен.
 */
export async function verify(token, now = Date.now()) {
  try {
    const [data, sig] = String(token || "").split(".");
    if (!data || !sig) return null;
    const pk = await publicKey();
    if (!pk) return null;
    if (!crypto.verify(null, Buffer.from(data), pk, unb64u(sig))) return null;
    const j = JSON.parse(unb64u(data).toString("utf8"));
    if (!j || typeof j !== "object" || !j.uid) return null;
    if (Number(j.exp) * 1000 <= now) return null;
    if ((await revokedSet()).has(String(j.uid))) return null;
    return { uid: String(j.uid), plan: String(j.plan || "free"), planId: String(j.planId || j.plan || "free"),
      until: j.until ? String(j.until) : null, exp: Number(j.exp) };
  } catch { return null; }
}

/* Что из сервиса можно дёргать через основной сервер (/api/codes/…):
   ровно то, что нужно приложению. Список отозванных и внутренние
   маршруты наружу не отдаются. */
export const PROXIED = { GET: [/^\/public-key$/, /^\/plans$/, /^\/payment\/[A-Za-z0-9_-]+$/],
  POST: [/^\/register$/, /^\/token$/, /^\/plan$/, /^\/rotate$/] };

/** Запрос к сервису кодов (localhost). `headers` — что пробросить. */
export async function call(method, path, body, headers = {}) {
  if (!enabled()) return { status: 503, body: { error: "codes service is off" } };
  try {
    const r = await fetch(`${codesUrl()}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      ...(method === "GET" || method === "DELETE" ? {} : { body: JSON.stringify(body || {}) }),
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, body: j };
  } catch (e) {
    return { status: 502, body: { error: `codes service: ${e.message}` } };
  }
}

/** Переслать запрос приложения сервису кодов как есть. */
export async function proxy(method, path, body) {
  const allowed = PROXIED[method] || [];
  if (!allowed.some((re) => re.test(path))) return { status: 404, body: { error: "not found" } };
  return call(method, path, body);
}

/* Админ-панель подписок (владелец, 2026-09-21): страница и её API живут
   в сервисе кодов, наружу их выводит этот сервер под /admin и
   /api/admin. Подпись — админ-бота, проверяет её сам сервис. */
export const adminProxy = (method, path, body, initData) =>
  call(method, `/admin${path}`, body, { "X-Admin-Init-Data": String(initData || "") });
export async function adminPage() {
  if (!enabled()) return null;
  try {
    const r = await fetch(`${codesUrl()}/admin/`);
    return r.ok ? await r.text() : null;
  } catch { return null; }
}

/* Stars оплачены — сервису кодов: подписка включается там. */
export const paid = (id, tx) => call("POST", "/internal/paid", { id, tx });
export const expiring = () => call("GET", "/internal/expiring");
export const reminded = (uid, mark) => call("POST", "/internal/reminded", { uid, mark });
