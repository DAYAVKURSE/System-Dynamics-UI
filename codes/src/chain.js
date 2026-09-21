/* ════════════════════════════════════════════════════════════════
   ЦЕПОЧКА TON · курс, балансы, поиск входящего перевода

   Открытый API toncenter (v3): без ключа — с лимитом запросов, с ключом
   (TONCENTER_API_KEY) — свободнее. Курс TON к доллару — CoinGecko.
   Всё здесь — «лучше, чем ничего»: сеть недоступна — вернём null, а не
   уроним сервис; платёж найдётся при следующей проверке.
   ════════════════════════════════════════════════════════════════ */
import { decodeComment } from "./boc.js";

const TONCENTER = process.env.TONCENTER_URL || "https://toncenter.com/api/v3";
export const USDT_MASTER = process.env.USDT_MASTER || "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const NANO = 1e9;
const USDT_DEC = 1e6;

const headers = () => ({ Accept: "application/json",
  ...(process.env.TONCENTER_API_KEY ? { "X-API-Key": process.env.TONCENTER_API_KEY } : {}) });
/* Открытый toncenter без ключа пускает около запроса в секунду: идём по
   одному, не чаще, а на 429 ждём и пробуем ещё раз. */
const GAP_MS = 1100;
let lastAt = 0;
let lane = Promise.resolve();
async function getJson(url) {
  const run = async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const wait = lastAt + GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAt = Date.now();
      const r = await fetch(url, { headers: headers() });
      if (r.status === 429 && attempt === 0) { await new Promise((res) => setTimeout(res, 2500)); continue; }
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json();
    }
    throw new Error(`${url}: 429`);
  };
  const p = lane.then(run, run);
  lane = p.catch(() => {});
  return p;
}

let rate = { usd: null, at: 0 };
/** Курс TON в долларах, не старше десяти минут. */
export async function tonUsd() {
  if (rate.usd && Date.now() - rate.at < 10 * 60 * 1000) return rate.usd;
  try {
    const j = await getJson("https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd");
    const usd = Number(j?.["the-open-network"]?.usd);
    if (usd > 0) rate = { usd, at: Date.now() };
  } catch { /* остаёмся с прежним */ }
  return rate.usd;
}
/** Для тестов: подставить курс. */
export const setTonUsd = (usd) => { rate = { usd, at: Date.now() }; };

export async function accountBalance(address) {
  if (!address) return null;
  const j = await getJson(`${TONCENTER}/account?address=${encodeURIComponent(address)}`);
  const b = Number(j?.balance);
  return Number.isFinite(b) ? b / NANO : null;
}
export async function jettonBalance(address) {
  if (!address) return null;
  const j = await getJson(`${TONCENTER}/jetton/wallets?owner_address=${encodeURIComponent(address)}&jetton_address=${encodeURIComponent(USDT_MASTER)}&limit=1`);
  const w = (j?.jetton_wallets || [])[0];
  const b = Number(w?.balance);
  return Number.isFinite(b) ? b / USDT_DEC : null;
}

/* Комментарий перевода: у обычного — в теле входящего сообщения
   (`message_content.body`, BOC), у jetton-перевода — в `forward_payload`
   (тоже BOC); разобранное toncenter поле, если оно есть, берём первым. */
const commentOf = (m) => {
  const ready = m?.message_content?.decoded?.comment ?? m?.decoded_forward_payload?.comment ?? m?.comment;
  if (ready != null && String(ready).trim()) return String(ready).trim();
  return decodeComment(m?.message_content?.body || m?.forward_payload || "");
};

/**
 * Входящий перевод под ожидающий платёж: тот же комментарий и сумма не
 * меньше нужной. Возвращает хэш транзакции или null.
 */
export async function findIncoming(p) {
  if (p.method === "ton") {
    const j = await getJson(`${TONCENTER}/transactions?account=${encodeURIComponent(p.address)}&limit=50&sort=desc`);
    for (const t of j?.transactions || []) {
      const m = t.in_msg;
      if (!m || !m.value) continue;
      if (commentOf(m) !== p.comment) continue;
      if (Number(m.value) / NANO + 1e-9 < p.amount) continue;
      return t.hash || m.hash || "tx";
    }
    return null;
  }
  if (p.method === "usdt") {
    const j = await getJson(`${TONCENTER}/jetton/transfers?owner_address=${encodeURIComponent(p.address)}&jetton_master=${encodeURIComponent(USDT_MASTER)}&direction=in&limit=50&sort=desc`);
    for (const t of j?.jetton_transfers || []) {
      if (commentOf(t) !== p.comment) continue;
      if (Number(t.amount) / USDT_DEC + 1e-9 < p.amount) continue;
      return t.transaction_hash || t.trace_id || "tx";
    }
    return null;
  }
  return null;
}
