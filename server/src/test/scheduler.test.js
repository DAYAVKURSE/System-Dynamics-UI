import { describe, expect, it, vi } from "vitest";
import { FIRE_WINDOW_MS, dueNotifications, formatMessage, formatWarn, keyboardFor, occurrencesNear, reminderAlive, repeatDue, runTick, wallToUtc } from "../lib/scheduler.js";

/* Время в задачах «настенное» (как ввёл пользователь), поэтому все проверки
   идут через явный tzOffset — тот же, что даёт getTimezoneOffset() в браузере.
   Москва (UTC+3) — это -180. */
const MSK = -180;
const at = (wall, tz = MSK) => wallToUtc(wall, tz);
const MIN = 60000;

const task = (over = {}) => ({
  id: "t1", title: "Позвонить рефералам", body: "", status: "backlog",
  start: "2026-09-15T10:00", repeat: "once", days: [], time: "", warn: 10, ...over,
});

describe("перевод настенного времени в UTC", () => {
  it("учитывает часовой пояс пользователя", () => {
    // 10:00 в Москве — это 07:00 UTC.
    expect(new Date(at("2026-09-15T10:00")).toISOString()).toBe("2026-09-15T07:00:00.000Z");
  });

  it("для UTC оставляет время как есть", () => {
    expect(new Date(at("2026-09-15T10:00", 0)).toISOString()).toBe("2026-09-15T10:00:00.000Z");
  });
});

/* ДО ДЕДЛАЙНА — В ПРОЦЕНТАХ (владелец, 2026-09-21): «пользователь должен
   предупреждаться за введённое количество процентов времени до момента
   сдачи». Срок задачи 10:00 → 12:00, четверть — полчаса. */
describe("предупреждение до дедлайна", () => {
  const s = (over, notes) => ({ tzOffset: MSK, notes,
    tasks: [task({ end: "2026-09-15T12:00", dead: 25, warn: 0, ...over })] });
  // «Начинается» в 10:00 уже ушло — здесь смотрят только на срок.
  const SENT = { "t1:2026-09-15T10:00:start": 1 };
  const kinds = (sch, wall) => dueNotifications(sch, at(wall), SENT).map((d) => d.kind);

  it("уходит, когда осталась названная доля срока, и один раз", () => {
    expect(kinds(s(), "2026-09-15T11:29")).toEqual([]);
    const due = dueNotifications(s(), at("2026-09-15T11:30"), SENT);
    expect(due.map((d) => d.kind)).toEqual(["deadline"]);
    expect(due[0].dead).toBe(25);
    expect(Math.round(due[0].left / MIN)).toBe(30);
    expect(formatMessage(due[0])).toMatch(/^До сдачи осталось 30 минут — 25 % срока: Позвонить рефералам/);
    expect(formatMessage(due[0])).toMatch(/Срок: 2026-09-15 12:00/);
    // Отправленное второй раз не уходит.
    expect(dueNotifications(s(), at("2026-09-15T11:40"), { ...SENT, [due[0].key]: 1 })).toEqual([]);
    // Кнопок под ним нет: начинать или откладывать тут нечего.
    expect(keyboardFor(due[0], "2")).toBeNull();
  });

  it("после срока не шлётся, без доли — тоже", () => {
    expect(kinds(s(), "2026-09-15T12:01")).toEqual([]);
    expect(kinds(s({ dead: 0 }), "2026-09-15T11:59")).toEqual([]);
  });

  it("начала нет — отсчёт от момента, когда задача появилась в напоминаниях", () => {
    // Появилась в 08:00, срок 12:00 — четыре часа; половина — в 10:00.
    const notes = { "task:t1": { id: "task:t1", createdAt: new Date(at("2026-09-15T08:00")).toISOString() } };
    expect(kinds(s({ start: "", dead: 50 }, notes), "2026-09-15T09:59")).toEqual([]);
    expect(kinds(s({ start: "", dead: 50 }, notes), "2026-09-15T10:00")).toEqual(["deadline"]);
    // Ни начала, ни записи — считать не от чего.
    expect(kinds(s({ start: "", dead: 50 }), "2026-09-15T11:00")).toEqual([]);
  });

  it("взятая в работу тоже предупреждает, сданная — нет", () => {
    expect(kinds(s({ status: "progress" }), "2026-09-15T11:30")).toEqual(["deadline"]);
    expect(kinds(s({ status: "review" }), "2026-09-15T11:30")).toEqual([]);
  });
});

