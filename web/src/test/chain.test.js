import { describe, expect, it } from "vitest";
import { normalizeFunc } from "../lib/funcs.js";
import { actualOf, chainOf, estimate, estimateRange, factorsIn } from "../lib/chain.js";

/* ЦЕПОЧКА · что случится с этим ресурсом дальше.

   Счёт идёт ВПЕРЁД, от того, что уже лежит на столе. Цель разворачивается
   назад — «что сделать, чтобы получить»; здесь наоборот — «вот заявка, во
   что она превратится, до какого звена и какой ценой». */

const F = (over) => normalizeFunc({ e: "A", dur: 1, durHi: 1, durUnit: "ч",
  every: 0, everyHi: 0, ...over });

const MODEL = {
  traits: [{ id: "zayavka", e: "A", l: "заявка", have: 5 },
    { id: "tz", e: "A", l: "ТЗ", have: 0 },
    { id: "maket", e: "A", l: "макет", have: 0 },
    { id: "sait", e: "A", l: "сайт", have: 0 },
    { id: "dengi", e: "A", l: "деньги", have: 100 }],
  funcs: [
    F({ id: "f1", name: "Разобрать заявку", takes: [{ trait: "zayavka", lo: 1, hi: 1 }],
      gives: [{ trait: "tz", lo: 1, hi: 1 }] }),
    F({ id: "f2", name: "Собрать макет", takes: [{ trait: "tz", lo: 1, hi: 1, spend: false }],
      gives: [{ trait: "maket", lo: 1, hi: 2 }] }),
    F({ id: "f3", name: "Сверстать", takes: [{ trait: "maket", lo: 1, hi: 1 },
      { trait: "dengi", lo: 10, hi: 10 }],
    gives: [{ trait: "sait", lo: 1, hi: 1 }] }),
  ],
  factors: [{ id: "x1", e: "A", name: "сезон", chance: 40 }],
  tasks: [],
};

