import { describe, expect, it } from "vitest";
import { WORK_STATUSES, avg, byRating, commentsFor, dayHours, hasSchedule, historyOf,
  inTime, lastReview, lastSubmission, perDayOf, ratingId, scheduleOfPerson, scheduleText,
  shortStat, statsOf, statusOf, visibleStats, workTime } from "../lib/workers.js";
import { WEEK } from "../lib/funcs.js";

/* История воркера — то, чего нельзя увидеть в одной задаче: как человек
   работает вообще. Здесь проверяется, что считается по фактам и молчит там,
   где фактов нет: «нет данных» — не ноль, и выдавать одно за другое значит
   клеветать на человека.

   Оценка при этом идёт в рейтинг только ОПУБЛИКОВАННОЙ — без имени и когда
   её нельзя вычислить. Реестр опубликованного (`published`) ведёт сервер;
   здесь он задаётся руками. */

const FUNCS = [{ id: "f1", e: "A", name: "вёрстка" },
  { id: "f2", e: "A", name: "правки" }];

// Задача-выполнение: кто делал, в какие сроки, что сдал и как приняли.
const T = (id, over = {}) => ({ id, funcId: "f1", title: id, assignee: "p1",
  start: "2026-01-01T09:00:00Z", end: "2026-01-02T09:00:00Z", status: "done",
  submissions: [{ id: `s${id}`, at: "2026-01-02T08:00:00Z", hours: 4,
    takes: { t1: 2 }, gives: { t2: 3 }, text: "готово" }],
  reviews: [{ id: `r${id}`, accept: true, mark: 5, comment: "хорошо", by: "p9" }],
  ...over });
// Реестр опубликованного: все оценки проверяющего p9 по этим задачам.
const PUB = (...ids) => ({ published: ids.map((id) => ratingId(id, "work", "p9")) });

