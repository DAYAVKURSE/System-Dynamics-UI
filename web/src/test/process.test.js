import { describe, expect, it } from "vitest";
import { canAcceptProc, dropHypo, formatStep, hintAt, nameKey, normalizeProc, parseProcess,
  procFuncs, procIssues, replaceName, resolveProc, stateOf, suggestNames, syncProcFuncs }
  from "../lib/process.js";
import { activeFuncs, liveModel, normalizeFunc } from "../lib/funcs.js";
import { forecast } from "../lib/plan.js";
import { chainOf } from "../lib/chain.js";

/* ТЕХНОЛОГИЧЕСКИЙ ПРОЦЕСС — ТЕКСТ, ИЗ КОТОРОГО СОБИРАЮТСЯ ФУНКЦИИ.

   Владелец пишет строками «Актив: берёт Ресурс 2 → отдаёт Ресурс 1», и
   разбор должен понимать его так, как он пишет: без регистра, с «даёт»
   вместо «отдаёт» и «->» вместо стрелки. Здесь проверяется сам разбор,
   память записи о найденных id (переименованное остаётся своим, удалённое
   видно удалённым), сборка функций и то, ради чего всё это: гипотеза
   считается только по просьбе. */

const entities = [{ id: "usr", name: "Пользователи" }, { id: "mkt", name: "Рынок услуг" }];
const traits = [
  { id: "dem", e: "mkt", l: "спрос" },
  { id: "req", e: "usr", l: "заявки" },
  { id: "req2", e: "mkt", l: "заявки" },
];
const model = { entities, traits };

describe("разбор строки", () => {
  it("«Актив: берёт … → отдаёт …» — актив, входы с числами, выходы с числами", () => {
    const { steps, errors } = parseProcess("Пользователи: берёт спрос 2, заявки 1 → отдаёт заявки 3", model);
    expect(errors).toEqual([]);
    expect(steps).toHaveLength(1);
    expect(steps[0].asset).toEqual({ name: "Пользователи", id: "usr" });
    expect(steps[0].takes).toEqual([
      { name: "спрос", id: "dem", qty: 2 }, { name: "заявки", id: "req", qty: 1 }]);
    expect(steps[0].gives).toEqual([{ name: "заявки", id: "req", qty: 3 }]);
  });

  it("«даёт», «выдаёт» и «->» читаются так же; десятичная запятая — число", () => {
    const a = parseProcess("Пользователи: берёт спрос 1,5 -> даёт заявки 1", model);
    const b = parseProcess("Пользователи: берёт спрос 1 → выдаёт заявки 2", model);
    expect(a.errors).toEqual([]);
    expect(a.steps[0].takes[0].qty).toBe(1.5);
    expect(b.errors).toEqual([]);
    expect(b.steps[0].gives[0].qty).toBe(2);
  });

  it("имена сравниваются без регистра, лишних пробелов и разницы «е/ё»", () => {
    const { steps, errors } = parseProcess("  ПОЛЬЗОВАТЕЛИ : берет  Спрос 2 -> дает  ЗАЯВКИ 1 ", model);
    expect(errors).toEqual([]);
    expect(steps[0].asset.id).toBe("usr");
    expect(steps[0].takes[0].id).toBe("dem");
    expect(steps[0].gives[0].id).toBe("req");
    expect(nameKey("Ёлка  большая ")).toBe("елка большая");
  });

  it("одноимённый ресурс берётся из актива строки, а не первый попавшийся", () => {
    const { steps } = parseProcess("Рынок услуг: берёт спрос 1 → отдаёт заявки 1", model);
    expect(steps[0].gives[0].id).toBe("req2");
  });

  it("ненайденное остаётся без id, а не ошибкой: так процесс и придумывают", () => {
    const { steps, errors } = parseProcess("Склад: берёт спрос 1 → отдаёт коробки 2", model);
    expect(errors).toEqual([]);
    expect(steps[0].asset).toEqual({ name: "Склад", id: null });
    expect(steps[0].gives[0]).toEqual({ name: "коробки", id: null, qty: 2 });
  });

  it("ошибки — словами и с номером строки; пустые строки не считаются", () => {
    const text = [
      "Пользователи берёт спрос 1 → отдаёт заявки 1",
      "",
      "Пользователи: берёт спрос 1 отдаёт заявки 1",
      "Пользователи: спрос 1 → отдаёт заявки 1",
      "Пользователи: берёт спрос → отдаёт заявки 1",
      "Пользователи: берёт спрос 1 → отдаёт",
      "Пользователи: берёт спрос 1 → отдаёт заявки 1",
    ].join("\n");
    const { steps, errors } = parseProcess(text, model);
    expect(errors.map((e) => e.line)).toEqual([1, 3, 4, 5, 6]);
    expect(errors[0].message).toMatch(/двоеточия/);
    expect(errors[1].message).toMatch(/стрелки/);
    expect(errors[2].message).toMatch(/«берёт»/);
    expect(errors[3].message).toMatch(/не указано число/);
    expect(errors[4].message).toMatch(/не сказано, что отдаёт/);
    // Строка с ошибкой всё равно в списке: её показывают там же, где ошибка.
    expect(steps).toHaveLength(6);
    expect(steps[5]).toMatchObject({ line: 7, error: null });
  });

  it("каноническая запись строки — та, которой заменяют имя", () => {
    const { steps } = parseProcess("Пользователи: берёт спрос 2 -> даёт заявки 1", model);
    expect(formatStep(steps[0])).toBe("Пользователи: берёт спрос 2 → отдаёт заявки 1");
    expect(replaceName("Склад: берёт спрос 1 -> даёт коробки 2\nПользователи: берёт спрос 1 → отдаёт заявки 1",
      "asset", "склад", "Рынок услуг"))
      .toBe("Рынок услуг: берёт спрос 1 → отдаёт коробки 2\nПользователи: берёт спрос 1 → отдаёт заявки 1");
    expect(replaceName("Склад: берёт спрос 1 → отдаёт коробки 2", "trait", "Коробки", "заявки"))
      .toBe("Склад: берёт спрос 1 → отдаёт заявки 2");
  });
});

