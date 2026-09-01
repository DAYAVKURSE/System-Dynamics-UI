import { describe, expect, it } from "vitest";
import { Cond, asGate, asRatio, condKind, condRefs, depsOf, isFlow, normalizeTrait,
  normalizeTraits, shown, simulate, stored, transfers, unitOf } from "../lib/sim.js";

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

describe("условие-сравнение: пропускает или нет", () => {
  // «Отклики отправляем, только пока свободного времени больше 100 часов».
  const gated = (expr) => ({
    traits: [
      { id: "work", e: "me", k: "res", l: "рабочее время", unit: "ч/день" },
      { id: "bid", e: "ord", k: "res", l: "отклики", unit: "ч/день" },
      { id: "quota", e: "ord", k: "res", l: "остаток квоты", unit: "шт.", have: 5 },
    ],
    edges: [
      { id: "e0", from: "me", to: "work", gives: 10, per: "день", sign: 1, conds: [] },
      { id: "e1", from: "me", to: "bid", gives: 1, per: "день", sign: 1,
        conds: [{ expr }] },
    ],
  });
  const bid = (expr) => at(simulate(gated(expr).traits, gated(expr).edges, 1).bid);

  it("верное условие пропускает перенос целиком", () => {
    expect(bid("{quota} > 0")).toBe(30);
  });

  it("неверное — перенос не идёт вовсе", () => {
    expect(bid("{quota} > 10")).toBe(0);
  });

  it("сравнение считается после арифметики", () => {
    // 10 - 5 > 2 + 1 → 5 > 3 → верно
    expect(bid("10 - {quota} > 2 + 1")).toBe(30);
    // 10 - 5 > 6 + 1 → 5 > 7 → неверно
    expect(bid("10 - {quota} > 6 + 1")).toBe(0);
  });

  it("пустое условие не душит стрелку", () => {
    // Только что добавленное условие ещё не заполнено — стрелка обязана
    // работать, иначе прогноз схлопывается без объяснения.
    expect(bid("")).toBe(30);
  });

  it("сломанное условие тоже не душит", () => {
    expect(bid("((((")).toBe(30);
    expect(bid("{такого-нет} > 1")).toBe(30);
  });

  it("условие-сравнение сочетается с расходом источника", () => {
    const m = gated("{quota} > 0");
    m.edges[1].fromTrait = "work";
    m.edges[1].gives = 20;
    const s = simulate(m.traits, m.edges, 1);
    expect(at(s.bid)).toBe(300);  // просит 600, есть 300
    expect(at(s.work)).toBe(0);
  });

  it("закрытое условие ничего не тратит у источника", () => {
    const m = gated("{quota} > 10");
    m.edges[1].fromTrait = "work";
    m.edges[1].gives = 20;
    const s = simulate(m.traits, m.edges, 1);
    expect(at(s.bid)).toBe(0);
    expect(at(s.work)).toBe(300); // время осталось нетронутым
  });
});

describe("вид условия", () => {
  it("различает сравнение и пропорцию", () => {
    expect(condKind({ expr: "{a} > 1" })).toBe("gate");
    expect(condKind({ left: "{a}", mode: "min", right: "1" })).toBe("min");
    expect(condKind({ left: "{a}", mode: "max", right: "1" })).toBe("max");
    expect(condKind({ trait: "a", mode: "min", amt: 5 })).toBe("min");
  });

  it("переключение вида не теряет написанное", () => {
    // Человек набрал формулу руками — стирать её при смене вида нельзя.
    const gate = { expr: "10 - {a} >= {b} + 2" };
    expect(asRatio(gate, "min")).toEqual({ left: "10 - {a}", mode: "min", right: "{b} + 2" });
    expect(asGate(asRatio(gate, "min")).expr).toBe("10 - {a} >= {b} + 2");
  });

  it("выражение без сравнения переводится в пропорцию целиком", () => {
    expect(asRatio({ expr: "{a} * 2" }, "min")).toEqual({ left: "{a} * 2", mode: "min", right: "1" });
  });

  it("зависимости условия-сравнения видны графу целей", () => {
    expect(condRefs({ expr: "10 - {a} > {b} + {c}" })).toEqual(["a", "b", "c"]);
  });
});

describe("период ресурса", () => {
  const flow = (per) => ({ id: "w", e: "me", k: "res", l: "время", unit: "ч", flow: true, per });
  const stock = { id: "m", e: "co", k: "res", l: "деньги", unit: "₽", flow: false };

  it("внутри модели поток живёт в месяц, человеку показывается в его периоде", () => {
    expect(shown(flow("день"), 300)).toBe(10);
    expect(shown(flow("мес"), 300)).toBe(300);
    expect(shown(flow("квартал"), 300)).toBe(900);
  });

  it("ввод переводится обратно — туда и назад без потерь", () => {
    expect(stored(flow("день"), 10)).toBe(300);
    expect(shown(flow("день"), stored(flow("день"), 7))).toBe(7);
  });

  it("запас не переводится ничем — он не скорость", () => {
    expect(shown(stock, 1000)).toBe(1000);
    expect(stored(stock, 1000)).toBe(1000);
  });

  it("единица собирается из части и периода", () => {
    expect(unitOf(flow("день"))).toBe("ч/день");
    expect(unitOf(stock)).toBe("₽");
  });
});

