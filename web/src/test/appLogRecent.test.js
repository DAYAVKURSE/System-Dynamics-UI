import { beforeEach, describe, expect, it } from "vitest";
import { clearLog, fieldNote, recent, recentText, record, scrub } from "../lib/appLog.js";

/* ЛЕНТА К СООБЩЕНИЮ ОБ ОШИБКЕ (владелец, 2026-09-21): последние действия
   за две минуты, но не меньше пятидесяти (всего меньше — все), без
   чувствительных данных. */
beforeEach(() => clearLog());

describe("recent", () => {
  it("за две минуты, если их не меньше пятидесяти; иначе — последние пятьдесят; всего меньше — все", () => {
    const now = 1_000_000_000;
    for (let i = 0; i < 70; i += 1) record(`шаг ${i}`, now - (70 - i) * 2_000);   // раз в 2 с, 140 с назад…
    const got = recent({ now });
    // За 120 с — шаги с 10-го по 69-й: шестьдесят, больше пятидесяти.
    expect(got.map((e) => e.text)).toEqual(Array.from({ length: 60 }, (_, i) => `шаг ${10 + i}`));
    clearLog();
    for (let i = 0; i < 60; i += 1) record(`шаг ${i}`, now - (60 - i) * 60_000);   // раз в минуту
    // За две минуты — два, мало: берём последние пятьдесят (владелец, 2026-09-22).
    expect(recent({ now }).map((e) => e.text)).toEqual(Array.from({ length: 50 }, (_, i) => `шаг ${10 + i}`));
    clearLog();
    record("один", now - 5_000); record("два", now - 1_000);
    expect(recent({ now }).map((e) => e.text)).toEqual(["один", "два"]);
    expect(recentText({ now })).toMatch(/один\n.*два$/);
  });
  it("чувствительное вычищено: почта, ключи, номера; поле ключа — только «изменено»", () => {
    expect(scrub("написал на ivan@example.com")).toBe("написал на «почта»");
    expect(scrub("ключ sk-abcdefghijklmnop123")).toBe("ключ «ключ»");
    expect(scrub("токен AbCdEfGhIjKlMnOpQrStUvWxYz0123")).toBe("токен «ключ»");
    expect(scrub("звонил +7 (999) 123-45-67")).toBe("звонил +«номер»");
    expect(scrub("кнопка «Сохранить»")).toBe("кнопка «Сохранить»");
    expect(fieldNote({ tagName: "INPUT", type: "text", value: "sk-secret", getAttribute: (k) => (k === "aria-label" ? "ключ провайдера" : null) }))
      .toBe("поле «ключ провайдера»: изменено");
    record("поле «почта»: ivan@example.com");
    expect(recent().map((e) => e.text)).toEqual(["поле «почта»: «почта»"]);
  });
});
