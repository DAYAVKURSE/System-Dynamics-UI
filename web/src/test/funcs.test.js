import { describe, expect, it } from "vitest";
import { DUR_UNITS, avgOf, byCrew, countWorkers, crewOf, everyOf, everyText,
  fromHours, hoursOf,
  newFunc, newGive,
  newPort, normalizeFunc, normalizeFuncs, okRange, pruneWorkers, rangeText,
  runHours, runQty, workersOf } from "../lib/funcs.js";

/* Функция — то, что преобразует ресурсы актива: берёт одни, выдаёт другие,
   и на это уходит время. Здесь проверяется её запись, диапазоны, среднее по
   фактическим выполнениям и работа со временем: из неё считаются и сроки
   задач, и то, сколько выполнений помещается в шаг прогноза. */

describe("запись функции", () => {
  it("новая функция принадлежит активу и пуста, но не сломана", () => {
    const f = newFunc("usr", "вёрстка");
    expect(f.e).toBe("usr");
    expect(f.name).toBe("вёрстка");
    expect(f.takes).toEqual([]);
    expect(f.gives).toEqual([]);
    expect(f.id).toBeTruthy();
  });

  it("время, исполнители и проверяющие — у функции, а не у каждого выхода", () => {
    // Выполнение либо случилось целиком, либо нет: раздавать разным
    // выходам разные сроки и разных людей не за что.
    const f = newFunc("usr");
    expect(f.dur).toBeGreaterThan(0);
    expect(DUR_UNITS[f.durUnit]).toBeTruthy();
    expect(f.owners).toEqual([]);
    expect(f.reviewers).toEqual([]);
  });

  it("у двух функций и двух портов подряд разные id — иначе один затрёт другого", () => {
    expect(newFunc("usr").id).not.toBe(newFunc("usr").id);
    expect(newPort().id).not.toBe(newPort().id);
  });

  it("новый вход заводится вилкой 1..1, а не нулём", () => {
    // Ноль означал бы «ресурс в рецепте есть, но не расходуется» — не то,
    // что человек имел в виду, нажимая «+ берёт».
    expect(newPort("t1")).toMatchObject({ trait: "t1", lo: 1, hi: 1 });
  });
});

describe("чужая запись достраивается, а не роняет редактор", () => {
  it("функция без списков получает пустые", () => {
    const f = normalizeFunc({ id: "f1", e: "usr" });
    expect(f.takes).toEqual([]);
    expect(f.gives).toEqual([]);
    expect(f.name).toBe("");
  });

  it("отсутствующий список функций — это пусто, а не падение", () => {
    expect(normalizeFuncs(undefined)).toEqual([]);
    expect(normalizeFuncs(null)).toEqual([]);
    expect(normalizeFuncs([{ id: "f1", e: "usr" }])).toHaveLength(1);
  });

  it("выдуманная единица времени заменяется на понятную", () => {
    expect(DUR_UNITS[normalizeFunc({ dur: 2, durUnit: "парсек" }).durUnit]).toBeTruthy();
  });
});

describe("прежние записи не переносятся", () => {
  /* Владелец сказал прямо: модели, собранные под прежний расчёт, работать не
     должны. Молчаливый перенос был бы хуже отказа — получилась бы модель,
     которую никто не собирал. */
  const old = {
    id: "f1", e: "usr", name: "вёрстка",
    takes: [{ trait: "t1", qty: 3 }],
    gives: [{ id: "g1", trait: "t2", qty: 5, dur: 1, durUnit: "дн", owners: ["p1"] }],
  };

  it("qty не становится вилкой: чего в нынешней записи нет, то и не читается", () => {
    const f = normalizeFunc(old);
    expect(f.takes[0]).toMatchObject({ trait: "t1", lo: 0, hi: 0 });
    expect(f.gives[0]).toMatchObject({ trait: "t2", lo: 0, hi: 0 });
  });

  it("срок и люди с выходов на функцию не поднимаются", () => {
    const f = normalizeFunc(old);
    expect(f.dur).toBe(0);
    expect(f.owners).toEqual([]);
  });

  it("но чужая запись всё равно достраивается, а не роняет редактор", () => {
    // Отказ работать — это пустые поля и красная подпись, а не белый экран.
    const f = normalizeFunc(old);
    expect(DUR_UNITS[f.durUnit]).toBeTruthy();
    expect(DUR_UNITS[f.everyUnit]).toBeTruthy();
  });

  it("получатель с выхода не читается — его называет сам ресурс", () => {
    // Поле «передаёт в» спрашивало то, что уже сказано выбором ресурса, и
    // могло с ним разойтись. Оставить его в записи значило бы хранить
    // вторую версию одного и того же.
    const f = normalizeFunc({ gives: [{ trait: "t2", lo: 1, hi: 1, to: "B" }] });
    expect(f.gives[0]).not.toHaveProperty("to");
    expect(newGive("t2", 1, 2)).toMatchObject({ trait: "t2", lo: 1, hi: 2 });
    expect(newGive("t2", 1, 2)).not.toHaveProperty("to");
  });
});

