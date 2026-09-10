import { describe, expect, it } from "vitest";
import { DUE_ON, budgetHours, checkGoal, dueHours, goalQty, goalState, goalText, newGoal,
  normalizeGoal, plannable,
  perMonth, planGoal, workDays } from "../lib/goals.js";
import { MONTH_H } from "../lib/plan.js";
import { normalizeFunc } from "../lib/funcs.js";

/* Цель ушла с ресурса, где была одним числом. Число не отвечало ни на один
   вопрос, который человек про цель задаёт: к какому сроку, каким темпом и
   какой ценой. Здесь проверяется, что все три отвечены — и что ответ
   считается из модели, а не хранится рядом с ней. */

/* Количество в образцах — числом, как его и произносят: «пять». В записи
   это условие «=5» (lib/expr.js), и образец переводит одно в другое. */
const G = ({ qty, ...over } = {}) => normalizeGoal({ ...newGoal("t2"), ...over,
  ...(qty != null ? { expr: `=${qty}` } : {}) });

/* Один клиент делается из двух «спросов» и занимает 20 часов. Спрос никуда
   не запасён — его производит «реклама», почти мгновенно и за деньги.
   Значит цепочка настоящая: продажа не начнётся раньше рекламы. */
const model = {
  traits: [{ id: "t0", e: "A", l: "деньги", have: 1e6 },
    { id: "t1", e: "A", l: "спрос", have: 0 },
    { id: "t2", e: "A", l: "клиент", have: 0 }],
  funcs: [normalizeFunc({ id: "f1", e: "A", name: "продажа", dur: 20, durUnit: "ч",
    takes: [{ trait: "t1", lo: 2, hi: 2 }], gives: [{ trait: "t2", lo: 1, hi: 1 }] }),
  normalizeFunc({ id: "f0", e: "A", name: "реклама", dur: 0.001, durUnit: "ч",
    takes: [{ trait: "t0", lo: 1, hi: 1 }], gives: [{ trait: "t1", lo: 2, hi: 2 }] })],
};

describe("цель — это не число", () => {
  it("новая цель уже осмысленна: ресурс, количество, темп и срок", () => {
    const g = newGoal("t2");
    expect(g).toMatchObject({ trait: "t2", expr: "=1", rate: "week", dueIn: 1, dueUnit: "мес" });
  });

  it("без ресурса или без количества считать нечего", () => {
    expect(checkGoal(G(), model.traits)).toBe(true);
    expect(checkGoal(G({ trait: "" }), model.traits)).toBe(false);
    expect(checkGoal(G({ expr: "" }), model.traits)).toBe(false);
    expect(checkGoal(G({ expr: "=2+" }), model.traits)).toBe(false);
    // Прежнее число читается как «ровно столько».
    expect(normalizeGoal({ qty: 7 }).expr).toBe("=7");
    expect(normalizeGoal({ qty: 7 }).qty).toBeUndefined();
    // Срок обязателен: цель без срока — это пожелание.
    expect(checkGoal(G({ dueIn: 0 }), model.traits)).toBe(false);
  });

  it("читается словами, как её произносит человек", () => {
    const g = G({ qty: 1, rate: "week", dueIn: 1, dueUnit: "мес", hours: 1,
      hoursPer: "day", days: [1, 2, 3, 4, 5] });
    expect(goalText(g, () => "клиент"))
      .toBe("1 клиент в неделю · через 1 мес · 1 ч в день (5 дн/нед)");
    expect(goalText(G({ expr: ">@{t1}*2" }), (id) => ({ t1: "спрос", t2: "клиент" })[id]))
      .toMatch(/^> @спрос\*2 клиент/);
  });
});

