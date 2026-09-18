import { describe, expect, it } from "vitest";
import { canAcceptProc, dropHypo, formatStep, hintAt, nameKey, newProc, normalizeProc,
  parseLine, parseProcess, procFuncs, procIssues, procLabel, procUsesAsset, replaceName,
  marksOf, paintOf, resolveProc, stateOf, stepsOf, suggestNames, syncProcFuncs, tokenize } from "../lib/process.js";
import { splitQty } from "../lib/process.js";
import { activeFuncs, liveModel, normalizeFunc } from "../lib/funcs.js";
import { forecast } from "../lib/plan.js";
import { chainOf } from "../lib/chain.js";

/* ТЕХНОЛОГИЧЕСКИЙ ПРОЦЕСС — ТЕКСТ, ИЗ КОТОРОГО СОБИРАЮТСЯ ФУНКЦИИ.

   Владелец пишет строками «Актив, Должность, берёт: Откуда, Что 2,
   отдаёт: Куда, Что» — порядок слов его. Разбор понимает его так, как он
   пишет: без регистра, с «даёт» вместо «отдаёт», без должности, с числом
   после ресурса. Здесь проверяется сам разбор, подсказки у курсора,
   память записи о найденных id, сборка функций и то, ради чего всё это:
   гипотеза считается только по просьбе. */

const entities = [{ id: "usr", name: "Пользователи" }, { id: "mkt", name: "Рынок услуг" }];
const traits = [
  { id: "dem", e: "mkt", l: "спрос" },
  { id: "req", e: "usr", l: "заявки" },
  { id: "req2", e: "mkt", l: "заявки" },
];
const positions = [{ id: "sales", name: "менеджер" }];
const model = { entities, traits, positions };
const LINE = "Пользователи, менеджер, берёт: Рынок услуг, спрос 2, отдаёт: Пользователи, заявки";

describe("разбор строки", () => {
  it("слова через запятую: актив, должность, «берёт:» пары откуда/что, «отдаёт:» пары куда/что", () => {
    const s = parseLine(LINE, model);
    expect(s.error).toBeNull();
    expect(s.asset).toMatchObject({ name: "Пользователи", id: "usr", span: { start: 0, end: 12 } });
    expect(s.role).toMatchObject({ name: "менеджер", id: "sales" });
    expect(s.takes).toMatchObject([{ asset: { name: "Рынок услуг", id: "mkt" },
      trait: { name: "спрос", id: "dem" }, qty: 2 }]);
    expect(s.gives).toMatchObject([{ asset: { name: "Пользователи", id: "usr" },
      trait: { name: "заявки", id: "req" }, qty: 1 }]);
  });

  it("должность можно пропустить; «даёт», «выдаёт» и метка без двоеточия читаются так же; десятичная через запятую", () => {
    const s = parseLine("пользователи, берёт рынок услуг, СПРОС 1,5, выдаёт пользователи, заявки", model);
    expect(s.error).toBeNull();
    expect(s.role).toBeNull();
    expect(s.takes[0].qty).toBe(1.5);
    expect(s.takes[0].trait.id).toBe("dem");
    expect(s.gives[0].trait.id).toBe("req");
  });

  it("одноимённый ресурс берётся из актива пары, а не откуда попало", () => {
    const s = parseLine("Пользователи, берёт: Рынок услуг, заявки", model);
    expect(s.takes[0].trait.id).toBe("req2");
    // В названном активе такого ресурса нет — это неизвестное, а не чужой.
    const t = parseLine("Пользователи, берёт: Рынок услуг, коробки", model);
    expect(t.takes[0].trait.id).toBeNull();
  });

  it("ненайденное остаётся без id, а не ошибкой: так процесс и придумывают", () => {
    const s = parseLine("Склад, кладовщик, берёт: Пользователи, заявки, отдаёт: Склад, коробки", model);
    expect(s.error).toBeNull();
    expect(s.asset).toMatchObject({ name: "Склад", id: null });
    expect(s.role).toMatchObject({ name: "кладовщик", id: null });
    expect(s.gives[0]).toMatchObject({ asset: { name: "Склад", id: null },
      trait: { name: "коробки", id: null }, qty: 1 });
  });

  it("ошибки строения — словами и с номером строки; пустые строки пропускаются", () => {
    expect(parseLine("", model).error).toBe("не назван актив");
    expect(parseLine("Пользователи, менеджер", model).error).toBe("не сказано, что берёт и что отдаёт");
    expect(parseLine("Пользователи, менеджер, Рынок услуг, спрос", model).error)
      .toMatch(/ждут «берёт:» или «отдаёт:»/);
    expect(parseLine("Пользователи, берёт: Рынок услуг", model).error)
      .toBe("у «Рынок услуг» не назван ресурс");
    const { steps, errors } = parseProcess(`${LINE}\n\nоднослово\n`, model);
    expect(steps.map((s) => s.line)).toEqual([1, 3]);
    expect(errors).toEqual([{ line: 3, message: "не сказано, что берёт и что отдаёт" }]);
  });

  it("слова строки с положением; каноническая запись — та, которой заменяют строку", () => {
    expect(tokenize("а, б,в").map((t) => [t.text, t.start])).toEqual([["а", 0], ["б", 3], ["в", 5]]);
    expect(tokenize("спрос 1,5").map((t) => t.text)).toEqual(["спрос 1,5"]);
    expect(formatStep(parseLine("пользователи , менеджер,берёт рынок услуг, спрос 2, отдаёт пользователи, заявки", model)))
      .toBe("пользователи, менеджер, берёт: рынок услуг, спрос 2, отдаёт: пользователи, заявки");
    expect(nameKey("  Заявки ")).toBe(nameKey("заЯвки"));
    expect(nameKey("Ёлка")).toBe("елка");
  });
});

