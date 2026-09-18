import { describe, expect, it } from "vitest";
import { diffTasks, exportText, fromV1, hintAt, importText, isV1, issuesOf, labelOf, paintOf, parseText, procFuncs,
  replaceName, setHand, suggest, takesAt, toggleRole, usesAsset } from "../lib/proc2.js";

/* ЯЗЫК ТЕХПРОЦЕССА v2 (владелец, 2026-09-18): строки с метками, роли
   значками, переменные, ветки «Если/Иначе». Здесь — разбор, раскраска,
   подсказки, выгрузка/загрузка и сборка функций. */

const model = {
  entities: [{ id: "own", name: "Владелец", posts: ["r_owner"] }, { id: "prt", name: "Партнёр", posts: ["r_prt"] }],
  positions: [{ id: "r_owner", name: "Владелец" }, { id: "r_prt", name: "Партнёр-фрилансер" }, { id: "r_free", name: "Курьер" }],
  traits: [{ id: "t1", l: "оффер", e: "own" }, { id: "t2", l: "назначенный диапазон", e: "prt" }, { id: "t3", l: "оплата", e: "prt", have: 1000 },
    { id: "t4", l: "оплата", e: "own" }],
};
const T = `Функция: Передача лида

Задача: передать оффер
Кто: Партнёр-фрилансер(постановщик, исполнитель)(переменная: сотрудник A),
Кто: Владелец(проверяющий),
Отдают: оффер. Сколько: =1 (переменная: оффер A),
Кому: Владелец

Задача: назначить время
Кто: Владелец
Берет: (оффер A)
Отдает: назначенный диапазон 45-55% A (переменная: время A)
Кому: Партнёр-фрилансер`;

describe("разбор", () => {
  it("метки строк: функция, задача, кто, берёт/отдаёт (и множественное число), кому", () => {
    expect(labelOf("Кто: Владелец")).toMatchObject({ kind: "who", rest: { text: "Владелец", start: 5 } });
    expect(labelOf("  Берут: x").plural).toBe(true);
    expect(labelOf("отдаёт: x")).toMatchObject({ kind: "give", plural: false });
    expect(labelOf("Владелец(проверяющий),")).toBeNull();
  });

  it("функции с задачами; «Кто» — должность → актив, роли, рука; ресурсы с количеством и переменными", () => {
    const { funcs, errors } = parseText(importText(T), model, {});
    expect(errors).toEqual([]);
    expect(funcs).toHaveLength(1);
    const [f] = funcs;
    expect(f.name).toBe("Передача лида");
    expect(f.tasks.map((t) => t.name)).toEqual(["передать оффер", "назначить время"]);
    const b = f.tasks[0].branches[0];
    expect(b.who[0]).toMatchObject({ name: "Партнёр-фрилансер", asset: { id: "prt" }, roles: { setter: true, doer: true, checker: false }, hand: "A" });
    expect(b.who[1]).toMatchObject({ name: "Владелец", asset: { id: "own" }, roles: { checker: true } });
    expect(b.steps[0]).toMatchObject({ kind: "give", plural: true, to: { asset: { id: "own" } } });
    // «оффер. Сколько: =1 (переменная: оффер A)» — имя, количество, переменная; ресурс — в активе «Кому».
    expect(b.steps[0].items[0]).toMatchObject({ name: "оффер", qty: 1, var: "оффер A", letter: "A", trait: { id: "t1" } });
    const b2 = f.tasks[1].branches[0];
    expect(b2.steps[0].items[0]).toMatchObject({ ref: true, var: "оффер A", name: "" });
    // «45-55% A» — доля буквы A той же задачи (ссылка на переменную — 1) → вилка.
    expect(b2.steps[1].items[0]).toMatchObject({ name: "назначенный диапазон", qty: 0.45, qtyHi: 0.55, var: "время A", trait: { id: "t2" } });
  });

  it("«Кто: Актив» — любой воркер актива; должность без актива — неизвестна", () => {
    const { funcs } = parseText("Задача: x\nКто: Партнёр\nОтдаёт: оплата 2", model, {});
    const w = funcs[0].tasks[0].branches[0].who[0];
    expect(w).toMatchObject({ anyWorker: true, asset: { id: "prt" } });
    expect(funcs[0].tasks[0].branches[0].steps[0].items[0]).toMatchObject({ trait: { id: "t3" }, qty: 2 });
    expect(issuesOf({ text: "Задача: x\nКто: Курьер\nОтдаёт: оплата" }, model)[0]).toMatch(/должность без актива: Курьер/);
    expect(issuesOf({ text: "Задача: x\nКто: Дворник\nОтдаёт: оплата" }, model)[0]).toMatch(/нет такой должности или актива: Дворник/);
  });

  it("«Если … То:» и «Иначе:» — ветки задачи; название функции без метки после двух пустых строк", () => {
    const text = `Задача: a\nКто: Владелец\nОтдаёт: оффер (переменная: X)\n\n\nСозвон\nЕсли: X И !флаг C, То:\nКто: Владелец\nБерёт: X\nОтдаёт: оплата\nИначе:\nКто: Партнёр\nОтдаёт: оплата`;
    const { funcs, errors } = parseText(text, model, {});
    expect(errors).toEqual([]);
    expect(funcs.map((f) => f.name)).toEqual(["", "Созвон"]);
    const t = funcs[1].tasks[0];
    expect(t.branches.map((b) => [b.cond, !!b.isElse, b.who.map((w) => w.name)])).toEqual([["X И !флаг C", false, ["Владелец"]], [null, true, ["Партнёр"]]]);
    expect(t.branches[0].steps[0].items[0]).toMatchObject({ ref: true, var: "X" });
  });

  it("обязательное: «Кто» без «Берёт»/«Отдаёт» — ошибка строки; «Кому» без шага — тоже", () => {
    expect(parseText("Задача: a\nКто: Владелец", model, {}).errors[0].message).toMatch(/нужно «Берёт:» или «Отдаёт:»/);
    expect(parseText("Кому: Владелец", model, {}).errors[0].message).toMatch(/без «Берёт:»\/«Отдаёт:»/);
  });
});