describe("что считается выполнением", () => {
  it("задача без сдач в историю не идёт — обещание не измерение", () => {
    expect(historyOf([T("a", { submissions: [] })], FUNCS, "p1")).toHaveLength(0);
  });

  it("чужие задачи не считаются своими", () => {
    expect(historyOf([T("a", { assignee: "p2" })], FUNCS, "p1")).toHaveLength(0);
  });

  it("в строке видно и функцию, и сроки, и что сдали", () => {
    const [r] = historyOf([T("a")], FUNCS, "p1", PUB("a"));
    expect(r).toMatchObject({ func: "вёрстка", hours: 4, mark: 5,
      comment: "хорошо", done: true, inTime: true, published: true });
    expect(r.gives).toEqual({ t2: 3 });
  });

  it("неопубликованная оценка в строке — не оценка, а «ждёт публикации»", () => {
    // Оценка есть, но показать её без имени пока нельзя: `mark` — null,
    // и это не «без оценки», о чём и говорит `pending`.
    const [r] = historyOf([T("a")], FUNCS, "p1");
    expect(r.mark).toBeNull();
    expect(r.pending).toBe(true);
    expect(r.published).toBe(false);
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
  it("средняя оценка — по принятым работам с опубликованной оценкой", () => {
    const tasks = [T("a"),
      T("b", { reviews: [{ accept: true, mark: 3, comment: "так себе", by: "p9" }] })];
    const s = statsOf(tasks, FUNCS, "p1", PUB("a", "b"));
    expect(s.mark).toBe(4);
    expect(s.marks).toBe(2);
    expect(s.done).toBe(2);
    expect(s.hours).toBe(8);
  });

  it("без реестра опубликованного оценок нет — и это не ноль", () => {
    /* Анонимность не может держаться на том, что интерфейс не показывает:
       непубликованная оценка для рейтинга не существует. Работы при этом
       считаются — их не прячут. */
    const tasks = [T("a"), T("b")];
    const s = statsOf(tasks, FUNCS, "p1");
    expect(s.mark).toBeNull();
    expect(s.marks).toBe(0);
    expect(s.pending).toBe(2);
    expect(s.done).toBe(2);
    // Опубликована одна — считается одна.
    expect(statsOf(tasks, FUNCS, "p1", PUB("a"))).toMatchObject({ mark: 5, marks: 1,
      pending: 1 });
  });

  it("возвращённая работа в средние не идёт, но видна отдельно", () => {
    // Сдача, которую не приняли, — заявление исполнителя, а не измерение.
    const tasks = [T("a"), T("b", { status: "backlog",
      reviews: [{ accept: false, mark: 2, comment: "переделать", by: "p9" }] })];
    const s = statsOf(tasks, FUNCS, "p1", PUB("a", "b"));
    expect(s.mark).toBe(5);
    expect(s.done).toBe(1);
    expect(s.returned).toBe(1);
    expect(s.total).toBe(2);
  });

  it("оценка постановки считается отдельно и тоже только опубликованная", () => {
    // p1 ставил задачу p2; p2 при сдаче оценил постановку.
    const set = { id: "s", funcId: "f1", setter: "p1", assignee: "p2", status: "done",
      submissions: [{ at: "2026-01-02T08:00:00Z", hours: 1,
        setterRating: { mark: 4, comment: "ясно", hidden: false } }],
      reviews: [] };
    expect(statsOf([set], FUNCS, "p1").setup).toEqual({ mark: null, marks: 0 });
    expect(statsOf([set], FUNCS, "p1", { published: [ratingId("s", "setup", "p2")] }).setup)
      .toEqual({ mark: 4, marks: 1 });
    // К рейтингу за выполнение она не прибавляется.
    expect(statsOf([set], FUNCS, "p1", { published: [ratingId("s", "setup", "p2")] }).mark)
      .toBeNull();
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
    reviews: [{ accept: true, mark, comment: "c", by: "p9" }] });
  const pub = (...ids) => PUB(...ids.map((id) => `t${id}`));

  it("сперва лучшие по оценке", () => {
    const tasks = [mk("p1", 3), mk("p2", 5), mk("p3", 4)];
    expect(byRating(tasks, FUNCS, ["p1", "p2", "p3"], pub("p1", "p2", "p3")))
      .toEqual(["p2", "p3", "p1"]);
  });

  it("при равных оценках вперёд тот, кто чаще в срок", () => {
    const tasks = [mk("p1", 4, true), mk("p2", 4, false)];
    expect(byRating(tasks, FUNCS, ["p1", "p2"], pub("p1", "p2"))).toEqual(["p2", "p1"]);
  });

  it("человек без оценок идёт после оценённых, а не считается худшим", () => {
    // О нём просто ничего не известно; ставить его ниже двойки было бы
    // выводом из пустоты.
    const tasks = [mk("p1", 2)];
    expect(byRating(tasks, FUNCS, ["p0", "p1"], pub("p1"))).toEqual(["p1", "p0"]);
  });
});

describe("строка о человеке", () => {
  it("оценка, срок и объём — коротко", () => {
    const tasks = [T("a")];
    expect(shortStat(statsOf(tasks, FUNCS, "p1", PUB("a"))))
      .toBe("5 · в срок 100% · 1 работа");
  });

  it("без единой оценки так и сказано", () => {
    expect(shortStat(statsOf([], FUNCS, "p1"))).toBe("без оценок · 0 работ");
  });

  it("про себя — «свой рейтинг скрыт», а не «без оценок»: оценки-то есть", () => {
    const s = visibleStats({ tasks: [T("a")], funcs: FUNCS, ...PUB("a") }, "p1", "p1");
    expect(shortStat(s)).toBe("свой рейтинг скрыт · в срок 100% · 1 работа");
  });
});

/* ─────── ПРО СЕБЯ ЧЕЛОВЕК ВИДИТ НЕ ВСЁ ───────

   Свои оценки и свой рейтинг не показываются: рейтинг существует, чтобы
   ЕМУ поручали, а не чтобы он на себя смотрел. Правило — в одном месте,
   `visibleStats`; остальное только спрашивает. */
describe("что видно смотрящему", () => {
  const model = (...tasks) => ({ tasks, funcs: FUNCS, ...PUB(...tasks.map((t) => t.id)) });

  it("себе — без оценок и без рейтинга, с признаком self", () => {
    const s = visibleStats(model(T("a")), "p1", "p1");
    expect(s.self).toBe(true);
    expect(s.mark).toBeNull();
    expect(s.marks).toBeNull();
    expect(s.setup.mark).toBeNull();
    expect(s.rows[0].mark).toBeNull();
    // Работы при этом на месте: прячется оценка, а не сделанное.
    expect(s.done).toBe(1);
  });

  it("другому — рейтинг из опубликованного, как есть", () => {
    const s = visibleStats(model(T("a")), "p1", "p9");
    expect(s.self).toBe(false);
    expect(s.mark).toBe(5);
    expect(s.rows[0].mark).toBe(5);
  });

  it("слова: себе — скрытые сразу и публичные после публикации; другим — только опубликованные публичные", () => {
    const hidden = T("h", { reviews: [{ accept: true, mark: 4, comment: "лично", hidden: true, by: "p9" }] });
    const open = T("o", { reviews: [{ accept: true, mark: 4, comment: "всем", by: "p9" }] });
    const none = { tasks: [hidden, open], funcs: FUNCS, published: [] };
    const rowOf = (s, id) => s.rows.find((r) => r.task === id);
    // Себе: скрытое видно и без публикации, публичное — нет.
    let s = visibleStats(none, "p1", "p1");
    expect(rowOf(s, "h").comment).toBe("лично");
    expect(rowOf(s, "o").comment).toBe("");
    // Другому до публикации — ничего: слова выдали бы автора.
    s = visibleStats(none, "p1", "p5");
    expect(rowOf(s, "h").comment).toBe("");
    expect(rowOf(s, "o").comment).toBe("");
    // После публикации другому — публичное, но не скрытое.
    s = visibleStats({ ...none, ...PUB("h", "o") }, "p1", "p5");
    expect(rowOf(s, "h").comment).toBe("");
    expect(rowOf(s, "o").comment).toBe("всем");
    // Автор свои слова видит всегда.
    expect(rowOf(visibleStats(none, "p1", "p9"), "h").comment).toBe("лично");
  });

  /* Скрытость одна на отметку и слова: чужая скрытая строка постороннему
     не показывается вовсе, а в средние скрытая отметка входит. */
  describe("скрытая отметка", () => {
    const hidden = T("h", { reviews: [{ accept: true, mark: 3, comment: "лично", hidden: true, by: "p9" }] });
    const open = T("o", { reviews: [{ accept: true, mark: 5, comment: "всем", by: "p9" }] });
    const m = { tasks: [hidden, open], funcs: FUNCS, ...PUB("h", "o") };
    const rowOf = (s, id) => s.rows.find((r) => r.task === id);

    it("постороннему — ни отметки, ни слов, ни признака «скрыто»; работа на месте", () => {
      const s = visibleStats(m, "p1", "p5");
      expect(rowOf(s, "h")).toMatchObject({ mark: null, comment: "", hidden: false,
        pending: false, published: false, done: true, hours: 4 });
      // Публичная соседка — как была.
      expect(rowOf(s, "o")).toMatchObject({ mark: 5, comment: "всем" });
    });

    it("в средней постороннего скрытая отметка есть: (3 + 5) / 2", () => {
      const s = visibleStats(m, "p1", "p5");
      expect(s.mark).toBe(4);
      expect(s.marks).toBe(2);
    });

    it("автору — своя скрытая строка целиком", () => {
      expect(rowOf(visibleStats(m, "p1", "p9"), "h"))
        .toMatchObject({ mark: 3, comment: "лично", hidden: true });
    });

    it("себе — слова видны (их для него и писали), отметка — нет, как и всегда", () => {
      expect(rowOf(visibleStats(m, "p1", "p1"), "h"))
        .toMatchObject({ mark: null, comment: "лично", hidden: true });
    });

    it("владелец — такой же посторонний: чужую скрытую отметку не видит", () => {
      expect(rowOf(visibleStats(m, "p1", "owner"), "h").mark).toBeNull();
    });

    it("historyOf с viewer режет так же; без viewer — строки как есть (для средних)", () => {
      const cut = historyOf(m.tasks, FUNCS, "p1", { published: m.published, viewer: "p5" });
      expect(cut.find((r) => r.task === "h")).toMatchObject({ mark: null, comment: "", hidden: false });
      const raw = historyOf(m.tasks, FUNCS, "p1", { published: m.published });
      expect(raw.find((r) => r.task === "h")).toMatchObject({ mark: 3, comment: "лично", hidden: true });
      // Автор и через historyOf видит своё.
      expect(historyOf(m.tasks, FUNCS, "p1", { published: m.published, viewer: "p9" })
        .find((r) => r.task === "h").mark).toBe(3);
    });
  });

  it("commentsFor: адресованные мне и чужие публичные — без автора", () => {
    const hidden = T("h", { reviews: [{ accept: true, mark: 4, comment: "лично", hidden: true, by: "p9" }] });
    const open = T("o", { reviews: [{ accept: true, mark: 4, comment: "всем", by: "p9" }] });
    const set = { id: "s", funcId: "f1", setter: "p1", assignee: "p2", status: "done",
      submissions: [{ at: "2026-01-02T08:00:00Z", hours: 1,
        setterRating: { mark: 3, comment: "срок тесный", hidden: false } }], reviews: [] };
    const m = { tasks: [hidden, open, set], funcs: FUNCS,
      published: [ratingId("o", "work", "p9"), ratingId("s", "setup", "p2")] };
    const mine = commentsFor(m, { viewer: "p1" }).mine;
    expect(mine.map((c) => c.text).sort()).toEqual(["всем", "лично", "срок тесный"]);
    expect(mine.find((c) => c.text === "лично")).toMatchObject({ kind: "work", hidden: true });
    expect(mine.find((c) => c.text === "срок тесный").kind).toBe("setup");
    mine.forEach((c) => expect(c).not.toHaveProperty("by"));
    // Постороннему про p1 — только опубликованные публичные.
    const others = commentsFor(m, { viewer: "p5" }).others;
    expect(others.p1.map((c) => c.text).sort()).toEqual(["всем", "срок тесный"]);
    // Автор своих слов в «адресованных мне» не видит.
    expect(commentsFor(m, { viewer: "p9" }).mine).toEqual([]);
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

  /* ─── часы отдельного дня ───

     Общие «с — до» действуют на все рабочие дни, `perDay` — исключения:
     «в субботу с 10 до 14». Запись без часов дня читается как прежде. */
  it("часы дня разбираются строго и живут только у рабочего дня", () => {
    expect(perDayOf({ 6: { from: "10:00", to: "14:00" }, 2: { from: "9:00", to: "25:00" },
      9: { from: "10:00" }, вт: { from: "10:00" } }, [1, 2, 6]))
      .toEqual({ 6: { from: "10:00", to: "14:00" } });
    // Выключили день — его часы ушли вместе с ним.
    expect(scheduleOfPerson({ days: [1], perDay: { 6: { from: "10:00", to: "14:00" } } })
      .perDay).toEqual({});
    // Прежняя запись: исключений нет, и всё остальное как было.
    expect(scheduleOfPerson({ days: [1, 2], from: "09:00", to: "18:00" }))
      .toEqual({ days: [1, 2], from: "09:00", to: "18:00", perDay: {}, status: "ready",
        statusAt: null });
    expect(perDayOf("не объект")).toEqual({});
    expect(perDayOf([{ from: "10:00" }])).toEqual({});
  });

  it("часы дня — свои, если названы, иначе общие", () => {
    const sc = scheduleOfPerson({ days: [1, 6], from: "09:00", to: "18:00",
      perDay: { 6: { from: "10:00", to: "" } } });
    expect(dayHours(sc, 1)).toEqual({ from: "09:00", to: "18:00" });
    // Запись дня — целиком: пустая граница в ней не подменяется общей.
    expect(dayHours(sc, 6)).toEqual({ from: "10:00", to: "" });
  });

  it("исключения в тексте стоят своей группой через «;»", () => {
    const text = (p) => scheduleText(scheduleOfPerson(p), WEEK);
    expect(text({ days: [1, 2, 3, 4, 5, 6], from: "09:00", to: "18:00",
      perDay: { 6: { from: "10:00", to: "14:00" } } }))
      .toBe("пн–пт · 09:00–18:00; сб · 10:00–14:00");
    // Дни с одинаковыми часами — вместе, даже если стоят не подряд.
    expect(text({ days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00",
      perDay: { 3: { from: "10:00", to: "14:00" } } }))
      .toBe("пн, вт, чт, пт · 09:00–18:00; ср · 10:00–14:00");
    // Общих часов нет — у дней без своих часов их и не показывают.
    expect(text({ days: [1, 2, 6], perDay: { 6: { from: "10:00", to: "14:00" } } }))
      .toBe("пн, вт; сб · 10:00–14:00");
  });
});