describe("подсказки у курсора", () => {
  const at = (text, pos = text.length) => hintAt(text, pos);

  it("по порядку слов: актив → должность → метка → откуда → что → куда → что", () => {
    expect(at("").kind).toBe("asset");
    expect(at("Поль")).toMatchObject({ kind: "asset", query: "Поль", start: 0 });
    expect(at("Пользователи, ")).toMatchObject({ kind: "role", query: "" });
    expect(at("Пользователи, менеджер, ").kind).toBe("mark");
    expect(at("Пользователи, менеджер, берёт: ")).toMatchObject({ kind: "fromAsset" });
    expect(at("Пользователи, менеджер, берёт: Рынок услуг, сп"))
      .toMatchObject({ kind: "trait", query: "сп", assetName: "Рынок услуг" });
    expect(at("Пользователи, менеджер, берёт: Рынок услуг, спрос 2, ")).toMatchObject({ kind: "fromAsset" });
    expect(at("Пользователи, менеджер, берёт: Рынок услуг, спрос 2, отдаёт: ")).toMatchObject({ kind: "toAsset" });
    expect(at("Пользователи, берёт: Рынок услуг, спрос, отдаёт: Пользователи, ")).toMatchObject({ kind: "trait", assetName: "Пользователи" });
    // Курсор на второй строке — по её словам, а не по первой.
    expect(at(`${LINE}\nСклад, `).kind).toBe("role");
  });

  it("имена под подсказку — по месту: активы, должности с метками, ресурсы актива пары; заведённое — первым", () => {
    const names = (h, proc) => suggestNames(h, model, proc).map((x) => x.name);
    expect(names(at("Поль"))).toEqual(["Пользователи"]);
    expect(names(at("Пользователи, "))).toEqual(["берёт:", "отдаёт:", "менеджер"]);
    expect(names(at("Пользователи, менеджер, берёт: "))).toEqual(["отдаёт:", "Пользователи", "Рынок услуг"]);
    expect(names(at("Пользователи, берёт: Рынок услуг, "))).toEqual(["спрос", "заявки"]);
    expect(names(at("Пользователи, берёт: Рынок услуг, за"))).toEqual(["заявки"]);
    // Вхождение — после начала: «нок» найдёт «Рынок услуг».
    expect(names(at("нок"))).toEqual(["Рынок услуг"]);
    const proc = { hypo: { entities: ["mkt"], traits: [], roles: [] } };
    expect(names(at(""), proc)).toEqual(["Рынок услуг", "Пользователи"]);
  });
});