describe("следующая попытка", () => {
  it("пусто значит «сразу» — следующая попытка сразу за предыдущей", () => {
    expect(everyOf(newFunc("usr"))).toBe(0);
    expect(everyText(newFunc("usr"))).toBe("сразу");
  });

  it("задаётся отдельно от длительности: час работы раз в месяц — это законно", () => {
    // Одно другого не заменяет: работа может занимать час, а следующая
    // попытка случаться через месяц, и наоборот.
    const f = normalizeFunc({ dur: 1, durUnit: "ч", every: 1, everyUnit: "мес" });
    expect(hoursOf(f)).toBe(1);
    expect(everyOf(f)).toBe(730);
    expect(everyText(f)).toBe("через 1 мес");
  });

  it("тоже вилка: «через 1–2 нед» — это не одно число", () => {
    const f = normalizeFunc({ every: 1, everyHi: 2, everyUnit: "нед" });
    expect(everyText(f)).toBe("через 1–2 нед");
    // Щедрой оценке достаётся частая попытка, осторожной — редкая.
    expect(everyOf(f, "hi")).toBe(168);
    expect(everyOf(f, "lo")).toBe(336);
  });
});

describe("вилка по-человечески", () => {
  it("читается словами, а не парой чисел", () => {
    expect(rangeText({ lo: 3, hi: 5 })).toBe("от 3 до 5");
    expect(rangeText({ lo: 4, hi: 4 })).toBe("ровно 4");
    expect(rangeText({ lo: 3, hi: 0 })).toBe("от 3");
    expect(rangeText({ lo: 0, hi: 5 })).toBe("до 5");
    // Незаданное — так и сказано: ноль здесь означал бы «ничего не будет».
    expect(rangeText({ lo: 0, hi: 0 })).toBe("сколько — не задано");
    expect(rangeText(null)).toBe("сколько — не задано");
  });

  it("перевёрнутая и пустая вилки не годны", () => {
    // «От 5 до 3» молча считалось бы как попало, а человек был бы уверен,
    // что задал границы.
    expect(okRange({ lo: 3, hi: 5 })).toBe(true);
    expect(okRange({ lo: 5, hi: 3 })).toBe(false);
    expect(okRange({ lo: 0, hi: 0 })).toBe(false);
  });
});

describe("время", () => {
  it("длительность приводится к часам — общей мере", () => {
    expect(hoursOf({ dur: 2, durUnit: "ч" })).toBe(2);
    expect(hoursOf({ dur: 1, durUnit: "дн" })).toBe(24);
    expect(hoursOf({ dur: 2, durUnit: "нед" })).toBe(336);
    expect(hoursOf({})).toBe(0);
  });

  it("обратно — в удобных единицах, а не в 36 часах", () => {
    expect(fromHours(36)).toEqual({ dur: 1.5, durUnit: "дн" });
    expect(fromHours(3)).toEqual({ dur: 3, durUnit: "ч" });
    expect(fromHours(0)).toEqual({ dur: 0, durUnit: "ч" });
  });
});

describe("факт: среднее арифметическое по выполнениям", () => {
  const runs = [
    { hours: 24, takes: { t1: 3 }, gives: { t2: 5 } },
    { hours: 48, takes: { t1: 5 }, gives: { t2: 9 } },
  ];

  it("среднее берётся только по состоявшимся", () => {
    // Незакрытое выполнение ничего не измеряет, а взятое в расчёт занижало
    // бы среднее ровно тогда, когда работа идёт.
    expect(avgOf([24, 48])).toBe(36);
    expect(avgOf([24, 0, 48])).toBe(36);
    expect(avgOf([])).toBeNull();
    expect(avgOf([0])).toBeNull();
  });

  it("по выполнениям видно и среднее время, и среднее количество", () => {
    expect(runHours(runs)).toBe(36);
    expect(runQty(runs, "takes", "t1")).toBe(4);
    expect(runQty(runs, "gives", "t2")).toBe(7);
  });

  it("пока выполнений нет — факта нет, и выдавать за него план нельзя", () => {
    expect(runHours([])).toBeNull();
    expect(runQty([], "gives", "t2")).toBeNull();
    expect(runQty(runs, "gives", "нет-такого")).toBeNull();
  });
});

