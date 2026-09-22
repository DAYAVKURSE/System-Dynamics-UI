/* ════════════════════════════════════════════════════════════════
   КЛЮЧ И ТОКЕН · сервис кодов (codes/)

   Ключ — постоянный и один: его выдают при регистрации, его человек
   сохраняет и с ним входит с любого Telegram (владелец, 2026-09-21).
   Токен — короткий, на час, подписанный сервисом; его проверяет каждое
   хранилище. Приложение обновляет токен само, по ключу, и кладёт в
   каждый запрос заголовком X-User-Token.

   Ключ живёт в localStorage этого устройства: спрашивать его при каждом
   открытии значило бы заставлять человека носить его с собой. Хранилище
   у устройства одно на все Telegram-аккаунты, поэтому ключ лежит под
   id аккаунта (владелец, 2026-09-22: с другого аккаунта того же телефона
   открывалось всё — под чужим ключом). Ключ, сохранённый раньше без id,
   забирает только тот аккаунт, к чьей записи он привязан.
   ════════════════════════════════════════════════════════════════ */
import { getInitData, getTelegram } from "./telegram.js";

const LEGACY_KEY = "sd_code_key";
const LEGACY_TOK = "sd_code_token";
const tgId = () => {
  try { return String(getTelegram()?.initDataUnsafe?.user?.id || ""); } catch { return ""; }
};
const slot = (base) => (tgId() ? `${base}:${tgId()}` : base);
const keySlot = () => slot(LEGACY_KEY);
const tokSlot = () => slot(LEGACY_TOK);
/* Обновляем за пять минут до конца: запрос, отправленный в последнюю
   секунду, не должен упереться в истёкший токен. */
const EARLY_MS = 5 * 60 * 1000;

const read = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const write = (k, v) => {
  try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* приватный режим */ }
};

export const savedKey = () => read(keySlot());
export const normKey = (v) => String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, "")
  .match(/.{1,4}/g)?.join("-") || "";

let tok = null; // {token, exp(ms), uid, plan}
let tokAt = ""; // под каким аккаунтом он запомнен
const loadTok = () => {
  if (tok && tokAt === tokSlot()) return tok;
  tokAt = tokSlot();
  try { tok = JSON.parse(read(tokAt) || "null"); } catch { tok = null; }
  return tok;
};
const keepTok = (t) => { tok = t; tokAt = tokSlot(); write(tokAt, t ? JSON.stringify(t) : ""); };

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

/* Подпись Telegram — с каждым запросом: по ней сервис кодов узнаёт имя
   и username человека (админ-панель показывает их), а инвойс за звёзды
   уходит в его чат. Подделать нельзя — подпись проверяет сервер. */
const call = async (path, body) => {
  const r = await fetch(`/api/codes${path}`, { method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json",
      "X-Telegram-Init-Data": getInitData() },
    body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error || `Сервер ответил ${r.status}`); e.status = r.status; throw e;
  }
  return j;
};
const take = (j, key) => {
  if (key) write(keySlot(), key);
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
  /* Раз за сеанс токен берётся заново даже свежий: с ним уезжает подпись
     Telegram, по которой сервис кодов запоминает имя и username. */
  let fresh = false;
  try { fresh = sessionStorage.getItem("sd_tok_fresh") === "1"; } catch { fresh = true; }
  if (t && fresh && t.exp - Date.now() > EARLY_MS) return t.token;
  const key = savedKey();
  if (!key) return adoptLegacy();
  try { sessionStorage.setItem("sd_tok_fresh", "1"); } catch { /* приватный режим */ }
  try {
    take(await call("/token", { key }));
    return codeToken();
  } catch (e) {
    if (e.status === 401) forgetKey();
    return "";
  }
}

/* Ключ, сохранённый до раскладки по аккаунтам: сервер отдаёт его только
   аккаунту, к чьей записи он привязан. Чужой — остаётся лежать для
   своего хозяина, этот аккаунт получает экран ключа. */
async function adoptLegacy() {
  const old = read(LEGACY_KEY);
  if (!old || !tgId()) return "";
  try {
    take(await call("/token", { key: old, adopt: true }), old);
    write(LEGACY_KEY, ""); write(LEGACY_TOK, "");
    try { sessionStorage.setItem("sd_tok_fresh", "1"); } catch { /* приватный режим */ }
    return codeToken();
  } catch (e) {
    if (e.status === 401) { write(LEGACY_KEY, ""); write(LEGACY_TOK, ""); }
    return "";
  }
}

/** Регистрация: план, способ оплаты (для платных) → ключ и, если план
    платный, платёж, который надо провести (payments.js). */
export async function registerCode(plan, method) {
  const j = await call("/register", { plan, ...(method ? { method } : {}) });
  take(j, j.key);
  return { key: j.key, uid: j.uid, plan: j.plan, payment: j.payment || null };
}
/** Планы и способы — с сервера: их правит владелец в админ-панели. */
export async function fetchPlans() {
  const r = await fetch("/api/codes/plans", { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Сервер ответил ${r.status}`);
  return r.json();
}
/** Платёж: статус; оплачен — обновляем токен по ключу. */
export async function paymentStatus(id) {
  const r = await fetch(`/api/codes/payment/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Сервер ответил ${r.status}`);
  if (j.payment?.status === "paid" && savedKey()) {
    try { take(await call("/token", { key: savedKey() })); } catch { /* токен обновится позже */ }
  }
  return j.payment;
}
/** Вход по ключу, сохранённому раньше. */
export async function loginWithKey(key) {
  const k = normKey(key);
  const j = await call("/token", { key: k });
  return take(j, k);
}
/** Смена плана: бесплатный — сразу, платный — платёж на проведение. */
export async function changePlan(plan, method) {
  const key = savedKey();
  if (!key) throw new Error("нет ключа");
  const j = await call("/plan", { key, plan, ...(method ? { method } : {}) });
  take(j);
  return { uid: j.uid, plan: j.plan, payment: j.payment || null };
}
/** Новый ключ взамен прежнего: прежний перестаёт действовать. */
export async function rotateKey() {
  const key = savedKey();
  if (!key) throw new Error("нет ключа");
  const j = await call("/rotate", { key });
  take(j, j.key);
  return j.key;
}
export function forgetKey() { write(keySlot(), ""); keepTok(null); }