describe("разовая задача", () => {
  const s = (over) => ({ tzOffset: MSK, tasks: [task(over)] });

  it("предупреждение уходит ровно за указанное число минут", () => {
    const due = dueNotifications(s(), at("2026-09-15T09:50"));
    expect(due.map((d) => d.kind)).toEqual(["warn"]);
    expect(due[0].warn).toBe(10);
  });

  it("до момента предупреждения не шлёт ничего", () => {
    expect(dueNotifications(s(), at("2026-09-15T09:49"))).toEqual([]);
  });

  it("отменённая не напоминает о себе", () => {
    /* Позвать человека к работе, которую решили не делать, — значит позвать
       его к делу, которого нет. Задача при этом никуда не девается: она
       лежит в списке с пометкой. */
    const off = { tzOffset: MSK, tasks: [task({ canceled: true })] };
    expect(dueNotifications(off, at("2026-09-15T09:50"))).toEqual([]);
    expect(dueNotifications(off, at("2026-09-15T10:00"))).toEqual([]);
  });

  it("в момент начала уходит уведомление о начале", () => {
    const due = dueNotifications(s(), at("2026-09-15T10:00"));
    expect(due.map((d) => d.kind)).toContain("start");
  });

  it("уже отправленное повторно не уходит", () => {
    const now = at("2026-09-15T09:50");
    const [first] = dueNotifications(s(), now);
    expect(dueNotifications(s(), now, { [first.key]: now })).toEqual([]);
  });

  it("«не предупреждать» оставляет только уведомление о начале", () => {
    expect(dueNotifications(s({ warn: null }), at("2026-09-15T09:50"))).toEqual([]);
    expect(dueNotifications(s({ warn: null }), at("2026-09-15T10:00")).map((d) => d.kind))
      .toEqual(["start"]);
  });

  it("«в момент начала» (0 минут) не создаёт отдельного предупреждения", () => {
    const due = dueNotifications(s({ warn: 0 }), at("2026-09-15T10:00"));
    expect(due.map((d) => d.kind)).toEqual(["start"]);
  });

  it("завершённая задача молчит", () => {
    expect(dueNotifications(s({ status: "done" }), at("2026-09-15T10:00"))).toEqual([]);
  });

  it("пропущенное недавно напоминание всё же уходит (сервер перезапускали)", () => {
    const late = at("2026-09-15T10:00") + FIRE_WINDOW_MS - MIN;
    expect(dueNotifications(s(), late).map((d) => d.kind)).toContain("start");
  });

  /* Владелец (2026-09-20): «если уведомление не пришло по каким-либо
     причинам в нужное время, то оно должно прийти, как только это станет
     возможным». У РАЗОВОЙ задачи второго такого момента нет — значит,
     опоздавшее уходит, сколько бы ни прошло. */
  it("давно просроченное у разовой задачи всё равно уходит", () => {
    const tooLate = at("2026-09-15T10:00") + FIRE_WINDOW_MS + MIN;
    const due = dueNotifications(s(), tooLate);
    expect(due.map((d) => d.kind)).toEqual(["start"]);
    // А предупреждения «через 10 минут» уже нет: начало настало.
    expect(due.map((d) => d.kind)).not.toContain("warn");
    // Отметка об отправленном по-прежнему глушит повтор.
    expect(dueNotifications(s(), tooLate, { [due[0].key]: 1 })).toEqual([]);
  });

  /* А у ПОВТОРЯЮЩЕЙСЯ окно остаётся: пропущенное вчерашнее срабатывание
     заменяет сегодняшнее, и слать оба — звать к работе, которой нет. */
  it("у повторяющейся давно просроченное не сыпется пачкой", () => {
    const daily = { tzOffset: MSK,
      tasks: [task({ repeat: "daily", time: "09:00", warn: 0, start: "" })] };
    expect(dueNotifications(daily, at("2026-09-15T14:00"))).toEqual([]);
  });

  it("задача без даты начала ничего не планирует", () => {
    expect(dueNotifications(s({ start: "" }), at("2026-09-15T10:00"))).toEqual([]);
  });
});

describe("ежедневная задача", () => {
  const s = { tzOffset: MSK, tasks: [task({ repeat: "daily", time: "09:00", warn: 20, start: "" })] };

  it("срабатывает каждый день в указанное время", () => {
    for (const day of ["2026-09-15", "2026-09-16", "2026-09-17"]) {
      const due = dueNotifications(s, at(`${day}T09:00`));
      expect(due.map((d) => d.kind)).toContain("start");
    }
  });

  it("предупреждает за 20 минут", () => {
    const due = dueNotifications(s, at("2026-09-16T08:40"));
    expect(due.map((d) => d.kind)).toEqual(["warn"]);
  });

  it("в другое время суток молчит", () => {
    expect(dueNotifications(s, at("2026-09-16T15:00"))).toEqual([]);
  });

  it("ключи разных дней различаются — вчерашняя отметка не глушит сегодня", () => {
    const y = dueNotifications(s, at("2026-09-15T09:00"))[0];
    const t = dueNotifications(s, at("2026-09-16T09:00"))[0];
    expect(y.key).not.toBe(t.key);
    expect(dueNotifications(s, at("2026-09-16T09:00"), { [y.key]: 1 })).toHaveLength(1);
  });

  it("без времени повтора не планируется", () => {
    const noTime = { tzOffset: MSK, tasks: [task({ repeat: "daily", time: "", start: "" })] };
    expect(dueNotifications(noTime, at("2026-09-16T09:00"))).toEqual([]);
  });
});

