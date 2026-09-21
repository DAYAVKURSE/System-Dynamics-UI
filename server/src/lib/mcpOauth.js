import crypto from "node:crypto";

/* ════════════════════════════════════════════════════════════════
   ВХОД НА MCP-СЕРВЕР ЧЕРЕЗ OAUTH (владелец, 2026-09-21)

   «При опросе MCP-серверов мне предлагается ввести токен. Должна
   выдаваться страница входа, а не ввод bearer». Делаем по спецификации
   MCP (OAuth 2.1 + PKCE):

   1. сервер ответил 401 — ищем, кто его авторизует: адрес из
      `WWW-Authenticate: … resource_metadata="…"`, иначе
      `/.well-known/oauth-protected-resource` у сервера, иначе сам сервер;
   2. у сервера авторизации — `/.well-known/oauth-authorization-server`:
      адреса входа, обмена кода и регистрации клиента;
   3. клиента регистрируем динамически (redirect — наш callback);
   4. человека отправляем на страницу входа; после входа сервер
      возвращает код на наш callback, мы меняем его на токен и кладём
      к записи MCP-сервера (bearer) вместе с refresh-токеном.

   Токен обновляется сам, когда истёк (`ensureFresh`). Ожидания входа
   живут в памяти десять минут: это разовая ссылка, а не запись.
   ════════════════════════════════════════════════════════════════ */
const PENDING_MS = 10 * 60 * 1000;
const pending = new Map();   // state → { userId, mcpId, verifier, tokenUrl, clientId, clientSecret, redirect, resource, at }

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const originOf = (url) => { try { return new URL(url).origin; } catch { return ""; } };
async function getJson(url, opts = {}) {
  const r = await fetch(url, { headers: { Accept: "application/json" }, ...opts });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
export const redirectUri = (publicUrl = process.env.PUBLIC_URL || "") =>
  `${String(publicUrl).replace(/\/+$/, "")}/api/assistant/mcp/oauth/callback`;

/**
 * Кто и как авторизует сервер: {authUrl, tokenUrl, regUrl, scopes}.
 * `hint` — заголовок WWW-Authenticate, если сервер его прислал.
 */
export async function discover(serverUrl, hint = "") {
  const metaFromHint = (String(hint || "").match(/resource_metadata="([^"]+)"/) || [])[1];
  const origin = originOf(serverUrl);
  let asList = [];
  let scopes = [];
  for (const u of [metaFromHint, origin ? `${origin}/.well-known/oauth-protected-resource` : ""].filter(Boolean)) {
    try {
      const rm = await getJson(u);
      if (Array.isArray(rm?.authorization_servers)) asList = rm.authorization_servers;
      if (Array.isArray(rm?.scopes_supported)) scopes = rm.scopes_supported;
      if (asList.length) break;
    } catch { /* следующий */ }
  }
  if (!asList.length && origin) asList = [origin];
  for (const as of asList) {
    const base = String(as).replace(/\/+$/, "");
    for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
      try {
        const m = await getJson(`${base}${path}`);
        if (m?.authorization_endpoint && m?.token_endpoint) {
          return { issuer: m.issuer || base, authUrl: m.authorization_endpoint, tokenUrl: m.token_endpoint,
            regUrl: m.registration_endpoint || "", scopes: scopes.length ? scopes : (m.scopes_supported || []),
            pkce: !Array.isArray(m.code_challenge_methods_supported) || m.code_challenge_methods_supported.includes("S256") };
        }
      } catch { /* следующий */ }
    }
  }
  return null;
}

/** Клиент — свой у каждой пары «сервер авторизации ↔ мы»; регистрируем, если можно. */
export async function registerClient(meta, redirect) {
  if (!meta.regUrl) return { clientId: process.env.MCP_OAUTH_CLIENT_ID || "", clientSecret: "" };
  const r = await fetch(meta.regUrl, { method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_name: "blockTree", redirect_uris: [redirect],
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      token_endpoint_auth_method: "none" }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.client_id) throw new Error(`регистрация клиента: ${j.error_description || j.error || r.status}`);
  return { clientId: String(j.client_id), clientSecret: String(j.client_secret || "") };
}

