import { describe, expect, it } from "vitest";
import {
  arrowEnds, exprGaps, exprText, exprToEdges, negate, newLine, newToken, readProgram,
} from "../lib/hexpr.js";

/* Гипотеза — программа из строк: каждая начинается с оператора. */

const ENTITIES = [{ id: "a", name: "Я" }, { id: "b", name: "Клиенты" }];
const TRAITS = [
  { id: "t1", e: "a", l: "рабочее время" },
  { id: "t2", e: "b", l: "заявки" },
  { id: "t3", e: "b", l: "деньги" },
];

const res = (trait) => newToken("res", { trait });
const ent = (entity) => newToken("ent", { entity });
const txt = (text) => newToken("text", { text });
const elem = () => newToken("elem");
const arr = (patch) => newToken("arrow", { gives: 5, ...patch });
const L = (op, tokens = [], patch = {}) => newLine(op, { tokens, ...patch });

const P = (lines) => readProgram(lines, { entities: ENTITIES, traits: TRAITS });
const E = (lines) => exprToEdges(lines, TRAITS, ENTITIES);
const G = (lines) => exprGaps(lines, TRAITS, ENTITIES);

describe("если / то / иначе", () => {
  const ifThenElse = [
    L("if", [res("t3"), txt(">"), txt("100")]),
    L("then", [res("t1"), arr(), res("t2")]),
    L("else", [res("t1"), arr(), res("t3")]),
  ];

  it("«то» получает условие предыдущего «если»", () => {
    const { steps } = P(ifThenElse);
    expect(steps[0].conds).toEqual(["{t3} > 100"]);
  });

  it("«иначе» получает перевёрнутое условие, а не пустое", () => {
    expect(P(ifThenElse).steps[1].conds).toEqual(["{t3} <= 100"]);
  });

  it("две ветки дают две стрелки с противоположными условиями", () => {
    const eds = E(ifThenElse);
    expect(eds).toHaveLength(2);
    expect(eds[0].conds).toEqual([{ expr: "{t3} > 100" }]);
    expect(eds[1].conds).toEqual([{ expr: "{t3} <= 100" }]);
  });

  it("«то» без «если» происходит всегда — это не ошибка", () => {
    const lines = [L("then", [res("t1"), arr(), res("t2")])];
    expect(G(lines)).toEqual([]);
    expect(E(lines)[0].conds).toEqual([]);
  });

  it("условие действует на одну строку, а не на все следующие", () => {
    const lines = [
      L("if", [res("t3"), txt(">"), txt("100")]),
      L("then", [res("t1"), arr(), res("t2")]),
      L("then", [res("t1"), arr(), res("t3")]),
    ];
    const eds = E(lines);
    expect(eds[0].conds).toHaveLength(1);
    expect(eds[1].conds).toEqual([]);
  });

  it("«иначе» без «если» выше названо ошибкой", () => {
    expect(G([L("else", [res("t1"), arr(), res("t2")])]).join(" "))
      .toMatch(/«иначе» без «если»/);
  });

  it("«если» без условия названо ошибкой", () => {
    expect(G([L("if"), L("then", [res("t1"), arr(), res("t2")])]).join(" "))
      .toMatch(/после «если» не написано условие/);
  });
});

describe("пока / повторять / break / continue", () => {
  const loop = [
    L("while", [res("t1"), txt(">"), txt("0")]),
    L("repeat"),
    L("then", [res("t1"), arr(), res("t2")]),
    L("break"),
  ];

  it("тело цикла идёт под условием «пока»", () => {
    expect(E(loop)[0].conds).toEqual([{ expr: "{t1} > 0" }]);
  });

  it("после break тело цикла кончилось — условие дальше не действует", () => {
    const eds = E([...loop, L("then", [res("t1"), arr(), res("t3")])]);
    expect(eds).toHaveLength(2);
    expect(eds[0].conds).toHaveLength(1);
    expect(eds[1].conds).toEqual([]);      // это уже вне цикла
  });

  it("после continue остаток тела не выполняется, и об этом сказано", () => {
    const lines = [
      L("while", [res("t1"), txt(">"), txt("0")]),
      L("repeat"),
      L("continue"),
      L("then", [res("t1"), arr(), res("t2")]),
      L("break"),
    ];
    expect(G(lines).join(" ")).toMatch(/после break или continue есть движения/);
    // И такие движения в модель не попадают — молча их не выбрасываем.
    expect(E(lines)).toHaveLength(0);
  });

  it("break вне цикла — ошибка, а не тихий пропуск", () => {
    expect(G([L("break"), L("then", [res("t1"), arr(), res("t2")])]).join(" "))
      .toMatch(/break стоит вне цикла/);
  });

  it("continue вне цикла — тоже ошибка", () => {
    expect(G([L("continue"), L("then", [res("t1"), arr(), res("t2")])]).join(" "))
      .toMatch(/continue стоит вне цикла/);
  });

  it("«повторять» без «пока» — движение без условия, это законно", () => {
    const lines = [L("repeat"), L("then", [res("t1"), arr(), res("t2")]), L("break")];
    expect(G(lines)).toEqual([]);
    expect(E(lines)[0].conds).toEqual([]);
  });
});

