import { describe, expect, it } from "vitest";
import { allHands, applyHand, handColor, handLinks, handOfFunc, linkPath, newHandName, pinsOf, removeHand } from "../lib/hands.js";
import { procFuncs } from "../lib/proc2.js";

/* «НЕ МЕНЯТЬ РУКУ» на схеме: пины задач справа от блоков, линии между
   задачами с одной рукой, снятие нажатием и связывание перетаскиванием
   — всё через текст процесса. */

const model = { entities: [{ id: "usr", name: "Пользователи", x: 100, y: 50, posts: [] }, { id: "mkt", name: "Рынок услуг", x: 400, y: 50 }],
  traits: [{ id: "req", l: "заявки", e: "usr" }, { id: "act", l: "активные", e: "usr" }], positions: [] };
const T = "Функция: Обработка\n\nЗадача: собрать\nКто: Пользователи {space bear}\nБерёт: заявки 2\nОтдаёт: активные (переменная: люди A)\n\nЗадача: обзвонить\nКто: Пользователи {space bear}\nБерёт: (люди A)\nОтдаёт: заявки 1\n\nЗадача: отчитаться\nКто: Пользователи\nОтдаёт: заявки 1";
const proc = { id: "pr1", status: "on", text: T, hypo: { traits: [] }, missing: { rejected: [] } };
const funcs = procFuncs(proc, model);

describe("пины и линии", () => {
  it("по пину на задачу процесса справа от блока; рука — у исполнителя", () => {
    const pins = pinsOf(funcs, model.entities);
    expect(pins.map((p) => [p.func, p.x, p.y, p.hand])).toEqual([["pr1_1_t1", 318, 68, "space bear"], ["pr1_1_t2", 318, 83, "space bear"], ["pr1_1_t3", 318, 98, null]]);
    expect(handOfFunc(funcs[2])).toBeNull();
  });
  it("задачи с одной рукой соединены по порядку шагов; путь идёт вправо со скруглениями", () => {
    expect(handLinks(funcs)).toEqual([{ a: "pr1_1_t1", b: "pr1_1_t2", hand: "space bear", proc: "pr1" }]);
    const [a, b] = pinsOf(funcs, model.entities);
    expect(linkPath(a, b)).toBe("M 318 68 H 326 Q 334 68 334 76 V 75 Q 334 83 326 83 H 318");
    expect(linkPath(a, { ...b, y: a.y })).toMatch(/^M 318 68 H 326 Q 334 68 334 76 V 76 Q 334 84 326 84 H 318$/);
  });
});

describe("правка рук через текст", () => {
  it("снятие руки с задачи убирает «{space bear}» только у неё", () => {
    const next = removeHand([proc], funcs, model, "pr1_1_t2");
    expect(next[0].text.split("{space bear}").length - 1).toBe(1);
    expect(next[0].text).toContain("Задача: обзвонить\nКто: Пользователи\n");
    expect(removeHand([proc], funcs, model, "pr1_1_t3")).toBeNull();   // руки не было
  });
  it("перетаскивание точки на точку ставит ту же руку второй задаче; без рук — новое имя из двух слов, не занятое нигде", () => {
    const next = applyHand([proc], funcs, model, "pr1_1_t3", "pr1_1_t1");
    expect(next[0].text).toContain("Задача: отчитаться\nКто: Пользователи {space bear}");
    const bare = { ...proc, text: T.replace(/ \{space bear\}/g, "") };
    const f2 = procFuncs(bare, model);
    const n2 = applyHand([bare], f2, model, "pr1_1_t1", "pr1_1_t2");
    const names = [...n2[0].text.matchAll(/\{([^}]+)\}/g)].map((x) => x[1]);
    expect(names).toHaveLength(2);
    expect(names[0]).toBe(names[1]);
    expect(names[0]).toMatch(/^[a-z]+ [a-z]+$/);
    // Имена не повторяются между процессами; цвет по имени один и тот же.
    expect(allHands([proc], model)).toEqual(new Set(["space bear"]));
    for (let i = 0; i < 20; i += 1) expect(newHandName(new Set(["space bear"]))).not.toBe("space bear");
    expect(handColor("space bear")).toBe(handColor("Space Bear"));
    // Разные процессы не связываются.
    expect(applyHand([proc], [...funcs, { id: "x", proc: "pr9", who: [] }], model, "pr1_1_t1", "x")).toBeNull();
  });
});
