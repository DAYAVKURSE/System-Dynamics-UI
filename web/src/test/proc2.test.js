import { describe, expect, it } from "vitest";
import { diffTasks, exportText, fromV1, hintAt, importText, isV1, issuesOf, labelOf, paintOf, parseText, peopleOfPosition, procFuncs,
  parseDur, parseEvery, parsePar, setTaskTime, setTaskChecks, renameVar, replaceName, setAuto, setHand, setPerson, suggest, takesAt, toggleRole, usesAsset } from "../lib/proc2.js";

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

describe("знак «=», хвост операции и ресурсы без актива (владелец, 2026-09-18)", () => {
  it("«=2» — ровно 2; недописанная операция остаётся хвостом с ошибкой, имя не портится", () => {
    const { funcs } = parseText("Задача: x\nКто: Владелец\nОтдаёт: оффер =2, оплата 5 +", model, {});
    const items = funcs[0].tasks[0].branches[0].steps[0].items;
    expect(items[0]).toMatchObject({ name: "оффер", qty: 2, tail: "=2" });
    expect(items[0].expr).toBeUndefined();
    expect(items[1]).toMatchObject({ name: "оплата", expr: "5 +", tail: "5 +" });
    expect(items[1].exprError).toBeTruthy();
    expect(items[0].tailSpan).toEqual({ start: 14, end: 16 });
  });

  it("после ресурса в «Отдаёт:» есть «или» — новая строка «Или:»; в «Берёт:» его нет (владелец, 2026-09-18)", () => {
    const give = suggest(hintAt("Кто: Владелец\nОтдаёт: оффер 5", 29, model), model);
    expect(give.find((i) => i.name === "или")).toMatchObject({ kind: "дальше", text: "\nИли:", suffix: " " });
    expect(give.find((i) => i.name === "→").note).toMatch(/^и /);
    const take = suggest(hintAt("Кто: Владелец\nБерёт: оффер 5", 28, model), model);
    expect(take.find((i) => i.name === "или")).toBeUndefined();
  });

  it("после «Или:» снова предлагается «Кому:» — и в списке «сколько», и в начале строки (владелец, 2026-09-18)", () => {
    const T = "Задача: a\nКто: Владелец\nОтдаёт: оффер 1\nКому: Партнёр-фрилансер\nИли: оплата 2";
    const qty = suggest(hintAt(T, T.length, model), model);
    expect(qty.find((i) => i.note === "новая строка: Кому:")).toMatchObject({ name: "↵", text: "\nКому:" });
    expect(qty.some((i) => i.note === "новая строка: От кого:")).toBe(false);
    const labels = suggest(hintAt(`${T}\n`, T.length + 1, model), model).map((i) => `${i.name} ${i.note || ""}`.trim());
    expect(labels[0]).toBe("Кому: куда");
    // «Кому:» после «Или:» относится к тому же шагу.
    const { funcs, errors } = parseText(`${T}\nКому: Владелец`, model, {});
    expect(errors).toEqual([]);
    expect(funcs[0].tasks[0].branches[0].steps[0].tos.map((x) => x.name)).toEqual(["Партнёр-фрилансер", "Владелец"]);
  });

  it("в списке «сколько» есть знак «=» (ровно); раскраска несёт хвост операции", () => {
    // Хвост пуст — «=», операнды, «дальше»; после числа — знаки; после знака — только операнды (владелец, 2026-09-18).
    const empty = suggest(hintAt("Отдаёт: оффер ", 14, model), model);
    expect(empty.find((i) => i.name === "=")).toMatchObject({ kind: "знак", note: "ровно" });
    expect(empty.find((i) => i.info).note).toMatch(/число, выберите ресурс или закреплённый/);
    expect(empty.filter((i) => i.kind === "ресурс").map((i) => i.name)).toContain("@оффер");
    const h = hintAt("Отдаёт: оффер 5", 15, model);
    expect(h.kind).toBe("qty");
    const afterNum = suggest(h, model);
    expect(afterNum.filter((i) => i.kind === "знак").map((i) => i.name)).toEqual(["%", "*", "/", "+", "-"]);
    expect(afterNum.some((i) => i.name === "=" || /диапазон/.test(i.note || ""))).toBe(false);
    const afterOp = suggest(hintAt("Отдаёт: оффер 5 % ", 18, model), model);
    expect(afterOp.find((i) => i.info).note).toMatch(/процент от чего: введите число или выберите «@ресурс»/);
    expect(afterOp.some((i) => i.kind === "знак" || i.kind === "дальше")).toBe(false);
    expect(afterOp.some((i) => i.kind === "ресурс")).toBe(true);
    // Закреплённый ресурс в операции — его количество.
    const T3 = "Задача: a\nКто: Владелец\nОтдаёт: оффер 4 (lead)\n\nЗадача: b\nКто: Владелец\nОтдаёт: оффер 50% lead";
    const items = parseText(T3, model, {}).funcs[0].tasks[1].items;
    expect(items[0]).toMatchObject({ qty: 2, expr: "50% lead" });
    expect(items[0].exprError).toBeUndefined();
    const span = paintOf("Кто: Владелец\nОтдаёт: оффер 50% A", model, {})[1].spans.find((k) => k.kind === "trait");
    expect(span).toMatchObject({ name: "оффер", tail: "50% A" });
  });

  it("после «Отдаёт:» без актива — ресурсы всех активов с пометкой, а не «сперва назовите кто»", () => {
    const items = suggest(hintAt("Отдаёт: ", 8, model), model);
    expect(items.filter((i) => i.kind === "ресурс").map((i) => `${i.name} — ${i.note}`)).toEqual(
      ["оффер — Владелец", "назначенный диапазон — Партнёр", "оплата — Партнёр", "оплата — Владелец"]);
    const info = items.find((i) => i.info);
    expect(info.note).toMatch(/актива исполнителя/);
    expect(info.note).not.toMatch(/сперва/);
    // «Кто:» с должностью без актива — то же.
    const noAsset = suggest(hintAt("Кто: Курьер\nБерёт: ", 19, model), model);
    expect(noAsset.some((i) => i.kind === "ресурс")).toBe(true);
  });
});

