import { describe, expect, it } from "vitest";
import { WORK_STATUSES, avg, byRating, hasSchedule, historyOf, inTime, lastReview,
  lastSubmission, scheduleOfPerson, scheduleText, shortStat, statsOf, statusOf,
  workTime } from "../lib/workers.js";
import { WEEK } from "../lib/funcs.js";

/* История воркера — то, чего нельзя увидеть в одной задаче: как человек
   работает вообще. Здесь проверяется, что считается по фактам и молчит там,
   где фактов нет: «нет данных» — не ноль, и выдавать одно за другое значит
   клеветать на человека. */

const FUNCS = [{ id: "f1", e: "A", name: "вёрстка" },
  { id: "f2", e: "A", name: "правки" }];

// Задача-выполнение: кто делал, в какие сроки, что сдал и как приняли.
const T = (id, over = {}) => ({ id, funcId: "f1", title: id, assignee: "p1",
  start: "2026-01-01T09:00:00Z", end: "2026-01-02T09:00:00Z", status: "done",
  submissions: [{ id: `s${id}`, at: "2026-01-02T08:00:00Z", hours: 4,
    takes: { t1: 2 }, gives: { t2: 3 }, text: "готово" }],
  reviews: [{ id: `r${id}`, accept: true, mark: 5, comment: "хорошо", by: "p9" }],
  ...over });

describe("что считается выполнением", () => {
  it("задача без сдач в историю не идёт — обещание не измерение", () => {
    expect(historyOf([T("a", { submissions: [] })], FUNCS, "p1")).toHaveLength(0);
  });

  it("чужие задачи не считаются своими", () => {
    expect(historyOf([T("a", { assignee: "p2" })], FUNCS, "p1")).toHaveLength(0);
  });

  it("в строке видно и функцию, и сроки, и что сдали", () => {
    const [r] = historyOf([T("a")], FUNCS, "p1");
    expect(r).toMatchObject({ func: "вёрстка", hours: 4, mark: 5,
      comment: "хорошо", done: true, inTime: true });
    expect(r.gives).toEqual({ t2: 3 });
  });

  it("удалённая функция не роняет историю — работа-то была", () => {
    expect(historyOf([T("a", { funcId: "нет-такой" })], FUNCS, "p1")[0].func)
      .toBe("функция удалена");
  });

  it("последняя сдача и последнее решение — те, по которым судят", () => {
    expect(lastSubmission({ submissions: [{ id: "1" }, { id: "2" }] }).id).toBe("2");
    expect(lastReview({ reviews: [{ id: "1" }, { id: "2" }] }).id).toBe("2");
    expect(lastSubmission({})).toBeNull();
    expect(lastReview({})).toBeNull();
  });
});

describe("уложился ли в срок", () => {
  it("сдал раньше конца — в срок, позже — нет", () => {
    const t = { end: "2026-01-02T09:00:00Z" };
    expect(inTime(t, { at: "2026-01-02T08:00:00Z" })).toBe(true);
    expect(inTime(t, { at: "2026-01-03T08:00:00Z" })).toBe(false);
  });

  it("срока не ставили — не «уложился» и не «сорвал», а неизвестно", () => {
    // Молча засчитывать такую работу в срок нельзя: доля выросла бы на
    // пустом месте, и цифра начала бы врать.
    expect(inTime({ end: null }, { at: "2026-01-02T08:00:00Z" })).toBeNull();
    expect(inTime({ end: "2026-01-02T09:00:00Z" }, {})).toBeNull();
  });
});

describe("итог по человеку", () => {
  it("средняя оценка — по принятым работам", () => {
    const tasks = [T("a"), T("b", { reviews: [{ accept: true, mark: 3, comment: "так себе" }] })];
    const s = statsOf(tasks, FUNCS, "p1");
    expect(s.mark).toBe(4);
    expect(s.done).toBe(2);
    expect(s.hours).toBe(8);
  });

  it("возвращённая работа в средние не идёт, но видна отдельно", () => {
    // Сдача, которую не приняли, — заявление исполнителя, а не измерение.
    const tasks = [T("a"), T("b", { status: "backlog",
      reviews: [{ accept: false, mark: 2, comment: "переделать" }] })];
    const s = statsOf(tasks, FUNCS, "p1");
    expect(s.mark).toBe(5);
    expect(s.done).toBe(1);
    expect(s.returned).toBe(1);
    expect(s.total).toBe(2);
  });

  it("доля «в срок» считается только по работам, где срок стоял", () => {
    const tasks = [T("a"), T("b", { end: null }),
      T("c", { submissions: [{ at: "2026-01-05T00:00:00Z", hours: 1 }] })];
    const s = statsOf(tasks, FUNCS, "p1");
    expect(s.timed).toBe(2);
    expect(s.onTime).toBe(0.5);
  });

  it("нечего считать — null, а не ноль", () => {
    const s = statsOf([], FUNCS, "p1");
    expect(s.mark).toBeNull();
    expect(s.onTime).toBeNull();
    expect(s.done).toBe(0);
    expect(avg([])).toBeNull();
  });
});

