/* ════════════════════════════════════════════════════════════════
   ЦЕПОЧКА TON · курс, балансы, поиск входящего перевода

   Открытый API toncenter (v3): без ключа — с лимитом запросов, с ключом
   (TONCENTER_API_KEY) — свободнее. Курс TON к доллару — CoinGecko.
   Всё здесь — «лучше, чем ничего»: сеть недоступна — вернём null, а не
   уроним сервис; платёж найдётся при следующей проверке.
   ════════════════════════════════════════════════════════════════ */
const TONCENTER = process.env.TONCENTER_URL || "https://toncenter.com/api/v3";
export const USDT_MASTER = process.env.USDT_MASTER || "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const NANO = 1e9;
const USDT_DEC = 1e6;

const headers = () => ({ Accept: "application/json",
  ...(process.env.TONCENTER_API_KEY ? { "X-API-Key": process.env.TONCENTER_API_KEY } : {}) });
async function getJson(url) {
  const r = await fetch(url, { headers: headers() });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
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

/* Комментарий перевода: toncenter отдаёт его в `in_msg.message_content.decoded.comment`
   у обычного перевода и в `forward_payload`/`comment` у jetton-перевода. */
const commentOf = (m) => String(m?.message_content?.decoded?.comment ?? m?.comment ?? m?.forward_payload?.comment ?? "").trim();

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