describe("память записи о найденных id", () => {
  const proc = normalizeProc({ id: "pr1", text: "Пользователи: берёт спрос 1 → отдаёт заявки 1",
    steps: parseProcess("Пользователи: берёт спрос 1 → отдаёт заявки 1", model).steps });

  it("переименованный на схеме актив остаётся своим: id помнит, чего имя не знает", () => {
    const renamed = { ...model, entities: [{ id: "usr", name: "Клиенты" }, entities[1]] };
    const { steps } = resolveProc(proc, renamed);
    expect(steps[0].asset.id).toBe("usr");
    expect(stateOf(steps[0].asset, "asset", renamed, proc)).toBe("ok");
  });

  it("удалённый со схемы — «удалён», а не «никогда не было»: ему просят замену", () => {
    const gone = { ...model, entities: [entities[1]] };
    const { steps } = resolveProc(proc, gone);
    expect(stateOf(steps[0].asset, "asset", gone, proc)).toBe("deleted");
    expect(procIssues(proc, gone)).toEqual(["сначала поставьте замену: Пользователи"]);
    expect(canAcceptProc(proc, gone)).toBe(false);
  });

  it("неизвестное и отклонённое различаются, и оба не дают принять", () => {
    const p = normalizeProc({ id: "pr2", text: "Склад: берёт спрос 1 → отдаёт коробки 2" });
    const { steps } = resolveProc(p, model);
    expect(stateOf(steps[0].asset, "asset", model, p)).toBe("unknown");
    expect(procIssues(p, model)).toEqual(["сначала примите или отклоните: Склад, коробки"]);
    const rej = { ...p, missing: { rejected: ["склад"] } };
    expect(stateOf(steps[0].asset, "asset", model, rej)).toBe("rejected");
    expect(procIssues(rej, model)).toEqual([
      "сначала примите или отклоните: коробки",
      "отклонено — исправьте или удалите строку: Склад"]);
    expect(canAcceptProc(proc, model)).toBe(true);
    expect(procIssues(normalizeProc({ id: "pr3", text: "" }), model)).toEqual(["процесс пуст"]);
  });

  it("прежняя запись без новых полей читается как «не принято»", () => {
    expect(normalizeProc({ id: "x", text: "a" })).toEqual({
      id: "x", text: "a", status: "off", steps: [],
      hypo: { entities: [], traits: [] }, missing: { rejected: [] } });
    expect(normalizeProc({ status: "странно" }).status).toBe("off");
  });
});