describe("переменные ресурсов: плашка и переименование (владелец, 2026-09-18)", () => {
  it("плашка ресурса — имя и количество, переменная — своей плашкой; ссылка «(X)» — только плашка переменной", () => {
    const rows = paintOf("Кто: Владелец\nОтдаёт: оффер 2 (переменная: lead)\nБерёт: (lead)", model, {});
    const give = rows[1].spans.filter((k) => k.kind !== "mark");
    // Имя и количество — разными плашками (владелец, 2026-09-18).
    expect(give.map((k) => [k.kind, k.start, k.end])).toEqual([["trait", 8, 13], ["qty", 14, 15], ["var", 16, 34]]);
    expect(give[2]).toMatchObject({ varName: "lead", ref: false, inner: { start: 29, end: 33 }, itemSpan: { start: 8, end: 34 } });
    const take = rows[2].spans.filter((k) => k.kind !== "mark");
    expect(take.map((k) => k.kind)).toEqual(["var"]);
    expect(take[0]).toMatchObject({ varName: "lead", ref: true, itemSpan: { start: 7, end: 13 } });
  });

  it("renameVar правит объявление, ссылки и флаг во всём тексте", () => {
    expect(renameVar("Отдаёт: оффер (переменная: lead)\nБерёт: (lead), (флаг lead)\nЕсли: время", "lead", "deal"))
      .toBe("Отдаёт: оффер (переменная: deal)\nБерёт: (deal), (флаг deal)\nЕсли: время");
    expect(renameVar("(переменная: leader)", "lead", "x")).toBe("(переменная: leader)");
  });
});

