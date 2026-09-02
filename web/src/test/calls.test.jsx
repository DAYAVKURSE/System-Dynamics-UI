import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callFromLocation, callLink, getLocalStream, mediaSupported, recorderMime }
  from "../calls.js";

/* Клиентская часть звонков: откуда берётся встреча и что делать, когда
   камеры нет. */

const setUrl = (search) => {
  delete window.location;
  window.location = new URL(`https://example.test/${search}`);
};

beforeEach(() => { delete window.Telegram; });
afterEach(() => { vi.restoreAllMocks(); });

describe("встреча из ссылки", () => {
  it("берётся из ?call=", () => {
    setUrl("?call=abc123");
    expect(callFromLocation()).toBe("abc123");
  });

  it("берётся из startapp мини-приложения", () => {
    setUrl("?tgWebAppStartParam=call_xyz");
    expect(callFromLocation()).toBe("xyz");
  });

  it("берётся из initDataUnsafe, когда параметра в адресе нет", () => {
    setUrl("");
    window.Telegram = { WebApp: { initDataUnsafe: { start_param: "call_zzz" } } };
    expect(callFromLocation()).toBe("zzz");
  });

  it("чужой startapp встречей не считается", () => {
    setUrl("?tgWebAppStartParam=invite_777");
    expect(callFromLocation()).toBeNull();
  });

  it("без параметров — ничего", () => {
    setUrl("");
    expect(callFromLocation()).toBeNull();
  });

  it("ссылка на встречу ведёт на отдельную страницу звонка", () => {
    setUrl("");
    expect(callLink("abc")).toBe("https://example.test/call?call=abc");
  });
});

describe("камера и микрофон", () => {
  it("без поддержки говорит именно об этом, а не «не разрешили»", async () => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    expect(mediaSupported()).toBe(false);
    await expect(getLocalStream()).rejects.toThrow(/не даёт доступ/);
  });

  it("отказ пользователя объясняется как отказ, а не как поломка", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: async () => {
        const e = new Error("denied"); e.name = "NotAllowedError"; throw e;
      } }, configurable: true });
    await expect(getLocalStream()).rejects.toThrow(/не разрешён/);
  });

  it("отсутствие камеры отличается от отказа", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: async () => {
        const e = new Error("none"); e.name = "NotFoundError"; throw e;
      } }, configurable: true });
    await expect(getLocalStream()).rejects.toThrow(/не найдены/);
  });

  it("камера просится фронтальная — на телефоне это единственная разумная", async () => {
    let asked = null;
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: async (c) => { asked = c; return { id: "s" }; } },
      configurable: true });
    await getLocalStream();
    expect(asked.video.facingMode).toBe("user");
    expect(asked.audio).toBe(true);
  });
});

describe("запись", () => {
  it("без MediaRecorder формата нет — записывать нечем", () => {
    const saved = global.MediaRecorder;
    delete global.MediaRecorder;
    expect(recorderMime()).toBe("");
    global.MediaRecorder = saved;
  });

  it("выбирается первый поддерживаемый формат, а не первый из списка", () => {
    global.MediaRecorder = { isTypeSupported: (t) => t === "video/mp4" };
    expect(recorderMime()).toBe("video/mp4");
    delete global.MediaRecorder;
  });

  it("если не поддержан ни один — пусто, а не выдуманный формат", () => {
    global.MediaRecorder = { isTypeSupported: () => false };
    expect(recorderMime()).toBe("");
    delete global.MediaRecorder;
  });
});