describe("порядок людей", () => {
  const mk = (id, mark, late) => ({ id: `t${id}`, funcId: "f1", assignee: id,
    status: "done", end: "2026-01-02T09:00:00Z",
    submissions: [{ at: late ? "2026-01-03T09:00:00Z" : "2026-01-01T09:00:00Z", hours: 1 }],
    reviews: [{ accept: true, mark, comment: "c" }] });

  it("сперва лучшие по оценке", () => {
    const tasks = [mk("p1", 3), mk("p2", 5), mk("p3", 4)];
    expect(byRating(tasks, FUNCS, ["p1", "p2", "p3"])).toEqual(["p2", "p3", "p1"]);
  });

  it("при равных оценках вперёд тот, кто чаще в срок", () => {
    const tasks = [mk("p1", 4, true), mk("p2", 4, false)];
    expect(byRating(tasks, FUNCS, ["p1", "p2"])).toEqual(["p2", "p1"]);
  });

  it("человек без оценок идёт после оценённых, а не считается худшим", () => {
    // О нём просто ничего не известно; ставить его ниже двойки было бы
    // выводом из пустоты.
    const tasks = [mk("p1", 2)];
    expect(byRating(tasks, FUNCS, ["p0", "p1"])).toEqual(["p1", "p0"]);
  });
});

describe("строка о человеке", () => {
  it("оценка, срок и объём — коротко", () => {
    const tasks = [T("a")];
    expect(shortStat(statsOf(tasks, FUNCS, "p1")))
      .toBe("5 · в срок 100% · 1 работа");
  });

  it("без единой оценки так и сказано", () => {
    expect(shortStat(statsOf([], FUNCS, "p1"))).toBe("без оценок · 0 работ");
  });
});

/* ─────── РАБОЧИЙ ГРАФИК И СТАТУС ───────

   Рейтинг говорит, как человек работает. Прежде него спрашивают куда более
   простое: работает ли он сейчас. */
describe("рабочий график и статус", () => {
  it("статус — один из четырёх, выдумка приводится к «готов»", () => {
    expect(WORK_STATUSES.map((s) => s.id))
      .toEqual(["ready", "break", "off", "busy"]);
    expect(statusOf("off").name).toBe("сегодня не работаю");
    expect(statusOf("выдумка").id).toBe("ready");
  });

  it("часы — «ЧЧ:ММ» или пусто: выдуманное время честнее не записывать", () => {
    expect(workTime("09:30")).toBe("09:30");
    expect(workTime("25:00")).toBe("");
    expect(workTime("9:00")).toBe("");
    expect(workTime("")).toBe("");
  });

  it("дни разбираются: только 0–6, без повторов и без выдумки", () => {
    expect(scheduleOfPerson({ days: [1, 1, 5, 9, -2, "вт"] }).days)
      .toEqual([1, 5]);
    // Пусто — это «дни не названы», а не «все семь»: у графика нет
    // разумного значения по умолчанию, и дописать семидневку за человека
    // нельзя.
    expect(scheduleOfPerson({}).days).toEqual([]);
    expect(hasSchedule(scheduleOfPerson({}))).toBe(false);
    expect(hasSchedule(scheduleOfPerson({ from: "09:00" }))).toBe(true);
  });

  it("подряд идущие дни склеиваются в отрезок, а разрозненные — нет", () => {
    const text = (p) => scheduleText(scheduleOfPerson(p), WEEK);
    expect(text({ days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" }))
      .toBe("пн–пт · 09:00–18:00");
    expect(text({ days: [1, 3, 5] })).toBe("пн, ср, пт");
    // Два дня подряд — всё ещё перечисление: «сб–вс» не короче «сб, вс».
    expect(text({ days: [6, 0] })).toBe("сб, вс");
    // Названа одна граница — так и сказано, а не додумана вторая.
    expect(text({ days: [1], from: "10:00" })).toBe("пн · с 10:00");
    expect(text({ days: [1], to: "18:00" })).toBe("пн · до 18:00");
  });
});
