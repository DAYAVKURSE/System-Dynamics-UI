import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SystemModel, { TAB_LIST } from "../components/SystemModel.jsx";
import ProfilePanel, { PROFILE_FIELDS, filled, profileOf }
  from "../components/ProfilePanel.jsx";
import { resetIdentity } from "../identity.js";

/* СТРАНИЦА ЧЕЛОВЕКА: анкета и рейтинг.

   Рейтинг говорит, КАК человек работал, но не говорит, кто он. Анкету
   пишет он сам и только свою: про себя он знает точнее, а заполненная
   кем-то другим она была бы чужим мнением под чужим именем. */

const ME = { id: "2", name: "Иван", isOwner: false, known: true, tabs: ["tasks"],
  profile: { title: "аналитик", about: "", skills: "", contact: "" } };
const PEOPLE = [{ id: "2", name: "Иван", title: "аналитик" },
  { id: "3", name: "Пётр", title: "верстальщик", about: "делаю макеты" }];

afterEach(() => vi.restoreAllMocks());

describe("анкета", () => {
  it("полей немного: анкета должна заполняться, а не отпугивать", () => {
    expect(PROFILE_FIELDS.map((f) => f.id))
      .toEqual(["title", "about", "skills", "contact"]);
  });

  it("пустая анкета — это пусто, а не отсутствие человека", () => {
    expect(filled(profileOf({ id: "9" }))).toBe(false);
    expect(filled(profileOf({ title: "аналитик" }))).toBe(true);
  });

  it("свою можно править, и она уходит на сервер", async () => {
    const saved = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      saved.push([url, JSON.parse(opts.body)]);
      return { ok: true, status: 200, json: async () => ({ profile: JSON.parse(opts.body) }) };
    }));
    render(<ProfilePanel me={ME} people={PEOPLE} tasks={[]} funcs={[]} />);
    const about = screen.getByLabelText("о себе");
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
    expect(screen.queryByLabelText("о себе")).toBeNull();
    expect(screen.queryByRole("button", { name: "Сохранить анкету" })).toBeNull();
  });

  it("с чужой страницы видно, как вернуться к своей", () => {
    const opened = [];
    render(<ProfilePanel me={ME} personId="3" people={PEOPLE} tasks={[]} funcs={[]}
      onPerson={(id) => opened.push(id)} />);
    fireEvent.click(screen.getByRole("button", { name: "← моя анкета" }));
    expect(opened).toEqual(["2"]);
  });

  it("рейтинг — на той же странице, а не в отдельном окне", () => {
    const tasks = [{ id: "a", funcId: "f1", assignee: "2", status: "done",
      title: "Сбор заявок", end: "2026-01-02T09:00:00Z",
      submissions: [{ at: "2026-01-01T09:00:00Z", hours: 2, takes: {}, gives: {} }],
      reviews: [{ accept: true, mark: 5, comment: "хорошо" }] }];
    render(<ProfilePanel me={ME} people={PEOPLE} tasks={tasks}
      funcs={[{ id: "f1", name: "Сбор заявок" }]} />);
    expect(screen.getByText("рейтинг и работы")).toBeInTheDocument();
    expect(screen.getByText("5/5")).toBeInTheDocument();
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

  it("страница человека — вкладкой, а не окном поверх работы", () => {
    // Истории может быть много: в окне её пришлось бы листать поверх того,
    // что под ним, и закрывать, чтобы вернуться к делу.
    render(<SystemModel />);
    fireEvent.click(screen.getByRole("button", { name: "Анкета" }));
    expect(screen.getByText("рейтинг и работы")).toBeInTheDocument();
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
});