describe("«Кому:»/«От кого:» — как участник: рука и сотрудник (владелец, 2026-09-18)", () => {
  it("читаются «{рука}» и «@сотрудник», красятся плашками, ставятся setHand/setPerson, уходят в порт функции", () => {
    const text = "Задача: x\nКто: Партнёр-фрилансер\nОтдаёт: оплата 5\nКому: Владелец {space bear} @Иван";
    const { funcs } = parseText(text, model, {});
    const step = funcs[0].tasks[0].branches[0].steps[0];
    expect(step.to).toMatchObject({ name: "Владелец", hand: "space bear", person: "Иван" });
    const spans = paintOf(text, model, {})[3].spans.map((k) => k.kind);
    // У «Кому:» с должностью — пометка актива справа, как у «Кто:» (владелец, 2026-09-18).
    expect(paintOf("Кто: Владелец\nОтдаёт: оффер 1\nКому: Партнёр-фрилансер", model, {})[2].note).toBe("Партнёр");
    expect(spans).toEqual(["mark", "asset", "hand", "person"]);
    expect(setHand("Кому: Владелец", 0, "quiet fox")).toBe("Кому: Владелец {quiet fox}");
    expect(setPerson("От кого: Владелец {quiet fox}", 0, "Пётр")).toBe("От кого: Владелец @Пётр");
    expect(setAuto("Кому: Владелец @Пётр", 0)).toBe("Кому: Владелец");
    expect(exportText("Кому: Владелец {space bear}")).toBe("Кому: Владелец (переменная: сотрудник space bear)");
    expect(importText("Кому: Владелец (переменная: сотрудник space bear)")).toBe("Кому: Владелец {space bear}");
    const f = procFuncs({ id: "p", text }, model)[0];
    expect([...f.takes, ...f.gives].find((x) => x.to)).toMatchObject({ to: "own", toHand: "space bear", toPerson: "Иван" });
  });
});

describe("несколько «Кому:» (владелец, 2026-09-18)", () => {
  it("все получатели читаются, красятся, дают по порту на каждого; после «Кому:» подсказка предлагает ещё «Кому:»", () => {
    const text = "Задача: x\nКто: Партнёр-фрилансер\nОтдаёт: оплата 5\nКому: Владелец\nКому: Партнёр-фрилансер {space bear}";
    const { funcs, errors } = parseText(text, model, {});
    expect(errors).toEqual([]);
    const step = funcs[0].tasks[0].branches[0].steps[0];
    expect(step.tos.map((x) => x.name)).toEqual(["Владелец", "Партнёр-фрилансер"]);
    expect(step.to.name).toBe("Владелец");
    expect(paintOf(text, model, {})[4].spans.map((k) => k.kind)).toEqual(["mark", "asset", "hand"]);
    const f = procFuncs({ id: "p", text }, model)[0];
    expect(f.gives.map((g) => [g.trait, g.to, g.toHand || ""])).toEqual([["t4", "own", ""], ["t4", "prt", "space bear"]]);   // ресурс — по первому получателю
    expect(f.steps[0].ports).toHaveLength(2);
    const labels = suggest(hintAt(`${text}\n`, text.length + 1, model), model).map((i) => `${i.name} ${i.note || ""}`.trim());
    expect(labels[0]).toBe("Кому: ещё кому");
    expect(usesAsset({ id: "p", text }, model, "prt")).toBe(true);
    expect(replaceName(text, "who", "Владелец", "Босс", model).split("\n")[3]).toBe("Кому: Босс");
  });
});