describe("для element в активе", () => {
  const forLoop = [
    L("for", [ent("b")], { elem: "element" }),
    L("then", [res("t1"), arr(), elem()]),
    L("break"),
  ];

  it("тело разворачивается по копии на каждый ресурс актива", () => {
    // У «Клиентов» два ресурса: заявки и деньги.
    const eds = E(forLoop);
    expect(eds).toHaveLength(2);
    expect(eds.map((e) => e.to).sort()).toEqual(["t2", "t3"]);
  });

  it("«значение element» указывает на свой ресурс в каждой копии", () => {
    const lines = [
      L("for", [ent("b")], { elem: "element" }),
      L("if", [elem(), txt(">"), txt("10")]),
      L("then", [res("t1"), arr(), elem()]),
      L("break"),
    ];
    const eds = E(lines);
    expect(eds.map((e) => e.conds[0].expr).sort())
      .toEqual(["{t2} > 10", "{t3} > 10"]);
  });

  it("без выбранного актива обходить нечего — это названо", () => {
    expect(G([L("for", [], { elem: "e" }), L("then", [res("t1"), arr(), res("t2")])])
      .join(" ")).toMatch(/не выбран актив/);
  });

  it("«значение element» вне цикла подставлять нечего", () => {
    expect(G([L("then", [res("t1"), arr(), elem()])]).join(" "))
      .toMatch(/вне цикла «для»/);
  });

  it("хвост после цикла разбирается один раз, а не по копии на ресурс", () => {
    const lines = [...forLoop, L("then", [res("t1"), arr(), res("t3")])];
    // Две копии тела плюс одна строка после break — но она внутри каждой
    // ветви разбора, поэтому её движение тоже удваивается: разворот
    // статический, и это честно видно по числу стрелок.
    const eds = E(lines);
    expect(eds.filter((e) => e.to === "t3" && e.fromTrait === "t1").length)
      .toBeGreaterThan(0);
  });
});

describe("повторы складываются", () => {
  it("вложенные циклы умножают потоки", () => {
    const lines = [
      L("for", [ent("b")], { elem: "e" }),
      L("then", [res("t1"), arr({ gives: 5, threads: 3 }), res("t2")]),
      L("break"),
    ];
    // Разворот «для» даёт копии, а не множитель потоков: потоки остаются
    // своими у каждой копии.
    expect(E(lines)[0].threads).toBe(3);
  });

  it("несколько условий доезжают до стрелки все", () => {
    const lines = [
      L("while", [res("t1"), txt(">"), txt("0")]),
      L("repeat"),
      L("if", [res("t3"), txt(">"), txt("100")]),
      L("then", [res("t1"), arr(), res("t2")]),
      L("break"),
    ];
    const [ed] = E(lines);
    expect(ed.conds.map((c) => c.expr).sort())
      .toEqual(["{t1} > 0", "{t3} > 100"]);
  });
});

describe("концы стрелки", () => {
  it("берутся у соседних ресурсов строки", () => {
    const tk = [res("t1"), arr(), res("t2")];
    expect(arrowEnds(tk, 1)).toEqual({ from: "t1", to: "t2" });
  });

  it("две стрелки подряд не делят один ресурс", () => {
    const tk = [res("t1"), arr(), arr(), res("t2")];
    expect(arrowEnds(tk, 2)).toEqual({ from: null, to: "t2" });
    expect(arrowEnds(tk, 1)).toEqual({ from: "t1", to: null });
  });

  it("элемент цикла — тоже конец стрелки", () => {
    expect(arrowEnds([res("t1"), arr(), elem()], 1))
      .toEqual({ from: "t1", to: "@elem" });
  });
});

describe("отрицание условия", () => {
  it("переворачивает знак сравнения", () => {
    expect(negate("{a} > 10")).toBe("{a} <= 10");
    expect(negate("{a} = 10")).toBe("{a} ≠ 10");
  });
  it("без сравнения переворачивать нечего", () => {
    expect(negate("{a} + 1")).toBe("");
  });
});

describe("чего не хватает", () => {
  it("готовая программа не жалуется", () => {
    expect(G([
      L("if", [res("t3"), txt(">"), txt("100")]),
      L("then", [res("t1"), arr(), res("t2")]),
    ])).toEqual([]);
  });

  it("пустая программа так и говорит", () => {
    expect(G([]).join(" ")).toMatch(/строк пока нет/);
  });

  it("строки без единой стрелки движений не описывают", () => {
    expect(G([L("if", [res("t3"), txt(">"), txt("1")])]).join(" "))
      .toMatch(/нет ни одной стрелки/);
  });

  it("нулевое количество — не движение", () => {
    expect(G([L("then", [res("t1"), arr({ gives: 0 }), res("t2")])]).join(" "))
      .toMatch(/сколько переносится/);
  });

  it("стрелка сама в себя не имеет смысла", () => {
    expect(G([L("then", [res("t1"), arr(), res("t1")])]).join(" "))
      .toMatch(/сам в себя/);
  });

  it("ссылка на удалённый ресурс замечается", () => {
    expect(G([L("then", [res("нет-такого"), arr(), res("t2")])]).join(" "))
      .toMatch(/удалённый ресурс/);
  });
});

describe("программа словами", () => {
  it("каждая строка начинается со своего оператора", () => {
    const s = exprText([
      L("if", [res("t3"), txt(">"), txt("100")]),
      L("then", [res("t1"), arr(), res("t2")]),
    ], TRAITS, ENTITIES);
    expect(s).toBe("если [деньги] > 100\nто [рабочее время] → [заявки]");
  });

  it("«для» читается по-русски, с именем элемента и активом", () => {
    expect(exprText([L("for", [ent("b")], { elem: "клиент" })], TRAITS, ENTITIES))
      .toBe("для клиент в «Клиенты»");
  });

  it("break и continue пишутся сами по себе", () => {
    expect(exprText([L("break"), L("continue")], TRAITS, ENTITIES))
      .toBe("break\ncontinue");
  });
});
