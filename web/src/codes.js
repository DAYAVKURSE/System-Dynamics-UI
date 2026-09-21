/* ════════════════════════════════════════════════════════════════
   КЛЮЧ И ТОКЕН · сервис кодов (codes/)

   Ключ — постоянный и один: его выдают при регистрации, его человек
   сохраняет и с ним входит с любого Telegram (владелец, 2026-09-21).
   Токен — короткий, на час, подписанный сервисом; его проверяет каждое
   хранилище. Приложение обновляет токен само, по ключу, и кладёт в
   каждый запрос заголовком X-User-Token.

   Ключ живёт в localStorage этого устройства: спрашивать его при каждом
   открытии значило бы заставлять человека носить его с собой.
   ════════════════════════════════════════════════════════════════ */
const KEY = "sd_code_key";
const TOK = "sd_code_token";
/* Обновляем за пять минут до конца: запрос, отправленный в последнюю
   секунду, не должен упереться в истёкший токен. */
const EARLY_MS = 5 * 60 * 1000;

const read = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const write = (k, v) => {
  try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* приватный режим */ }
};

export const savedKey = () => read(KEY);
export const normKey = (v) => String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, "")
  .match(/.{1,4}/g)?.join("-") || "";

let tok = null; // {token, exp(ms), uid, plan}
const loadTok = () => {
  if (tok) return tok;
  try { tok = JSON.parse(read(TOK) || "null"); } catch { tok = null; }
  return tok;
};
const keepTok = (t) => { tok = t; write(TOK, t ? JSON.stringify(t) : ""); };

/** Токен для заголовка — если он есть и ещё годен. Синхронно. */
export function codeToken() {
  const t = loadTok();
  return t && t.exp > Date.now() ? t.token : "";
}
export const codeHeader = () => {
  const t = codeToken();
  return t ? { "X-User-Token": t } : {};
};
/** Что известно о себе по токену: {uid, plan} или null. */
export function codeInfo() {
  const t = loadTok();
  return t && t.exp > Date.now() ? { uid: t.uid, plan: t.plan } : null;
}

const call = async (path, body) => {
  const r = await fetch(`/api/codes${path}`, { method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error || `Сервер ответил ${r.status}`); e.status = r.status; throw e;
  }
  return j;
};
const take = (j, key) => {
  if (key) write(KEY, key);
  keepTok({ token: j.token, exp: Number(j.exp) * 1000, uid: j.uid, plan: j.plan });
  return { uid: j.uid, plan: j.plan };
};

/**
 * Годный токен: свой, если ещё не пора обновлять; иначе новый по ключу.
 * Нет ключа — пусто: приложение ведёт человека за ним. Негодный ключ
 * (отозван, заменён) — забывается, чтобы не спрашивать сервис впустую.
 */
export async function ensureToken() {
  const t = loadTok();
  if (t && t.exp - Date.now() > EARLY_MS) return t.token;
  const key = savedKey();
  if (!key) return "";
  try {
    take(await call("/token", { key }));
    return codeToken();
  } catch (e) {
    if (e.status === 401) forgetKey();
    return "";
  }
}

/** Регистрация: план, способ оплаты (для платных) → ключ. */
export async function registerCode(plan, method) {
  const j = await call("/register", { plan, ...(method ? { method } : {}) });
  take(j, j.key);
  return { key: j.key, uid: j.uid, plan: j.plan };
}
/** Вход по ключу, сохранённому раньше. */
export async function loginWithKey(key) {
  const k = normKey(key);
  const j = await call("/token", { key: k });
  return take(j, k);
}
export async function changePlan(plan, method) {
  const key = savedKey();
  if (!key) throw new Error("нет ключа");
  return take(await call("/plan", { key, plan, ...(method ? { method } : {}) }));
}
/** Новый ключ взамен прежнего: прежний перестаёт действовать. */
export async function rotateKey() {
  const key = savedKey();
  if (!key) throw new Error("нет ключа");
  const j = await call("/rotate", { key });
  take(j, j.key);
  return j.key;
}
export function forgetKey() { write(KEY, ""); keepTok(null); }