describe("«Если:» — знаки сравнения (владелец, 2026-09-18)", () => {
  it("после переменной предлагаются = > < ≥ ≤ ≠; после знака — просьба ввести число или переменную", () => {
    const T2 = "Задача: a\nКто: Владелец\nОтдаёт: оффер 2 (lead)\n\nЗадача: b\nЕсли: lead ";
    const items = suggest(hintAt(T2, T2.length, model), model);
    expect(items.filter((i) => i.kind === "знак").map((i) => i.name)).toEqual(["=", ">", "<", "≥", "≤", "≠", "И", "ИЛИ", "!"]);
    expect(items.find((i) => i.name === ">")).toMatchObject({ note: "больше", suffix: " ", insert: true });
    const after = hintAt(`${T2}> `, T2.length + 2, model);
    expect(after).toMatchObject({ kind: "cond", query: "", afterOp: true });
    const items2 = suggest(after, model);
    expect(items2.find((i) => i.info).note).toMatch(/число или выберите переменную/);
    expect(items2.some((i) => i.kind === "знак")).toBe(false);
  });
});

describe("«То:» своей строкой (владелец, 2026-09-18)", () => {
  it("«То:» после «Если:» читается, без «Если:» — ошибка; после «То:» подсказка предлагает Кто/Берёт/Отдаёт; из условия — пункт «↵ То:»", () => {
    const text = "Задача: a\nЕсли: lead > 5\nТо:\nКто: Владелец\nОтдаёт: оффер 1\nИначе:\nКто: Владелец\nОтдаёт: оффер 2";
    const { funcs, errors } = parseText(text, model, {});
    expect(errors).toEqual([]);
    const [b1, b2] = funcs[0].tasks[0].branches;
    expect(b1).toMatchObject({ cond: "lead > 5", thenRow: 2 });
    expect(b1.who[0].name).toBe("Владелец");
    expect(b2.isElse).toBe(true);
    expect(labelOf("То:")).toMatchObject({ kind: "then" });
    expect(parseText("Задача: a\nТо:", model, {}).errors[0].message).toMatch(/«То:» без «Если:»/);
    const labels = suggest(hintAt("Задача: a\nЕсли: x\nТо:\n", 22, model), model).slice(0, 3).map((i) => i.name);
    expect(labels).toEqual(["Кто:", "Берёт:", "Отдаёт:"]);
    const item = suggest(hintAt("Задача: a\nЕсли: lead ", 21, model), model).find((i) => i.note === "новая строка: То:");
    expect(item).toMatchObject({ name: "↵", text: "\nТо:", suffix: "\n" });
  });
});

describe("сроки задачи в тексте (владелец, 2026-09-18)", () => {
  const T = "Задача: шаг\nСрок: 2-4 дн\nПопытка: через 3 ч\nОдновременно: 2, на актив 5\nКто: Владелец\nОтдаёт: оффер 1";
  it("«Срок:», «Попытка:», «Одновременно:» читаются и уходят в функцию", () => {
    const { funcs, errors } = parseText(T, model, {});
    expect(errors).toEqual([]);
    expect(funcs[0].tasks[0].time).toMatchObject({ dur: 2, durHi: 4, durUnit: "дн", every: 3, everyHi: 3, everyUnit: "ч", par: 2, parAll: 5 });
    const f = procFuncs({ id: "p", text: T }, model)[0];
    expect(f).toMatchObject({ dur: 2, durHi: 4, durUnit: "дн", every: 3, everyUnit: "ч", par: 2, parAll: 5 });
    // Без строк — прежние умолчания функции.
    expect(procFuncs({ id: "p", text: "Задача: a\nКто: Владелец\nОтдаёт: оффер 1" }, model)[0]).toMatchObject({ dur: 1, durUnit: "дн" });
  });

  it("разбор значений и ошибка непонятной строки", () => {
    expect(parseDur("2-4 дн")).toEqual({ dur: 2, durHi: 4, durUnit: "дн" });
    expect(parseEvery("сразу")).toEqual({ every: 0, everyHi: 0, everyUnit: "дн" });
    expect(parseEvery("через 3 ч")).toEqual({ every: 3, everyHi: 3, everyUnit: "ч" });
    expect(parsePar("2, на актив 5")).toEqual({ par: 2, parAll: 5 });
    expect(parseDur("скоро")).toBeNull();
    expect(parseText("Задача: a\nСрок: скоро", model, {}).errors[0].message).toMatch(/число и единица/);
    expect(parseText("Срок: 2 дн", model, {}).errors[0].message).toMatch(/без задачи/);
  });

  it("setTaskTime ставит, меняет и убирает строку сразу под задачей", () => {
    let t = "Задача: шаг\nКто: Владелец";
    t = setTaskTime(t, 0, "dur", "2 дн");
    expect(t).toBe("Задача: шаг\nСрок: 2 дн\nКто: Владелец");
    t = setTaskTime(t, 0, "par", "3");
    expect(t).toBe("Задача: шаг\nСрок: 2 дн\nОдновременно: 3\nКто: Владелец");
    t = setTaskTime(t, 0, "dur", "4-6 ч");
    expect(t.split("\n")[1]).toBe("Срок: 4-6 ч");
    expect(setTaskTime(t, 0, "dur", null)).toBe("Задача: шаг\nОдновременно: 3\nКто: Владелец");
  });
});

