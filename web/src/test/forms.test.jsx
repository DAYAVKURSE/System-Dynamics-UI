import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PeoplePanel from "../components/PeoplePanel.jsx";
import ProfilePanel, { filled, profileOf } from "../components/ProfilePanel.jsx";

/* АНКЕТЫ КАК СЛОВАРИ.

   Анкета — список конкретных вопросов, а не одно большое поле с подсказкой
   «пиши по шаблону»: человеку показывают каждый вопрос отдельно, и он
   отвечает на него. Анкет несколько, и назначают их ролям — в «Людях и
   ролях», рядом с ролью. Ответы лежат по идентификатору вопроса и уезжают
   той же кнопкой «Сохранить анкету». Кому анкет по ролям не назначили, у
   того формы «моя анкета» нет вовсе: спрашивать нечего. Анкету можно
   загрузить списком — «1. вопрос» на строку. */

const FORMS = [
  { id: "dev", name: "Анкета разработчика",
    questions: [{ id: "q1", text: "Стек" }, { id: "q2", text: "Уровень" }] },
  { id: "common", name: "Общая", questions: [{ id: "q3", text: "Город" }] },
];
const ORG = {
  ownerId: "1",
  roles: [{ id: "executor", name: "исполнитель", tabs: ["tasks"], form: "dev" },
    { id: "reviewer", name: "проверяющий", tabs: ["review"], form: null }],
  users: [{ id: "1", name: "Владелец", roles: [] }],
  forms: FORMS,
};

/* Сервер владельца: список организации и правки. Каждая правка запоминается,
   чтобы проверить, что именно уехало, — список после неё перечитывается. */
const ownerServer = () => {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (opts.method && opts.method !== "GET") {
      calls.push({ url: u, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
      return { ok: true, status: opts.method === "DELETE" ? 204 : 200, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ORG };
  }));
  return calls;
};

afterEach(() => vi.restoreAllMocks());

