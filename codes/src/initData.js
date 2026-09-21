import crypto from "node:crypto";

/* Проверка подписи Telegram.WebApp.initData — та же, что на основном
   сервере (server/src/lib/telegramAuth.js), но своим токеном: панель
   открывает АДМИН-бот, и подпись у неё его. */
export function verifyInitData(initData, botToken, { maxAgeS = 24 * 3600 } = {}) {
  try {
    const params = new URLSearchParams(String(initData || ""));
    const hash = params.get("hash");
    if (!hash) return { ok: false, reason: "no hash" };
    params.delete("hash");
    const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
    const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
    const want = crypto.createHmac("sha256", secret).update(check).digest("hex");
    if (want.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(hash))) {
      return { ok: false, reason: "bad hash" };
    }
    const auth = Number(params.get("auth_date"));
    if (!auth || Date.now() / 1000 - auth > maxAgeS) return { ok: false, reason: "expired" };
    const user = JSON.parse(params.get("user") || "null");
    if (!user?.id) return { ok: false, reason: "no user" };
    return { ok: true, userId: String(user.id), user };
  } catch (e) { return { ok: false, reason: e.message }; }
}
