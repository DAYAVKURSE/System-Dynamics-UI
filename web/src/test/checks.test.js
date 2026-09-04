import { describe, expect, it } from "vitest";
import { WHY_ASSET, WHY_FUNC, WHY_TRAIT, checkAsset, checkFunc, checkTrait,
  normalizeFunc } from "../lib/funcs.js";

/* Подписи «актив», «функция», «ресурс» белые, пока строение сходится, и
   красные, когда нет. Здесь проверяются сами правила: цвет и модальное
   окно — дело интерфейса, а вот «сходится или нет» решается тут.

   Связи в этой модели задают функции, и только они: функция берёт ресурсы
   и выдаёт ресурсы — любые на схеме, свои или чужого актива. Выдать чужой
   ресурс и значит передать туда: получателя у выхода нет, его называет сам
   ресурс. Стрелок «актив → ресурс» больше нет. */

const T = (id, e) => ({ id, e, l: id });
const P = (trait) => ({ id: `p${trait}`, trait, lo: 1, hi: 2 });
const F = (id, e, takes, gives, over = {}) => ({ id, e, name: id, dur: 1, durUnit: "дн",
  takes, gives, owners: [], reviewers: [], ...over });

const traits = [T("a1", "A"), T("a2", "A"), T("b1", "B")];
const entities = [{ id: "A" }, { id: "B" }];

describe("актив", () => {
  // Годный актив: одна функция берёт ресурс чужого актива и делает свой,
  // другая выдаёт чужой — то есть передаёт туда.
  const both = [F("f1", "A", [P("b1")], [P("a1")]),
    F("f2", "A", [P("a1")], [P("b1")])];

  it("годен, когда есть и вход извне, и выход наружу", () => {
    expect(checkAsset("A", { traits, entities, funcs: both }).ok).toBe(true);
  });

  it("без функций — не годен: выполнять нечего", () => {
    expect(checkAsset("A", { traits, entities, funcs: [] }).ok).toBe(false);
  });

  it("без входа извне — не годен", () => {
    const f = F("f1", "A", [P("a2")], [P("b1")]);
    expect(checkAsset("A", { traits, entities, funcs: [f] }).ok).toBe(false);
  });

  it("без передачи наружу — не годен", () => {
    const f = F("f1", "A", [P("b1")], [P("a1")]);
    expect(checkAsset("A", { traits, entities, funcs: [f] }).ok).toBe(false);
  });

  it("но ресурс, который забирает чужая функция, — это тоже выход наружу", () => {
    // Отдавать можно и не передавая: у соседа своя функция, и она берёт.
    const mine = F("f1", "A", [P("b1")], [P("a1")]);
    const neighbour = F("f2", "B", [P("a1")], [P("b1")]);
    expect(checkAsset("A", { traits, entities, funcs: [mine, neighbour] }).ok).toBe(true);
  });

  it("актив, который варится сам в себе, — не годен", () => {
    const f = F("f1", "A", [P("a2")], [P("a1")]);
    expect(checkAsset("A", { traits, entities, funcs: [f] }).ok).toBe(false);
  });

  it("объяснение — дословно то, что дал владелец", () => {
    expect(checkAsset("A", { traits, entities }).why).toBe(WHY_ASSET);
    expect(WHY_ASSET).toMatch(/берёт один ресурс из внешней системы/);
  });
});

describe("ресурс", () => {
  it("годен: одна функция его выдаёт, другая берёт", () => {
    const funcs = [F("f1", "A", [P("b1")], [P("a1")]),
      F("f2", "A", [P("a1")], [P("a2")])];
    expect(checkTrait("a1", { traits, funcs }).ok).toBe(true);
  });

  it("его никто не выдаёт — не годен: он берётся ниоткуда", () => {
    const funcs = [F("f2", "A", [P("a1")], [P("a2")])];
    expect(checkTrait("a1", { traits, funcs }).ok).toBe(false);
  });

  it("его никто не берёт — не годен: он копится и никому не нужен", () => {
    const funcs = [F("f1", "A", [P("b1")], [P("a1")])];
    expect(checkTrait("a1", { traits, funcs }).ok).toBe(false);
  });

  it("функция чужого актива тоже считается — передача приносит ресурс", () => {
    const funcs = [F("f1", "B", [P("b1")], [P("a1")]),
      F("f2", "A", [P("a1")], [P("a2")])];
    expect(checkTrait("a1", { traits, funcs }).ok).toBe(true);
  });

  it("удалённого ресурса нет — и годным он быть не может", () => {
    expect(checkTrait("нет-такого", { traits, funcs: [] }).ok).toBe(false);
  });

  it("объяснение говорит, что ресурс сам себя не меняет", () => {
    expect(checkTrait("a1", { traits }).why).toBe(WHY_TRAIT);
    expect(WHY_TRAIT).toMatch(/Сам он не изменяется/);
  });
});