describe("память записи о найденных id", () => {
  const proc = () => ({ ...newProc(), id: "pr1", text: LINE, steps: parseProcess(LINE, model).steps });

  it("переименованный на схеме актив и ресурс остаются своими: id из прежнего разбора", () => {
    const renamed = { ...model, entities: [{ id: "usr", name: "Клиенты" }, entities[1]],
      traits: traits.map((t) => (t.id === "req" ? { ...t, l: "обращения" } : t)) };
    const { steps } = resolveProc(proc(), renamed);
    expect(steps[0].asset.id).toBe("usr");
    expect(steps[0].gives[0].trait.id).toBe("req");
    expect(stateOf(steps[0].asset, "asset", renamed, proc())).toBe("ok");
  });

  it("удалённый со схемы — «удалён», а не «никогда не был»; принять нельзя, пока не заменён", () => {
    const gone = { ...model, traits: traits.filter((t) => t.id !== "dem") };
    const p = proc();
    const { steps } = resolveProc(p, gone);
    expect(stateOf(steps[0].takes[0].trait, "trait", gone, p)).toBe("deleted");
    expect(procIssues(p, gone)).toEqual(["сначала поставьте замену: спрос"]);
    expect(canAcceptProc(p, model)).toBe(true);
  });

  it("неизвестное и отклонённое различаются, и оба не дают принять; должность — тоже слово", () => {
    const p = { ...newProc(), id: "pr2", text: "Склад, кладовщик, берёт: Рынок услуг, спрос" };
    expect(procIssues(p, model)).toEqual(["сначала примите или отклоните: Склад, кладовщик"]);
    const rejected = { ...p, missing: { rejected: ["склад"] } };
    const s = resolveProc(rejected, model).steps[0];
    expect(stateOf(s.asset, "asset", model, rejected)).toBe("rejected");
    expect(stateOf(s.role, "role", model, rejected)).toBe("unknown");
    expect(procIssues(rejected, model)).toEqual([
      "сначала примите или отклоните: кладовщик",
      "отклонено — исправьте или удалите строку: Склад"]);
  });

  it("замена имени переписывает строку в каноническом виде и только в её роли", () => {
    const text = `${LINE}\nСклад, берёт: Пользователи, заявки`;
    expect(replaceName(text, "asset", "Склад", "Рынок услуг").split("\n")[1])
      .toBe("Рынок услуг, берёт: Пользователи, заявки");
    expect(replaceName(text, "trait", "заявки", "обращения").split("\n")[0])
      .toBe("Пользователи, менеджер, берёт: Рынок услуг, спрос 2, отдаёт: Пользователи, обращения");
    // Первая строка не тронута, если имя в ней не стояло в этой роли.
    expect(replaceName(text, "role", "кладовщик", "менеджер")).toBe(text);
  });

  it("прежняя запись без новых полей читается как «не принято»; имя — своё или первая строка", () => {
    const p = normalizeProc({ id: "x", text: LINE });
    expect(p.status).toBe("off");
    expect(p.hypo).toEqual({ entities: [], traits: [], roles: [] });
    expect(procLabel(p)).toBe(LINE);
    expect(procLabel({ ...p, name: "Продажи" })).toBe("Продажи");
    expect(procLabel({ text: "" })).toBe("процесс");
    expect(procUsesAsset(proc(), "mkt")).toBe(true);
    expect(procUsesAsset(proc(), "zzz")).toBe(false);
  });
});

