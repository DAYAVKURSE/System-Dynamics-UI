import { describe, expect, it } from "vitest";
import { MATERIAL_KINDS, newCode, newMaterials, normalizeMaterials, spentIds, stockOf,
  unitLabel, unitsOf, withStock } from "../lib/units.js";

/* МАТЕРИАЛЫ — второй источник единиц и единственный источник числа «есть».

   Единицу либо сдают в задаче, либо кладут руками в «Материалы». Сколько
   ресурса есть — столько единиц лежит, минус израсходованное; число,
   записанное у ресурса, не читается: оно разошлось бы с вещами. */

const FILE = { name: "договор.pdf", type: "application/pdf", size: 10, url: "/api/reports/x/1" };

describe("запись материалов", () => {
  it("на каждую единицу — своё: свой файл, свой текст, свой код", () => {
    /* «Количество 3» — три вещи, и у каждой своё содержимое; один файл на
       троих — одна вещь с тремя номерами, так владелец и сказал. */
    const F2 = { ...FILE, name: "акт.pdf" };
    const file = newMaterials({ trait: "t1", kind: "file", files: [FILE, F2, FILE] });
    expect(file).toHaveLength(3);
    expect(file.map((m) => m.file.name)).toEqual(["договор.pdf", "акт.pdf", "договор.pdf"]);
    file.forEach((m) => expect(m).toMatchObject({ trait: "t1", kind: "file", qty: 1, text: "", code: "" }));
    expect(new Set(file.map((m) => m.id)).size).toBe(3);
    const text = newMaterials({ trait: "t1", kind: "text", texts: ["первый", "второй"] });
    expect(text).toHaveLength(2);
    expect(text.map((m) => m.text)).toEqual(["первый", "второй"]);
    text.forEach((m) => expect(m).toMatchObject({ kind: "text", qty: 1, file: null }));
    const codes = newMaterials({ trait: "t1", qty: 3, kind: "code" });
    expect(codes).toHaveLength(3);
    expect(new Set(codes.map((m) => m.code)).size).toBe(3);
    codes.forEach((m) => expect(m).toMatchObject({ kind: "code", qty: 1 }));
    expect(new Set(codes.map((m) => m.id)).size).toBe(3);
  });

  it("единица — что-то одно: у файла нет текста, у кода — ни того, ни другого", () => {
    const [m] = newMaterials({ trait: "t1", kind: "file", files: [FILE], texts: ["лишнее"] });
    expect(m.text).toBe("");
    const [c] = newMaterials({ trait: "t1", kind: "code", files: [FILE], texts: ["лишнее"] });
    expect(c.file).toBeNull();
    expect(c.text).toBe("");
    expect(c.code).toMatch(/^[A-Z2-9]{8}$/);
  });

  it("код, который человек видел в окне, и сохраняется; занятый заменяется", () => {
    const existing = [{ id: "m0", trait: "t1", kind: "code", qty: 1, code: "AAAAAAAA" }];
    const rows = newMaterials({ trait: "t1", qty: 2, kind: "code", existing,
      codes: ["BBBBBBBB", "AAAAAAAA"] });
    expect(rows[0].code).toBe("BBBBBBBB");
    expect(rows[1].code).not.toBe("AAAAAAAA");
    expect(rows[1].code).not.toBe("BBBBBBBB");
  });

  it("код читается вслух: без нуля, «о», единицы и «и»", () => {
    for (let i = 0; i < 50; i += 1) expect(newCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    // Занятые не повторяются.
    expect(newCode(new Set(["ZZZZZZZZ"]))).not.toBe("ZZZZZZZZ");
  });

  it("чужая запись достраивается, пустая и без ресурса — выбрасывается", () => {
    expect(normalizeMaterials(undefined)).toEqual([]);
    const out = normalizeMaterials([{ trait: "t1" }, null, { kind: "file" }, { trait: "t2", kind: "что?", qty: 0 }]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ trait: "t1", kind: "text", qty: 1 });
    expect(out[1]).toMatchObject({ trait: "t2", kind: "text", qty: 1 });
    expect(MATERIAL_KINDS.map((k) => k.id)).toEqual(["file", "text", "code"]);
  });
});

const F = { id: "f1", e: "A", takes: [{ trait: "t1", lo: 1, hi: 1 }],
  gives: [{ trait: "t2", lo: 1, hi: 1 }] };
const done = (id, { takes = {}, gives = {}, took = {}, status = "done", canceled, at } = {}) => ({
  id, funcId: "f1", title: `задача ${id}`, status, canceled,
  submissions: [{ id: `s_${id}`, at: at || "2026-09-02T10:00:00Z", takes, gives, took }],
});