describe("раскраска, подсказки, правки", () => {
  it("плашки по виду и стороне, пометка актива у «Кто», скобки шагов", () => {
    const text = "Задача: a\nКто: Партнёр-фрилансер ✎ (рука A)\nОтдаёт: оплата 2, оплата 3\nКому: Владелец";
    const rows = text.split("\n");
    const paint = paintOf(text, model, {});
    const cut = (r, k) => rows[r.row].slice(k.start, k.end);
    const r1 = paint.find((r) => r.row === 1);
    expect(r1.spans.map((k) => [k.kind, cut(r1, k)])).toEqual([["mark", "Кто:"], ["role", "Партнёр-фрилансер"], ["roles", "✎"], ["hand", "(рука A)"]]);
    expect(r1.note).toBe("Партнёр");
    const r2 = paint.find((r) => r.row === 2);
    expect(r2.spans.filter((k) => k.kind === "trait").map((k) => [cut(r2, k), k.side, k.state, k.letter])).toEqual([["оплата 2", "give", "ok", "A"], ["оплата 3", "give", "ok", "B"]]);
    expect(r2.brackets.map((b) => [b.side, cut(r2, b)])).toEqual([["give", "оплата 2, оплата 3"]]);
    expect(paint.find((r) => r.row === 3).spans[1]).toMatchObject({ kind: "asset", state: "ok" });
  });

  it("подсказки: метки в начале строки, должности с активом, ресурсы актива, «сколько», Кому", () => {
    const at = (t) => hintAt(t, t.length, model);
    const names = (t) => suggest(at(t), model, {}).map((i) => i.name);
    expect(at("").kind).toBe("label");
    expect(names("")).toEqual(["Кто:", "Задача:", "Функция:", "Если:", "Иначе:"]);
    expect(at("Кто: Парт")).toMatchObject({ kind: "who", query: "Парт" });
    expect(suggest(at("Кто: Парт"), model, {})[0]).toMatchObject({ name: "Партнёр-фрилансер", note: "Партнёр", suffix: "\n" });
    // После «Кто:» — берёт/отдаёт (в единственном числе при одном «Кто», во множественном — при двух).
    expect(names("Кто: Владелец\n").slice(0, 2)).toEqual(["Берёт:", "Отдаёт:"]);
    expect(names("Кто: Владелец\nКто: Партнёр\n").slice(0, 2)).toEqual(["Берут:", "Отдают:"]);
    // Ресурсы — актива исполнителя; после имени и пробела — «сколько».
    expect(names("Кто: Владелец\nОтдаёт: ")).toEqual(["оффер", "оплата"]);
    expect(at("Кто: Владелец\nОтдаёт: оффер ")).toMatchObject({ kind: "qty", traitName: "оффер" });
    expect(names("Кто: Владелец\nОтдаёт: оффер ")).toContain("→");
    expect(names("Кто: Владелец\nОтдаёт: оффер 2\n").slice(0, 2)).toEqual(["Кому:", "Или:"]);
    expect(at("Кто: Владелец\nОтдаёт: оффер 2\nКому: В")).toMatchObject({ kind: "to", query: "В" });
  });

  it("роли переключаются значками, рука ставится и снимается, имя меняется на месте", () => {
    expect(toggleRole("Кто: Владелец,", 0, "setter")).toBe("Кто: Владелец ✎,");
    expect(toggleRole("Кто: Владелец ✎ ⚙ (рука A)", 0, "setter")).toBe("Кто: Владелец ⚙ (рука A)");
    expect(setHand("Кто: Владелец ✎", 0, "b")).toBe("Кто: Владелец ✎ (рука B)");
    expect(setHand("Кто: Владелец ✎ (рука B)", 0, null)).toBe("Кто: Владелец ✎");
    const t = "Кто: Владелец\nОтдаёт: оффер 2 (X)\nКому: Партнёр";
    expect(replaceName(t, "trait", "оффер", "коробки", model)).toBe("Кто: Владелец\nОтдаёт: коробки 2 (X)\nКому: Партнёр");
    expect(replaceName(t, "asset", "Партнёр", "Владелец", model).split("\n")[2]).toBe("Кому: Владелец");
  });

  it("выгрузка — роли словами, загрузка — значками; старый текст переводится в новый", () => {
    const shown = "Кто: Партнёр-фрилансер ✎ ⚙ (рука A),";
    expect(exportText(shown)).toBe("Кто: Партнёр-фрилансер (постановщик, исполнитель) (рука A),");
    expect(importText("Кто: Владелец(проверяющий)(переменная: сотрудник B)")).toBe("Кто: Владелец ✓ (рука B)");
    expect(importText(exportText(shown))).toBe(shown);
    expect(isV1("Пользователи, менеджер, берёт: Рынок услуг, спрос 2")).toBe(true);
    expect(isV1("Кто: Владелец")).toBe(false);
    const steps = [{ asset: { name: "Пользователи" }, role: { name: "менеджер" },
      takes: [{ asset: { name: "Рынок услуг" }, trait: { name: "спрос" }, qty: 2 }], gives: [{ asset: { name: "Пользователи" }, trait: { name: "заявки" }, qty: 1 }] }];
    expect(fromV1("…", steps)).toBe("Задача: Пользователи\nКто: менеджер\nБерёт: спрос 2\nОт кого: Рынок услуг\nОтдаёт: заявки");
  });
});

