import { describe, expect, it } from "vitest";
import { assetWorkers, heldBy, shortage, taskGaps, whyNotSet } from "../lib/taskRules.js";

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
  it("три роли и срок обязательны; содержимое — нет", () => {
    expect(taskGaps({})).toEqual(["постановщик", "исполнитель", "проверяющий", "срок"]);
    expect(taskGaps(full({ body: "" }))).toEqual([]);
    expect(taskGaps(full({ assignee: null, end: "" }))).toEqual(["исполнитель", "срок"]);
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

  it("задача без функции — назначать не из кого", () => {
    expect(assetWorkers({ entities: [{ id: "usr", crew: ["7"] }], funcs: [] },
      { funcId: null }).size).toBe(0);
  });
});
