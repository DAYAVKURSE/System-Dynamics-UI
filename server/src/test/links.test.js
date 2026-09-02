import { describe, expect, it } from "vitest";
import { callLinkEnv, callLinkFor } from "../lib/links.js";

/* Ссылка на звонок: отдельное мини-приложение, если оно заведено, иначе
   главное; всегда на пол-экрана; без бота — обычный адрес страницы. */

describe("ссылка на звонок", () => {
  it("без отдельного приложения ведёт на главное мини-приложение, на пол-экрана", () => {
    expect(callLinkFor({ botName: "sdbot" }, "m1"))
      .toBe("https://t.me/sdbot?startapp=call_m1&mode=compact");
  });

  it("с отдельным приложением звонка — через его короткое имя", () => {
    expect(callLinkFor({ botName: "sdbot", callApp: "call" }, "m1"))
      .toBe("https://t.me/sdbot/call?startapp=call_m1&mode=compact");
  });

  it("имя приложения звонка важнее имени главного", () => {
    expect(callLinkFor({ botName: "sdbot", callApp: "call", appName: "model" }, "m1"))
      .toMatch(/^https:\/\/t\.me\/sdbot\/call\?/);
    expect(callLinkFor({ botName: "sdbot", appName: "model" }, "m1"))
      .toMatch(/^https:\/\/t\.me\/sdbot\/model\?/);
  });

  it("без имени бота — адрес страницы звонка на своём сервере", () => {
    expect(callLinkFor({ publicUrl: "https://x.test" }, "m1")).toBe("https://x.test/call?call=m1");
    expect(callLinkFor({}, "m1")).toBe("/call?call=m1");
  });

  it("id экранируется", () => {
    expect(callLinkFor({ botName: "b" }, "a b&c")).toContain("startapp=call_a%20b%26c&");
  });

  it("окружение читается по именам переменных", () => {
    const env = { TELEGRAM_CALL_APP: "call", TELEGRAM_APP_NAME: "model", PUBLIC_URL: "https://x" };
    expect(callLinkEnv(env, "sdbot")).toEqual({
      botName: "sdbot", callApp: "call", appName: "model", publicUrl: "https://x",
    });
    expect(callLinkEnv({}, "")).toEqual({ botName: "", callApp: "", appName: "", publicUrl: "" });
  });
});
