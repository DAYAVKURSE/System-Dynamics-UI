import crypto from "node:crypto";

// Проверка Telegram.WebApp.initData по алгоритму из документации Telegram:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
const MAX_AUTH_AGE_SEC = 24 * 60 * 60;

export function verifyInitData(initData, botToken) {
  if (!initData) return { ok: false, reason: "missing" };
  if (!botToken) return { ok: false, reason: "no-bot-token" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "no-hash" };
  params.delete("hash");

  const pairs = [];
  for (const [key, value] of params.entries()) pairs.push(`${key}=${value}`);
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(computedHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad-hash" };
  }

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SEC) {
    return { ok: false, reason: "expired" };
  }

  let user = null;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    user = null;
  }

  return { ok: true, userId: user?.id != null ? String(user.id) : "unknown", user };
}
