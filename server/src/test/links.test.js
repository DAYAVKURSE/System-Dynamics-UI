import { describe, expect, it } from "vitest";
import { callAppNameOk, callLinkEnv, callLinkFor, startParamOk } from "../lib/links.js";

/* Ссылка на звонок ведёт в отдельное мини-приложение звонка — и только в
   него. Нет отдельного приложения — ведёт на страницу звонка, но никогда
   на главное приложение модели. */

describe("ссылка на звонок", () => {
  it("с заведённым приложением звонка — на него, на пол-экрана", () => {
    expect(callLinkFor({ botName: "sdbot", callApp: "call" }, "m1"))
      .toBe("https://t.me/sdbot/call?startapp=call_m1&mode=compact");
  });

  it("без приложения звонка — на страницу звонка, а НЕ на главное приложение", () => {
    const link = callLinkFor({ botName: "sdbot", publicUrl: "https://x.test" }, "m1");
    expect(link).toBe("https://x.test/call?call=m1");
    expect(link).not.toContain("t.me");
  });

  it("имя главного приложения на ссылку звонка больше не влияет", () => {
    // Раньше TELEGRAM_APP_NAME подставлялся сюда, и звонок открывался
    // внутри модели. Теперь этот путь закрыт.
    expect(callLinkEnv({ TELEGRAM_APP_NAME: "model", PUBLIC_URL: "https://x.test" }, "sdbot"))
      .toEqual({ botName: "sdbot", callApp: "", publicUrl: "https://x.test" });
    expect(callLinkFor({ botName: "sdbot", publicUrl: "https://x.test" }, "m1"))
      .not.toContain("model");
  });

  it("без имени бота — адрес страницы звонка на своём сервере", () => {
    expect(callLinkFor({ publicUrl: "https://x.test" }, "m1")).toBe("https://x.test/call?call=m1");
    expect(callLinkFor({}, "m1")).toBe("/call?call=m1");
  });

  it("id, который Telegram не пропустит в startapp, уводится на страницу", () => {
    // startapp принимает только буквы, цифры, «_» и «-». Экранирование тут
    // не спасает: процент Telegram отбрасывает, и ссылка открывала бы
    // пустое окно вместо встречи.
    expect(startParamOk("aB3_-x")).toBe(true);
    expect(startParamOk("a b&c")).toBe(false);
    expect(callLinkFor({ botName: "b", callApp: "call", publicUrl: "https://x.test" }, "a b&c"))
      .toBe("https://x.test/call?call=a%20b%26c");
  });

  it("окружение читается по именам переменных", () => {
    const env = { TELEGRAM_CALL_APP: " call ", PUBLIC_URL: "https://x/" };
    expect(callLinkEnv(env, "sdbot"))
      .toEqual({ botName: "sdbot", callApp: "call", publicUrl: "https://x" });
    expect(callLinkEnv({}, "")).toEqual({ botName: "", callApp: "", publicUrl: "" });
  });

  it("короткое имя приложения проверяется по правилам @BotFather", () => {
    expect(callAppNameOk("call")).toBe(true);
    expect(callAppNameOk("my_call1")).toBe(true);
    expect(callAppNameOk("ab")).toBe(false);         // короче трёх
    expect(callAppNameOk("зво нок")).toBe(false);    // не латиница и с пробелом
    expect(callAppNameOk("")).toBe(false);
  });
});
