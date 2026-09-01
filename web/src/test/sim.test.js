import { describe, expect, it } from "vitest";
import { Cond, adviseFor, asGate, asRatio, condKind, condRefs, depsOf, isFact,
  isFlow, isTaskEdge, modelEdges, normalizeTrait, normalizeTraits, resolveStep,
  shown, simulate, stored, taskEdges, unitOf } from "../lib/sim.js";

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
    // Значение потока — фонд месяца, а не остаток: сколько времени приходит,
    // а не сколько не потрачено. Остаток как значение делал осмысленные
    // условия ложными в начале месяца и качал модель.
    expect(at(s.work)).toBe(300);
  });

  it("одному желающему достаётся всё, что есть", () => {
    const m = time("work");
    m.edges = m.edges.filter((e) => e.id !== "e2");
    const s = run(m);
    expect(at(s.cv)).toBe(300);
    expect(at(s.work)).toBe(300); // фонд месяца не убывает от трат — убывает запас
  });

  it("когда хватает на всех, никто не урезан", () => {
    const m = time("work");
    m.edges[1].gives = 3;
    m.edges[2].gives = 4;
    const s = run(m);
    expect(at(s.cv)).toBe(90);
    expect(at(s.bid)).toBe(120);
    expect(at(s.work)).toBe(300); // фонд месяца; кто сколько взял — видно у получателей
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
    expect(at(s.work)).toBe(300); // фонд месяца
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
  const now = (m = rush) => {
    const by = {};
    resolveStep(m.traits, m.edges, {
      stockAt: (id) => Number(m.traits.find((t) => t.id === id)?.have ?? 0),
      seedAt: (t) => Number(t.have ?? 0),
      giveAt: (ed) => Number(ed.gives) || 0,
    }).moves.forEach((f) => { by[f.ed.id] = f; });
    return by;
  };

  it("запрос и полученное — разные числа, и видно оба", () => {
    // Ровно то, из-за чего карточка врала: она показывала запрос как факт.
    const f = now();
    expect(f.cv.want).toBeCloseTo(1460, 6);
    expect(f.cv.moved).toBeCloseTo(150, 6);
    expect(f.bid.moved).toBeCloseTo(150, 6);
  });

  it("сумма выданного не больше того, что есть у источника", () => {
    const f = now();
    expect(f.cv.moved + f.bid.moved).toBeCloseTo(300, 6);
    expect(f.cv.supply).toBe(300);
    expect(f.cv.demand).toBeCloseTo(2920, 6);
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

  it("карточка объясняет ровно месяц 0 прогноза — числа сходятся", () => {
    // Карточка и симуляция разрешают шаг одной функцией. Если разойдутся,
    // пользователь увидит в карточке одно, а в прогнозе другое — ровно та
    // ошибка, что уже была, причём дважды.
    const s = simulate(rush.traits, rush.edges, 2);
    const f = now(rush);
    expect(at(s.cv, 0)).toBe(Math.round(f.cv.moved * 100) / 100);
  });

  it("условие на собственный источник видит фонд месяца и не качает модель", () => {
    // Раньше поток в условии был остатком: в начале месяца 0 времени «ещё
    // нет» → мёртвый месяц, дальше качание 0/150/0. Теперь условие видит,
    // сколько времени приходит в этом месяце, и модель ровная с месяца 0.
    const m = JSON.parse(JSON.stringify(rush));
    m.edges[1].conds = [{ expr: "{work} >= 1" }];
    m.edges[2].conds = [{ expr: "{work} >= 1" }];
    const s = simulate(m.traits, m.edges, 4);
    expect(s.cv.map(Math.round)).toEqual([150, 150, 150, 150, 150]);
    expect(s.work.map(Math.round)).toEqual([300, 300, 300, 300, 300]);
    const f = now(m);
    // Условие проверяется на каждой попытке: как только фонд выбран,
    // попытки перестают проходить — поэтому итоговая пропускная доля
    // условий меньше единицы, а не «верно весь месяц».
    expect(f.cv.k).toBeGreaterThan(0);
    expect(f.cv.k).toBeLessThan(1);
    expect(f.cv.moved).toBeCloseTo(150, 6);
  });

  it("цепочка потоков разогревается внутри шага, а не по месяцу на звено", () => {
    // А наполняет Б, В заперт условием на Б: месяц 0 уже должен быть живым.
    const m = JSON.parse(JSON.stringify(rush));
    m.edges[2].conds = [{ expr: "{cv} >= 100" }]; // bid заперт на другой поток
    const s = simulate(m.traits, m.edges, 2);
    expect(at(s.cv, 0)).toBeGreaterThan(0);
    expect(at(s.bid, 0)).toBeGreaterThan(0);
  });
});

describe("расчёт по попыткам внутри месяца", () => {
  // Фонд 300 ч/мес; стрелка берёт по 5 в день, но только пока времени
  // не меньше 200 — «не трогай последние 200 часов».
  const threshold = (right) => ({
    traits: [
      { id: "work", e: "me", k: "res", l: "время", unit: "часов", flow: true, per: "мес" },
      { id: "cv", e: "job", k: "res", l: "резюме", unit: "часов", flow: true, per: "мес" },
    ],
    edges: [
      { id: "in", from: "me", to: "work", gives: 10, per: "день", sign: 1, conds: [] },
      { id: "cv", from: "me", to: "cv", gives: 5, per: "день", sign: 1,
        conds: [{ expr: `{work} >= ${right}` }], fromTrait: "work" },
    ],
  });

  it("условие проверяется на каждой попытке, а не раз в месяц", () => {
    // Одна проверка в месяц сказала бы «300 >= 200 — верно» и отдала все 150.
    // По попыткам: берём по 5, пока остаток не меньше 200 — это 21 попытка
    // (300, 295, … 200), итого 105, и на 195 стрелка останавливается.
    const s = simulate(threshold(200).traits, threshold(200).edges, 1);
    expect(at(s.cv, 0)).toBe(105);
  });

  it("порог ноль — берётся всё, что просилось", () => {
    const s = simulate(threshold(0).traits, threshold(0).edges, 1);
    expect(at(s.cv, 0)).toBe(150);
  });

  it("двое пьют из одного фонда — кто чаще просит, тому больше", () => {
    // Рассылка просит по часу (пачками по суткам: 24,33/день), оставление —
    // по 5 в день. Оба идут, пока фонд не выбран: ~10 дней, дальше пусто.
    const m = threshold(1);
    m.traits.push({ id: "bid", e: "ord", k: "res", l: "отклики", unit: "часов", flow: true, per: "мес" });
    m.edges[1] = { id: "cv", from: "me", to: "cv", gives: 1, per: "час", sign: 1,
      conds: [{ expr: "{work} >= 1" }], fromTrait: "work" };
    m.edges.push({ id: "bid", from: "me", to: "bid", gives: 5, per: "день", sign: 1,
      conds: [{ expr: "{work} >= 1" }], fromTrait: "work" });
    const s = simulate(m.traits, m.edges, 1);
    expect(at(s.cv, 0)).toBeCloseTo(248.86, 1);
    expect(at(s.bid, 0)).toBeCloseTo(51.14, 1);
    expect(s.cv[0] + s.bid[0]).toBeCloseTo(300, 6);
  });

  it("стрелки без источника и без условий считаются как раньше, одним махом", () => {
    const m = {
      traits: [{ id: "u", e: "x", k: "res", l: "юзеры", unit: "чел.", flow: true, per: "мес" }],
      edges: [{ id: "e", from: "x", to: "u", gives: 7, per: "день", sign: 1, conds: [] }],
    };
    expect(at(simulate(m.traits, m.edges, 1).u, 0)).toBe(210);
  });

  it("условие на чужой убывающий ресурс тоже видит попытки", () => {
    // Стрелка ничего не берёт сама, но заперта на остаток чужого фонда:
    // как только его выбрали, её попытки перестают проходить.
    const m = threshold(1);
    m.traits.push({ id: "flag", e: "ord", k: "res", l: "флаг", unit: "ед.", flow: true, per: "мес" });
    m.edges[1].conds = [];   // потребитель пьёт без условий: 150 из 300
    m.edges.push({ id: "fl", from: "ord", to: "flag", gives: 1, per: "день", sign: 1,
      conds: [{ expr: "{work} >= 280" }] });
    const s = simulate(m.traits, m.edges, 1);
    // Остаток падает по 5 в день с 300: не меньше 280 он только 5 первых попыток.
    expect(at(s.flag, 0)).toBe(5);
  });
});

describe("метрика задачи как движение", () => {
  const traits = [
    // Фонд 300 ч/мес, чтобы списание задачи было видно, а не упиралось в ноль.
    { id: "work", e: "me", k: "res", l: "время", unit: "часов", have: 300,
      flow: true, per: "мес" },
    { id: "money", e: "co", k: "res", l: "деньги", unit: "₽", have: 1000, flow: false },
  ];
  const task = (over = {}) => ({
    id: "t1", goalId: "g", title: "Работа по найму", status: "progress",
    effects: [
      { id: "e1", dir: "spend", trait: "work", amount: 2, per: "день", basis: "fact" },
      { id: "e2", dir: "gain", trait: "money", amount: 5000, per: "мес", basis: "fact" },
    ],
    ...over,
  });

  it("разворачивается в обычные стрелки — по одной на строку метрики", () => {
    const es = taskEdges([task()], traits);
    expect(es).toHaveLength(2);
    expect(es[0]).toMatchObject({ to: "work", from: "me", gives: 2, per: "день", sign: -1 });
    expect(es[1]).toMatchObject({ to: "money", from: "co", gives: 5000, per: "мес", sign: 1 });
    expect(es.every(isTaskEdge)).toBe(true);
  });

  it("тратит и приносит — это две разные стрелки, часы в рубли не превращаются", () => {
    const s = simulate(traits, modelEdges([], [task()], traits), 2);
    expect(at(s.work, 0)).toBe(240);   // 300 − 60: два часа в день забронированы
    expect(at(s.money, 1)).toBe(6000); // 1000 + 5000 за месяц
  });

  it("выполненная задача больше ничего не тратит и не приносит", () => {
    expect(taskEdges([task({ status: "done" })], traits)).toHaveLength(0);
    const s = simulate(traits, modelEdges([], [task({ status: "done" })], traits), 1);
    expect(at(s.money, 1)).toBe(1000);
  });

  it("строка без ресурса или без числа не считается", () => {
    const half = task({ effects: [
      { id: "a", dir: "spend", trait: "", amount: 5, per: "мес" },
      { id: "b", dir: "gain", trait: "money", amount: 0, per: "мес" },
      { id: "c", dir: "gain", trait: "нет-такого", amount: 5, per: "мес" },
    ] });
    expect(taskEdges([half], traits)).toHaveLength(0);
  });

  it("метрика бывает фактом и гипотезой, как обычная стрелка", () => {
    const es = taskEdges([task()], traits);
    expect(es.every(isFact)).toBe(true);
    const hypo = taskEdges([task({ effects: [
      { id: "x", dir: "gain", trait: "money", amount: 100, per: "мес" }] })], traits);
    expect(isFact(hypo[0])).toBe(false);
  });

  it("рекомендации не предлагают крутить стрелку задачи", () => {
    // Её значение выводится из метрики и стёрлось бы следующим пересчётом.
    const goal = { ...traits[1], want: 100000, by: 6 };
    const ts = [{ ...traits[0] }, goal];
    const r = adviseFor(ts, modelEdges([], [task()], ts), goal, 6);
    expect(r.recs.some((x) => x.type === "edge")).toBe(false);
  });

  it("стрелка задачи уникальна по задаче и строке метрики", () => {
    const two = taskEdges([task(), { ...task(), id: "t2" }], traits);
    expect(new Set(two.map((e) => e.id)).size).toBe(two.length);
  });
});
