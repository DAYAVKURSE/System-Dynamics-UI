import { describe, expect, it } from "vitest";
import { callAppNameOk, callLinkEnv, callLinkFor, isMainAppLink, startParamOk }
  from "../lib/links.js";

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
      .toEqual({ botName: "sdbot", callApp: "", callMain: false, publicUrl: "https://x.test" });
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
      .toEqual({ botName: "sdbot", callApp: "call", callMain: false, publicUrl: "https://x" });
    expect(callLinkEnv({}, ""))
      .toEqual({ botName: "", callApp: "", callMain: false, publicUrl: "" });
  });

  /* Главное приложение бота — единственный способ получить пол-экрана:
     отдельное приложение Telegram открывает только на весь экран (почему —
     в lib/links.js). Поэтому запрет на такую ссылку снят, но лишь под
     явной настройкой: владелец сперва заводит главное приложение на тот же
     адрес /call и включает её командой «/callmain on». */
  describe("главное приложение бота — ради пол-экрана", () => {
    it("включённое — ссылка ведёт на него, с mode=compact", () => {
      expect(callLinkFor({ botName: "sdbot", callApp: "call", callMain: true }, "m1"))
        .toBe("https://t.me/sdbot?startapp=call_m1&mode=compact");
    });

    it("выключенное — всё как было, отдельное приложение", () => {
      expect(callLinkFor({ botName: "sdbot", callApp: "call", callMain: false }, "m1"))
        .toBe("https://t.me/sdbot/call?startapp=call_m1&mode=compact");
    });

    it("включается только значением «1» — мусор в .env её не включит", () => {
      const on = (v) => callLinkEnv({ TELEGRAM_CALL_MAIN: v }, "b").callMain;
      expect(on("1")).toBe(true);
      expect(on(" 1 ")).toBe(true);
      expect(on("да")).toBe(false);
      expect(on("true")).toBe(false);
      expect(on("0")).toBe(false);
      expect(on("")).toBe(false);
      expect(callLinkEnv({}, "b").callMain).toBe(false);
    });

    it("без имени бота не спасает и она — остаётся страница", () => {
      expect(callLinkFor({ callMain: true, publicUrl: "https://x.test" }, "m1"))
        .toBe("https://x.test/call?call=m1");
    });

    it("две ссылки в мини-приложение различаются, и не путаются со страницей", () => {
      // Приглашение обещает пол-экрана только про главное приложение:
      // обещать половину и открыть целое — хуже, чем не обещать.
      expect(isMainAppLink("https://t.me/sdbot?startapp=call_m1&mode=compact")).toBe(true);
      expect(isMainAppLink("https://t.me/sdbot/call?startapp=call_m1&mode=compact")).toBe(false);
      expect(isMainAppLink("https://x.test/call?call=m1")).toBe(false);
      expect(isMainAppLink("")).toBe(false);
    });
  });

  it("короткое имя приложения проверяется по правилам @BotFather", () => {
    expect(callAppNameOk("call")).toBe(true);
    expect(callAppNameOk("my_call1")).toBe(true);
    expect(callAppNameOk("ab")).toBe(false);         // короче трёх
    expect(callAppNameOk("зво нок")).toBe(false);    // не латиница и с пробелом
    expect(callAppNameOk("")).toBe(false);
  });
});