describe("задача по определённым дням", () => {
  // 2026-09-15 — вторник (индекс 1, где понедельник = 0).
  const onTueThu = { tzOffset: MSK, tasks: [task({
    repeat: "weekly", time: "12:00", days: [1, 3], warn: null, start: "",
  })] };

  it("срабатывает в выбранный день", () => {
    expect(dueNotifications(onTueThu, at("2026-09-15T12:00")).map((d) => d.kind))
      .toEqual(["start"]); // вторник
    expect(dueNotifications(onTueThu, at("2026-09-17T12:00")).map((d) => d.kind))
      .toEqual(["start"]); // четверг
  });

  it("в невыбранный день молчит", () => {
    expect(dueNotifications(onTueThu, at("2026-09-16T12:00"))).toEqual([]); // среда
    expect(dueNotifications(onTueThu, at("2026-09-18T12:00"))).toEqual([]); // пятница
  });

  it("без выбранных дней не срабатывает вовсе", () => {
    const noDays = { tzOffset: MSK, tasks: [task({
      repeat: "weekly", time: "12:00", days: [], start: "",
    })] };
    expect(dueNotifications(noDays, at("2026-09-15T12:00"))).toEqual([]);
  });

  it("день недели считается в часовом поясе пользователя, а не сервера", () => {
    // Понедельник 23:30 по Москве — это ещё понедельник 20:30 UTC,
    // но при офсете +13 (Окленд) те же настенные 23:30 приходятся на другой
    // момент UTC. Проверяем, что день берётся из настенного времени.
    const mondayOnly = (tz) => ({ tzOffset: tz, tasks: [task({
      repeat: "weekly", time: "23:30", days: [0], warn: null, start: "",
    })] });
    // 2026-09-14 — понедельник.
    expect(dueNotifications(mondayOnly(MSK), wallToUtc("2026-09-14T23:30", MSK)))
      .toHaveLength(1);
    expect(dueNotifications(mondayOnly(-780), wallToUtc("2026-09-14T23:30", -780)))
      .toHaveLength(1);
  });
});

/* ─── отложенная задача напоминает о себе заново ───

   «Отложить» спрашивает, на сколько, и в названный момент человек должен
   получить то же уведомление с теми же двумя кнопками — иначе «отложить»
   было бы «забыть». Момент хранится UTC-меткой: его назвал сервер, сложив
   «на сколько» с «сейчас», а не человек в поле формы. */
describe("отложенная задача", () => {
  // Позвали в 10:00 по Москве, отложили на два часа.
  const until = new Date(at("2026-09-15T12:00")).toISOString();
  const s = (over) => ({ tzOffset: MSK, tasks: [task({ status: "deferred", deferredUntil: until,
    ...over })] });

  it("в момент «до» уходит новое уведомление о начале — с кнопками", () => {
    const due = dueNotifications(s(), at("2026-09-15T12:00"));
    expect(due).toHaveLength(1);
    expect(due[0].kind).toBe("start");
    expect(due[0].deferred).toBe(true);
    // Время начала показывается в поясе человека, а не сервера.
    expect(due[0].startWall).toBe("2026-09-15T12:00");
    expect(formatMessage(due[0])).toContain("отложенная: Позвонить рефералам");
    expect(formatMessage(due[0])).toContain("Начало: 2026-09-15 12:00");
  });

  it("отметка об исходном уведомлении повторное не глушит", () => {
    // Исходное «Начинается» ушло в 10:00, ПОКА задача ещё не была отложена.
    const first = dueNotifications({ tzOffset: MSK, tasks: [task()] }, at("2026-09-15T10:00"))
      .find((d) => d.kind === "start");
    const later = dueNotifications(s(), at("2026-09-15T12:00"), { [first.key]: 1 });
    expect(later.map((d) => d.kind)).toEqual(["start"]);
    expect(later[0].key).not.toBe(first.key);
  });

  /* «Отложить» под предупреждением: «в назначенный час не начну, напомни
     позже». Плановые warn/start раньше названного момента не шлются —
     иначе в 10:00 приходило бы «Начинается» с кнопками, и откладывать
     пришлось бы заново, вопреки обещанию «когда время выйдет, напомню». */
  it("отложено с предупреждения — в плановый момент начала тишина, в «до» одно отложенное", () => {
    // Предупреждение за 10 минут ушло в 9:50, человек нажал «Отложить на 2 часа 10 минут» → до 12:00.
    const warned = dueNotifications({ tzOffset: MSK, tasks: [task()] }, at("2026-09-15T09:50"))[0];
    expect(warned.kind).toBe("warn");
    const sent = { [warned.key]: 1 };
    expect(dueNotifications(s({ status: "backlog" }), at("2026-09-15T10:00"), sent)).toEqual([]);
    expect(dueNotifications(s({ status: "backlog" }), at("2026-09-15T10:00") + 30000, sent)).toEqual([]);
    const due = dueNotifications(s({ status: "backlog" }), at("2026-09-15T12:00"), sent);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ kind: "start", deferred: true });
  });

  it("отложено ещё до предупреждения — молчат и предупреждение, и начало", () => {
    // Отложили с вечера накануне: до 12:00; в 9:50 и 10:00 — ничего.
    expect(dueNotifications(s(), at("2026-09-15T09:50"))).toEqual([]);
    expect(dueNotifications(s(), at("2026-09-15T10:00"))).toEqual([]);
    expect(dueNotifications(s(), at("2026-09-15T12:00")).map((d) => d.deferred)).toEqual([true]);
  });

  it("плановое ПОСЛЕ «до» не глушится: отложили на пять минут, а начало через десять", () => {
    const soon = new Date(at("2026-09-15T09:55")).toISOString();
    const [deferred] = dueNotifications(s({ deferredUntil: soon }), at("2026-09-15T09:55"));
    expect(deferred.deferred).toBe(true);
    const due = dueNotifications(s({ deferredUntil: soon }), at("2026-09-15T10:00"), { [deferred.key]: 1 });
    expect(due.map((d) => [d.kind, d.deferred])).toEqual([["start", false]]);
  });

  it("взятая задача со старым «до» напоминает по плану: отложение её больше не касается", () => {
    // status progress: плановое начало «взятой» и так не шлётся? Нет —
    // планировщик глушит только done; проверяем, что фильтр отложения
    // действует лишь на лежащие (DEFERRABLE), а не на все подряд.
    const due = dueNotifications(s({ status: "progress" }), at("2026-09-15T10:00"));
    expect(due.map((d) => [d.kind, d.deferred])).toEqual([["start", false]]);
  });

  it("предупреждения «за 10 минут» у отложенного нет: момент назвал сам человек", () => {
    expect(dueNotifications(s(), at("2026-09-15T11:50"))).toEqual([]);
  });

  it("взятой напоминают один раз, сданную не начинают вовсе", () => {
    /* Владелец (2026-09-20): «если пользователь взял задачу в работу до
       того, как пришло напоминание, то это напоминание должно приходить в
       момент, когда он взял задачу в работу». Поэтому взятой, которой ещё
       НЕ напоминали, плановое начало уходит — но ровно один раз. */
    const taken = dueNotifications(s({ status: "progress" }), at("2026-09-15T12:00"));
    expect(taken.map((d) => [d.kind, d.deferred])).toEqual([["start", false]]);
    expect(dueNotifications(s({ status: "progress" }), at("2026-09-15T12:00"),
      { [taken[0].key]: 1 })).toEqual([]);
    // Сданную «начинать» нечего ни при каких отметках.
    expect(dueNotifications(s({ status: "review" }), at("2026-09-15T12:00"))).toEqual([]);
  });

  it("без «до» отложенная напоминает по плану, и порченая дата — не дата", () => {
    /* Отложения нет — остаётся обычная лежащая задача с прошедшим
       началом: ей напоминают, как только становится возможно. */
    const plain = dueNotifications(s({ deferredUntil: null }), at("2026-09-15T12:00"));
    expect(plain.map((d) => [d.kind, d.deferred])).toEqual([["start", false]]);
    const broken = dueNotifications(s({ deferredUntil: "потом" }), at("2026-09-15T12:00"));
    expect(broken.map((d) => [d.kind, d.deferred])).toEqual([["start", false]]);
  });
});

