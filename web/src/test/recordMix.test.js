import { afterEach, describe, expect, it, vi } from "vitest";
import { coverBox, gridFor, startMix } from "../recordMix.js";

/* Сведение звонка в одну запись.

   Раньше в MediaRecorder уходил свой поток целиком, и на записи были
   только своя камера и свой голос. Здесь проверяется то, из-за чего это
   случалось: что в запись попадают ВСЕ плитки и ВСЕ голоса, что состав
   пересматривается на каждый кадр, и что после остановки ничего не
   продолжает работать. */

const video = (w, h) => {
  const v = document.createElement("video");
  Object.defineProperty(v, "videoWidth", { value: w, configurable: true });
  Object.defineProperty(v, "videoHeight", { value: h, configurable: true });
  return v;
};
const stream = (kinds) => new window.MediaStream(kinds.map((k) => ({ kind: k, stop() {} })));

let live = null;
afterEach(() => { live?.stop(); live = null; vi.useRealTimers(); });

describe("сетка", () => {
  it("тянется к квадрату, как и на экране", () => {
    expect(gridFor(1)).toEqual({ cols: 1, rows: 1 });
    expect(gridFor(2)).toEqual({ cols: 2, rows: 1 });
    expect(gridFor(4)).toEqual({ cols: 2, rows: 2 });
    expect(gridFor(5)).toEqual({ cols: 3, rows: 2 });
    // Пустой звонок — всё равно одна клетка, а не деление на ноль.
    expect(gridFor(0)).toEqual({ cols: 1, rows: 1 });
  });
});

describe("кадр в клетке", () => {
  it("заполняет клетку целиком, срезая лишнее, и остаётся по центру", () => {
    // Широкий кадр в квадратной клетке: по высоте впритык, по ширине с запасом.
    const b = coverBox(1600, 900, 0, 0, 100, 100);
    expect(b.h).toBeCloseTo(100);
    expect(b.w).toBeGreaterThan(100);
    expect(b.x).toBeCloseTo((100 - b.w) / 2);
    expect(b.y).toBeCloseTo(0);
  });

  it("кадра ещё нет — клетка не ломает раскладку", () => {
    expect(coverBox(0, 0, 5, 7, 100, 50)).toEqual({ x: 5, y: 7, w: 100, h: 50 });
  });
});

describe("что уходит в запись", () => {
  it("в потоке есть и видео холста, и сведённый звук", () => {
    live = startMix({ grid: () => null, streams: () => [] });
    expect(live.stream.getVideoTracks()).toHaveLength(1);
    expect(live.stream.getAudioTracks()).toHaveLength(1);
  });

  it("рисуются ВСЕ плитки, а не только своя", () => {
    vi.useFakeTimers();
    const box = document.createElement("div");
    box.append(video(640, 480), video(640, 480), video(640, 480));
    live = startMix({ grid: () => box, streams: () => [] });
    const ctx = live.canvas.getContext("2d");
    ctx.drawn.length = 0;
    vi.advanceTimersByTime(200);
    // Ровно три drawImage на кадр — по одному на плитку.
    expect(ctx.drawn.length % 3).toBe(0);
    expect(ctx.drawn.length).toBeGreaterThanOrEqual(3);
  });

  it("подключившийся посреди записи попадает в кадр сам", () => {
    vi.useFakeTimers();
    const box = document.createElement("div");
    box.append(video(640, 480));
    live = startMix({ grid: () => box, streams: () => [] });
    const ctx = live.canvas.getContext("2d");
    vi.advanceTimersByTime(100);
    const was = ctx.drawn.length;
    box.append(video(640, 480));           // пришёл второй
    ctx.drawn.length = 0;
    vi.advanceTimersByTime(100);
    expect(ctx.drawn.length).toBeGreaterThan(was ? 1 : 0);
    expect(ctx.drawn.length % 2).toBe(0);  // теперь по две плитки на кадр
  });
});

describe("звук всех участников", () => {
  it("каждый поток со звуком становится источником микшера", () => {
    const made = vi.spyOn(window.AudioContext.prototype, "createMediaStreamSource");
    const mine = stream(["audio", "video"]);
    const theirs = stream(["audio"]);
    live = startMix({ grid: () => null, streams: () => [mine, theirs] });
    // Свой голос и голос собеседника — два источника, один общий выход.
    expect(made).toHaveBeenCalledTimes(2);
    expect(made.mock.calls.map(([s]) => s)).toEqual([mine, theirs]);
    expect(live.stream.getAudioTracks()).toHaveLength(1);
  });

  it("поток без звука не подключается, и один поток не подключается дважды", () => {
    const made = vi.spyOn(window.AudioContext.prototype, "createMediaStreamSource");
    const mute = stream(["video"]);
    const loud = stream(["audio"]);
    const list = [mute, loud];
    live = startMix({ grid: () => null, streams: () => list });
    live.sync();
    live.sync();
    expect(made).toHaveBeenCalledTimes(1);
    expect(made.mock.calls[0][0]).toBe(loud);
  });

  it("подключившийся посреди записи получает голос, ушедший — отсоединяется", () => {
    const made = vi.spyOn(window.AudioContext.prototype, "createMediaStreamSource");
    const mine = stream(["audio"]);
    const theirs = stream(["audio"]);
    const list = [mine];
    live = startMix({ grid: () => null, streams: () => list });
    expect(made).toHaveBeenCalledTimes(1);

    list.push(theirs);          // кто-то вошёл
    live.sync();
    expect(made).toHaveBeenCalledTimes(2);
    const node = made.mock.results[1].value;
    expect(node.connected).toBe(true);

    list.splice(1, 1);          // и вышел
    live.sync();
    expect(node.connected).toBe(false);
  });
});

describe("остановка", () => {
  it("гасит таймер, узлы и дорожки — иначе холст жёг бы батарею после записи", () => {
    vi.useFakeTimers();
    const box = document.createElement("div");
    box.append(video(640, 480));
    const m = startMix({ grid: () => box, streams: () => [stream(["audio"])] });
    const ctx = m.canvas.getContext("2d");
    vi.advanceTimersByTime(100);
    const track = m.stream.getVideoTracks()[0];
    const stopped = vi.spyOn(track, "stop");
    m.stop();
    ctx.drawn.length = 0;
    vi.advanceTimersByTime(500);
    expect(ctx.drawn).toHaveLength(0);     // больше не рисуем
    expect(stopped).toHaveBeenCalled();
  });
});
