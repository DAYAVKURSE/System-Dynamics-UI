import { describe, expect, it } from "vitest";
import { DUE_ON, budgetHours, checkGoal, dueHours, goalText, newGoal, normalizeGoal,
  perMonth, planGoal, workDays } from "../lib/goals.js";
import { MONTH_H } from "../lib/plan.js";
import { normalizeFunc } from "../lib/funcs.js";

/* Цель ушла с ресурса, где была одним числом. Число не отвечало ни на один
   вопрос, который человек про цель задаёт: к какому сроку, каким темпом и
   какой ценой. Здесь проверяется, что все три отвечены — и что ответ
   считается из модели, а не хранится рядом с ней. */

const G = (over = {}) => normalizeGoal({ ...newGoal("t2"), ...over });

/* Один клиент делается из двух «спросов» и занимает сутки. Спрос приходит
   извне — от функции «реклама», иначе поток нечем кормить. */
const model = {
  traits: [{ id: "t0", e: "A", l: "деньги", have: 1e6 },
    { id: "t1", e: "A", l: "спрос", have: 1000 },
    { id: "t2", e: "A", l: "клиент", have: 0 }],
  funcs: [normalizeFunc({ id: "f1", e: "A", name: "продажа", dur: 1, durUnit: "дн",
    takes: [{ trait: "t1", lo: 2, hi: 2 }], gives: [{ trait: "t2", lo: 1, hi: 1 }] }),
  normalizeFunc({ id: "f0", e: "A", name: "реклама", dur: 0.001, durUnit: "ч",
    takes: [{ trait: "t0", lo: 1, hi: 1 }], gives: [{ trait: "t1", lo: 2, hi: 2 }] })],
};

describe("цель — это не число", () => {
  it("новая цель уже осмысленна: ресурс, количество, темп и срок", () => {
    const g = newGoal("t2");
    expect(g).toMatchObject({ trait: "t2", qty: 1, rate: "week", dueIn: 1, dueUnit: "мес" });
  });

  it("без ресурса или без количества считать нечего", () => {
    expect(checkGoal(G(), model.traits)).toBe(true);
    expect(checkGoal(G({ trait: "" }), model.traits)).toBe(false);
    expect(checkGoal(G({ qty: 0 }), model.traits)).toBe(false);
    // Срок обязателен: цель без срока — это пожелание.
    expect(checkGoal(G({ dueIn: 0 }), model.traits)).toBe(false);
  });

  it("читается словами, как её произносит человек", () => {
    const g = G({ qty: 1, rate: "week", dueIn: 1, dueUnit: "мес", hours: 1,
      hoursPer: "day", days: [1, 2, 3, 4, 5] });
    expect(goalText(g, () => "клиент"))
      .toBe("1 клиент в неделю · через 1 мес · 1 ч в день (5 дн/нед)");
  });
});

describe("темп", () => {
  it("«один в неделю» — это столько-то в месяц", () => {
    expect(perMonth(G({ qty: 1, rate: "week" }))).toBeCloseTo(MONTH_H / 168);
    expect(perMonth(G({ qty: 2, rate: "month" }))).toBeCloseTo(2);
  });

  it("разовая цель месячного темпа не задаёт", () => {
    // «Получить одного» и «получать по одному каждый месяц» — разные вещи,
    // и приводить первое ко второму значило бы выдумать повторение.
    expect(perMonth(G({ rate: "once" }))).toBeNull();
  });
});

describe("срок", () => {
  it("через сколько-то — это часы", () => {
    expect(dueHours(G({ dueIn: 1, dueUnit: "мес" }))).toBe(MONTH_H);
    expect(dueHours(G({ dueIn: 2, dueUnit: "нед" }))).toBe(336);
  });

  it("или к названному числу", () => {
    const now = new Date("2026-01-01T00:00:00Z").getTime();
    const g = G({ dueKind: DUE_ON, dueOn: "2026-01-11" });
    expect(dueHours(g, now)).toBeCloseTo(240, 0);
  });

  it("срок в прошлом — это ноль, а не отрицательное время", () => {
    const now = new Date("2026-06-01T00:00:00Z").getTime();
    expect(dueHours(G({ dueKind: DUE_ON, dueOn: "2026-01-01" }), now)).toBe(0);
  });

  it("не задан — так и сказано, а не подставлено «когда-нибудь»", () => {
    expect(dueHours(G({ dueIn: 0 }))).toBeNull();
    expect(dueHours(G({ dueKind: DUE_ON, dueOn: "" }))).toBeNull();
  });
});