describe("функции из шагов", () => {
  const text = "Пользователи: берёт спрос 2 → отдаёт заявки 1\nРынок услуг: берёт заявки 1 → отдаёт спрос 3";
  const proc = normalizeProc({ id: "pr1", text, status: "hypo" });

  it("по функции на строку, в активе строки, с точным числом и пометкой процесса", () => {
    const fs = procFuncs(proc, model);
    expect(fs).toHaveLength(2);
    expect(fs[0]).toMatchObject({ id: "pr1_1", e: "usr", proc: "pr1", accepted: true,
      name: "процесс: Пользователи: берёт спрос 2 → отдаёт заявки 1" });
    expect(fs[0].takes[0]).toMatchObject({ trait: "dem", lo: 2, hi: 2 });
    expect(fs[0].gives[0]).toMatchObject({ trait: "req", lo: 1, hi: 1 });
    expect(fs[1]).toMatchObject({ id: "pr1_2", e: "mkt" });
    // Не принятый процесс функций не даёт вовсе.
    expect(procFuncs({ ...proc, status: "off" }, model)).toEqual([]);
  });

  it("строка с неизвестным функции не даёт: нечего брать и некуда отдавать", () => {
    const p = normalizeProc({ id: "pr2", status: "on",
      text: "Пользователи: берёт спрос 2 → отдаёт заявки 1\nСклад: берёт спрос 1 → отдаёт коробки 2" });
    expect(procFuncs(p, model).map((f) => f.id)).toEqual(["pr2_1"]);
  });

  it("пересборка: чужие функции не трогаются, свои — заново, положение на схеме остаётся", () => {
    const own = normalizeFunc({ id: "f_own", e: "usr", name: "своя" });
    const old = normalizeFunc({ id: "pr1_1", e: "usr", proc: "pr1", x: 40, y: 50,
      takes: [{ trait: "req", lo: 9, hi: 9 }] });
    const next = syncProcFuncs([own, old], [proc], model, normalizeFunc);
    expect(next.map((f) => f.id)).toEqual(["f_own", "pr1_1", "pr1_2"]);
    expect(next[1]).toMatchObject({ x: 40, y: 50 });
    expect(next[1].takes[0]).toMatchObject({ trait: "dem", lo: 2 });
    // Снятый процесс уносит свои функции.
    expect(syncProcFuncs(next, [{ ...proc, status: "off" }], model, normalizeFunc)
      .map((f) => f.id)).toEqual(["f_own"]);
  });

  it("уборка гипотез: уходит то, чем никто больше не пользуется", () => {
    const ents = [...entities, { id: "wh", name: "Склад", hypo: true }];
    const trs = [...traits, { id: "box", e: "wh", l: "коробки", hypo: true },
      { id: "pal", e: "wh", l: "поддоны", hypo: true }];
    const p = normalizeProc({ id: "pr1", status: "hypo", hypo: { entities: ["wh"], traits: ["box", "pal"] } });
    const funcs = [
      normalizeFunc({ id: "pr1_1", e: "wh", proc: "pr1", gives: [{ trait: "box" }] }),
      normalizeFunc({ id: "f_other", e: "usr", takes: [{ trait: "pal" }] }),
    ];
    const out = dropHypo(p, { entities: ents, traits: trs, funcs });
    expect(out.funcs.map((f) => f.id)).toEqual(["f_other"]);
    expect(out.traits.map((t) => t.id)).toEqual(["dem", "req", "req2", "pal"]);
    // Поддоны берёт чужая функция — они остались, и актив с ними тоже.
    expect(out.entities.map((e) => e.id)).toEqual(["usr", "mkt", "wh"]);
    expect(out.proc.hypo).toEqual({ entities: ["wh"], traits: ["pal"] });
  });
});