describe("темп", () => {
  it("«один в неделю» — это столько-то в месяц", () => {
    expect(perMonth(G({ rate: "week" }), 1)).toBeCloseTo(MONTH_H / 168);
    expect(perMonth(G({ rate: "month" }), 2)).toBeCloseTo(2);
  });

  it("разовая цель месячного темпа не задаёт", () => {
    // «Получить одного» и «получать по одному каждый месяц» — разные вещи,
    // и приводить первое ко второму значило бы выдумать повторение.
    expect(perMonth(G({ rate: "once" }), 1)).toBeNull();
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

  /* ─── у числа есть единица ───

     «2 в день» не читается вовсе: два часа или два дня — разные вещи, а
     поле молча считало часы. Мера та же, что у сроков функций: день это 24
     часа, неделя — 168. Двух разных «дней» в одной модели быть не должно. */
  it("единица у числа считается: два дня в неделю — это 48 часов, а не два", () => {
    const hours = budgetHours(G({ hours: 2, hoursUnit: "ч", hoursPer: "week" }));
    const days = budgetHours(G({ hours: 2, hoursUnit: "дн", hoursPer: "week" }));
    expect(days).toBeCloseTo(hours * 24);
  });

  it("единицы нет — считаем часы, как и прежние цели", () => {
    expect(budgetHours(G({ hours: 3, hoursPer: "week" })))
      .toBeCloseTo(budgetHours(G({ hours: 3, hoursUnit: "ч", hoursPer: "week" })));
  });

  it("бюджет идёт в прогноз: с единицей «дн» цель влезает, с «ч» — нет", () => {
    /* Ради этого сравнения время и спрашивают. Единица меняет его в 24
       раза — значит и ответ «влезает ли» обязана менять. */
    const tight = planGoal(model, G({ qty: 1, rate: "week",
      hours: 1, hoursUnit: "ч", hoursPer: "week" }), {});
    const roomy = planGoal(model, G({ qty: 1, rate: "week",
      hours: 1, hoursUnit: "нед", hoursPer: "week" }), {});
    expect(tight.fits).toBe(false);
    expect(roomy.fits).toBe(true);
    expect(roomy.budget).toBeCloseTo(tight.budget * 168);
  });
});

describe("количество — выражением", () => {
  it("«=» и «>» дают число для плана, «<» и «!» — только условие", () => {
    expect(plannable(G({ expr: "=5" }), model)).toBe(true);
    expect(plannable(G({ expr: ">5" }), model)).toBe(true);
    expect(plannable(G({ expr: "<5" }), model)).toBe(false);
    expect(plannable(G({ expr: "!5" }), model)).toBe(false);
    expect(plannable(G({ expr: "=0" }), model)).toBe(false);
  });

  it("ссылка на другой ресурс считается по его остатку", () => {
    const m = { ...model, traits: model.traits.map((t) => (t.id === "t1" ? { ...t, have: 4 } : t)) };
    // t2 нужно вдвое больше, чем есть t1: 8.
    expect(goalQty(G({ expr: "=@{t1}*2" }), m)).toBe(8);
    expect(goalState(G({ expr: "=@{t1}*2" }), m)).toMatchObject({ target: 8, met: false });
    // План на 8 — работы больше, чем на 1.
    expect(planGoal(m, G({ expr: "=@{t1}*2", rate: "once" }), {}).work.hi)
      .toBeGreaterThan(planGoal(m, G({ expr: "=1", rate: "once" }), {}).work.hi);
    // Удалённый ресурс — ошибка, а не ноль.
    expect(goalState(G({ expr: "=@{нет}" }), m).error).toMatch(/удалён/);
    expect(checkGoal(G({ expr: "=@{нет}" }), m.traits)).toBe(true);   // запись цела
    expect(plannable(G({ expr: "=@{нет}" }), m)).toBe(false);          // а плана нет
  });
});

describe("что цель означает для модели", () => {
  const plan = (over) => planGoal(model, G(over), {});

  it("считает работу за период темпа и приводит её к месяцу", () => {
    // Один клиент — 20 часов продажи. Один в неделю — это ~4,3 таких
    // круга в месяц.
    const p = plan({ qty: 1, rate: "week", hours: 0 });
    expect(p.ok).toBe(true);
    expect(p.work.hi).toBeCloseTo(20.001 * (MONTH_H / 168), 0);
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
    // Круг занимает 20 часов; «один в день» ещё держится, а «два в день» —
    // уже нет, сколько ни старайся.
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

  it("цена по ресурсам считается, а не называется человеком", () => {
    /* Прежде цель просила назвать «затраты другого ресурса», и модель тут
       же считала настоящие: рядом стояли два ответа на один вопрос, причём
       один — догадка. Спрашивать перестали; остался посчитанный. */
    const p = planGoal(model, G({ qty: 1, rate: "once",
      costs: [{ id: "c1", trait: "t1", qty: 1 }] }), {});
    expect(p.costs).toEqual([]);
    expect(p.extra.find((x) => x.name === "спрос")).toMatchObject({ real: 2 });
  });

  it("и считается по всем ресурсам, а не по не названным человеком", () => {
    const p = planGoal(model, G({ qty: 1, rate: "once" }), {});
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

  it("единица времени у прежних целей — часы: их числа не меняются", () => {
    /* Поле единицы завели позже, и старые записи считали часы. «ч» и есть
       их значение по умолчанию — иначе прежний бюджет молча вырос бы в
       сутки. */
    expect(normalizeGoal({}).hoursUnit).toBe("ч");
    expect(normalizeGoal({ hoursUnit: "выдумка" }).hoursUnit).toBe("ч");
    expect(normalizeGoal({ hoursUnit: "дн" }).hoursUnit).toBe("дн");
  });
});


describe("что цель сделает с моделью", () => {
  const plan = (over) => planGoal(model, G(over), { now: Date.UTC(2026, 0, 1) });

  it("видно, каких ресурсов прибавится, а каких убавится", () => {
    // Один клиент: +1 клиент, −2 спроса, а спрос производит реклама, и она
    // ест деньги. Чистое изменение по каждому ресурсу, а не приход и
    // расход по отдельности.
    const e = plan({ qty: 1, rate: "once" }).effect;
    expect(e.t2).toBe(1);
    expect(e.t0).toBeLessThan(0);
    // Спрос и производится, и тратится — в итоге ноль или около него.
    expect(Math.abs(e.t1)).toBeLessThan(1e-9);
  });

  it("видно, какие задачи и когда заведутся", () => {
    const rows = plan({ qty: 2, rate: "once" }).schedule;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ name: expect.any(String), no: 1 });
    expect(rows[0].start instanceof Date).toBe(true);
    // Список отсортирован по времени: сперва то, что делается раньше.
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].start.getTime()).toBeGreaterThanOrEqual(rows[i - 1].start.getTime());
    }
  });

  it("функция не начинается раньше, чем созреют её входы", () => {
    // Продажа ждёт рекламу: её задача не может стоять первой.
    const rows = plan({ qty: 1, rate: "once" }).schedule;
    const ad = rows.find((r) => r.name === "реклама");
    const sale = rows.find((r) => r.name === "продажа");
    expect(sale.start.getTime()).toBeGreaterThanOrEqual(ad.start.getTime());
  });

  it("недостижимая цель не заводит ни одной задачи", () => {
    const alone = { traits: [{ id: "t9", e: "A", l: "чудо" }], funcs: [] };
    expect(planGoal(alone, normalizeGoal({ ...newGoal("t9"), qty: 5 }), {}).schedule)
      .toEqual([]);
  });
});

describe("применение цели", () => {
  it("новая цель не применена: сперва прикидка, потом решение", () => {
    // Пока цель не применена, она считается, но ни на что не влияет. Без
    // этой границы каждая правка числа молча меняла бы доску задач.
    expect(newGoal("t2").appliedAt).toBeNull();
  });

  it("отметка о применении переживает чтение чужой записи", () => {
    const at = "2026-01-01T00:00:00.000Z";
    expect(normalizeGoal({ appliedAt: at }).appliedAt).toBe(at);
    expect(normalizeGoal({}).appliedAt).toBeNull();
  });
});
