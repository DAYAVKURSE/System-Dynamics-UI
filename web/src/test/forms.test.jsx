import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PeoplePanel from "../components/PeoplePanel.jsx";
import ProfilePanel, { filled, profileOf } from "../components/ProfilePanel.jsx";

/* АНКЕТЫ КАК СЛОВАРИ.

   Анкета — список конкретных вопросов, а не одно большое поле с подсказкой
   «пиши по шаблону»: человеку показывают каждый вопрос отдельно, и он
   отвечает на него. Анкет несколько, и назначают их ролям — в «Людях и
   ролях», рядом с ролью. Ответы лежат по идентификатору вопроса и уезжают
   той же кнопкой «Сохранить анкету». Кому анкет по ролям не назначили, тот
   видит прежнее одно поле: старые записи ничего не теряют. */

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

describe("анкеты в «Людях и ролях»", () => {
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
    // Под ролями, а не над ними: анкету назначают роли и ищут рядом с ней.
    const labels = [...container.querySelectorAll("div")].map((d) => d.textContent)
      .filter((t) => t === "роли и что они открывают" || t === "анкеты");
    expect(labels).toEqual(["роли и что они открывают", "анкеты"]);

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
    const name = await screen.findByLabelText("название анкеты «Общая»");
    fireEvent.change(name, { target: { value: "Общие вопросы" } });
    fireEvent.blur(name);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: "/api/org/forms/common", method: "PUT",
      body: { name: "Общие вопросы" } });

    const card = name.closest("div").parentElement;
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

  it("анкет по ролям нет — прежнее одно поле, и оно уезжает без словаря ответов", async () => {
    const saved = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      saved.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ profile: JSON.parse(opts.body) }) };
    }));
    render(<ProfilePanel me={{ ...ME, forms: [] }} people={[]} tasks={[]} funcs={[]} />);
    const about = screen.getByLabelText("анкета");
    fireEvent.change(about, { target: { value: "делаю отчёты" } });
    fireEvent.blur(about);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить анкету" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].about).toBe("делаю отчёты");
    expect(saved[0]).not.toHaveProperty("answers");
  });

  it("ответ на вопрос — тоже заполненная анкета", () => {
    expect(filled(profileOf({ answers: { q1: "React" } }))).toBe(true);
    expect(filled(profileOf({ answers: { q1: "  " } }))).toBe(false);
    // Старая запись без ответов читается как прежде.
    expect(profileOf({ about: "верстаю" }).answers).toEqual({});
  });
});
