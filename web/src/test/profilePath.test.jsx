import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { resetIdentity } from "../identity.js";
import { resetReportsAvailable } from "../storage.js";
import TasksBoard, { newTask } from "../components/TasksBoard.jsx";

/* ГРАФИК, «ЗА СКОЛЬКО ПРЕДУПРЕДИТЬ» И ПУТЬ ЧЕРЕЗ ВСЁ ПРИЛОЖЕНИЕ.

   Жалоба была такая: «рабочий график не сохраняется — перешёл на другую
   вкладку и обратно, а там прежние значения». Путь длинный: ProfilePanel →
   putProfile → сервер → ответ → onSaved в SystemModel → me.profile →
   повторный вход на вкладку, и черновик собирается из me.profile заново.
   Здесь он проходится целиком, с сервером, который отвечает как настоящий:
   тем, что записал. */

const HEALTH = { ok: true, scenarios: true, reminders: true, reports: true, org: true };

/* Сервер с памятью: анкета, записанная PUT'ом, приходит потом и в «кто
   я», и в списке людей, — ровно как orgStore на настоящем. */
function server({ me, users, workspace = null, scenarios = [] }) {
  const puts = [];
  const schedules = [];
  const state = { profile: { ...me.profile } };
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/api/health")) {
      return { ok: true, headers: { get: () => "application/json" },
        json: async () => HEALTH };
    }
    if (u.includes("/api/org/me/profile")) {
      const body = JSON.parse(opts.body);
      puts.push(body);
      Object.assign(state.profile, body);
      const mine = users.find((x) => String(x.id) === String(me.id));
      if (mine) Object.assign(mine, body);
      return { ok: true, status: 200, json: async () => ({ profile: { ...state.profile } }) };
    }
    if (u.includes("/api/org/me")) {
      return { ok: true, json: async () => ({ ...me, profile: { ...state.profile } }) };
    }
    if (u.includes("/api/org")) {
      return { ok: true, json: async () => ({ ownerId: "1", roles: [], users }) };
    }
    if (u.includes("/api/schedule") && opts.method === "PUT") {
      schedules.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (u.includes("/api/workspace")) {
      return { ok: true, json: async () => (workspace || {}) };
    }
    if (u.includes("/api/scenarios")) {
      return { ok: true, json: async () => scenarios };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  return { puts, schedules, state };
}

const fresh = async () => {
  vi.resetModules();
  resetIdentity();
  const { default: SystemModel } = await import("../components/SystemModel.jsx");
  return render(<SystemModel />);
};
const tab = (name) => fireEvent.click(screen.getByRole("button", { name }));

const EMPTY = { about: "", days: [], from: "", to: "", status: "ready", warnMin: 10 };
const IVAN = { id: "2", name: "Иван", isOwner: false, known: true, role: null,
  tabs: ["tasks", "tools"], profile: { ...EMPTY } };
const OWNER = { id: "1", name: "Владелец", isOwner: true, known: true, role: null,
  tabs: ["tasks", "review", "scheme", "reports", "tools"], profile: { ...EMPTY } };
const people = () => [{ id: "1", name: "Владелец", ...EMPTY }, { id: "2", name: "Иван", ...EMPTY }];

beforeEach(() => { localStorage.clear(); resetIdentity(); resetReportsAvailable(); });
afterEach(() => { vi.restoreAllMocks(); delete global.fetch; resetIdentity(); });

describe("график переживает переход между вкладками", () => {
  it("правка → сохранение → другая вкладка → обратно: значения на месте, и «Сохранено.» видно",
    async () => {
      // Анкета есть только у того, чьей роли её назначили: вопрос «Стек».
      const FORMS = [{ id: "f", name: "Анкета", questions: [{ id: "q1", text: "Стек" }] }];
      const { puts } = server({ me: { ...IVAN, forms: FORMS }, users: people() });
      await fresh();
      await waitFor(() => expect(screen.getByRole("button", { name: "Задачи" })).toBeInTheDocument());
      tab("Анкета");
      await waitFor(() => expect(screen.getByLabelText("рабочий день пн")).toBeInTheDocument());
      fireEvent.dblClick(screen.getByLabelText("рабочий день пн"));
      fireEvent.click(screen.getByLabelText("рабочие дни"));
      fireEvent.click(screen.getByLabelText("принять: часы дня"));
      fireEvent.change(screen.getByLabelText("работаю с"), { target: { value: "09:00" } });
      fireEvent.click(screen.getByLabelText("статус: короткий перерыв"));
      const about = screen.getByLabelText("Стек");
      fireEvent.change(about, { target: { value: "делаю отчёты" } });
      fireEvent.blur(about);
      fireEvent.click(screen.getByRole("button", { name: "Сохранить анкету" }));
      await waitFor(() => expect(puts.some((b) => b.answers?.q1 === "делаю отчёты")).toBe(true));
      /* Прежде «Сохранено.» стиралось тем же эффектом, что пересобирал
         черновик из нового me.profile, — человек не видел, что дошло. */
      await waitFor(() => expect(screen.getByText("Сохранено.")).toBeInTheDocument());
      expect(screen.getByLabelText("Стек")).toHaveValue("делаю отчёты");

      tab("Задачи");
      expect(screen.queryByLabelText("рабочий день пн")).toBeNull();
      tab("Анкета");
      // Вкладка собрана заново — из me.profile, куда лёг ответ сервера.
      expect(screen.getByLabelText("работаю с")).toHaveValue("09:00");
      expect(screen.getByText(/Работает: пн · с 09:00/)).toBeInTheDocument();
      expect(screen.getAllByText("короткий перерыв").length).toBeGreaterThan(0);
      expect(screen.getByLabelText("Стек")).toHaveValue("делаю отчёты");
      // И в списке людей — то же, что на вкладке: одна правда на один вопрос.
      const last = puts[puts.length - 1];
      expect(last).toMatchObject({ days: [1], from: "09:00", status: "break" });
    });

  it("нажал статус и сразу ушёл со вкладки — нажатие всё равно уехало, и обратно оно на месте",
    async () => {
      /* Так и терялся график: кнопка «Сохранить» стояла в другой карточке,
         а переключатели выглядели переключателями. Теперь уход со вкладки
         раньше задержки отправляет нажатое сразу. */
      const { puts } = server({ me: IVAN, users: people() });
      await fresh();
      await waitFor(() => expect(screen.getByRole("button", { name: "Задачи" })).toBeInTheDocument());
      tab("Анкета");
      await waitFor(() => expect(screen.getByLabelText("статус: сегодня не работаю")).toBeInTheDocument());
      fireEvent.click(screen.getByLabelText("статус: сегодня не работаю"));
      fireEvent.dblClick(screen.getByLabelText("рабочий день сб"));
      fireEvent.click(screen.getByLabelText("рабочие дни"));
      fireEvent.click(screen.getByLabelText("принять: часы дня"));
      tab("Задачи");   // раньше, чем истекла задержка
      await waitFor(() => expect(puts).toHaveLength(1));
      expect(puts[0]).toEqual({ days: [6], from: "", to: "", perDay: {}, status: "off",
        statusAt: expect.any(String) });
      tab("Анкета");
      await waitFor(() => expect(screen.getByText(/Работает: сб/)).toBeInTheDocument());
      expect(screen.getAllByText("сегодня не работаю").length).toBeGreaterThan(0);
    });
});

describe("«за сколько предупреждать» — у каждого своё", () => {
  it("карточка «Напоминания» в инструментах пишет warnMin, и расписание уходит с ним",
    async () => {
      const { puts, schedules } = server({ me: IVAN, users: people(),
        workspace: { entities: [], traits: [], funcs: [], tasks: [
          { ...newTask({ funcId: null, title: "Задача Ивана" }), id: "t1",
            status: "backlog", assignee: "2", start: "2030-01-01T10:00" }] } });
      await fresh();
      await waitFor(() => expect(screen.getByRole("button", { name: "Инструменты" })).toBeInTheDocument());
      tab("Инструменты");
      tab("Напоминания");
      expect(screen.getByText("напоминания")).toBeInTheDocument();
      const sel = screen.getByLabelText("предупреждать за");
      expect(sel).toHaveValue("10");
      fireEvent.change(sel, { target: { value: "30" } });
      await waitFor(() => expect(puts).toEqual([{ warnMin: 30 }]));
      await waitFor(() => expect(screen.getByText("Сохранено.")).toBeInTheDocument());
      /* Расписание пересылается с новым «за сколько»: оно у задачи не своё,
         а того, кому напоминают. */
      await waitFor(() => expect(schedules.some((s) =>
        s.tasks.some((t) => t.id === "t1" && t.warn === 30))).toBe(true), { timeout: 4000 });
    }, 10000);

  it("постановщику уходит напоминание о постановке, исполнителю — о работе",
    async () => {
      /* Владелец: «когда задачу нужно поставить, постановщику должно
         приходить напоминание, как и для задач». Ждущая постановки задача
         исполнителю не напоминает: начинать в ней пока нечего. */
      const { schedules } = server({ me: IVAN, users: people(),
        workspace: { entities: [], traits: [], funcs: [], tasks: [
          /* Исполнителя в ней ещё нет — её и предстоит поставить: с
             исполнителем она встала бы в бэклог сама (владелец,
             2026-09-19). */
          { ...newTask({ funcId: null, title: "Поставить" }), id: "s1",
            status: "wait", setter: "2", end: "2030-01-01T10:00" },
          { ...newTask({ funcId: null, title: "Работать" }), id: "w1",
            status: "backlog", assignee: "2", start: "2030-01-01T10:00" }] } });
      await fresh();
      await waitFor(() => expect(schedules.length).toBeGreaterThan(0), { timeout: 4000 });
      await waitFor(() => {
        const last = schedules[schedules.length - 1].tasks;
        expect(last.find((t) => t.id === "s1")?.kind).toBe("setup");
        expect(last.find((t) => t.id === "w1")?.kind).toBe("task");
      }, { timeout: 4000 });
    }, 10000);

  it("расписание уходит при входе — с «за сколько» из анкеты, а не из задачи", async () => {
    /* Записи, сделанные до v1.1, не несут исполнителя; кнопки под
       напоминанием появятся у них, только когда доска пришлёт расписание
       заново. Поэтому не ждём правки. */
    const { schedules } = server({ me: { ...IVAN, profile: { ...EMPTY, warnMin: 20 } },
      users: people(),
      workspace: { entities: [], traits: [], funcs: [], tasks: [
        { ...newTask({ funcId: null, title: "Задача Ивана" }), id: "t1", warn: 5,
          status: "backlog", assignee: "2", start: "2030-01-01T10:00" }] } });
    await fresh();
    await waitFor(() => expect(schedules.length).toBeGreaterThan(0), { timeout: 4000 });
    await waitFor(() => expect(schedules.some((s) =>
      s.tasks.some((t) => t.id === "t1"))).toBe(true), { timeout: 4000 });
    const withTask = schedules.filter((s) => s.tasks.some((t) => t.id === "t1"));
    // В задаче было своё «5» — оно не в счёт: у человека сказано «20».
    expect(withTask[withTask.length - 1].tasks.find((t) => t.id === "t1").warn).toBe(20);
  }, 10000);

  it("в расписание уходит только порученное этому человеку", async () => {
    /* Уведомление о заказе — исполнителю. Задача, где Иван постановщик или
       проверяющий, ему о начале не напоминает: работа не его. */
    const { schedules } = server({ me: { ...IVAN, profile: { ...EMPTY, warnMin: 20 } },
      users: people(),
      workspace: { entities: [], traits: [], funcs: [], tasks: [
        { ...newTask({ funcId: null, title: "Моя" }), id: "mine",
          status: "backlog", assignee: "2", start: "2030-01-01T10:00" },
        { ...newTask({ funcId: null, title: "Чужая, я ставлю" }), id: "theirs",
          status: "backlog", setter: "2", assignee: "3", start: "2030-01-01T11:00" },
        { ...newTask({ funcId: null, title: "Ничья" }), id: "nobody",
          status: "wait", assignee: null, start: "2030-01-01T12:00" }] } });
    await fresh();
    await waitFor(() => expect(schedules.some((s) =>
      s.tasks.some((t) => t.id === "mine"))).toBe(true), { timeout: 4000 });
    const last = schedules[schedules.length - 1];
    expect(last.tasks.map((t) => t.id)).toEqual(["mine"]);
  }, 10000);

  it("у новой задачи поля «предупредить» нет: это не её настройка", () => {
    expect(newTask({ funcId: "f1" })).not.toHaveProperty("warn");
  });
});

describe("постановщик приходит из ролей функции", () => {
  it("задачи из цели рождаются с постановщиком функции — форме выбирать нечего", async () => {
    /* Иначе позванный постановщик не увидел бы задачу в «ждут постановки»:
       ему показывают только те, где постановщик — он. */
    localStorage.clear(); resetIdentity();
    const { default: SystemModel } = await import("../components/SystemModel.jsx");
    const { container } = render(<SystemModel />);
    const field = () => container.querySelector("textarea");
    const commit = (el, value) => { fireEvent.change(el, { target: { value } }); fireEvent.blur(el); };
    tab("Инструменты"); tab("Выгрузка"); tab("Выгрузить");
    const doc = JSON.parse(field().value);
    // Постановщик у одной функции назван, у другой — нет.
    const funcs = doc.funcs.map((f, i) => ({ ...f, setters: i === 0 ? ["local"] : [] }));
    commit(field(), JSON.stringify({ ...doc, funcs, tasks: [] }));
    fireEvent.click(screen.getAllByRole("button", { name: "Загрузить" })[0]);
    expect(screen.getByText("Загружено.")).toBeInTheDocument();

    tab("Схема"); tab("Цели");
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть цель" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Спрогнозировать" }));
    fireEvent.click(screen.getByRole("button", { name: "Применить цель" }));

    tab("Инструменты"); tab("Выгрузка"); tab("Выгрузить");
    const after = JSON.parse(field().value);
    expect(after.tasks.length).toBeGreaterThan(0);
    /* ПУСТЫХ РОЛЕЙ У ЗАДАЧИ НЕ БЫВАЕТ (владелец, 2026-09-20): названного
       постановщика берут как есть, а неназванного заменяет исполнитель —
       «не назначен» не остаётся ни у кого. */
    after.tasks.forEach((t) => {
      const f = funcs.find((x) => x.id === t.funcId);
      if (f.setters[0]) expect(t.setter).toBe(f.setters[0]);
      else expect(t.setter).toBe(t.assignee);
    });
  });
});