describe("функции из текста и версии", () => {
  it("функция с задачами: порты сводные, шаги по порядку, должности в ролях; неизвестное — функции нет", () => {
    const proc = { id: "pr1", status: "on", text: importText(T), hypo: { traits: [] }, missing: { rejected: [] } };
    const fs = procFuncs(proc, model);
    // Каждая задача — своя функция в активе исполнителя, связанная цепочкой.
    expect(fs.map((f) => [f.id, f.e, f.name, f.chain.step, f.chain.of, f.chain.name])).toEqual([
      ["pr1_1_t1", "prt", "передать оффер", 1, 2, "Передача лида"], ["pr1_1_t2", "own", "назначить время", 2, 2, "Передача лида"]]);
    const [a, b] = fs;
    expect(a.who[0]).toMatchObject({ pos: "r_prt", asset: "prt", hand: "A", roles: { setter: true, doer: true, checker: false } });
    expect(a.posts).toEqual({ setters: ["r_prt"], owners: ["r_prt"], reviewers: ["r_owner"] });
    expect(a.steps).toEqual([{ kind: "give", ports: ["p_pr1_1_t1_0"] }]);
    expect(a.gives[0]).toMatchObject({ trait: "t1", lo: 1, hi: 1, to: "own", var: "оффер A" });
    expect(takesAt(a)).toBe("done");
    // «Кто: Владелец» без ролей — любая роль; ссылка «(оффер A)» — вход ресурса из актива, куда его выдали.
    expect(b.posts).toEqual({ setters: ["r_owner"], owners: ["r_owner"], reviewers: ["r_owner"] });
    expect(b.takes[0]).toMatchObject({ trait: "t1", lo: 1, hi: 1, from: "own", var: "оффер A" });
    expect(b.gives[0]).toMatchObject({ trait: "t2", lo: 0.45, hi: 0.55 });
    expect(b.steps.map((s) => s.kind)).toEqual(["take", "give"]);
    expect(takesAt(b)).toBe("start");
    expect(usesAsset(proc, model, "own")).toBe(true);
    expect(procFuncs({ ...proc, text: "Задача: x\nКто: Курьер\nОтдаёт: оплата" }, model)).toEqual([]);
  });

  it("разница версий — по задачам: изменённая задача в «+» и в «−»", () => {
    const a = importText(T);
    const b = a.replace("назначенный диапазон 45-55% A", "назначенный диапазон 50% A");
    const d = diffTasks(a, b, model);
    expect(d.added.map((x) => x.name)).toEqual(["назначить время"]);
    expect(d.removed.map((x) => x.name)).toEqual(["назначить время"]);
    expect(diffTasks(a, a, model)).toEqual({ added: [], removed: [] });
    expect(diffTasks("", a, model).added).toHaveLength(2);
  });
});