describe("анкеты в «Ролях»", () => {
  it("у роли выбирается анкета, и выбор уезжает на сервер", async () => {
    const calls = ownerServer();
    render(<PeoplePanel />);
    const pick = await screen.findByLabelText("анкета роли «исполнитель»");
    expect(pick).toHaveValue("dev");
    expect([...pick.options].map((o) => o.textContent))
      .toEqual(["— нет —", "Анкета разработчика", "Общая"]);
    expect(screen.getByLabelText("анкета роли «проверяющий»")).toHaveValue("");

    fireEvent.change(screen.getByLabelText("анкета роли «проверяющий»"),
      { target: { value: "common" } });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: "/api/org/roles/reviewer/form", method: "PUT",
      body: { formId: "common" } });
    // «— нет —» снимает анкету: роль ничего не спрашивает.
    fireEvent.change(pick, { target: { value: "" } });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body).toEqual({ formId: null });
  });

  it("раздел «анкеты» стоит под ролями и заводит новую по названию", async () => {
    const calls = ownerServer();
    const { container } = render(<PeoplePanel />);
    await screen.findByText("анкеты");
    // Три формы, каждая своей карточкой: участники, роли, анкеты — в этом порядке.
    const [people, roles, forms] = ["участники", "роли", "анкеты"].map((l) => screen.getByLabelText(l));
    // eslint-disable-next-line no-bitwise
    expect(people.compareDocumentPosition(roles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(roles.compareDocumentPosition(forms) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container).toBeTruthy();

    const add = screen.getByRole("button", { name: "+ анкета" });
    expect(add).toBeDisabled();
    const name = screen.getByPlaceholderText("название новой анкеты");
    fireEvent.change(name, { target: { value: "Курьер" } });
    fireEvent.blur(name);
    fireEvent.click(add);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: "/api/org/forms", method: "POST",
      body: { name: "Курьер" } });
  });

  it("«Загрузить анкету» принимает пронумерованный список и шлёт вопросы одной записью", async () => {
    const calls = ownerServer();
    render(<PeoplePanel />);
    await screen.findByText("анкеты");
    fireEvent.click(screen.getByRole("button", { name: "Загрузить анкету" }));
    const load = screen.getByLabelText("загрузить анкету из списка");
    expect(load).toBeDisabled();
    const text = screen.getByLabelText("текст анкеты");
    fireEvent.change(text, { target: { value: "Стек\nУровень" } });
    expect(screen.getByText(/Нужен пронумерованный список/)).toBeInTheDocument();
    fireEvent.change(text, { target: { value: "1. Стек\n2. Уровень\nподробно\n3) Город" } });
    expect(screen.getByText("вопросов: 3")).toBeInTheDocument();
    // Без названия не уезжает: анкете нужно имя, как и при «+ анкета».
    expect(load).toBeDisabled();
    const name = screen.getByPlaceholderText("название новой анкеты");
    fireEvent.change(name, { target: { value: "Курьер" } });
    fireEvent.blur(name);
    fireEvent.click(load);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: "/api/org/forms", method: "POST",
      body: { name: "Курьер", questions: ["Стек", "Уровень подробно", "Город"] } });
  });

  it("вопросы правятся списком: текст с прежним id, «+ вопрос», «✕»", async () => {
    const calls = ownerServer();
    render(<PeoplePanel />);
    const q1 = await screen.findByLabelText("вопрос 1 анкеты «Анкета разработчика»");
    expect(q1).toHaveValue("Стек");

    // Правка текста — тот же вопрос: его id остаётся, и ответы при нём.
    fireEvent.change(q1, { target: { value: "Стек и инструменты" } });
    fireEvent.blur(q1);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: "/api/org/forms/dev", method: "PUT" });
    expect(calls[0].body.questions).toEqual([{ id: "q1", text: "Стек и инструменты" },
      { id: "q2", text: "Уровень" }]);

    // Новый вопрос — строкой в конец списка.
    const add = screen.getByRole("button", { name: "добавить вопрос в анкету «Анкета разработчика»" });
    expect(add).toBeDisabled();
    const text = screen.getByLabelText("новый вопрос анкеты «Анкета разработчика»");
    fireEvent.change(text, { target: { value: "Языки" } });
    fireEvent.blur(text);
    fireEvent.click(add);
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body.questions).toEqual([{ id: "q1", text: "Стек" },
      { id: "q2", text: "Уровень" }, "Языки"]);

    // ✕ убирает один вопрос, остальные едут как были.
    fireEvent.click(screen.getByLabelText("убрать вопрос 2 анкеты «Анкета разработчика»"));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].body.questions).toEqual([{ id: "q1", text: "Стек" }]);

    // Стёртый текст не уезжает: убрать вопрос — это ✕, а не пустая строка.
    fireEvent.change(q1, { target: { value: "   " } });
    fireEvent.blur(q1);
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(3);
  });

  it("анкета переименовывается и удаляется", async () => {
    const calls = ownerServer();
    render(<PeoplePanel />);
    /* Название анкеты — надпись: правка открывается двойным нажатием
       (владелец, 2026-09-19). */
    const label = await screen.findByLabelText("название анкеты «Общая»");
    const card = label.closest("div").parentElement;
    fireEvent.doubleClick(label);
    const name = screen.getByLabelText("название анкеты «Общая»");
    fireEvent.change(name, { target: { value: "Общие вопросы" } });
    fireEvent.blur(name);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: "/api/org/forms/common", method: "PUT",
      body: { name: "Общие вопросы" } });

    fireEvent.click(within(card).getByRole("button", { name: "Удалить анкету" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({ url: "/api/org/forms/common", method: "DELETE" });
  });
});