describe("критерии проверки задачи (владелец, 2026-09-18)", () => {
  it("строки «Критерий:» читаются, уходят в функцию и правятся setTaskChecks", () => {
    const T = "Задача: шаг\nСрок: 2 дн\nКритерий: есть ссылка\nКритерий: заполнены поля\nКто: Владелец\nОтдаёт: оффер 1";
    const { funcs, errors } = parseText(T, model, {});
    expect(errors).toEqual([]);
    expect((funcs[0].tasks[0].checks || []).map((c) => c.text)).toEqual(["есть ссылка", "заполнены поля"]);
    expect(procFuncs({ id: "p", text: T }, model)[0].checks).toEqual(["есть ссылка", "заполнены поля"]);
    expect(parseText("Задача: a\nКритерий:", model, {}).errors[0].message).toMatch(/напишите, что проверяем/);
    expect(setTaskChecks("Задача: шаг\nСрок: 2 дн\nКто: Владелец", 0, ["раз", "два"]))
      .toBe("Задача: шаг\nСрок: 2 дн\nКритерий: раз\nКритерий: два\nКто: Владелец");
    expect(setTaskChecks(T, 0, []).split("\n")).toEqual(["Задача: шаг", "Срок: 2 дн", "Кто: Владелец", "Отдаёт: оффер 1"]);
    // После названия задачи метка «Критерий:» есть в подсказках.
    expect(suggest(hintAt("Задача: шаг", 11, model), model).some((i) => i.name === "Критерий:")).toBe(true);
  });
});

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
    expect(b.who[0]).toMatchObject({ name: "Партнёр-фрилансер", asset: { id: "prt" }, roles: { setter: true, doer: true, checker: false }, hand: "a" });
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
    expect(r2.spans.filter((k) => k.kind === "trait").map((k) => [cut(r2, k), k.side, k.state, k.letter])).toEqual([["оплата", "give", "ok", "A"], ["оплата", "give", "ok", "B"]]);
    expect(r2.spans.filter((k) => k.kind === "qty").map((k) => cut(r2, k))).toEqual(["2", "3"]);
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
    // Рука — переменная сотрудника из двух слов в фигурных скобках; сотрудник — «@Имя»; одно снимает другое.
    expect(setHand("Кто: Владелец ✎", 0, "Space Bear")).toBe("Кто: Владелец ✎ {space bear}");
    expect(setHand("Кто: Владелец ✎ {space bear}", 0, null)).toBe("Кто: Владелец ✎");
    expect(setPerson("Кто: Владелец ✎ {space bear},", 0, "Иван Петров")).toBe("Кто: Владелец ✎ @Иван Петров,");
    expect(setHand("Кто: Владелец @Иван Петров", 0, "funny donut")).toBe("Кто: Владелец {funny donut}");
    expect(setAuto("Кто: Владелец ✎ {x} @Иван", 0)).toBe("Кто: Владелец ✎");
    const t = "Кто: Владелец\nОтдаёт: оффер 2 (X)\nКому: Партнёр";
    expect(replaceName(t, "trait", "оффер", "коробки", model)).toBe("Кто: Владелец\nОтдаёт: коробки 2 (X)\nКому: Партнёр");
    expect(replaceName(t, "asset", "Партнёр", "Владелец", model).split("\n")[2]).toBe("Кому: Владелец");
  });

  it("выгрузка — роли и переменная словами, загрузка — значками и «{имя}»; старый текст переводится в новый", () => {
    const shown = "Кто: Партнёр-фрилансер ✎ ⚙ {space bear},";
    expect(exportText(shown)).toBe("Кто: Партнёр-фрилансер (постановщик, исполнитель) (переменная: сотрудник space bear),");
    expect(exportText("Кто: Владелец @Иван Петров")).toBe("Кто: Владелец (сотрудник: Иван Петров)");
    expect(importText("Кто: Владелец(проверяющий)(переменная: сотрудник B)")).toBe("Кто: Владелец ✓ {b}");
    expect(importText("Кто: Владелец (сотрудник: Иван Петров)")).toBe("Кто: Владелец @Иван Петров");
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
    expect(a.who[0]).toMatchObject({ pos: "r_prt", asset: "prt", hand: "a", roles: { setter: true, doer: true, checker: false } });
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

describe("переменная сотрудника и конкретный сотрудник", () => {
  const m = { ...model, entities: [{ ...model.entities[0], crew: ["7", "8"] }, model.entities[1]],
    people: [{ id: "7", name: "Иван Петров", roles: ["r_owner"] }, { id: "8", name: "Оля", roles: [] }] };
  it("«{space bear}» — рука (без регистра), «@Имя» — сотрудник по имени из людей; плашки без скобок и «@»", () => {
    const text = "Кто: Владелец ✎ {Space Bear}\nКто: Владелец @Иван Петров,\nКто: Владелец @Нет Такого\nОтдаёт: оффер";
    const who = parseText(text, m, {}).funcs[0].tasks[0].branches[0].who;
    expect(who.map((w) => [w.hand, w.person, w.personId])).toEqual([["space bear", null, null], [null, "Иван Петров", "7"], [null, "Нет Такого", null]]);
    const paint = paintOf(text, m, {});
    expect(paint[0].spans.find((k) => k.kind === "hand")).toMatchObject({ brace: true, hand: "space bear" });
    expect(paint[1].spans.find((k) => k.kind === "person")).toMatchObject({ at: true, known: true });
    expect(paint[2].spans.find((k) => k.kind === "person")).toMatchObject({ known: false });
    expect(issuesOf({ text }, m)).toContain("нет такого сотрудника: Нет Такого");
    // В функцию сотрудник уходит идентификатором.
    const f = procFuncs({ id: "p", status: "on", text: "Задача: a\nКто: Владелец @Иван Петров\nОтдаёт: оффер", hypo: { traits: [] }, missing: { rejected: [] } }, m)[0];
    expect(f.who[0]).toMatchObject({ person: "7" });
  });
  it("«@» в строке «Кто:» подсказывает сотрудников должности; сотрудники должности — по ролям людей", () => {
    expect(peopleOfPosition("Владелец", m).map((p) => p.name)).toEqual(["Иван Петров"]);
    expect(peopleOfPosition("Партнёр", { ...m, entities: [{ id: "prt", name: "Партнёр", crew: ["8"] }] }).map((p) => p.name)).toEqual(["Оля"]);
    const h = hintAt("Кто: Владелец @Ив", "Кто: Владелец @Ив".length, m);
    expect(h).toMatchObject({ kind: "person", query: "Ив", posName: "Владелец" });
    expect(suggest(h, m, {}).map((i) => i.name)).toEqual(["@Иван Петров"]);
  });
});
