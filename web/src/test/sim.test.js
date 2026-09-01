import { describe, expect, it } from "vitest";
import { Cond, depsOf, isFlow, simulate } from "../lib/sim.js";

/* Движок: расход ресурса и дележ между теми, кто на него претендует.
   Числа здесь проверяются напрямую — на отрисованные значения полагаться
   нельзя, ошибка в расчёте глазом не видна. */

// «Моё время» отдаёт 10 часов в день; двое желающих просят по 10 часов в день.
const time = (fromTrait) => ({
  traits: [
    { id: "work", e: "me", k: "res", l: "рабочее время", unit: "ч/день" },
    { id: "cv", e: "job", k: "res", l: "время на резюме", unit: "ч/день" },
    { id: "bid", e: "ord", k: "res", l: "время на отклики", unit: "ч/день" },
  ],
  edges: [
    // пополнение самого себя — приходит извне модели, источника не имеет
    { id: "e0", from: "me", to: "work", gives: 10, per: "день", sign: 1, conds: [] },
    { id: "e1", from: "me", to: "cv", gives: 10, per: "день", sign: 1, conds: [], fromTrait },
    { id: "e2", from: "me", to: "bid", gives: 10, per: "день", sign: 1, conds: [], fromTrait },
  ],
});
const run = (m, months = 3) => simulate(m.traits, m.edges, months);
const at = (s, i = 0) => Math.round(s[i] * 100) / 100;

describe("расход ресурса", () => {
  it("без указанного источника величина берётся из ниоткуда — как было раньше", () => {
    // Обратная совместимость: у всех стрелок в сохранённых сценариях источника
    // нет, и считаться они должны ровно как считались.
    const s = run(time(undefined));
    expect(at(s.work)).toBe(300);
    expect(at(s.cv)).toBe(300);
    expect(at(s.bid)).toBe(300);
  });

  it("с источником один и тот же час не уходит в два места", () => {
    // 10 ч/день = 300 ч/мес на всех. Просят 600 — каждый получает половину.
    const s = run(time("work"));
    expect(at(s.cv)).toBe(150);
    expect(at(s.bid)).toBe(150);
    expect(at(s.work)).toBe(0); // всё распределено, свободного времени не осталось
  });

  it("одному желающему достаётся всё, что есть", () => {
    const m = time("work");
    m.edges = m.edges.filter((e) => e.id !== "e2");
    const s = run(m);
    expect(at(s.cv)).toBe(300);
    expect(at(s.work)).toBe(0);
  });

  it("когда хватает на всех, никто не урезан", () => {
    const m = time("work");
    m.edges[1].gives = 3;
    m.edges[2].gives = 4;
    const s = run(m);
    expect(at(s.cv)).toBe(90);
    expect(at(s.bid)).toBe(120);
    expect(at(s.work)).toBe(90); // 300 − 90 − 120 осталось свободным
  });

  it("делится по величине запроса, а не поровну", () => {
    // Кто просил вдвое больше — вдвое больше и получит.
    const m = time("work");
    m.edges[1].gives = 10;
    m.edges[2].gives = 20;
    const s = run(m);
    expect(at(s.cv)).toBe(100);
    expect(at(s.bid)).toBe(200);
  });

  it("порядок стрелок в файле не даёт преимущества", () => {
    const m = time("work");
    const s1 = run(m);
    const flipped = time("work");
    flipped.edges = [flipped.edges[0], flipped.edges[2], flipped.edges[1]];
    const s2 = run(flipped);
    expect(at(s2.cv)).toBe(at(s1.cv));
    expect(at(s2.bid)).toBe(at(s1.bid));
  });
});

describe("расход запаса", () => {
  const stock = (fromTrait) => ({
    traits: [
      { id: "money", e: "co", k: "res", l: "деньги", unit: "₽", have: 1000 },
      { id: "ads", e: "mk", k: "res", l: "закупленная реклама", unit: "₽" },
    ],
    edges: [{ id: "e1", from: "co", to: "ads", gives: 400, per: "мес", sign: 1,
      conds: [], fromTrait }],
  });

  it("запас убывает ровно на переданное", () => {
    const s = simulate(stock("money").traits, stock("money").edges, 2);
    // Ряд показывает состояние на начало месяца, до списания за него.
    expect(at(s.money, 0)).toBe(1000);
    expect(at(s.money, 1)).toBe(600);
    expect(at(s.money, 2)).toBe(200);
    expect(at(s.ads, 1)).toBe(400);
    expect(at(s.ads, 2)).toBe(800);
  });

  it("нельзя потратить больше, чем накоплено", () => {
    const s = simulate(stock("money").traits, stock("money").edges, 4);
    expect(at(s.money, 3)).toBe(0);
    // За третий месяц ушло только то, что оставалось: 200, а не 400.
    expect(at(s.ads, 4)).toBe(1000);
    expect(Math.min(...s.money)).toBeGreaterThanOrEqual(0);
  });

  it("пустой запас ничего не даёт", () => {
    const m = stock("money");
    m.traits[0].have = 0;
    const s = simulate(m.traits, m.edges, 2);
    expect(at(s.ads, 2)).toBe(0);
  });
});

describe("устойчивость к кривым ссылкам", () => {
  it("ссылка на несуществующий ресурс не обнуляет стрелку", () => {
    const m = time("нет-такого");
    const s = run(m);
    expect(at(s.cv)).toBe(300); // считаем как без источника, а не как «нечего взять»
  });

  it("ресурс не питает сам себя", () => {
    // Иначе стрелка «+10 из самого себя» давала бы ровно ноль, и человек
    // не понял бы, куда делось пополнение.
    const m = time(undefined);
    m.edges[0].fromTrait = "work";
    const s = run(m);
    expect(at(s.work)).toBe(300);
  });

  it("условия по-прежнему ограничивают стрелку", () => {
    const m = time("work");
    m.traits.push({ id: "gate", e: "me", k: "res", l: "готовность", unit: "шт.", have: 5 });
    // «не меньше 10» при 5 — половина.
    m.edges[1].conds = [Cond("gate", "min", 10)];
    const s = run(m);
    // Условие уменьшает запрос (300 → 150), и уже уменьшенные запросы делят
    // те же 300 часов: 150 и 300 просят, получают 100 и 200.
    expect(at(s.cv)).toBe(100);
    expect(at(s.bid)).toBe(200);
    expect(at(s.cv) + at(s.bid)).toBe(300); // больше, чем есть, не раздали
  });
});

describe("граф зависимостей цели", () => {
  it("включает ресурс, из которого стрелка берёт", () => {
    // Не хватит источника — цель не будет достигнута, значит он в графе.
    const d = depsOf(time("work").edges, "cv");
    expect(d.traits).toContain("work");
  });

  it("без источника лишнего в граф не тянет", () => {
    const d = depsOf(time(undefined).edges, "cv");
    expect(d.traits).not.toContain("work");
  });
});

describe("тип величины", () => {
  it("слэш в единице делает поток", () => {
    expect(isFlow({ unit: "ч/день" })).toBe(true);
    expect(isFlow({ unit: "₽" })).toBe(false);
    expect(isFlow({ unit: "₽", flow: true })).toBe(true);
  });
});