describe("подсказки при наборе", () => {
  it("в начале строки — активы, после «берёт», «отдаёт» и запятой — ресурсы", () => {
    expect(hintAt("Поль", 4)).toEqual({ kind: "asset", start: 0, query: "Поль" });
    const t = "Пользователи: берёт сп";
    expect(hintAt(t, t.length)).toEqual({ kind: "trait", start: t.length - 2, query: "сп" });
    const c = "Пользователи: берёт спрос 2, за";
    expect(hintAt(c, c.length)).toMatchObject({ kind: "trait", query: "за" });
    const g = "Пользователи: берёт спрос 2 → отдаёт ";
    expect(hintAt(g, g.length)).toMatchObject({ kind: "trait", query: "" });
  });

  it("после числа и после стрелки подсказывать нечего; вторая строка считается своей", () => {
    const n = "Пользователи: берёт спрос 2";
    expect(hintAt(n, n.length)).toBeNull();
    const a = "Пользователи: берёт спрос 2 → ";
    expect(hintAt(a, a.length)).toBeNull();
    const two = "Пользователи: берёт спрос 2 → отдаёт заявки 1\nРын";
    expect(hintAt(two, two.length)).toEqual({ kind: "asset", start: two.length - 3, query: "Рын" });
  });

  it("имена — по началу набранного, ресурсы актива строки первыми, без повторов", () => {
    expect(suggestNames({ kind: "asset", query: "р" }, model)).toEqual(["Рынок услуг"]);
    expect(suggestNames({ kind: "trait", query: "" }, model, "usr")).toEqual(["заявки", "спрос"]);
    expect(suggestNames({ kind: "trait", query: "" }, model, "mkt")).toEqual(["спрос", "заявки"]);
    expect(suggestNames({ kind: "trait", query: "за" }, model, null)).toEqual(["заявки"]);
    expect(suggestNames(null, model)).toEqual([]);
  });
});

describe("гипотеза считается только по просьбе", () => {
  const plain = normalizeFunc({ id: "f1", e: "usr", takes: [{ trait: "dem", lo: 1, hi: 1 }],
    gives: [{ trait: "req", lo: 1, hi: 1 }], dur: 1, durUnit: "дн" });
  const hypo = normalizeFunc({ id: "pr1_1", e: "usr", proc: "pr1",
    takes: [{ trait: "dem", lo: 1, hi: 1 }], gives: [{ trait: "req2", lo: 5, hi: 5 }],
    dur: 1, durUnit: "дн" });
  const on = normalizeFunc({ id: "pr2_1", e: "usr", proc: "pr2", takes: [], gives: [], dur: 1 });
  const procs = [{ id: "pr1", status: "hypo" }, { id: "pr2", status: "on" }];

  it("activeFuncs: «гипотетически» — с галочкой, «принято» — всегда, без пометок — тот же список", () => {
    expect(activeFuncs({ funcs: [plain, hypo, on], procs }).map((f) => f.id)).toEqual(["f1", "pr2_1"]);
    expect(activeFuncs({ funcs: [plain, hypo, on], procs, hypoOn: true }).map((f) => f.id))
      .toEqual(["f1", "pr1_1", "pr2_1"]);
    const same = [plain];
    expect(activeFuncs({ funcs: same, procs })).toBe(same);
    expect(liveModel({ funcs: same }).funcs).toBe(same);
    // Функция процесса, о котором модель не знает, — принята: раз она есть, её применили.
    expect(activeFuncs({ funcs: [hypo] }).map((f) => f.id)).toEqual(["pr1_1"]);
  });

  it("прогноз и цепочка видят гипотезу только с галочкой", () => {
    const m = { traits: traits.map((t) => ({ ...t, have: 100 })), funcs: [plain, hypo], procs };
    const off = forecast(m, { span: 3 });
    const with_ = forecast({ ...m, hypoOn: true }, { span: 3 });
    expect(off.hi.req2[3]).toBe(100);
    expect(with_.hi.req2[3]).toBeGreaterThan(100);
    expect(chainOf(m, { from: "dem" }).steps.map((s) => s.id)).toEqual(["f1"]);
    expect(chainOf({ ...m, hypoOn: true }, { from: "dem" }).steps.map((s) => s.id).sort())
      .toEqual(["f1", "pr1_1"]);
  });
});