describe("единицы из материалов", () => {
  it("материал — единица с номером, принятая, без задачи", () => {
    const materials = [{ id: "m1", trait: "t1", kind: "file", qty: 2, file: FILE, at: "2026-09-01T10:00:00Z", by: "7" }];
    const rows = unitsOf({ tasks: [], funcs: [F], materials });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "m1", trait: "t1", qty: 2, no: 1, from: "material",
      kind: "file", file: FILE, accepted: true, task: null, by: "7" });
  });

  it("номера общие для материалов и сдач — по времени", () => {
    const materials = [{ id: "m1", trait: "t2", kind: "text", qty: 1, text: "первый", at: "2026-09-01T10:00:00Z" }];
    const rows = unitsOf({ tasks: [done("a", { gives: { t2: 1 } })], funcs: [F], materials });
    expect(rows.map((u) => [u.id, u.no, u.from])).toEqual([["m1", 1, "material"], ["s_a~t2", 2, "task"]]);
  });

  it("единица называется одной строкой одинаково везде", () => {
    expect(unitLabel({ from: "material", code: "ABCD2345" })).toBe("ABCD2345");
    expect(unitLabel({ from: "material", file: FILE })).toBe("договор.pdf");
    expect(unitLabel({ from: "material", text: "  короткий текст " })).toBe("короткий текст");
    expect(unitLabel({ from: "material", text: "x".repeat(60) })).toHaveLength(40);
    expect(unitLabel({ from: "material" })).toBe("материал");
    expect(unitLabel({ from: "task", title: "Сбор" })).toBe("Сбор");
    expect(unitLabel({ from: "task" })).toBe("без названия");
  });
});

describe("сколько есть", () => {
  it("материалы плюс принятые сдачи минус расход", () => {
    const materials = [{ id: "m1", trait: "t1", kind: "text", qty: 5 }];
    const tasks = [
      done("a", { takes: { t1: 2 }, gives: { t2: 1 } }),
      done("b", { takes: { t1: 1 }, gives: { t2: 1 }, status: "review" }),   // не принята
      done("c", { takes: { t1: 1 }, gives: { t2: 1 }, canceled: true }),     // отменена
    ];
    // «b» на проверке: функция сначала берёт — взятое выдано при взятии (по сдаче, 1).
    expect(stockOf({ traits: [], tasks, funcs: [F], materials })).toEqual({ t1: 2, t2: 1 });
    // Сначала отдаёт — взятое уходит только после проверки; в работе без сдачи — план (`lo`).
    expect(stockOf({ traits: [], tasks, funcs: [{ ...F, steps: [{ kind: "give", ports: [] }] }], materials })).toEqual({ t1: 3, t2: 1 });
    expect(stockOf({ traits: [], tasks: [{ id: "d", funcId: "f1", status: "progress", taken: true, submissions: [] }], funcs: [F], materials })).toEqual({ t1: 4 });
  });

  it("нерасходуемый вход остаток не уменьшает; ниже нуля не бывает", () => {
    const f = { ...F, takes: [{ trait: "t1", lo: 1, hi: 1, spend: false }] };
    const materials = [{ id: "m1", trait: "t1", kind: "text", qty: 1 }];
    expect(stockOf({ tasks: [done("a", { takes: { t1: 1 } })], funcs: [f], materials })).toEqual({ t1: 1 });
    // Старая сдача взяла больше, чем сейчас лежит, — ноль, а не долг.
    expect(stockOf({ tasks: [done("a", { takes: { t1: 9 } })], funcs: [F], materials })).toEqual({ t1: 0 });
  });

  it("withStock подставляет посчитанное и не читает записанное число", () => {
    const traits = [{ id: "t1", l: "спрос", have: 3000 }, { id: "t2", l: "заявки", have: 7 }];
    const materials = [{ id: "m1", trait: "t1", kind: "text", qty: 2 }];
    expect(withStock({ traits, tasks: [], funcs: [F], materials }).map((t) => t.have)).toEqual([2, 0]);
    // Сами ресурсы не переписаны — это вид для расчёта, а не правка.
    expect(traits[0].have).toBe(3000);
  });

  it("израсходованные единицы известны по номерам, которые назвали при сдаче", () => {
    const materials = [{ id: "m1", trait: "t1", kind: "code", qty: 1, code: "A" },
      { id: "m2", trait: "t1", kind: "code", qty: 1, code: "B" }];
    const tasks = [done("a", { takes: { t1: 1 }, took: { t1: ["m1"] } })];
    expect([...spentIds({ tasks, funcs: [F], materials })]).toEqual(["m1"]);
    // Нерасходуемый вход единицу не тратит, непринятая сдача — тоже.
    const f = { ...F, takes: [{ trait: "t1", lo: 1, hi: 1, spend: false }] };
    expect(spentIds({ tasks, funcs: [f], materials }).size).toBe(0);
    expect(spentIds({ tasks: [{ ...tasks[0], status: "review" }], funcs: [F], materials }).size).toBe(0);
  });
});
