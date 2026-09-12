import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SystemModel, { TAB_LIST } from "../components/SystemModel.jsx";
import ProfilePanel, { PROFILE_FIELDS, filled, profileOf }
  from "../components/ProfilePanel.jsx";
import { resetIdentity } from "../identity.js";

/* ЧЕЛОВЕК: анкета и рейтинг.

   Рейтинг говорит, КАК человек работал, но не говорит, кто он. Анкету
   пишет он сам и только свою: про себя он знает точнее, а заполненная
   кем-то другим она была бы чужим мнением под чужим именем.

   Поле в анкете ОДНО. Прежде их было четыре — «чем занимается», «о себе»,
   «что умеет», «как связаться»: это была не анкета, а допрос по форме,
   которую никто не заказывал. */

const ME = { id: "2", name: "Иван", isOwner: false, known: true, tabs: ["tasks"],
  profile: { about: "" } };
const PEOPLE = [{ id: "2", name: "Иван" },
  { id: "3", name: "Пётр", about: "делаю макеты" }];

afterEach(() => vi.restoreAllMocks());

describe("анкета", () => {
  it("поле одно: что о себе писать, решает человек, а не форма", () => {
    expect(PROFILE_FIELDS.map((f) => f.id)).toEqual(["about"]);
  });

  it("пустая анкета — это пусто, а не отсутствие человека", () => {
    expect(filled(profileOf({ id: "9" }))).toBe(false);
    expect(filled(profileOf({ about: "аналитик" }))).toBe(true);
  });

  it("свою можно править, и она уходит на сервер", async () => {
    const saved = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      saved.push([url, JSON.parse(opts.body)]);
      return { ok: true, status: 200, json: async () => ({ profile: JSON.parse(opts.body) }) };
    }));
    render(<ProfilePanel me={ME} people={PEOPLE} tasks={[]} funcs={[]} />);
    const about = screen.getByLabelText("анкета");
    fireEvent.change(about, { target: { value: "делаю отчёты" } });
    fireEvent.blur(about);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить анкету" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0][0]).toBe("/api/org/me/profile");
    expect(saved[0][1].about).toBe("делаю отчёты");
    expect(screen.getByText("Сохранено.")).toBeInTheDocument();
  });

  it("чужая только читается: писать там нечего, а не «нет прав»", () => {
    render(<ProfilePanel me={ME} personId="3" people={PEOPLE} tasks={[]} funcs={[]} />);
    expect(screen.getByText("Пётр")).toBeInTheDocument();
    expect(screen.getByText("делаю макеты")).toBeInTheDocument();
    expect(screen.queryByLabelText("анкета")).toBeNull();
    expect(screen.queryByRole("button", { name: "Сохранить анкету" })).toBeNull();
  });

  /* ─── РАБОЧИЙ ГРАФИК И СТАТУС ───

     Анкета говорит, ЧТО человек умеет; график и статус — РАБОТАЕТ ЛИ ОН
     СЕЙЧАС. Второе спрашивают раньше первого: ставить задачу тому, у кого
     сегодня выходной, значит назначить срок, которого никто не обещал. */
  it("свой график и статус человек ставит сам, и они уходят сами — без кнопки",
    async () => {
      /* Это переключатели, а не поля формы: «сегодня не работаю» нажимают
         и уходят. Кнопка стояла в другой карточке и называлась «анкету» —
         нажатый статус оставался в браузере и терялся с уходом со вкладки.
         Теперь нажатия уезжают сами, подряд идущие — одним запросом. */
      const saved = [];
      vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
        saved.push(JSON.parse(opts.body));
        return { ok: true, status: 200,
          json: async () => ({ profile: { about: "", ...JSON.parse(opts.body) } }) };
      }));
      render(<ProfilePanel me={ME} people={PEOPLE} tasks={[]} funcs={[]} />);
      expect(screen.getByText(/сохраняются сами, при каждом нажатии/)).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText("рабочий день пн"));
      fireEvent.click(screen.getByLabelText("рабочий день вт"));
      fireEvent.change(screen.getByLabelText("работаю с"),
        { target: { value: "09:00" } });
      fireEvent.change(screen.getByLabelText("работаю до"),
        { target: { value: "18:00" } });
      fireEvent.click(screen.getByLabelText("статус: короткий перерыв"));
      await waitFor(() => expect(screen.getByText("график сохранён")).toBeInTheDocument());
      // Пять нажатий подряд — один запрос, и в нём всё сразу.
      expect(saved).toHaveLength(1);
      expect(saved[0]).toEqual({ days: [1, 2], from: "09:00", to: "18:00",
        perDay: {}, status: "break" });
      // Текст анкеты этим запросом не трогается: его человек шлёт сам.
      expect(saved[0]).not.toHaveProperty("about");
    });

  it("сервер не ответил — карточка говорит это словами, а не молчит", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500,
      json: async () => ({ error: "диск недоступен" }) })));
    render(<ProfilePanel me={ME} people={PEOPLE} tasks={[]} funcs={[]} />);
    fireEvent.click(screen.getByLabelText("статус: сегодня не работаю"));
    await waitFor(() => expect(screen.getByText(/График не сохранился: диск недоступен/))
      .toBeInTheDocument());
    // Нажатое при этом на месте: человек видит, что именно не дошло.
    expect(screen.getAllByText("сегодня не работаю").length).toBeGreaterThan(0);
  });

  it("список людей, пришедший позже, не стирает того, что человек уже нажал", async () => {
    /* «Кто я» приходит первым, список людей — вторым, а «Люди и роли»
       перечитывают его ещё раз. Прежде каждый такой приход пересобирал
       черновик из пропсов, и нажатое до него молча заменялось прежним. */
    const saved = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      saved.push(JSON.parse(opts.body));
      return { ok: true, status: 200,
        json: async () => ({ profile: { about: "", ...JSON.parse(opts.body) } }) };
    }));
    const { rerender } = render(
      <ProfilePanel me={ME} people={[]} tasks={[]} funcs={[]} />);
    fireEvent.click(screen.getByLabelText("рабочий день сб"));
    const about = screen.getByLabelText("анкета");
    fireEvent.change(about, { target: { value: "пишу" } });
    fireEvent.blur(about);
    // Приехал список людей и заново приехало «кто я» — с прежней анкетой.
    rerender(<ProfilePanel me={{ ...ME, profile: { about: "старое", days: [] } }}
      people={PEOPLE} tasks={[]} funcs={[]} />);
    expect(screen.getByLabelText("анкета")).toHaveValue("пишу");
    expect(screen.getByText(/Работает: сб/)).toBeInTheDocument();
    await waitFor(() => expect(saved.some((b) => JSON.stringify(b.days) === "[6]")).toBe(true));
  });

  it("график читается словами, а подряд идущие дни склеиваются", () => {
    /* «пн, вт, ср, чт, пт» человек пересчитывает в уме, а «пн–пт» —
       читает сразу. */
    render(<ProfilePanel me={ME} personId="3" tasks={[]} funcs={[]}
      people={[{ id: "3", name: "Пётр", days: [1, 2, 3, 4, 5],
        from: "10:00", to: "19:00", status: "off" }]} />);
    expect(screen.getByText(/Работает: пн–пт · 10:00–19:00/)).toBeInTheDocument();
    expect(screen.getByText("сегодня не работаю")).toBeInTheDocument();
  });

  it("чужой график виден, но не правится: это его слова, а не наши", () => {
    render(<ProfilePanel me={ME} personId="3" tasks={[]} funcs={[]}
      people={[{ id: "3", name: "Пётр", days: [6], from: "12:00" }]} />);
    expect(screen.getByText(/Работает: сб · с 12:00/)).toBeInTheDocument();
    expect(screen.queryByLabelText("рабочий день пн")).toBeNull();
    expect(screen.queryByLabelText("работаю с")).toBeNull();
    expect(screen.queryByLabelText("статус: короткий перерыв")).toBeNull();
  });

  it("не задан — так и сказано: пусто это не «все дни и круглые сутки»", () => {
    render(<ProfilePanel me={ME} personId="3" tasks={[]} funcs={[]}
      people={[{ id: "3", name: "Пётр" }]} />);
    expect(screen.getByText(/График не задан/)).toBeInTheDocument();
    expect(screen.getByText("дни не названы")).toBeInTheDocument();
    expect(screen.getByText("часы не названы")).toBeInTheDocument();
  });

  it("чужих анкет на странице нет: она про одного человека", () => {
    /* Список остальных превращал страницу в справочник и предлагал уйти с
       неё ровно тогда, когда её открыли, чтобы прочитать. */
    render(<ProfilePanel me={ME} personId="3" people={PEOPLE} tasks={[]} funcs={[]} />);
    expect(screen.queryByText("другие люди")).toBeNull();
    expect(screen.queryByRole("button", { name: "Иван" })).toBeNull();
  });

  /* ─── ПРО СЕБЯ ЧЕЛОВЕК ВИДИТ НЕ ВСЁ ───

     Свои оценки и свой рейтинг не показываются: рейтинг существует, чтобы
     ЕМУ поручали работу, а не чтобы он смотрел на себя. Адресованные ему
     слова — показываются. */
  const rated = (over = {}) => [{ id: "a", funcId: "f1", assignee: "2", status: "done",
    title: "Сбор заявок", end: "2026-01-02T09:00:00Z",
    submissions: [{ at: "2026-01-01T09:00:00Z", hours: 2, takes: {}, gives: {} }],
    reviews: [{ accept: true, mark: 5, comment: "хорошо", by: "3", ...over }] }];

  it("рейтинг чужого — на той же странице, а не в отдельном окне", () => {
    render(<ProfilePanel me={{ ...ME, id: "9" }} personId="2" people={PEOPLE}
      tasks={rated()} published={["a~work~3"]}
      funcs={[{ id: "f1", name: "Сбор заявок" }]} />);
    expect(screen.getByText("рейтинг и работы")).toBeInTheDocument();
    expect(screen.getByText("5/10")).toBeInTheDocument();
  });

  it("свои оценки не показываются — вместо них сказано, почему", () => {
    render(<ProfilePanel me={ME} people={PEOPLE} tasks={rated()} published={["a~work~3"]}
      funcs={[{ id: "f1", name: "Сбор заявок" }]} />);
    expect(screen.getByText(/Свои оценки не показываются: рейтинг работает на того, кто поручает/))
      .toBeInTheDocument();
    expect(screen.queryByText("5/10")).toBeNull();
    expect(screen.queryByText(/средняя оценка/)).toBeNull();
    // Опубликованные слова про себя — видны, без имени: в списке
    // адресованных и у самой работы.
    expect(screen.getAllByText(/хорошо/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Пётр/)).toBeNull();
  });

  it("скрытые слова доходят до адресата сразу, а не после публикации", () => {
    render(<ProfilePanel me={ME} people={PEOPLE} published={[]}
      tasks={rated({ comment: "лично тебе", hidden: true })}
      funcs={[{ id: "f1", name: "Сбор заявок" }]} />);
    expect(screen.getAllByText(/лично тебе/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/скрытый · только вам/).length).toBeGreaterThan(0);
  });
});

describe("вкладка «Анкета»", () => {
  beforeEach(() => { localStorage.clear(); resetIdentity(); });

  it("стоит первой — до задач", () => {
    expect(TAB_LIST[0]).toEqual(["me", "Анкета"]);
  });

  it("открыта всем вошедшим, а не по роли", async () => {
    // Своя анкета — не привилегия: спрятать её за ролью значило бы, что
    // открыть её нельзя без чужого разрешения.
    render(<SystemModel />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Анкета" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Анкета" }));
    expect(screen.getByText("моя анкета")).toBeInTheDocument();
  });

  it("своя анкета — вкладка, и открывается она сразу, а не окном", () => {
    render(<SystemModel />);
    fireEvent.click(screen.getByRole("button", { name: "Анкета" }));
    // Своя страница: вместо рейтинга — адресованные слова.
    expect(screen.getByText("комментарии и работы")).toBeInTheDocument();
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
});