describe("occurrencesNear", () => {
  it("для разовой задачи даёт ровно одно срабатывание", () => {
    expect(occurrencesNear(task(), at("2026-09-15T10:00"), MSK)).toHaveLength(1);
  });

  it("для ежедневной смотрит соседние дни, чтобы поймать «за сутки»", () => {
    const t = task({ repeat: "daily", time: "09:00", warn: 1440, start: "" });
    expect(occurrencesNear(t, at("2026-09-16T09:00"), MSK).length).toBeGreaterThan(1);
  });
});

describe("текст сообщения", () => {
  it("предупреждение называет срок и задачу", () => {
    const msg = formatMessage({
      kind: "warn", warn: 10, title: "Позвонить рефералам",
      startWall: "2026-09-15T10:00", body: "Список в CRM",
    });
    expect(msg).toContain("Через 10 минут: Позвонить рефералам");
    expect(msg).toContain("2026-09-15 10:00");
    expect(msg).toContain("Список в CRM");
  });

  it("уведомление о начале говорит, что задача начинается", () => {
    expect(formatMessage({ kind: "start", title: "Разбор недели", startWall: "" }))
      .toContain("Начинается: Разбор недели");
  });

  it("склоняет единицы времени", () => {
    expect(formatWarn(1)).toBe("1 минуту");
    expect(formatWarn(20)).toBe("20 минут");
    expect(formatWarn(22)).toBe("22 минуты");
    expect(formatWarn(60)).toBe("1 час");
    expect(formatWarn(120)).toBe("2 часа");
    expect(formatWarn(1440)).toBe("1 сутки");
  });
});

