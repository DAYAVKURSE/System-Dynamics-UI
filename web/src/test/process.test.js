import { describe, expect, it } from "vitest";
import { canAcceptProc, dropHypo, exactOption, filterOptions, nameKey, newProc, newStep,
  normalizeProc, orderOptions, procFuncs, procIssues, procLabel, procText, stateOf,
  stepComplete, stepText, syncProcFuncs } from "../lib/process.js";
import { activeFuncs, liveModel, normalizeFunc } from "../lib/funcs.js";
import { forecast } from "../lib/plan.js";
import { chainOf } from "../lib/chain.js";

/* ТЕХНОЛОГИЧЕСКИЙ ПРОЦЕСС — ШАГИ, ИЗ КОТОРЫХ СОБИРАЮТСЯ ФУНКЦИИ.

   Владелец собирает шаг выборами: актив, должность, входы «из актива →
   ресурс», выходы «в актив → ресурс». Здесь проверяется запись шагов и её
   чтение (прежние записи из текста читаются в нынешнюю форму), состояние
   выбора (найдено, удалено, не найдено), сборка функций и то, ради чего
   всё это: гипотеза считается только по просьбе. */

const entities = [{ id: "usr", name: "Пользователи" }, { id: "mkt", name: "Рынок услуг" }];
const traits = [
  { id: "dem", e: "mkt", l: "спрос" },
  { id: "req", e: "usr", l: "заявки" },
  { id: "req2", e: "mkt", l: "заявки" },
];
const positions = [{ id: "sales", name: "менеджер" }];
const model = { entities, traits, positions };
const it_ = (id, name) => ({ id, name });
const step = (over = {}) => ({ ...newStep(), id: "1",
  asset: it_("usr", "Пользователи"), role: it_("sales", "менеджер"),
  takes: [{ asset: it_("mkt", "Рынок услуг"), trait: it_("dem", "спрос"), qty: 2 }],
  gives: [{ asset: it_("usr", "Пользователи"), trait: it_("req", "заявки"), qty: 1 }],
  ...over });
const proc = (over = {}) => ({ ...newProc(), id: "pr1", steps: [step()], ...over });

describe("запись шага", () => {
  it("шаг словами: актив (должность): берёт … из … → отдаёт … в …", () => {
    expect(stepText(step())).toBe(
      "Пользователи (менеджер): берёт спрос ×2 из Рынок услуг → отдаёт заявки в Пользователи");
    expect(stepText({ ...newStep(), asset: null })).toBe("?: берёт — → отдаёт —");
    expect(procText(proc({ steps: [step(), step({ id: "2", gives: [] })] })).split("\n")).toHaveLength(2);
  });

  it("имя процесса — своё, иначе первый шаг словами, иначе «процесс»", () => {
    expect(procLabel(proc({ name: "Продажи" }))).toBe("Продажи");
    expect(procLabel(proc())).toMatch(/^Пользователи \(менеджер\): берёт/);
    expect(procLabel(proc({ steps: [] }))).toBe("процесс");
  });

  it("прежняя запись из текста читается в нынешнюю форму, шаг — по номеру строки", () => {
    /* Идентификатор шага — номер строки: функции `${proc}_${line}` и
       задачи на них не должны повиснуть после выката. */
    const old = normalizeProc({ id: "pr9", text: "Пользователи: берёт спрос 2 → отдаёт заявки 1",
      status: "on",
      steps: [{ line: 1, text: "…", asset: { name: "Пользователи", id: "usr" },
        takes: [{ name: "спрос", id: "dem", qty: 2 }],
        gives: [{ name: "заявки", id: "req", qty: 1 }], error: null },
      { line: 2, text: "плохая строка", asset: null, takes: [], gives: [], error: "нет двоеточия" }],
      hypo: { entities: [], traits: [] } });
    expect(old.name).toBe("");
    expect(old.steps).toHaveLength(1);
    expect(old.steps[0]).toMatchObject({ id: "1", asset: { id: "usr" }, role: null,
      takes: [{ asset: null, trait: { id: "dem", name: "спрос" }, qty: 2 }],
      gives: [{ asset: null, trait: { id: "req", name: "заявки" }, qty: 1 }] });
    expect(old.hypo.roles).toEqual([]);
    // Без актива у входа функция не собирается — актив выбирают заново.
    expect(procIssues(old, model)).toEqual(["строка 1: берёт: не выбран актив",
      "строка 1: отдаёт: не выбран актив"]);
  });

  it("количество — положительное число, иначе 1; имена сравниваются без регистра и «ё»", () => {
    const p = normalizeProc({ steps: [{ id: "a", takes: [{ trait: { id: "dem", name: "спрос" }, qty: 0 }],
      gives: [{ trait: { id: "req", name: "x" }, qty: "2,5" }] }] });
    expect(p.steps[0].takes[0].qty).toBe(1);
    expect(p.steps[0].gives[0].qty).toBe(1);
    expect(nameKey("  Заявки ")).toBe(nameKey("заЯвки"));
    expect(nameKey("Ёлка")).toBe("елка");
  });
});