describe("вопросы в анкете человека", () => {
  const ME = { id: "2", name: "Иван", isOwner: false, known: true, tabs: ["tasks"],
    profile: { about: "", answers: { q1: "React" } }, forms: FORMS };

  it("есть анкеты по ролям — показаны вопросы, а не одно поле", () => {
    render(<ProfilePanel me={ME} people={[]} tasks={[]} funcs={[]} />);
    expect(screen.getByText("Анкета разработчика")).toBeInTheDocument();
    expect(screen.getByText("Общая")).toBeInTheDocument();
    expect(screen.getByLabelText("Стек")).toHaveValue("React");
    expect(screen.getByLabelText("Уровень")).toHaveValue("");
    expect(screen.getByLabelText("Город")).toHaveValue("");
    expect(screen.queryByLabelText("анкета")).toBeNull();
  });

  it("ответы уходят той же кнопкой «Сохранить анкету», по идентификатору вопроса", async () => {
    const saved = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      saved.push([String(url), JSON.parse(opts.body)]);
      return { ok: true, status: 200,
        json: async () => ({ profile: { about: "", ...JSON.parse(opts.body) } }) };
    }));
    render(<ProfilePanel me={ME} people={[]} tasks={[]} funcs={[]} />);
    const level = screen.getByLabelText("Уровень");
    fireEvent.change(level, { target: { value: "middle" } });
    fireEvent.blur(level);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить анкету" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0][0]).toBe("/api/org/me/profile");
    // Прежний ответ едет вместе с новым: словарь целиком, а не одна правка.
    expect(saved[0][1].answers).toEqual({ q1: "React", q2: "middle" });
    expect(screen.getByText("Сохранено.")).toBeInTheDocument();
    // И после ответа сервера ответ остаётся на месте.
    expect(screen.getByLabelText("Уровень")).toHaveValue("middle");
  });

  it("чужая анкета читается вопросом и ответом, без полей ввода", () => {
    render(<ProfilePanel me={{ ...ME, id: "9", forms: [] }} personId="2" tasks={[]} funcs={[]}
      people={[{ id: "2", name: "Иван", answers: { q1: "React" }, forms: [FORMS[0]] }]} />);
    expect(screen.getByText("Анкета разработчика")).toBeInTheDocument();
    expect(screen.getByText("Стек")).toBeInTheDocument();
    expect(screen.getByText("React")).toBeInTheDocument();
    expect(screen.getByText("Уровень")).toBeInTheDocument();
    expect(screen.getByText("не заполнено")).toBeInTheDocument();
    expect(screen.queryByLabelText("Стек")).toBeNull();
    expect(screen.queryByRole("button", { name: "Сохранить анкету" })).toBeNull();
  });

  it("анкет по ролям нет — формы «моя анкета» нет вовсе, только имя, график и работы", () => {
    /* Владелец: «если пользователю не назначена анкета, значит у него на
       вкладке «Анкета» не должно быть формы «Моя анкета»». */
    render(<ProfilePanel me={{ ...ME, forms: [] }} people={[]} tasks={[]} funcs={[]} />);
    expect(screen.getByText("Иван")).toBeInTheDocument();
    expect(screen.queryByText("моя анкета")).toBeNull();
    expect(screen.queryByLabelText("анкета")).toBeNull();
    expect(screen.queryByRole("button", { name: "Сохранить анкету" })).toBeNull();
    expect(screen.getByText("мой рабочий график")).toBeInTheDocument();
  });

  it("анкета стоит первой и прокручивается отдельно от остальной страницы", () => {
    render(<ProfilePanel me={ME} people={[]} tasks={[]} funcs={[]} />);
    const form = screen.getByText("моя анкета");
    const schedule = screen.getByText("мой рабочий график");
    // eslint-disable-next-line no-bitwise
    expect(form.compareDocumentPosition(schedule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const box = screen.getByLabelText("вопросы анкеты");
    expect(box.style.overflowY).toBe("auto");
    expect(box.style.maxHeight).toBe("55vh");
    expect(within(box).getByLabelText("Стек")).toBeInTheDocument();
  });

  it("ответ на вопрос — тоже заполненная анкета", () => {
    expect(filled(profileOf({ answers: { q1: "React" } }))).toBe(true);
    expect(filled(profileOf({ answers: { q1: "  " } }))).toBe(false);
    // Старая запись без ответов читается как прежде.
    expect(profileOf({ about: "верстаю" }).answers).toEqual({});
  });
});