describe("проход планировщика", () => {
  // Задача поручена тому же, у кого расписание: ему и кнопки.
  const schedule = { chatId: "42", tzOffset: MSK, tasks: [task({ assignee: "42" })], sent: {} };
  const makeStore = (schedules) => {
    const marked = [];
    return {
      marked,
      all: async () => schedules,
      markSent: async (userId, key) => marked.push(`${userId}:${key}`),
    };
  };

  it("отправляет и отмечает отправленное", async () => {
    const store = makeStore([{ userId: "42", schedule }]);
    const send = vi.fn().mockResolvedValue({});

    const n = await runTick({ store, send, now: at("2026-09-15T09:50") });

    expect(n).toBe(1);
    /* Предупреждение «через 10 минут» — с теми же кнопками, что и «пора
       начинать»: именно сейчас человек решает, успевает ли он. В v1.1
       кнопок под ним не было, и решить было нечем до самого начала. */
    const [chatId, text, keyboard] = send.mock.calls[0];
    expect(chatId).toBe("42");
    expect(text).toContain("Через 10 минут");
    expect(text).toContain("прямо сейчас, не дожидаясь начала");
    expect(keyboard.inline_keyboard[0].map((b) => b.callback_data))
      .toEqual(["task:defer:t1", "task:start:t1"]);
    expect(store.marked).toHaveLength(1);
  });

  it("предупреждение владельцу о чужой задаче — без кнопок, как и «пора начинать»", async () => {
    const store = makeStore([{ userId: "100", schedule: { ...schedule, chatId: "100" } }]);
    const send = vi.fn().mockResolvedValue({});
    await runTick({ store, send, now: at("2026-09-15T09:50") });
    const [, text, keyboard] = send.mock.calls[0];
    expect(text).toContain("Через 10 минут");
    expect(text).not.toContain("Отложить");
    expect(keyboard).toBeNull();
  });

  /* Расписания, сохранённые до v1.1, исполнителя не несут вовсе: поле
     отсутствует. После выката такие напоминания приходили без кнопок, и
     ответить на них было нечем. Запись без поля — запись того, у кого
     лежит; «никому» (null) — по-прежнему никому. */
  it("запись без поля исполнителя (до v1.1) считается записью того, у кого лежит", async () => {
    const old = { ...task() };
    delete old.assignee;
    const store = makeStore([{ userId: "42", schedule: { ...schedule, tasks: [old] } }]);
    const send = vi.fn().mockResolvedValue({});
    await runTick({ store, send, now: at("2026-09-15T10:00") });
    const [, text, keyboard] = send.mock.calls[0];
    expect(keyboard.inline_keyboard[0].map((b) => b.text)).toEqual(["🔴 Отложить", "🟢 Начать"]);
    expect(text).toContain("«🟢 Начать»");
    // Ключ есть, значения нет — то же самое, что ключа нет.
    const store2 = makeStore([{ userId: "42", schedule: { ...schedule, tasks: [task({ assignee: undefined })] } }]);
    const send2 = vi.fn().mockResolvedValue({});
    await runTick({ store: store2, send: send2, now: at("2026-09-15T10:00") });
    expect(send2.mock.calls[0][2]).not.toBeNull();
  });

  /* ─── две кнопки под уведомлением о начале ───

     Человека позвали, и он решает ровно одно: начинает он сейчас или нет.
     Без кнопок решение оставалось в голове, и доска показывала задачу
     лежащей в бэклоге и когда за неё взялись, и когда её отложили. */
  it("уведомление о начале приходит с кнопками «🔴 Отложить» и «🟢 Начать» — в этом порядке",
    async () => {
      const store = makeStore([{ userId: "42", schedule }]);
      const send = vi.fn().mockResolvedValue({});

      await runTick({ store, send, now: at("2026-09-15T10:00") });

      const [, text, keyboard] = send.mock.calls[0];
      expect(text).toContain("Начинается:");
      // Сказано, что кнопки делают: молчаливая «Отложить» обещала бы перенос.
      expect(text).toContain("останется в бэклоге как отложенная");
      expect(text).toContain("напомню снова");
      /* Отказ слева, действие справа. Красить инлайн-кнопки Telegram нельзя —
         цвет несёт только эмодзи в подписи. */
      expect(keyboard.inline_keyboard[0].map((b) => b.text))
        .toEqual(["🔴 Отложить", "🟢 Начать"]);
      expect(keyboard.inline_keyboard[0].map((b) => b.callback_data))
        .toEqual(["task:defer:t1", "task:start:t1"]);
    });

  /* Уведомление о той же задаче приходит и владельцу (у него в расписании
     вся модель), и постановщику с проверяющим — но взять или отложить её
     может только исполнитель; у остальных кнопка отвечала бы «не ваша». */
  it("владельцу и постановщику — то же уведомление, но без кнопок и без абзаца про них",
    async () => {
      const store = makeStore([{ userId: "100", schedule: { ...schedule, chatId: "100" } }]);
      const send = vi.fn().mockResolvedValue({});

      await runTick({ store, send, now: at("2026-09-15T10:00") });

      const [, text, keyboard] = send.mock.calls[0];
      expect(text).toContain("Начинается: Позвонить рефералам");
      expect(text).not.toContain("Отложить");
      expect(keyboard).toBeNull();
    });

  it("задача без исполнителя кнопок не получает: нажать их некому", async () => {
    const store = makeStore([{ userId: "42",
      schedule: { ...schedule, tasks: [task({ assignee: null })] } }]);
    const send = vi.fn().mockResolvedValue({});
    await runTick({ store, send, now: at("2026-09-15T10:00") });
    expect(send.mock.calls[0][2]).toBeNull();
    // Исполнитель — числом или строкой — одно и то же лицо.
    const store2 = makeStore([{ userId: "42", schedule: { ...schedule, tasks: [task({ assignee: 42 })] } }]);
    const send2 = vi.fn().mockResolvedValue({});
    await runTick({ store: store2, send: send2, now: at("2026-09-15T10:00") });
    expect(send2.mock.calls[0][2]).not.toBeNull();
  });

  it("без chatId не отправляет", async () => {
    const store = makeStore([{ userId: "42", schedule: { ...schedule, chatId: null } }]);
    const send = vi.fn();
    expect(await runTick({ store, send, now: at("2026-09-15T09:50") })).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("не отмечает отправленным то, что не ушло — попробует ещё раз", async () => {
    const store = makeStore([{ userId: "42", schedule }]);
    // Типичный случай: пользователь не начал диалог с ботом.
    const send = vi.fn().mockRejectedValue(new Error("bot was blocked by the user"));
    const log = vi.fn();

    expect(await runTick({ store, send, now: at("2026-09-15T09:50"), log })).toBe(0);
    expect(store.marked).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("не удалось отправить"));
  });

  it("сбой у одного пользователя не мешает остальным", async () => {
    const store = makeStore([
      { userId: "1", schedule: { ...schedule, chatId: "1" } },
      { userId: "2", schedule: { ...schedule, chatId: "2" } },
    ]);
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("chat not found"))
      .mockResolvedValue({});

    expect(await runTick({ store, send, now: at("2026-09-15T09:50") })).toBe(1);
  });

  it("уже отмеченное не отправляется повторно", async () => {
    const now = at("2026-09-15T09:50");
    const key = dueNotifications(schedule, now)[0].key;
    const store = makeStore([{ userId: "42", schedule: { ...schedule, sent: { [key]: now } } }]);
    const send = vi.fn();

    expect(await runTick({ store, send, now })).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

/* ─────── НАПОМИНАНИЕ ЖИВЁТ, ПОКА НА НЕГО НЕ ОТВЕТИЛИ ───────

   Владелец: «если пользователь не нажал „Отложить“, то это же сообщение
   должно ему приходить каждую минуту, пока не нажмёт что-то. Если нажал
   отложить, новое напоминание должно прийти через то время, которое указал
   пользователь». И отдельно: постановщику — напоминание о постановке с
   кнопками «Готово» и «Отложить». */
describe("повтор и напоминание о постановке", () => {
  const SETUP = { id: "s1", kind: "setup", title: "Поставить макет", status: "wait",
    setter: "200", end: "2030-01-01T10:00" };
  const sched = (over = {}) => ({ chatId: 42, tzOffset: 0, tasks: [SETUP], ...over });

  it("постановщику — «нужно поставить» с «Готово» и «Отложить», и сразу", () => {
    const due = dueNotifications(sched(), Date.parse("2026-01-01T09:00:00Z"), {});
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ kind: "setup", taskId: "s1", setter: "200" });
    const text = formatMessage(due[0], "200");
    expect(text).toMatch(/^Нужно поставить задачу: Поставить макет/);
    expect(text).toMatch(/Срок: 2030-01-01 10:00/);
    expect(text).toMatch(/повторю это сообщение через минуту/);
    expect(keyboardFor(due[0], "200").inline_keyboard[0].map((b) => b.text))
      .toEqual(["🔴 Отложить", "✅ Готово"]);
    // Не постановщику кнопок нет: «Готово» у него отказывало бы всегда.
    expect(keyboardFor(due[0], "300")).toBeNull();
  });

  it("поставленная задача больше не напоминает", () => {
    const set = sched({ tasks: [{ ...SETUP, status: "backlog" }] });
    expect(dueNotifications(set, Date.now(), {})).toEqual([]);
    // И отменённая тоже: работы, которой решили не делать, не ставят.
    const off = sched({ tasks: [{ ...SETUP, canceled: true }] });
    expect(dueNotifications(off, Date.now(), {})).toEqual([]);
  });

  it("висящее напоминание повторяется раз в минуту, пока не ответили", () => {
    const now = Date.parse("2026-01-01T09:00:00Z");
    const rem = { kind: "setup", taskId: "s1", lastSentAt: now, deferredUntil: null,
      text: "Нужно поставить задачу: Поставить макет" };
    const s = sched({ reminders: { "setup:s1": rem } });
    // Минута ещё не прошла — молчим.
    expect(repeatDue(s, now + 59_000)).toEqual([]);
    expect(repeatDue(s, now + 60_000).map((r) => r.id)).toEqual(["setup:s1"]);
    // Ответили — гасить нечего.
    expect(repeatDue(sched({ reminders: {} }), now + 600_000)).toEqual([]);
  });

  it("отложенное молчит до названного момента, потом снова каждую минуту", () => {
    const now = Date.parse("2026-01-01T09:00:00Z");
    const until = new Date(now + 30 * 60_000).toISOString();
    const s = sched({ reminders: { "setup:s1": { kind: "setup", taskId: "s1",
      lastSentAt: now, deferredUntil: until, text: "…" } } });
    expect(repeatDue(s, now + 10 * 60_000)).toEqual([]);
    expect(repeatDue(s, now + 31 * 60_000).map((r) => r.id)).toEqual(["setup:s1"]);
  });

  it("напоминание в силе, пока задача в том же состоянии", () => {
    const tasks = [{ id: "s1", status: "wait" }, { id: "w1", status: "backlog" },
      { id: "w2", status: "progress" }, { id: "w3", status: "done" }];
    const alive = (kind, taskId) => reminderAlive({ kind, taskId }, tasks);
    expect(alive("setup", "s1")).toBe(true);
    expect(reminderAlive({ kind: "setup", taskId: "w1" }, tasks)).toBe(false);
    expect(alive("task", "w1")).toBe(true);
    expect(alive("task", "w2")).toBe(false);      // взяли — начинать нечего
    expect(alive("task", "w3")).toBe(false);      // сдана
    expect(alive("task", "нет")).toBe(false);
    expect(reminderAlive({ kind: "task", taskId: "s1" },
      [{ id: "s1", status: "backlog", canceled: true }])).toBe(false);
  });

  it("тик шлёт повтор тем же текстом и отмечает время", async () => {
    const now = Date.parse("2026-01-01T09:00:00Z");
    const rem = { kind: "setup", taskId: "s1", lastSentAt: now - 120_000,
      deferredUntil: null, text: "Нужно поставить задачу: Поставить макет" };
    const touched = [];
    const opened = [];
    const sent = [];
    const store = {
      all: async () => [{ userId: "200", schedule: sched({ reminders: { "setup:s1": rem },
        sent: { "s1:setup": now - 120_000 } }) }],
      markSent: async () => {},
      openReminder: async (u, r) => { opened.push([u, r.kind, r.taskId]); },
      touchReminder: async (u, id, at) => { touched.push([u, id, at]); },
      failReminder: async () => ({ dropped: false }),
    };
    const n = await runTick({ store, send: async (chatId, text, keyboard) =>
      sent.push({ chatId, text, keyboard }), now });
    expect(n).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe(rem.text);          // слово в слово, а не заново
    expect(sent[0].keyboard.inline_keyboard[0].map((b) => b.text))
      .toEqual(["🔴 Отложить", "✅ Готово"]);
    expect(touched).toEqual([["200", "setup:s1", now]]);
    expect(opened).toEqual([]);                   // первого раза не было — только повтор
  });

  it("первая отправка заводит висящее напоминание — с этого и начинается повтор", async () => {
    const now = Date.parse("2026-01-01T09:00:00Z");
    const opened = [];
    const store = {
      all: async () => [{ userId: "200", schedule: sched() }],
      markSent: async () => {},
      openReminder: async (u, r, at) => { opened.push([u, r.kind, r.taskId, at]); },
      touchReminder: async () => {},
      failReminder: async () => ({ dropped: false }),
    };
    await runTick({ store, send: async () => {}, now });
    expect(opened).toEqual([["200", "setup", "s1", now]]);
  });
});

import { dueNotes, listReminders, noteAt, syncNotes } from "../lib/scheduler.js";

/* ─────── СПИСОК НАПОМИНАНИЙ (владелец, 2026-09-20) ───────

   Напоминание — запись, а не вычисляемая строчка: заводится, когда
   задача появилась в бэклоге, и из списка не пропадает, пока человек не
   удалит её сам. Прежде список считался из задач, и взятая в работу
   задача исчезала из него вместе с напоминанием. */
describe("записи напоминаний", () => {
  const now = Date.parse("2026-09-15T10:00:00Z");
  const sched = (tasks, over = {}) => ({ tzOffset: 0, tasks, notes: {}, ...over });

  it("заводится, когда задача появилась в бэклоге", () => {
    const { notes, changed } = syncNotes(sched([
      { id: "a", title: "Сверстать", status: "backlog", kind: "task",
        start: "2026-09-15T12:00", repeat: "once", warn: 30 },
      { id: "b", title: "Поставить макет", status: "wait", kind: "setup" },
    ]), now);
    expect(changed).toBe(true);
    expect(Object.keys(notes).sort()).toEqual(["setup:b", "task:a"]);
    // Исполнителю — за 30 минут до начала; постановщику — сразу.
    expect(notes["task:a"].at).toBe("2026-09-15T11:30:00.000Z");
    expect(notes["setup:b"].at).toBe("2026-09-15T10:00:00.000Z");
    expect(notes["task:a"].sentAt).toBeNull();
  });

  it("у взятой и сданной задачи новой записи не заводится", () => {
    const { notes } = syncNotes(sched([
      { id: "a", title: "В работе", status: "progress", kind: "task", start: "2026-09-15T12:00" },
      { id: "b", title: "Сдана", status: "review", kind: "task", start: "2026-09-15T12:00" },
      { id: "c", title: "Отменена", status: "backlog", kind: "task", canceled: true },
    ]), now);
    expect(Object.keys(notes)).toEqual([]);
  });

  it("запись остаётся, когда задачу взяли в работу и когда сдали", () => {
    const first = syncNotes(sched([
      { id: "a", title: "Сверстать", status: "backlog", kind: "task",
        start: "2026-09-15T12:00", repeat: "once", warn: 30 }]), now).notes;
    const inWork = sched([{ id: "a", title: "Сверстать", status: "progress", kind: "task",
      start: "2026-09-15T12:00", repeat: "once", warn: 30 }], { notes: first });
    expect(syncNotes(inWork, now).notes["task:a"]).toBeTruthy();
    const list = listReminders(inWork, now);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "task:a", title: "Сверстать",
      doing: "в работе", sentAt: null });
  });

  it("на форме — статус выполнения и статус напоминания", () => {
    const notes = { "task:a": { id: "task:a", kind: "task", taskId: "a", title: "Сверстать",
      at: "2026-09-15T11:30:00.000Z", sentAt: null } };
    const bases = [["backlog", "бэклог"], ["deferred", "бэклог"], ["progress", "в работе"],
      ["review", "сдана"], ["done", "сдана"], ["wait", "ожидает постановки"]];
    bases.forEach(([status, doing]) => {
      const list = listReminders(sched([{ id: "a", title: "Сверстать", status, kind: "task" }],
        { notes }), now);
      expect(list[0].doing).toBe(doing);
    });
    // Отправлено или нет — у самой записи, а не у задачи.
    const sent = { "task:a": { ...notes["task:a"], sentAt: "2026-09-15T11:30:00.000Z" } };
    expect(listReminders(sched([{ id: "a", status: "backlog", kind: "task" }], { notes: sent }),
      now)[0].sentAt).toBe("2026-09-15T11:30:00.000Z");
  });

  it("удалённая запись не показывается и заново не заводится", () => {
    const tasks = [{ id: "a", title: "Сверстать", status: "backlog", kind: "task",
      start: "2026-09-15T12:00", repeat: "once", warn: 30 }];
    const dead = { "task:a": { id: "task:a", kind: "task", taskId: "a", deleted: true } };
    expect(listReminders(sched(tasks, { notes: dead }), now)).toEqual([]);
    const { notes, changed } = syncNotes(sched(tasks, { notes: dead }), now);
    expect(changed).toBe(false);
    expect(notes["task:a"].deleted).toBe(true);
  });

  it("время сдвигается, пока не ушло; ушедшее не трогается", () => {
    const tasks = (start) => [{ id: "a", title: "Сверстать", status: "backlog", kind: "task",
      start, repeat: "once", warn: 0 }];
    const notes = syncNotes(sched(tasks("2026-09-15T12:00")), now).notes;
    const moved = syncNotes(sched(tasks("2026-09-15T14:00"), { notes }), now).notes;
    expect(moved["task:a"].at).toBe("2026-09-15T14:00:00.000Z");
    const gone = { "task:a": { ...moved["task:a"], sentAt: "2026-09-15T10:00:00.000Z" } };
    expect(syncNotes(sched(tasks("2026-09-15T18:00"), { notes: gone }), now)
      .notes["task:a"].at).toBe("2026-09-15T14:00:00.000Z");
  });

  it("пустое расписание — пустой список", () => {
    expect(listReminders(null, now)).toEqual([]);
  });
});