describe("функция", () => {
  const m = { traits, entities };

  it("преобразование целиком внутри актива — годна", () => {
    expect(checkFunc(F("f1", "A", [P("a1")], [P("a2")]), m).ok).toBe(true);
  });

  it("берёт несколько ресурсов и выдаёт несколько других — годна", () => {
    const f = F("f1", "A", [P("a1"), P("b1")], [P("a2")]);
    expect(checkFunc(f, m).ok).toBe(true);
  });

  it("берёт внешний ресурс и делает из него свой — годна", () => {
    // «Наружу» — про ресурс: функция, которая берёт чужой ресурс и делает
    // из него свой, — самая обычная.
    expect(checkFunc(F("f1", "A", [P("b1")], [P("a1")]), m).ok).toBe(true);
    // И наоборот: берёт свой, выдаёт чужой — это и есть передача.
    expect(checkFunc(F("f1", "A", [P("a1")], [P("b1")]), m).ok).toBe(true);
  });

  it("все ресурсы чужие — не годна: тогда она не часть этого актива", () => {
    const foreign = { traits: [...traits, T("b2", "B")], entities };
    expect(checkFunc(F("f1", "A", [P("b1")], [P("b2")]), foreign).ok).toBe(false);
  });

  it("ничего не берёт или ничего не выдаёт — не годна", () => {
    expect(checkFunc(F("f1", "A", [], [P("a1")]), m).ok).toBe(false);
    expect(checkFunc(F("f1", "A", [P("a1")], []), m).ok).toBe(false);
    expect(checkFunc(null, m).ok).toBe(false);
  });

  it("ссылка на удалённый ресурс — обрыв, а не «наружу»", () => {
    expect(checkFunc(F("f1", "A", [P("нет-такого")], [P("a1")]), m).ok).toBe(false);
  });

  it("получателя у выхода нет — его называет сам ресурс", () => {
    // Прежде рядом с ресурсом стояло поле «передаёт в», и оно могло с ним
    // разойтись: выбран ресурс одного актива, получателем назван другой —
    // и что тогда правда, не знал никто. Поля больше нет.
    expect(checkFunc(F("f1", "A", [P("b1")], [P("a1")]), m).ok).toBe(true);
    expect(normalizeFunc({ gives: [{ trait: "a1", lo: 1, hi: 1, to: "B" }] })
      .gives[0]).not.toHaveProperty("to");
  });

  it("вилка без количества или перевёрнутая — не годна", () => {
    const f = F("f1", "A", [P("a1")], [P("a2")]);
    expect(checkFunc({ ...f, takes: [{ trait: "a1", lo: 0, hi: 0 }] }, m).ok).toBe(false);
    expect(checkFunc({ ...f, gives: [{ trait: "a2", lo: 5, hi: 3 }] }, m).ok).toBe(false);
  });

  it("без времени выполнения — не годна: неизвестно, когда будет готово", () => {
    expect(checkFunc(F("f1", "A", [P("a1")], [P("a2")], { dur: 0 }), m).ok).toBe(false);
  });

  it("объяснение — то, что дал владелец, нынешними словами", () => {
    expect(checkFunc(F("f1", "A", [], []), m).why).toBe(WHY_FUNC);
    expect(WHY_FUNC).toMatch(/преобразует внешний ресурс во внутренний/);
    expect(WHY_FUNC).toMatch(/может только взять и дать/);
    expect(WHY_FUNC).toMatch(/среднее арифметическое/);
  });
});
