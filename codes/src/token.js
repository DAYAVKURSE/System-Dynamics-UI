import crypto from "node:crypto";

/* ════════════════════════════════════════════════════════════════
   ТОКЕН — короткая подписанная записка «это такой-то, план такой-то»

   Формат: base64url(JSON).base64url(подпись Ed25519). Подписывает сервис
   своим закрытым ключом; проверяет любое хранилище открытым — без звонка
   сервису (владелец, 2026-09-21: «по подписи, без звонка»). Живёт час:
   украденный токен бесполезен уже к вечеру, а приложение обновляет его
   само по постоянному ключу.
   ════════════════════════════════════════════════════════════════ */
export const TOKEN_TTL_S = 60 * 60;

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (s) => Buffer.from(String(s), "base64url");

export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}

export function signToken(payload, privateKeyPem, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const body = { ...payload, iat, exp: iat + TOKEN_TTL_S };
  const data = b64u(JSON.stringify(body));
  const sig = crypto.sign(null, Buffer.from(data), privateKeyPem);
  return `${data}.${b64u(sig)}`;
}

/** Разбор без проверки: чтобы посмотреть, чей токен и когда истекает. */
export function decodeToken(token) {
  try {
    const [data] = String(token || "").split(".");
    const j = JSON.parse(unb64u(data).toString("utf8"));
    return j && typeof j === "object" ? j : null;
  } catch { return null; }
}

/** Проверка подписи и срока. Возвращает содержимое или null. */
export function verifyToken(token, publicKeyPem, now = Date.now()) {
  try {
    const [data, sig] = String(token || "").split(".");
    if (!data || !sig) return null;
    const ok = crypto.verify(null, Buffer.from(data), publicKeyPem, unb64u(sig));
    if (!ok) return null;
    const j = JSON.parse(unb64u(data).toString("utf8"));
    if (!j || typeof j !== "object" || !j.uid) return null;
    if (Number(j.exp) * 1000 <= now) return null;
    return j;
  } catch { return null; }
}