/* «ОТМЕНИТЬ» НА ДОСКЕ — ЭТО ОТМЕНА РАБОТЫ.

   Отменяют то, что делают: задача в работе, человек её бросает — она
   возвращается в бэклог, к тем, кого ещё не начали. Лежащую в бэклоге
   отменять не за что: её никто не делает. Сданную проверяют, принятую
   сделали. Совсем удаляют задачу не здесь — на «Проверке», и только пока
   её не начали. */
describe("отмена работы — с доски, в бэклог", () => {
  const FUNCS = [{ id: "f1", e: "usr", name: "Сбор заявок", takes: [], gives: [],
    setters: ["1"], owners: ["2"], reviewers: ["3"] }];
  const task = () => ({ ...newTask({ funcId: "f1", title: "Задача A" }), id: "a",
    status: "backlog", setter: "1", assignee: "2", reviewer: "3", end: "2030-01-01T10:00" });
  function Board({ canAssign, onTasks, tasks: t0, onDrop }) {
    const [tasks, setTasks] = React.useState(t0
      || [task(), { ...task(), id: "b", title: "Задача B" }]);
    const [openId, setOpenId] = React.useState(null);
    React.useEffect(() => { onTasks?.(tasks); }, [tasks, onTasks]);
    return (<TasksBoard funcs={FUNCS} entities={[]} traits={[]} tasks={tasks}
      setTasks={setTasks} openId={openId} setOpenId={setOpenId} canAssign={canAssign}
      onDrop={onDrop} nameOf={(id) => id} meId="2" />);
  }
  const inWork = () => [{ ...task(), status: "progress", taken: true }];

  it("взятую в работу возвращают в бэклог — задача остаётся, взятие снимается", () => {
    let seen = [];
    const dropped = [];
    render(<Board canAssign tasks={inWork()} onTasks={(t) => { seen = t; }}
      onDrop={(t) => dropped.push(t.id)} />);
    fireEvent.click(screen.getByLabelText("отменить работу Задача A"));
    expect(screen.getByText(/Отменить работу по задаче «Задача A»\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Оставить" }));
    expect(seen[0].status).toBe("progress");

    fireEvent.click(screen.getByLabelText("отменить работу Задача A"));
    fireEvent.click(screen.getByRole("button", { name: "Да, вернуть в бэклог" }));
    expect(seen.map((t) => t.id)).toEqual(["a"]);
    expect(seen[0]).toMatchObject({ status: "backlog", taken: false });
    // Отказ уезжает на сервер: модель целиком пишет владелец.
    expect(dropped).toEqual(["a"]);
    expect(screen.getByText("Задача A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Взять в работу" })).toBeInTheDocument();
  });

  it("у лежащей в бэклоге кнопки нет: её никто не делает", () => {
    render(<Board canAssign />);
    expect(screen.queryByLabelText(/отменить работу/)).toBeNull();
  });

  it("на проверке и готовую не отменяют: кнопки нет", () => {
    /* Сданную проверяют, принятую — уже сделали: отменять там нечего. */
    render(<Board canAssign tasks={[
      { ...task(), id: "r", title: "На проверке", status: "review", taken: true },
      { ...task(), id: "p", title: "В работе", status: "progress", taken: true },
    ]} />);
    expect(screen.queryByLabelText("отменить работу На проверке")).toBeNull();
    expect(screen.getByLabelText("отменить работу В работе")).toBeInTheDocument();
  });

  it("исполнителю кнопка нужна: бросает работу тот, кто её делает", () => {
    render(<Board canAssign={false} tasks={inWork()} />);
    expect(screen.getByLabelText("отменить работу Задача A")).toBeInTheDocument();
  });

  it("нажатие «Отменить» не открывает карточку задачи", () => {
    render(<Board canAssign tasks={inWork()} />);
    fireEvent.click(screen.getByLabelText("отменить работу Задача A"));
    // Открытая карточка показала бы форму сдачи с заголовком задачи в поле.
    expect(within(document.body).queryByRole("button", { name: "СДАТЬ" })).toBeNull();
  });
});
