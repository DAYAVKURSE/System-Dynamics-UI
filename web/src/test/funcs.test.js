import { describe, expect, it } from "vitest";
import { DUR_UNITS, avgHours, cyclesPerMonth, fromHours, hoursOf, newFunc, newGive,
  normalizeFunc, normalizeFuncs } from "../lib/funcs.js";

/* Функциональный элемент — то, что преобразует ресурсы: берёт одни, выдаёт
   другие, и на это уходит время. Здесь проверяется его запись и работа со
   временем: из неё считаются и сроки задач, и то, сколько выполнений
   помещается в шаг прогноза. */

describe("запись элемента", () => {
  it("новый элемент принадлежит активу и пуст, но не сломан", () => {
    const f = newFunc("usr", "вёрстка");
    expect(f.e).toBe("usr");
    expect(f.name).toBe("вёрстка");
    expect(f.takes).toEqual([]);
    expect(f.gives).toEqual([]);
    expect(f.id).toBeTruthy();
  });

  it("у двух элементов подряд разные id — иначе один затрёт другого", () => {
    expect(newFunc("usr").id).not.toBe(newFunc("usr").id);
    expect(newGive().id).not.toBe(newGive().id);
  });

  it("функция — это ВЫХОД: у каждой свои сроки, ответственные и проверяющие", () => {
    // Владелец сказал прямо: проверяющие задаются «для разных функций,
    // которыми они выдают ресурс», а не на элемент целиком.
    const g = newGive("u9", 5);
    expect(g).toMatchObject({ trait: "u9", qty: 5, owners: [], reviewers: [] });
    expect(g.dur).toBeGreaterThan(0);
    expect(DUR_UNITS[g.durUnit]).toBeTruthy();
  });
});

describe("чужая запись достраивается, а не роняет редактор", () => {
  it("элемент без списков получает пустые", () => {
    const f = normalizeFunc({ id: "f1", e: "usr" });
    expect(f.takes).toEqual([]);
    expect(f.gives).toEqual([]);
    expect(f.name).toBe("");
  });

  it("выход без сроков и людей достраивается до годного", () => {
    const f = normalizeFunc({ id: "f1", e: "usr", gives: [{ trait: "u9" }] });
    const g = f.gives[0];
    expect(g.id).toBeTruthy();
    expect(g.owners).toEqual([]);
    expect(g.reviewers).toEqual([]);
    expect(DUR_UNITS[g.durUnit]).toBeTruthy();
    expect(g.qty).toBe(0);
  });

  it("выдуманная единица времени заменяется на понятную", () => {
    const f = normalizeFunc({ gives: [{ trait: "u9", durUnit: "парсек" }] });
    expect(DUR_UNITS[f.gives[0].durUnit]).toBeTruthy();
  });

  it("отсутствующий список элементов — это пусто, а не падение", () => {
    expect(normalizeFuncs(undefined)).toEqual([]);
    expect(normalizeFuncs(null)).toEqual([]);
    expect(normalizeFuncs([{ id: "f1", e: "usr" }])).toHaveLength(1);
  });
});

describe("время", () => {
  it("длительность приводится к часам — общей мере", () => {
    expect(hoursOf({ dur: 2, durUnit: "ч" })).toBe(2);
    expect(hoursOf({ dur: 1, durUnit: "дн" })).toBe(24);
    expect(hoursOf({ dur: 2, durUnit: "нед" })).toBe(336);
    expect(hoursOf({})).toBe(0);
  });

  it("обратно — в удобных единицах, а не в 36 часах", () => {
    expect(fromHours(36)).toEqual({ dur: 1.5, durUnit: "дн" });
    expect(fromHours(3)).toEqual({ dur: 3, durUnit: "ч" });
    expect(fromHours(0)).toEqual({ dur: 0, durUnit: "ч" });
  });

  it("цикл короче месяца повторяется, длиннее — выдаёт долю", () => {
    // Иначе результат, на который ушло полгода, появился бы разом, и
    // модель врала бы о сроках.
    expect(cyclesPerMonth({ dur: 1, durUnit: "мес" })).toBeCloseTo(1);
    expect(cyclesPerMonth({ dur: 1, durUnit: "нед" })).toBeGreaterThan(4);
    expect(cyclesPerMonth({ dur: 6, durUnit: "мес" })).toBeCloseTo(1 / 6);
    // Ноль длительности — не деление на бесконечность, а «не считаем».
    expect(cyclesPerMonth({ dur: 0, durUnit: "дн" })).toBe(0);
  });

  it("среднее берётся только по выполненным циклам", () => {
    // Незакрытая задача ничего не измеряет, а взятая в расчёт занижала бы
    // среднее ровно тогда, когда работа идёт.
    expect(avgHours([24, 48])).toBe(36);
    expect(avgHours([24, 0, 48])).toBe(36);
    expect(avgHours([])).toBeNull();
    expect(avgHours([0])).toBeNull();
  });
});