/**
 * Ссылка на страницу входа. Что нужно для обмена кода — ждёт по `state`.
 * `client` — уже зарегистрированный клиент, если он есть у записи.
 */
export async function startLogin({ userId, mcpId, serverUrl, hint = "", client = null, publicUrl }) {
  const meta = await discover(serverUrl, hint);
  if (!meta) throw new Error("сервер не рассказал, как на него входить (нет метаданных OAuth)");
  const redirect = redirectUri(publicUrl);
  const c = client?.clientId ? client : await registerClient(meta, redirect);
  if (!c.clientId) throw new Error("сервер не даёт зарегистрировать клиента");
  const verifier = b64u(crypto.randomBytes(32));
  const challenge = b64u(crypto.createHash("sha256").update(verifier).digest());
  const state = b64u(crypto.randomBytes(18));
  const u = new URL(meta.authUrl);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", c.clientId);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("resource", serverUrl);
  if (meta.scopes?.length) u.searchParams.set("scope", meta.scopes.join(" "));
  pending.set(state, { userId, mcpId, verifier, tokenUrl: meta.tokenUrl, clientId: c.clientId,
    clientSecret: c.clientSecret || "", redirect, resource: serverUrl, at: Date.now() });
  sweep();
  return { url: u.toString(), state, client: { clientId: c.clientId, clientSecret: c.clientSecret || "", tokenUrl: meta.tokenUrl, issuer: meta.issuer } };
}

function sweep() {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.at > PENDING_MS) pending.delete(k);
}
export const pendingOf = (state) => pending.get(String(state || "")) || null;
export const dropPending = (state) => pending.delete(String(state || ""));
/** Для тестов. */
export const _pending = pending;

async function tokenRequest(tokenUrl, params, { clientId, clientSecret }) {
  const body = new URLSearchParams(params);
  const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (clientSecret) headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  else body.set("client_id", clientId);
  const r = await fetch(tokenUrl, { method: "POST", headers, body: body.toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`обмен кода: ${j.error_description || j.error || r.status}`);
  return { kind: "bearer", token: String(j.access_token), refresh: String(j.refresh_token || ""),
    expiresAt: j.expires_in ? Date.now() + Number(j.expires_in) * 1000 : null };
}

/** Код пришёл на callback — меняем на токен. Возвращает {userId, mcpId, auth}. */
export async function finishLogin(state, code) {
  const p = pendingOf(state);
  if (!p) throw new Error("вход устарел — начните заново");
  dropPending(state);
  const auth = await tokenRequest(p.tokenUrl, { grant_type: "authorization_code", code: String(code || ""),
    redirect_uri: p.redirect, code_verifier: p.verifier, resource: p.resource },
  { clientId: p.clientId, clientSecret: p.clientSecret });
  return { userId: p.userId, mcpId: p.mcpId, auth: { ...auth, oauth: { tokenUrl: p.tokenUrl,
    clientId: p.clientId, clientSecret: p.clientSecret, resource: p.resource } } };
}

/** Токен истёк и есть refresh — обновить; иначе вернуть как есть. */
export async function refresh(auth) {
  if (!auth?.oauth?.tokenUrl || !auth.refresh) return null;
  const fresh = await tokenRequest(auth.oauth.tokenUrl, { grant_type: "refresh_token",
    refresh_token: auth.refresh, resource: auth.oauth.resource },
  { clientId: auth.oauth.clientId, clientSecret: auth.oauth.clientSecret });
  return { ...fresh, refresh: fresh.refresh || auth.refresh, oauth: auth.oauth };
}
export const stale = (auth, now = Date.now()) => !!auth?.expiresAt && auth.expiresAt - now < 60 * 1000;
