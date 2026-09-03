import { describe, expect, it } from "vitest";
import { barOf } from "../components/Timeline.jsx";

/* Полоса задачи на оси времени. Задача без начала и без сдач полосы не
   имеет: рисовать её «от сегодня до сегодня» значило бы выдумать данные. */

const func = { dur: 2, durUnit: "ч" };
const DAY = 86400000;

describe("полоса задачи", () => {
  it("без начала и без сдач полосы нет", () => {
    expect(barOf({ submissions: [] }, func)).toBeNull();
    expect(barOf({ start: null, submissions: [] }, func)).toBeNull();
    expect(barOf({ start: "", submissions: [] }, func)).toBeNull();
  });

  it("пустое начало — это не полночь 1970 года", () => {
    // `new Date(null)` даёт ровно её, и задача без начала уезжала на ось в
    // шестидесятые, утаскивая за собой всю шкалу.
    const at = "2026-09-03T10:00:00.000Z";
    const bar = barOf({ start: null, submissions: [{ id: "s", at }] }, func);
    expect(bar.from).toBe(new Date(at).getTime());
  });

  it("от начала — на время одного выполнения, пока сдач нет", () => {
    const start = "2026-09-01T09:00:00.000Z";
    const bar = barOf({ start, submissions: [] }, { dur: 3, durUnit: "дн" });
    expect(bar.from).toBe(new Date(start).getTime());
    expect(bar.to - bar.from).toBe(3 * DAY);
  });

  it("до последней сдачи, а не до первой попавшейся", () => {
    // Обычная sort() сравнивает как строки: «9…» шло бы после «17…», и
    // последняя сдача оказывалась не последней.
    const t = (iso) => new Date(iso).getTime();
    const bar = barOf({ start: "2026-09-01T00:00:00.000Z", submissions: [
      { id: "a", at: "2026-09-09T00:00:00.000Z" },
      { id: "b", at: "2026-09-17T00:00:00.000Z" },
    ] }, func);
    expect(bar.to).toBe(t("2026-09-17T00:00:00.000Z"));
  });
});
