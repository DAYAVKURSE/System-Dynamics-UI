import { describe, expect, it } from "vitest";
import { assetWorkers, funcExecutors, heldBy, roleOf, shortage, taskGaps, whyNotSet }
  from "../lib/taskRules.js";

/* Правило «можно ли поставить задачу» повторено с фронтенда
   (`whyNotSet` в TasksBoard.jsx, `shortage` в lib/funcs.js): сервер отдаётся
   отдельным пакетом, и тянуть в него код приложения нечем. Здесь те же
   случаи, что в тестах фронтенда (deadline.test.jsx, orGroups.test.js,
   units.test.js), — чтобы два места не разошлись молча. */

const TRAITS = [{ id: "t1", l: "спрос" }, { id: "t2", l: "заявки" }];
/* «Есть» — по материалам, а не по числу в ресурсе (`lib/stock.js`). */
const M = (trait, qty) => ({ id: `m_${trait}_${qty}`, trait, kind: "text", qty });
const FUNC = { id: "f1", e: "usr", name: "Сбор заявок",
  takes: [{ id: "p1", trait: "t1", lo: 2, hi: 4 }],
  gives: [{ id: "p2", trait: "t2", lo: 1, hi: 1 }] };
const full = (over) => ({ id: "tk", funcId: "f1", status: "wait", setter: "1",
  assignee: "2", reviewer: "3", end: "2030-03-01T11:00", ...over });

describe("незаполненность — словами и в порядке формы", () => {
  it("обязательны исполнитель и срок; постановщик, проверяющий и содержимое — нет", () => {
    /* Владелец, 2026-09-19: «если не выбран постановщик, значит,
       постановщиком является исполнитель… Если выбран только постановщик и
       исполнитель, значит, постановщик является проверяющим». */
    expect(taskGaps({})).toEqual(["исполнитель", "срок"]);
    expect(taskGaps(full({ body: "" }))).toEqual([]);
    expect(taskGaps(full({ setter: null, reviewer: null }))).toEqual([]);
    expect(taskGaps(full({ assignee: null, end: "" }))).toEqual(["исполнитель", "срок"]);
  });

  it("кого не назвали, того подразумевает сама задача", () => {
    expect(roleOf({ assignee: "2" }, "setter")).toBe("2");
    expect(roleOf({ assignee: "2" }, "reviewer")).toBe("2");
    expect(roleOf({ setter: "1", assignee: "2" }, "reviewer")).toBe("1");
    expect(roleOf({ setter: "1", assignee: "2", reviewer: "3" }, "reviewer")).toBe("3");
  });

  it("незаполненной задаче сперва называют незаполненное, а не ресурсы", () => {
    const poor = { funcs: [FUNC], traits: [{ id: "t1", l: "спрос" }], tasks: [] };
    expect(whyNotSet(full({ assignee: null }), poor)).toBe("Не хватает: исполнитель");
  });
});

describe("ресурсы", () => {
  it("описать можно, а поставить — нет: сказано, чего и сколько", () => {
    const poor = { funcs: [FUNC], traits: [{ id: "t1", l: "спрос" }], tasks: [],
      materials: [M("t1", 1)] };
    // «Сбор заявок» берёт до 4 «спроса», а его всего 1 — как в deadline.test.jsx.
    expect(whyNotSet(full(), poor)).toBe("Не хватает ресурсов: спрос — есть 1, нужно 4");
  });

  it("ресурса хватило — можно", () => {
    expect(whyNotSet(full(), { funcs: [FUNC], traits: TRAITS, tasks: [],
      materials: [M("t1", 100)] })).toBe("");
  });

  it("«или» внутри группы: нет первого ресурса — работа идёт на втором", () => {
    const f = { ...FUNC, takes: [
      { id: "a", trait: "t1", lo: 1, hi: 1, group: "g" },
      { id: "b", trait: "t3", lo: 1, hi: 1, group: "g" }] };
    const traits = [{ id: "t1", l: "спрос", have: 0 }, { id: "t3", l: "звонки", have: 1 }];
    expect(shortage(f, traits)).toEqual([]);
    // Без «или» та же функция стоит.
    const and = { ...f, takes: f.takes.map((p) => ({ ...p, group: p.id })) };
    expect(shortage(and, traits).map((x) => x.name)).toEqual(["спрос"]);
  });

  it("нерасходуемый вход второй раз этой функции не даётся", () => {
    const f = { ...FUNC, takes: [{ id: "a", trait: "t1", lo: 1, hi: 1, spend: false }] };
    const traits = [{ id: "t1", l: "заявка" }];
    const done = [{ id: "d", funcId: "f1", status: "done",
      submissions: [{ takes: { t1: 1 } }] }];
    expect(heldBy(done, f)).toEqual({ t1: 1 });
    expect(whyNotSet(full(), { funcs: [f], traits, tasks: done, materials: [M("t1", 1)] }))
      .toBe("Не хватает ресурсов: заявка — необработанного 0, нужно 1 (1 эта функция уже обработала)");
    // Непринятая сдача — ещё не результат.
    expect(heldBy(done.map((t) => ({ ...t, status: "review" })), f)).toEqual({});
  });

  it("функции нет — ресурсов не ждём: задача сама по себе полна", () => {
    expect(whyNotSet(full({ funcId: "нет" }), { funcs: [], traits: [], tasks: [] })).toBe("");
  });
});

describe("кого можно назначить", () => {
  it("воркеров актива функции — по членству и по ролям, и на активе, и на функции", () => {
    const model = {
      entities: [{ id: "usr", crew: ["7"], owners: ["2"], reviewers: ["3"] },
        { id: "other", crew: ["9"] }],
      funcs: [{ ...FUNC, setters: ["1"] }],
    };
    const w = assetWorkers(model, { funcId: "f1" });
    expect([...w].sort()).toEqual(["1", "2", "3", "7"]);
    expect(w.has("9")).toBe(false);
  });

  it("выполняет тот, у кого РОЛЬ исполнителя и функция ему не закрыта", () => {
    /* У функции названа роль; воркер с ней назначается, если ему не
       отмечено исключение. Ролей у человека бывает несколько — хватает
       одной названной. Правило то же, что в приложении (`eligible`). */
    const model = {
      entities: [{ id: "usr", crew: ["2", "4", "9"] }],
      funcs: [{ ...FUNC, e: "usr", owners: [], posts: { owners: ["designer"] }, except: ["4"] }],
    };
    const rolesOf = (id) => ({ 2: ["executor", "designer"], 4: ["designer"],
      9: ["editor"] })[id] || [];
    expect([...funcExecutors(model, { funcId: "f1" }, rolesOf)]).toEqual(["2"]);
    // Роль у функции не названа — читается старый список людей.
    const legacy = { funcs: [{ ...FUNC, owners: ["2", 7, ""], posts: {} }] };
    expect([...funcExecutors(legacy, { funcId: "f1" }, rolesOf)].sort()).toEqual(["2", "7"]);
    // Исключение действует и там: человек закрыт независимо от того, как он попал.
    const banned = { funcs: [{ ...FUNC, owners: ["2"], posts: {}, except: ["2"] }] };
    expect(funcExecutors(banned, { funcId: "f1" }, rolesOf).size).toBe(0);
    expect(funcExecutors(model, { funcId: "нет" }, rolesOf).size).toBe(0);
  });

  it("задача без функции — назначать не из кого", () => {
    expect(assetWorkers({ entities: [{ id: "usr", crew: ["7"] }], funcs: [] },
      { funcId: null }).size).toBe(0);
  });
});