describe("состояние выбора", () => {
  it("не выбрано, найдено, удалено, не найдено — четыре разных ответа", () => {
    expect(stateOf(null, "asset", model)).toBe("empty");
    expect(stateOf(it_("usr", "Пользователи"), "asset", model)).toBe("ok");
    expect(stateOf(it_("gone", "Склад"), "asset", model)).toBe("deleted");
    expect(stateOf({ id: null, name: "Склад" }, "asset", model)).toBe("unknown");
    expect(stateOf(it_("sales", "менеджер"), "role", model)).toBe("ok");
    expect(stateOf(it_("x", "курьер"), "role", model)).toBe("deleted");
  });

  it("причины отказа — словами, по строкам; собранный процесс принять можно", () => {
    expect(procIssues(proc(), model)).toEqual([]);
    expect(canAcceptProc(proc(), model)).toBe(true);
    expect(procIssues(proc({ steps: [] }), model)).toEqual(["процесс пуст"]);
    expect(procIssues(proc({ steps: [step({ asset: null, takes: [], gives: [] })] }), model))
      .toEqual(["строка 1: не выбран актив", "строка 1: ничего не берёт и не отдаёт"]);
    expect(procIssues(proc({ steps: [step({ asset: it_("gone", "Склад"),
      takes: [{ asset: it_("mkt", "Рынок услуг"), trait: it_("old", "прайс"), qty: 1 }],
      gives: [{ asset: it_("usr", "Пользователи"), trait: null, qty: 1 }] })] }), model))
      .toEqual(["строка 1: актив «Склад» удалён — выберите замену",
        "строка 1: берёт: ресурс «прайс» удалён — выберите замену",
        "строка 1: отдаёт: не выбран ресурс"]);
    expect(procIssues(proc({ steps: [step({ role: it_("x", "курьер") })] }), model))
      .toEqual(["строка 1: должность «курьер» удалена — выберите другую"]);
  });
});

describe("функции из шагов", () => {
  it("по функции на шаг, в активе шага, с точным числом и должностью исполнителя", () => {
    const fs = procFuncs(proc({ status: "hypo" }), model);
    expect(fs).toHaveLength(1);
    expect(fs[0]).toMatchObject({ id: "pr1_1", e: "usr", proc: "pr1", accepted: true,
      takes: [{ trait: "dem", lo: 2, hi: 2 }], gives: [{ trait: "req", lo: 1, hi: 1 }],
      posts: { owners: ["sales"] } });
    expect(fs[0].name).toMatch(/^процесс: /);
    // Без должности функция без исполнителя — правят в карточке.
    expect(procFuncs(proc({ status: "on", steps: [step({ role: null })] }), model)[0].posts)
      .toBeUndefined();
  });

  it("не принятый процесс и несобранный шаг функций не дают", () => {
    expect(procFuncs(proc({ status: "off" }), model)).toEqual([]);
    expect(stepComplete(step({ gives: [{ asset: it_("usr", "Пользователи"), trait: null, qty: 1 }] }),
      model)).toBe(false);
    expect(procFuncs(proc({ status: "on", steps: [step({ asset: it_("gone", "Склад") })] }), model))
      .toEqual([]);
  });

  it("пересборка: чужие функции не трогаются, свои — заново; положение и роли из карточки живут", () => {
    const own = normalizeFunc({ id: "f1", e: "usr", name: "своя" });
    const stale = normalizeFunc({ id: "pr1_1", e: "usr", proc: "pr1", name: "старая", x: 7,
      posts: { setters: ["boss"], owners: ["old"] } });
    const gone = normalizeFunc({ id: "pr1_9", e: "usr", proc: "pr1", name: "снятая" });
    const out = syncProcFuncs([own, stale, gone], [proc({ status: "on" })], model, normalizeFunc);
    expect(out.map((f) => f.id)).toEqual(["f1", "pr1_1"]);
    const f = out[1];
    expect(f.x).toBe(7);
    expect(f.posts.setters).toEqual(["boss"]);
    expect(f.posts.owners).toEqual(["sales"]);
    expect(f.takes.map((p) => p.trait)).toEqual(["dem"]);
  });

  it("уборка гипотез: уходит то, чем никто больше не пользуется; должности остаются", () => {
    const e2 = [...entities, { id: "wh", name: "Склад", hypo: true }];
    const t2 = [...traits, { id: "box", e: "wh", l: "коробки", hypo: true },
      { id: "shared", e: "wh", l: "паллеты", hypo: true }];
    const other = normalizeFunc({ id: "f9", e: "usr", takes: [{ trait: "shared", lo: 1, hi: 1 }] });
    const mine = normalizeFunc({ id: "pr1_1", e: "wh", proc: "pr1" });
    const p = proc({ hypo: { entities: ["wh"], traits: ["box", "shared"], roles: ["sales"] } });
    const d = dropHypo(p, { entities: e2, traits: t2, funcs: [other, mine] });
    expect(d.funcs.map((f) => f.id)).toEqual(["f9"]);
    expect(d.traits.map((t) => t.id)).toContain("shared");
    expect(d.traits.map((t) => t.id)).not.toContain("box");
    // Склад остался: в нём живут паллеты, которые взяла чужая функция.
    expect(d.entities.map((e) => e.id)).toContain("wh");
    expect(d.proc.hypo).toEqual({ entities: ["wh"], traits: ["shared"], roles: ["sales"] });
  });
});

describe("списки для выбора", () => {
  const options = [{ id: "a", name: "Аренда" }, { id: "b", name: "Банк" }, { id: "c", name: "Склад" }];

  it("заведённое из процесса — первым, от нового к старому; остальное — как на схеме", () => {
    expect(orderOptions(options, ["b", "c"]).map((o) => o.id)).toEqual(["c", "b", "a"]);
    expect(orderOptions(options, ["zzz"]).map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("набранное сужает список: сперва по началу, потом по вхождению; точное совпадение — без OK", () => {
    expect(filterOptions(options, "").map((o) => o.id)).toEqual(["a", "b", "c"]);
    expect(filterOptions(options, "ск").map((o) => o.id)).toEqual(["c"]);
    expect(filterOptions(options, "ан").map((o) => o.id)).toEqual(["b"]);
    expect(filterOptions(options, "клад").map((o) => o.id)).toEqual(["c"]);
    expect(exactOption(options, " склад ")?.id).toBe("c");
    expect(exactOption(options, "скла")).toBeNull();
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