describe("бюджет времени", () => {
  it("час в день — это месяц часов, а не один", () => {
    expect(budgetHours(G({ hours: 1, hoursPer: "day" })))
      .toBeCloseTo(1 * 7 * (MONTH_H / 168));
  });

  it("дни недели считаются: час в день по будням — пять часов в неделю", () => {
    // Считать все семь значило бы пообещать за человека выходные, которых
    // он не отдавал.
    expect(workDays(G({ days: [1, 2, 3, 4, 5] }))).toBe(5);
    expect(budgetHours(G({ hours: 1, hoursPer: "day", days: [1, 2, 3, 4, 5] })))
      .toBeCloseTo(5 * (MONTH_H / 168));
  });

  it("не задан — null: «сколько угодно» и «нисколько» не одно и то же", () => {
    expect(budgetHours(G({ hours: 0 }))).toBeNull();
  });
});

describe("что цель означает для модели", () => {
  const plan = (over) => planGoal(model, G(over), {});

  it("считает работу за период темпа и приводит её к месяцу", () => {
    // Один клиент делается сутки. Один в неделю — это ~4,3 суток работы
    // в месяц.
    const p = plan({ qty: 1, rate: "week", hours: 0 });
    expect(p.ok).toBe(true);
    expect(p.work.hi).toBeCloseTo(24 * (MONTH_H / 168), 0);
    expect(p.perMonth).toBeCloseTo(MONTH_H / 168);
  });

  it("говорит прямо, влезает ли работа в названный бюджет", () => {
    // Час в день это ~30 ч в месяц, а нужно ~104 ч: не влезает.
    const tight = plan({ qty: 1, rate: "week", hours: 1, hoursPer: "day" });
    expect(tight.fits).toBe(false);
    // Восемь часов в день — влезает.
    const wide = plan({ qty: 1, rate: "week", hours: 8, hoursPer: "day" });
    expect(wide.fits).toBe(true);
  });

  it("бюджет не задан — вердикта нет, а не «влезает»", () => {
    // Молчание тут честнее: не с чем сравнивать.
    expect(plan({ hours: 0 }).fits).toBeNull();
  });

  it("успевает ли первый результат к сроку", () => {
    expect(plan({ qty: 1, rate: "week", dueIn: 1, dueUnit: "мес" }).ready).toBe(true);
    expect(plan({ qty: 1, rate: "week", dueIn: 1, dueUnit: "ч" }).ready).toBe(false);
  });

  it("держится ли темп: круг длиннее периода — «раз в день» не выйдет", () => {
    // Один клиент делается сутки; «один в день» ещё держится, а «два в
    // день» — уже нет, сколько ни старайся.
    expect(plan({ qty: 1, rate: "day" }).cycle).toBe(true);
    expect(plan({ qty: 2, rate: "day" }).cycle).toBe(false);
    // У разовой цели периода нет — и вопроса тоже.
    expect(plan({ rate: "once" }).cycle).toBeNull();
  });

  it("запас идёт в дело у разовой цели, но не у темпа", () => {
    /* «Один клиент в неделю» надо выдавать каждую неделю: склад, из
       которого можно взять один раз, потока не заменяет. А разовая цель —
       это уровень, и то, что уже лежит, до него уже дотянуло. */
    expect(plan({ qty: 5, rate: "once" }).work.hi).toBeGreaterThan(0);
    const held = { ...model, traits: model.traits.map((t) => (t.id === "t2"
      ? { ...t, have: 99 } : t)) };
    expect(planGoal(held, G({ qty: 5, rate: "once" }), {}).work.hi).toBe(0);
    // А темп при том же складе работы не теряет.
    expect(planGoal(held, G({ qty: 1, rate: "week" }), {}).work.hi).toBeGreaterThan(0);
  });

  it("цена по ресурсам: названное человеком рядом с посчитанным", () => {
    // Человек думал, что уйдёт 1 «спрос», а по модели уходит 2.
    const p = planGoal(model, G({ qty: 1, rate: "once",
      costs: [{ id: "c1", trait: "t1", qty: 1 }] }), {});
    expect(p.costs[0]).toMatchObject({ name: "спрос", qty: 1, real: 2 });
  });

  it("и то, чего человек не назвал вовсе", () => {
    const p = planGoal(model, G({ qty: 1, rate: "once", costs: [] }), {});
    expect(p.extra.map((x) => x.name)).toContain("спрос");
  });

  it("недостижимая цель названа недостижимой, а не посчитана в ноль", () => {
    const alone = { traits: [{ id: "t9", e: "A", l: "чудо" }], funcs: [] };
    const p = planGoal(alone, normalizeGoal({ ...newGoal("t9"), qty: 5 }), {});
    expect(p.ok).toBe(false);
  });
});

describe("чужая запись достраивается", () => {
  it("выдуманный темп и единица срока заменяются на понятные", () => {
    const g = normalizeGoal({ rate: "парсек", dueUnit: "верста", days: [9, 1] });
    expect(g.rate).toBe("once");
    expect(g.dueUnit).toBe("мес");
    // Девятого дня недели не бывает.
    expect(g.days).toEqual([1]);
  });

  it("отсутствующий список целей — это пусто, а не падение", () => {
    expect(normalizeGoal({}).costs).toEqual([]);
  });
});