describe("цепочка от ресурса", () => {
  it("идёт вперёд по слоям: ресурс → функция → ресурс", () => {
    const c = chainOf(MODEL, { from: "zayavka" });
    expect(c.steps.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
    expect(c.traits).toEqual(["zayavka", "tz", "maket", "sait"]);
    // «Деньги» в цепочку не входят: их эта работа не производит, они
    // приходят со стороны.
    expect(c.traits).not.toContain("dengi");
  });

  it("ресурс-звено закрывает цепочку на себе", () => {
    const c = chainOf(MODEL, { from: "zayavka", upto: "maket" });
    expect(c.steps.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(c.traits).toEqual(["zayavka", "tz", "maket"]);
    expect(c.ok).toBe(true);
  });

  it("функция-звено входит в цепочку последней", () => {
    const c = chainOf(MODEL, { from: "zayavka", upto: "f2" });
    expect(c.steps.map((f) => f.id)).toEqual(["f1", "f2"]);
    // Её выход дальше не разворачивается: человек просил остановиться на ней.
    expect(c.traits).toEqual(["zayavka", "tz"]);
  });

  it("до звена не дошли — это разрыв, и молчать о нём нельзя", () => {
    const c = chainOf(MODEL, { from: "maket", upto: "tz" });
    expect(c.ok).toBe(false);
  });

  it("кольцо не зацикливает: функция входит в цепочку один раз", () => {
    const loop = { ...MODEL, funcs: [
      F({ id: "a", takes: [{ trait: "x" }], gives: [{ trait: "y" }] }),
      F({ id: "b", takes: [{ trait: "y" }], gives: [{ trait: "x" }] }),
    ] };
    expect(chainOf(loop, { from: "x" }).steps.map((f) => f.id)).toEqual(["a", "b"]);
  });
});

describe("предварительная оценка", () => {
  const chain = chainOf(MODEL, { from: "zayavka" });

  it("считает выполнения, время и изменение ресурсов", () => {
    const e = estimate(MODEL, chain, { side: "hi", qty: 1 });
    expect(e.steps.map((s) => s.func)).toEqual(["f1", "f2", "f3"]);
    // Одна заявка — одно ТЗ — щедрой стороной два макета — два сайта.
    expect(e.steps.find((s) => s.func === "f2").runs).toBe(1);
    expect(e.delta.zayavka).toBe(-1);
    expect(e.delta.tz).toBe(1);
    expect(e.delta.sait).toBeGreaterThan(0);
  });

  it("обработанное не расходуется: ТЗ остаётся на месте", () => {
    const e = estimate(MODEL, chain, { side: "hi", qty: 1 });
    // f2 берёт ТЗ, не расходуя: в минус оно не уходит.
    expect(e.delta.tz).toBe(1);
  });

  it("вход со стороны работу не сдерживает, но и не замалчивается", () => {
    const e = estimate(MODEL, chain, { side: "hi", qty: 1 });
    // Деньги в цепочке не производятся — они в «нужно со стороны».
    expect(e.need.dengi).toBeGreaterThan(0);
  });

  it("календарный срок — по самой длинной ветке, а не сумма всего", () => {
    const e = estimate(MODEL, chain, { side: "hi", qty: 1 });
    expect(e.calendarHours).toBeGreaterThan(0);
    expect(e.calendarHours).toBeLessThanOrEqual(
      e.steps.reduce((s, x) => s + x.calendarHours, 0));
    // Вторая функция ждёт первую: раньше её выхода она не начнётся.
    expect(e.steps.find((s) => s.func === "f2").startHours).toBeGreaterThan(0);
  });

  it("оценка — вилка, а не число: одно число было бы обещанием", () => {
    const r = estimateRange(MODEL, chain, { qty: 1 });
    expect(r.lo.delta.maket).toBeLessThanOrEqual(r.hi.delta.maket);
  });

  it("пустая цепочка ничего не выдумывает", () => {
    const e = estimate(MODEL, chainOf(MODEL, { from: "sait" }), { qty: 1 });
    expect(e.steps).toEqual([]);
    expect(e.workHours).toBe(0);
  });
});

describe("цепочка целиком, а не первое звено", () => {
  /* Живая воронка: контакты лида → договор → заказ → прибыль. «Передача
     заказа разработчикам» берёт И договор, И контакты лида — то есть входы
     у неё из разной глубины. Цепочка кладёт такую функцию в список по
     первому достигнутому входу, и считать её в том же порядке нельзя. */
  const LEAD = {
    traits: [{ id: "lead", e: "A", l: "контакты лида" }, { id: "dog", e: "A", l: "договор" },
      { id: "zak", e: "A", l: "заказ" }, { id: "pri", e: "A", l: "прибыль" }],
    funcs: [
      F({ id: "g1", name: "Созвон с лидом", takes: [{ trait: "lead", lo: 1, hi: 1 }],
        gives: [{ trait: "dog", lo: 1, hi: 1 }] }),
      F({ id: "g2", name: "Передача заказа", gives: [{ trait: "zak", lo: 1, hi: 1 }],
        takes: [{ trait: "dog", lo: 1, hi: 1 }, { trait: "lead", lo: 1, hi: 1, spend: false }] }),
      F({ id: "g3", name: "Получение прибыли", takes: [{ trait: "zak", lo: 1, hi: 1 }],
        gives: [{ trait: "pri", lo: 1000, hi: 1000 }] }),
    ],
    factors: [], tasks: [],
  };
  const stepsOf = (model) => estimate(model,
    chainOf(model, { from: "lead", upto: "" }), { side: "hi", qty: 1 }).steps;

  it("считается в порядке зависимостей, а не в порядке сбора цепочки", () => {
    /* Функция, у которой все входы из цепочки уже кто-то выдал, считается
       раньше. Иначе о договоре спрашивают раньше, чем его сделали, и шаг
       выходит с нулём выполнений. */
    const ok = { ...LEAD, funcs: LEAD.funcs.map((f) => (f.id === "g2"
      ? { ...f, takes: [{ ...f.takes[0] }] } : f)) };
    // Порядок в самой модели значения не имеет: считается по зависимостям.
    const swapped = { ...ok, funcs: [ok.funcs[2], ok.funcs[1], ok.funcs[0]] };
    expect(stepsOf(ok).map((s) => `${s.name} ×${s.runs}`))
      .toEqual(["Созвон с лидом ×1", "Передача заказа ×1", "Получение прибыли ×1"]);
    expect(stepsOf(swapped).map((s) => s.runs)).toEqual([1, 1, 1]);
  });

  it("шаг, который не выполнится, не исчезает — и говорит, чего не хватило", () => {
    /* Прежде такой шаг молча пропускался вместе со всем, что идёт за ним:
       отчёт про цепочку из трёх звеньев показывал одну задачу и не объяснял
       ничего. Человек видел обрубок и не знал, у него модель такая или
       программа врёт. */
    const steps = stepsOf(LEAD);
    expect(steps.map((s) => s.name)).toEqual([
      "Созвон с лидом", "Передача заказа", "Получение прибыли"]);
    expect(steps[1].runs).toBe(0);
    // Названо и чего не хватило, и кто это израсходовал.
    expect(steps[1].short).toEqual([{ trait: "lead", spentBy: "Созвон с лидом" }]);
    expect(steps[2].short.map((x) => x.trait)).toEqual(["zak"]);
    // Ресурсов несостоявшийся шаг не трогает: чего не было, то не потрачено.
    expect(steps[1].workHours).toBe(0);
    expect(steps[1].calendarHours).toBe(0);
  });

  it("у выполнимого шага список нехватки пуст, а не отсутствует", () => {
    // Иначе показу пришлось бы гадать, чем «нет поля» отличается от «нет
    // нехватки».
    expect(stepsOf(LEAD)[0].short).toEqual([]);
  });
});

describe("одновременные выполнения в оценке", () => {
  it("волнами, а не очередью: срок делится на число одновременных", () => {
    /* Три заявки через функцию, которую ведут по три разом, занимают время
       ОДНОГО выполнения, а не трёх. Восемь дел при четырёх одновременных —
       две волны. Работа при этом та же: человеко-часы не меняются. */
    const par3 = { ...MODEL, funcs: MODEL.funcs.map((f) => (f.id === "f1"
      ? { ...f, par: 3 } : f)) };
    const chain = chainOf(MODEL, { from: "zayavka", upto: "tz" });
    const one = estimate(MODEL, chain, { side: "hi", qty: 3 });
    const many = estimate(par3, chainOf(par3, { from: "zayavka", upto: "tz" }),
      { side: "hi", qty: 3 });
    expect(one.steps[0].calendarHours).toBe(3);
    expect(many.steps[0].calendarHours).toBe(1);
    /* И времени воркера они стоят столько же, сколько одно: он ведёт их
       разом. Считать три полных значило бы обвинить в тройной перегрузке
       того, для кого настройку и завели. */
    expect(many.steps[0].workHours).toBe(one.steps[0].workHours / 3);
  });

  it("неполная волна считается целой: полдела в календаре не занимает полволны", () => {
    const par2 = { ...MODEL, funcs: MODEL.funcs.map((f) => (f.id === "f1"
      ? { ...f, par: 2 } : f)) };
    const chain = chainOf(par2, { from: "zayavka", upto: "tz" });
    expect(estimate(par2, chain, { side: "hi", qty: 3 }).steps[0].calendarHours).toBe(2);
  });
});

describe("факторы, которые влияют", () => {
  it("фактор, трогающий ресурс цепочки, назван — с его вероятностью", () => {
    const m = { ...MODEL, funcs: [...MODEL.funcs,
      F({ id: "fx", name: "Сезонный спад", kind: "factor", factors: ["x1"],
        takes: [], gives: [{ trait: "maket", lo: 1, hi: 1 }] })] };
    const list = factorsIn(m, chainOf(m, { from: "zayavka" }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ func: "fx", traits: ["maket"] });
    expect(list[0].factors[0]).toMatchObject({ name: "сезон", chance: 40 });
  });

  it("фактор в стороне от цепочки её не касается", () => {
    const m = { ...MODEL, funcs: [...MODEL.funcs,
      F({ id: "fy", kind: "factor", factors: ["x1"],
        gives: [{ trait: "dengi", lo: 1, hi: 1 }] })] };
    expect(factorsIn(m, chainOf(m, { from: "zayavka" }))).toEqual([]);
  });
});

describe("фактическая оценка", () => {
  const tasks = [
    { id: "t1", funcId: "f1", title: "Заявка Петрова", status: "done",
      submissions: [{ id: "s1", at: "2026-02-01T10:00:00Z", hours: 3,
        takes: { zayavka: 1 }, gives: { tz: 1 } }] },
    { id: "t2", funcId: "f2", title: "Макет", status: "review",
      submissions: [{ id: "s2", at: "2026-02-02T10:00:00Z", hours: 9,
        takes: { tz: 1 }, gives: { maket: 1 } }] },
    { id: "t3", funcId: "нет-в-цепочке", title: "Чужая", status: "done",
      submissions: [{ id: "s3", at: "2026-02-03T10:00:00Z", hours: 5,
        takes: {}, gives: {} }] },
  ];
  const model = { ...MODEL, tasks };
  const chain = chainOf(model, { from: "zayavka" });

  it("в числа идут только принятые сдачи", () => {
    const a = actualOf(model, chain);
    // Задача на проверке — заявление исполнителя, а не измерение.
    expect(a.hours).toBe(3);
    expect(a.done).toBe(1);
    // Но из виду она не пропадает: это и есть ответ «сколько осталось».
    expect(a.total).toBe(2);
    expect(a.tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("чужая работа в отчёт не попадает", () => {
    expect(actualOf(model, chain).tasks.some((t) => t.id === "t3")).toBe(false);
  });

  it("вычитается только израсходованное, обработанное остаётся", () => {
    const a = actualOf(model, chain);
    expect(a.delta.zayavka).toBe(-1);
    expect(a.delta.tz).toBe(1);
  });

  it("без принятых сдач факта не существует", () => {
    const a = actualOf({ ...model, tasks: [tasks[1]] }, chain);
    expect(a.any).toBe(false);
    expect(a.hours).toBe(0);
  });
});