describe("воркеры актива", () => {
  it("принадлежат активу, а не функции; и их три вида", () => {
    // У актива есть постановщики, исполнители и проверяющие — это его
    // воркеры. Функции выполняют они же, поэтому список один и лежит на
    // активе.
    const entities = [{ id: "A", setters: ["p0"], owners: ["p1", "p2"], reviewers: ["p9"] },
      { id: "B", owners: ["p7"] }];
    // Рядом с ролями — порядок людей актива: он тоже свойство актива, и
    // собирать его отдельно значило бы держать ответ в двух местах.
    expect(workersOf(entities, "A"))
      .toEqual({ crew: [], setters: ["p0"], owners: ["p1", "p2"], reviewers: ["p9"] });
    expect(workersOf(entities, "B"))
      .toEqual({ crew: [], setters: [], owners: ["p7"], reviewers: [] });
    expect(workersOf(entities, "нет-такого"))
      .toEqual({ crew: [], setters: [], owners: [], reviewers: [] });
  });

  it("считаются люди, а не назначения: один человек — один воркер", () => {
    /* В маленькой команде один человек и ставит, и делает, и проверяет.
       Складывать длины трёх списков значило бы написать «3 воркера» там,
       где работает один. */
    expect(countWorkers({ setters: ["p1"], owners: ["p1"], reviewers: ["p1"] })).toBe(1);
    expect(countWorkers({ setters: ["p1"], owners: ["p2"], reviewers: ["p1", "p3"] })).toBe(3);
    expect(countWorkers({ owners: ["p1"] })).toBe(1);
    expect(countWorkers({})).toBe(0);
    // Число и строка «7» — один и тот же человек: списки приходят и из
    // сервера, и из браузера, и типы там не совпадают.
    expect(countWorkers({ setters: [7], owners: ["7"] })).toBe(1);
  });

  it("человек, переставший быть воркером, уходит и с функций актива", () => {
    // Иначе задача висела бы на том, кого в активе уже нет.
    const funcs = [{ id: "f1", e: "A", owners: ["p1", "p2"], reviewers: ["p9"] },
      { id: "f2", e: "B", owners: ["p1"], reviewers: [] }];
    const out = pruneWorkers(funcs, "A", { setters: [], owners: ["p1"], reviewers: [] });
    expect(out[0]).toMatchObject({ owners: ["p1"], reviewers: [] });
    // Чужой актив не трогаем: там свои воркеры.
    expect(out[1].owners).toEqual(["p1"]);
  });
});

/* ЛЮДИ АКТИВА ОДНИМ СПИСКОМ.

   Роли отвечают на вопрос «кто чем занят», а список людей — на другой:
   «кто это вообще». Порядок в нём задаёт человек, и в этом же порядке
   людей предлагают потом в формах выбора. */
describe("порядок людей актива", () => {
  const W = { setters: ["b"], owners: ["a", "b"], reviewers: ["c"] };

  it("человек в списке один раз, сколько бы ролей он ни занимал", () => {
    expect(crewOf(W)).toEqual(["b", "a", "c"]);
    expect(crewOf(W)).toHaveLength(countWorkers(W));
  });

  it("заданный порядок идёт первым, новые люди — следом", () => {
    expect(crewOf({ ...W, crew: ["c", "a"] })).toEqual(["c", "a", "b"]);
  });

  it("порядок — это только порядок: членство решают роли", () => {
    // Иначе удаление из ролей пришлось бы повторять во втором списке, и
    // рано или поздно они разошлись бы.
    expect(crewOf({ ...W, crew: ["ушёл", "a"] })).toEqual(["a", "b", "c"]);
  });

  it("тем же порядком выстраиваются люди в формах выбора", () => {
    const people = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(byCrew({ ...W, crew: ["c", "b", "a"] }, people).map((p) => p.id))
      .toEqual(["c", "b", "a"]);
    // Кого в активе нет вовсе — в конец: выдумывать ему место не из чего.
    expect(byCrew({ ...W, crew: ["c"] }, [{ id: "нет" }, { id: "c" }]).map((p) => p.id))
      .toEqual(["c", "нет"]);
  });
});