describe("когда запись пора отправить", () => {
  const now = Date.parse("2026-09-15T10:00:00Z");
  const one = (status, at, over = {}) => ({
    tzOffset: 0,
    tasks: [{ id: "a", title: "Сверстать", status, kind: "task",
      start: "2026-09-15T12:00", repeat: "once", warn: 30, ...over }],
    notes: { "task:a": { id: "task:a", kind: "task", taskId: "a", title: "Сверстать",
      at, sentAt: null } },
  });

  it("настало время — уходит", () => {
    expect(dueNotes(one("backlog", "2026-09-15T09:59:00.000Z"), now).map((n) => n.id))
      .toEqual(["task:a"]);
  });

  it("время не настало — молчит", () => {
    expect(dueNotes(one("backlog", "2026-09-15T11:30:00.000Z"), now)).toEqual([]);
  });

  /* Владелец (2026-09-20): «если пользователь взял задачу в работу до
     того, как пришло напоминание, то это напоминание должно приходить в
     момент, когда он взял задачу в работу». */
  it("взяли в работу раньше времени — уходит сразу", () => {
    expect(dueNotes(one("progress", "2026-09-15T11:30:00.000Z"), now).map((n) => n.id))
      .toEqual(["task:a"]);
  });

  it("уже отправленное второй раз не уходит", () => {
    const s = one("backlog", "2026-09-15T09:00:00.000Z");
    s.notes["task:a"].sentAt = "2026-09-15T09:00:00.000Z";
    expect(dueNotes(s, now)).toEqual([]);
  });

  it("удалённое, отменённое и сданное молчат", () => {
    const dead = one("backlog", "2026-09-15T09:00:00.000Z");
    dead.notes["task:a"].deleted = true;
    expect(dueNotes(dead, now)).toEqual([]);
    expect(dueNotes(one("backlog", "2026-09-15T09:00:00.000Z", { canceled: true }), now))
      .toEqual([]);
    expect(dueNotes(one("review", "2026-09-15T09:00:00.000Z"), now)).toEqual([]);
  });

  it("постановщику — пока задача ждёт постановки", () => {
    const s = { tzOffset: 0,
      tasks: [{ id: "b", title: "Поставить", status: "wait", kind: "setup" }],
      notes: { "setup:b": { id: "setup:b", kind: "setup", taskId: "b",
        at: "2026-09-15T10:00:00.000Z", sentAt: null } } };
    expect(dueNotes(s, now).map((n) => n.id)).toEqual(["setup:b"]);
    s.tasks[0].status = "backlog";
    expect(dueNotes(s, now)).toEqual([]);
  });

  it("время напоминания: за «предупредить» до начала, а без него — в начало", () => {
    const t = (warn) => ({ id: "a", kind: "task", status: "backlog",
      start: "2026-09-15T12:00", repeat: "once", warn });
    expect(noteAt(t(30), now, 0)).toBe(Date.parse("2026-09-15T11:30:00.000Z"));
    expect(noteAt(t(0), now, 0)).toBe(Date.parse("2026-09-15T12:00:00.000Z"));
    // Постановщику ждать нечего: задача висит непоставленной уже сейчас.
    expect(noteAt({ id: "b", kind: "setup", status: "wait" }, now, 0)).toBe(now);
  });
});