describe("разбор старой записи единицы", () => {
  it("«чел./мес» распадается на единицу и период", () => {
    expect(normalizeTrait({ id: "a", unit: "чел./мес" }))
      .toMatchObject({ unit: "чел.", per: "мес", flow: true });
  });

  it("хвост, который не период, остаётся частью единицы", () => {
    // «₽/ч» — это «рублей на час труда», а не скорость: разрезав, мы потеряли
    // бы смысл единицы.
    expect(normalizeTrait({ id: "a", unit: "₽/ч" }))
      .toMatchObject({ unit: "₽/ч", flow: true });
  });

  it("единица без слэша — запас", () => {
    expect(normalizeTrait({ id: "a", unit: "шт." })).toMatchObject({ unit: "шт.", flow: false });
  });

  it("уже разобранное не трогается", () => {
    const t = { id: "a", unit: "ч", flow: true, per: "день" };
    expect(normalizeTrait(t)).toBe(t);
    expect(normalizeTrait(normalizeTrait({ id: "b", unit: "чел./мес" })))
      .toMatchObject({ unit: "чел.", per: "мес" });
  });

  it("разбор не меняет расчёт — числа те же", () => {
    // Единственное, что меняется, — как значение подписано и показано.
    const raw = [
      { id: "a", e: "x", k: "res", l: "поток", unit: "чел./мес" },
      { id: "b", e: "x", k: "res", l: "запас", unit: "шт.", have: 5 },
    ];
    const edges = [{ id: "e", from: "x", to: "a", gives: 7, per: "мес", sign: 1, conds: [] }];
    const before = simulate(raw, edges, 2);
    const after = simulate(normalizeTraits(raw), edges, 2);
    expect(after.a).toEqual(before.a);
    expect(after.b).toEqual(before.b);
  });
});

describe("что стрелка передаёт на самом деле", () => {
  // Случай из жизни: 300 часов в месяц и две стрелки, каждая просит 1460.
  const rush = {
    traits: [
      { id: "work", e: "me", k: "res", l: "рабочее время", unit: "часов", flow: true, per: "мес" },
      { id: "cv", e: "job", k: "res", l: "резюме", unit: "часов", flow: true, per: "мес" },
      { id: "bid", e: "ord", k: "res", l: "отклики", unit: "часов", flow: true, per: "мес" },
    ],
    edges: [
      { id: "in", from: "me", to: "work", gives: 10, per: "день", sign: 1, conds: [] },
      { id: "cv", from: "me", to: "cv", gives: 2, per: "час", sign: 1, conds: [], fromTrait: "work" },
      { id: "bid", from: "me", to: "bid", gives: 2, per: "час", sign: 1, conds: [], fromTrait: "work" },
    ],
  };
  const now = (m = rush, state = { work: 0 }) => {
    const by = {};
    transfers(m.traits, m.edges, {
      valueAt: (id) => state[id] ?? 0,
      seedAt: (t) => Number(t.have ?? 0),
      giveAt: (ed) => Number(ed.gives) || 0,
    }).forEach((f) => { by[f.ed.id] = f; });
    return by;
  };

  it("запрос и полученное — разные числа, и видно оба", () => {
    // Ровно то, из-за чего карточка врала: она показывала запрос как факт.
    const f = now();
    expect(f.cv.want).toBe(1460);
    expect(f.cv.moved).toBe(150);
    expect(f.bid.moved).toBe(150);
  });

  it("сумма выданного не больше того, что есть у источника", () => {
    const f = now();
    expect(f.cv.moved + f.bid.moved).toBe(300);
    expect(f.cv.supply).toBe(300);
    expect(f.cv.demand).toBe(2920);
  });

  it("доля показывает, насколько урезали", () => {
    const f = now();
    expect(f.cv.share).toBeCloseTo(300 / 2920, 6);
    expect(f.in.share).toBe(1); // приход извне никто не режет
  });

  it("когда хватает на всех, запрос и полученное совпадают", () => {
    const m = JSON.parse(JSON.stringify(rush));
    m.edges[1].gives = 1; m.edges[1].per = "день";  // 30
    m.edges[2].gives = 2; m.edges[2].per = "день";  // 60
    const f = now(m);
    expect(f.cv.moved).toBe(f.cv.want);
    expect(f.bid.share).toBe(1);
  });

  it("карточка и симуляция считают одним и тем же — числа сходятся", () => {
    // Если разойдутся, пользователь снова увидит в карточке одно, а в
    // прогнозе другое; поэтому проверяем совпадение прямо.
    const s = simulate(rush.traits, rush.edges, 2);
    const f = now(rush, { work: s.work[0] });
    expect(at(s.cv, 1)).toBe(Math.round(f.cv.moved * 100) / 100);
  });
});
