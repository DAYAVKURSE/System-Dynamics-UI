import { describe, expect, it } from "vitest";
import { canAcceptProc, dropHypo, formatStep, hintAt, nameKey, newProc, normalizeProc,
  parseLine, parseProcess, procFuncs, procIssues, procLabel, procUsesAsset, replaceName,
  resolveProc, stateOf, suggestNames, syncProcFuncs, tokenize } from "../lib/process.js";
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
    expect(s.asset).toEqual({ name: "Пользователи", id: "usr" });
    expect(s.role).toEqual({ name: "менеджер", id: "sales" });
    expect(s.takes).toEqual([{ asset: { name: "Рынок услуг", id: "mkt" },
      trait: { name: "спрос", id: "dem" }, qty: 2 }]);
    expect(s.gives).toEqual([{ asset: { name: "Пользователи", id: "usr" },
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
    expect(s.asset).toEqual({ name: "Склад", id: null });
    expect(s.role).toEqual({ name: "кладовщик", id: null });
    expect(s.gives[0]).toEqual({ asset: { name: "Склад", id: null },
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