describe("функции из шагов", () => {
  const proc = (over = {}) => ({ ...newProc(), id: "pr1", text: LINE, status: "hypo", ...over });

  it("по функции на строку, в активе строки, с точным числом и должностью исполнителя", () => {
    const fs = procFuncs(proc(), model);
    expect(fs).toHaveLength(1);
    expect(fs[0]).toMatchObject({ id: "pr1_1", e: "usr", proc: "pr1", accepted: true,
      takes: [{ trait: "dem", lo: 2, hi: 2 }], gives: [{ trait: "req", lo: 1, hi: 1 }],
      posts: { owners: ["sales"] } });
    expect(fs[0].name).toMatch(/^процесс: /);
    expect(procFuncs(proc({ text: "Пользователи, берёт: Рынок услуг, спрос" }), model)[0].posts).toBeUndefined();
  });

  it("не принятый процесс и строка с неизвестным функций не дают", () => {
    expect(procFuncs(proc({ status: "off" }), model)).toEqual([]);
    expect(procFuncs(proc({ text: `${LINE}\nСклад, берёт: Рынок услуг, спрос` }), model).map((f) => f.id))
      .toEqual(["pr1_1"]);
  });

  it("пересборка: чужие функции не трогаются, свои — заново; положение и роли из карточки живут", () => {
    const own = normalizeFunc({ id: "f1", e: "usr", name: "своя" });
    const stale = normalizeFunc({ id: "pr1_1", e: "usr", proc: "pr1", name: "старая", x: 7,
      posts: { setters: ["boss"], owners: ["old"] } });
    const gone = normalizeFunc({ id: "pr1_9", e: "usr", proc: "pr1", name: "снятая" });
    const out = syncProcFuncs([own, stale, gone], [proc({ status: "on" })], model, normalizeFunc);
    expect(out.map((f) => f.id)).toEqual(["f1", "pr1_1"]);
    expect(out[1].x).toBe(7);
    expect(out[1].posts.setters).toEqual(["boss"]);
    expect(out[1].posts.owners).toEqual(["sales"]);
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
    expect(d.entities.map((e) => e.id)).toContain("wh");
    expect(d.proc.hypo).toEqual({ entities: ["wh"], traits: ["shared"], roles: ["sales"] });
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

describe("операции в количестве и красные метки (владелец, 2026-09-15)", () => {
  const stocked = { ...model, traits: traits.map((t) => ({ ...t, have: t.id === "dem" ? 50 : 0 })) };
  it("количество — операцией: «20% @спрос» считается по остатку, выражение остаётся у порта и в строке", () => {
    const s = parseLine("Пользователи, берёт: Рынок услуг, спрос 20% @спрос, отдаёт: Пользователи, заявки 2*3", stocked);
    expect(s.error).toBeNull();
    expect(s.takes[0].trait).toMatchObject({ name: "спрос", id: "dem" });
    expect(s.takes[0].qty).toBe(10);
    expect(s.takes[0].expr).toBe("20% @спрос");
    expect(s.gives[0].qty).toBe(6);
    expect(formatStep(s)).toBe("Пользователи, берёт: Рынок услуг, спрос 20% @спрос, отдаёт: Пользователи, заявки 2*3");
    // Ресурс в операции не найден — имя не портится, а ошибка названа.
    const bad = parseLine("Пользователи, берёт: Рынок услуг, спрос 20% @нет, отдаёт: Пользователи, заявки", stocked);
    expect(bad.takes[0].trait.name).toBe("спрос");
    expect(bad.takes[0].exprError).toBeTruthy();
  });
  it("метки: где в строке стоят ненайденные имена и что пропущено", () => {
    const text = "Пользователи, берёт: Рынок услуг, спрос, отдаёт: Склад, коробки\nСклад, берёт: Пользователи";
    const m = marksOf(text, model, newProc());
    expect(m[0].marks.map((k) => [k.name, k.state, k.start, k.end]))
      .toEqual([["Склад", "unknown", 49, 54], ["коробки", "unknown", 56, 63]]);
    expect(m[0].error).toBe("");
    expect(m[1].marks.map((k) => k.name)).toEqual(["Склад"]);
    expect(m[1].error).toMatch(/не назван ресурс/);
    // Отклонённое — своя метка; найденное по памяти записи — без метки.
    const proc = { ...newProc(), missing: { rejected: ["Склад"] } };
    expect(marksOf(text, model, proc)[0].marks[0].state).toBe("rejected");
  });
});

describe("буквы ресурсов в строке (владелец, 2026-09-15)", () => {
  const ents = [...entities, { id: "cust", name: "Заказчик" }, { id: "prt", name: "Партнёр" }, { id: "me", name: "Я" }];
  const trs = [...traits, { id: "pay1", e: "cust", l: "оплата", have: 0 }, { id: "pay2", e: "me", l: "оплата" },
    { id: "req3", e: "me", l: "заявки" }];
  const m = { entities: ents, traits: trs, positions };
  const L = "Партнёр, берёт: Заказчик, оплата 1000, отдаёт: Я, оплата 45-55% A, Я, заявки 2-4";

  it("ресурсы строки получают буквы по порядку; «45-55% A» — доля первого, диапазон — от и до", () => {
    const s = parseLine(L, m);
    expect(s.error).toBeNull();
    expect(s.takes[0]).toMatchObject({ letter: "A", trait: { name: "оплата", id: "pay1" }, qty: 1000 });
    expect(s.gives[0]).toMatchObject({ letter: "B", trait: { name: "оплата", id: "pay2" }, qty: 450, qtyHi: 550, expr: "45-55% A" });
    expect(s.gives[1]).toMatchObject({ letter: "C", trait: { name: "заявки", id: "req3" }, qty: 2, qtyHi: 4, expr: "2-4" });
    expect(formatStep(s)).toBe(L);
    // Строчная буква читается как заглавная; буквы, которой нет, — ошибка словами.
    expect(parseLine("Партнёр, берёт: Заказчик, оплата 1000, отдаёт: Я, оплата 50% a", m).gives[0].qty).toBe(500);
    // Буква — любой ресурс строки, хоть позже: «B» здесь — «оплата» у «Я» (1 → 0,5).
    expect(parseLine("Партнёр, берёт: Заказчик, оплата 50% B, отдаёт: Я, оплата", m).takes[0].qty).toBe(0.5);
    const bad = parseLine("Партнёр, берёт: Заказчик, оплата 50% C, отдаёт: Я, оплата", m);
    expect(bad.takes[0].exprError).toMatch(/нет ресурса с буквой «C»/);
    expect(marksOf("Партнёр, берёт: Заказчик, оплата 50% C, отдаёт: Я, оплата", m, newProc())[0].marks[0])
      .toMatchObject({ state: "expr", name: expect.stringMatching(/«C»/) });
    // Кириллическая буква — не ссылка, а часть имени.
    expect(parseLine("Партнёр, берёт: Заказчик, оплата 1000, отдаёт: Я, оплата б", m).gives[0].trait.name).toBe("оплата б");
  });

  it("одна буква, которой в строке ещё нет, — часть имени ресурса, а не операция", () => {
    const s = parseLine("Партнёр, берёт: Заказчик, оплата B, отдаёт: Я, оплата", m);
    expect(s.takes[0].trait.name).toBe("оплата B");
    expect(s.takes[0].expr).toBeUndefined();
  });

  it("функция из строки: буквы — идентификаторами портов, вилка — в lo/hi", () => {
    const proc = { ...newProc(), id: "pr9", text: L, status: "on" };
    const f = procFuncs(proc, m)[0];
    expect(f.takes[0]).toMatchObject({ id: "p_pr9_1_t0", lo: 1000, hi: 1000 });
    expect(f.takes[0].expr).toBeUndefined();
    expect(f.gives[0]).toMatchObject({ lo: 450, hi: 550, expr: "45-55% #{p_pr9_1_t0}" });
    expect(f.gives[1]).toMatchObject({ lo: 2, hi: 4, expr: "2-4" });
  });

  it("подсказка «сколько»: после имени ресурса и пробела — буквы строки и знаки; после «@» — ресурсы схемы", () => {
    const at = (t) => hintAt(t, t.length, m);
    const names = (h) => suggestNames(h, m, newProc()).map((x) => x.name);
    const h1 = at("Партнёр, берёт: Заказчик, оплата ");
    expect(h1).toMatchObject({ kind: "qty", query: "", traitName: "оплата", assetName: "Заказчик" });
    expect(names(h1)).toEqual(["%", "@", "-", "*", "/", "+", "(", ")", "→"]);   // ресурсов раньше нет — букв нет; «→» — дальше
    const h2 = at("Партнёр, берёт: Заказчик, оплата 1000, отдаёт: Я, оплата 50% ");
    expect(h2).toMatchObject({ kind: "qty", query: "", traitName: "оплата" });
    expect(names(h2)[0]).toBe("A");
    expect(suggestNames(h2, m, newProc())[0]).toMatchObject({ kind: "буква", note: "оплата (Заказчик)", suffix: "" });
    // Подставляется слово у курсора, не весь хвост: «50% » остаётся.
    expect(h2.start).toBe("Партнёр, берёт: Заказчик, оплата 1000, отдаёт: Я, оплата 50% ".length);
    const h3 = at("Партнёр, берёт: Заказчик, оплата 1000, отдаёт: Я, оплата 50% @сп");
    expect(h3).toMatchObject({ kind: "qty", query: "@сп" });
    expect(names(h3)).toEqual(["@спрос"]);
    // Незнакомое имя с хвостом-операцией — тоже «сколько»; имя без хвоста — по-прежнему «что».
    expect(at("Партнёр, берёт: Заказчик, оплата 1000, отдаёт: Я, деньги 50% A")).toMatchObject({ kind: "qty", traitName: "деньги", query: "A" });
    expect(at("Партнёр, берёт: Заказчик, опл").kind).toBe("trait");
    // Новое имя (его нет на схеме) и пробел — тоже «сколько»: процесс пишут новыми именами.
    const h4 = at("Партнёр, берёт: Заказчик, аванс ");
    expect(h4).toMatchObject({ kind: "qty", query: "", traitName: "аванс" });
    expect(names(h4)).toContain("%");
    // Недописанное имя остаётся в списке и подставляется целиком, с самого имени.
    const h5 = at("Партнёр, берёт: Рынок услуг, заявки ");
    expect(suggestNames({ ...h5, prior: [] }, { ...m, traits: [...trs, { id: "rw", e: "mkt", l: "заявки в работе" }] }, newProc())
      .find((x) => x.whole)).toMatchObject({ name: "заявки в работе" });
    expect(h5.nameStart).toBe("Партнёр, берёт: Рынок услуг, ".length);
    expect(at("Партнёр, берёт: Заказчик, оплата 1000, отдаёт: Я, заявки в").kind).toBe("trait");
  });
});

describe("шаг из нескольких строк и раскраска поля (владелец, 2026-09-16)", () => {
  const T = "Пользователи, менеджер\nберёт: Рынок услуг, спрос 1000\nотдаёт: Пользователи, заявки 45-55% A\n\nСклад, берёт: Пользователи, заявки 2";

  it("строка с «берёт:»/«отдаёт:» продолжает шаг предыдущей строки; пустая строка шаг закрывает", () => {
    const g = stepsOf(T);
    expect(g.map((x) => [x.line, x.rows.map((r) => r.row)])).toEqual([[1, [0, 1, 2]], [5, [4]]]);
    const { steps, errors } = parseProcess(T, model);
    expect(errors).toEqual([]);
    expect(steps[0]).toMatchObject({ line: 1, asset: { id: "usr" }, role: { id: "sales" } });
    expect(steps[0].takes[0]).toMatchObject({ trait: { name: "спрос" }, qty: 1000, letter: "A" });
    expect(steps[0].gives[0]).toMatchObject({ trait: { name: "заявки" }, qty: 450, qtyHi: 550, letter: "B" });
    expect(steps[1]).toMatchObject({ line: 5, asset: { name: "Склад", id: null } });
    // Ошибка строения — у первой строки шага.
    expect(parseProcess("Пользователи\nберёт: Рынок услуг", model).errors).toEqual([{ line: 1, message: "у «Рынок услуг» не назван ресурс" }]);
  });

  it("раскраска — по исходным строкам: плашки слов с видом и стороной, скобки сторон, ресурс вместе с количеством", () => {
    const rows = T.split("\n");
    const paint = paintOf(T, model, newProc());
    const cut = (r, k) => rows[r.row].slice(k.start + k.lead, k.end + k.lead);
    const r1 = paint.find((r) => r.row === 1);
    expect(r1.spans.map((k) => [k.kind, cut(r1, k), k.side])).toEqual([
      ["mark", "берёт:", "take"], ["asset", "Рынок услуг", "take"], ["trait", "спрос 1000", "take"]]);
    expect(r1.brackets.map((b) => [b.side, cut(r1, b)])).toEqual([["take", "Рынок услуг, спрос 1000"]]);
    const r2 = paint.find((r) => r.row === 2);
    expect(r2.spans.find((k) => k.kind === "trait")).toMatchObject({ letter: "B", state: "ok" });
    expect(cut(r2, r2.brackets[0])).toBe("Пользователи, заявки 45-55% A");
    const r0 = paint.find((r) => r.row === 0);
    expect(r0.spans.map((k) => [k.kind, k.state])).toEqual([["asset", "ok"], ["role", "ok"]]);
    expect(paint.find((r) => r.row === 4).spans[0]).toMatchObject({ kind: "asset", state: "unknown", name: "Склад" });
  });

  it("подсказка на строке-продолжении знает буквы ресурсов из строк выше", () => {
    const at = T.indexOf("45-55% A") + "45-55% ".length;
    const h = hintAt(T, at, model);
    expect(h).toMatchObject({ kind: "qty", query: "" });
    expect(h.prior.map((p) => [p.letter, p.name])).toEqual([["A", "спрос"]]);
    expect(hintAt("Пользователи\nберёт: ", "Пользователи\nберёт: ".length, model).kind).toBe("fromAsset");
    // Пробел после метки не съедается подстановкой: начало — после него.
    expect(hintAt("Пользователи, берёт: ", "Пользователи, берёт: ".length, model).start).toBe("Пользователи, берёт: ".length);
  });

  it("замена имени меняет слово на месте — строки по смыслу остаются", () => {
    expect(replaceName(T, "trait", "заявки", "обращения")).toBe(T.replace(/заявки/g, "обращения"));
    expect(replaceName(T, "asset", "Пользователи", "Клиенты").split("\n")[2]).toBe("отдаёт: Клиенты, обращения 45-55% A".replace("обращения", "заявки"));
  });
});

describe("splitQty: знак «=» и недописанная операция (владелец, 2026-09-18)", () => {
  it("«=3» — ровно 3; «=50% A» — операция; «5 +» — операция с ошибкой, имя целое", () => {
    expect(splitQty("заявки =3")).toEqual({ name: "заявки", qty: 3 });
    expect(splitQty("заявки =50% A", [], 1)).toEqual({ name: "заявки", qty: 1, expr: "=50% A" });
    expect(splitQty("заявки 5 +")).toEqual({ name: "заявки", qty: 1, expr: "5 +" });
    expect(splitQty("заявки =")).toEqual({ name: "заявки", qty: 1, expr: "=" });
  });
});
