import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { verifyInitData } from "../lib/telegramAuth.js";

function buildInitData(fields, botToken) {
  const p = new URLSearchParams(fields);
  const pairs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort();
  const dataCheckString = pairs.join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  p.set("hash", hash);
  return p.toString();
}

const botToken = "123456:TEST-TOKEN";

describe("verifyInitData", () => {
  it("принимает корректно подписанные данные и достаёт userId", () => {
    const initData = buildInitData(
      { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 42, first_name: "A" }) },
      botToken,
    );
    const result = verifyInitData(initData, botToken);
    expect(result.ok).toBe(true);
    expect(result.userId).toBe("42");
  });

  it("отклоняет данные с изменённым полем после подписи", () => {
    const initData = buildInitData(
      { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 42 }) },
      botToken,
    );
    const tampered = initData.replace("42", "43");
    const result = verifyInitData(tampered, botToken);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad-hash");
  });

  it("отклоняет просроченный auth_date", () => {
    const oldDate = Math.floor(Date.now() / 1000) - 25 * 60 * 60;
    const initData = buildInitData({ auth_date: String(oldDate), user: JSON.stringify({ id: 1 }) }, botToken);
    const result = verifyInitData(initData, botToken);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("отклоняет пустой initData", () => {
    expect(verifyInitData("", botToken).ok).toBe(false);
  });

  it("отклоняет подпись, сделанную другим токеном бота", () => {
    const initData = buildInitData(
      { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 1 }) },
      "999999:OTHER-TOKEN",
    );
    const result = verifyInitData(initData, botToken);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad-hash");
  });
});
