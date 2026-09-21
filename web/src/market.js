import { getInitData } from "./telegram.js";
import { codeHeader } from "./codes.js";
import { actingAs } from "./identity.js";

/* ════════════════════════════════════════════════════════════════
   РЫНОК УСЛУГ · разговор с сервером (см. server/src/routes/market.js)

   Всё — с подписью Telegram: рынок открыт зарегистрированным, и различает
   их сервер. Ответы приходят глазами спрашивающего: чужих откликов в них
   нет, и рисовать их не из чего.
   ════════════════════════════════════════════════════════════════ */

const headers = () => ({
  "Content-Type": "application/json",
  "X-Telegram-Init-Data": getInitData(), ...codeHeader(),
  /* Под чужой страницей — и здесь: «Войти под его именем» меняет не
     одну вкладку, а всё приложение (см. identity.js). */
  ...(actingAs() ? { "X-Act-As": actingAs() } : {}),
});

const json = async (url, opts) => {
  const r = await fetch(url, { headers: headers(), ...opts });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Сервер ответил ${r.status}`);
  return r.status === 204 ? null : r.json();
};
const enc = encodeURIComponent;
const post = (url, body) => json(url, { method: "POST", body: JSON.stringify(body || {}) });
const put = (url, body) => json(url, { method: "PUT", body: JSON.stringify(body || {}) });

export const getMarket = () => json("/api/market");
/* Страница автора — та же, что у воркера актива. Незнакомому смотрящему
   она представляется двумя словами и знаком приложения (владелец,
   2026-09-20); решает это сервер, а не интерфейс. */
export const getMarketPerson = (id) => json(`/api/market/people/${enc(id)}`);

export const addOrder = (fields) => post("/api/market/orders", fields);
export const updateOrder = (id, fields) => put(`/api/market/orders/${enc(id)}`, fields);
export const dropOrder = (id) => json(`/api/market/orders/${enc(id)}`, { method: "DELETE" });

export const addService = (fields) => post("/api/market/services", fields);
export const updateService = (id, fields) => put(`/api/market/services/${enc(id)}`, fields);
export const dropService = (id) => json(`/api/market/services/${enc(id)}`, { method: "DELETE" });

const offerUrl = (orderId, offerId) => `/api/market/orders/${enc(orderId)}/offers/${enc(offerId)}`;
export const addOffer = (orderId, fields) => post(`/api/market/orders/${enc(orderId)}/offers`, fields);
export const sendChat = (orderId, offerId, text) => post(`${offerUrl(orderId, offerId)}/chat`, { text });
export const putBrief = (orderId, offerId, brief) => put(`${offerUrl(orderId, offerId)}/brief`, brief);
export const acceptOffer = (orderId, offerId) => post(`${offerUrl(orderId, offerId)}/accept`);
export const addDelivery = (orderId, offerId, fields) => post(`${offerUrl(orderId, offerId)}/deliveries`, fields);
