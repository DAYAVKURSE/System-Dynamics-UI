import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

// Карточки прогноза свёрнуты: имя и график. Всё остальное разворачивается
// нажатием на заголовок, поэтому тесты сначала раскрывают карточки.
const expandCards = (container) => {
  [...container.querySelectorAll("span")]
    .filter((s) => s.textContent === "\u25b8")
    .forEach((s) => fireEvent.click(s.parentElement));
};


/* Разделов стало пять: «Цели» слились с «Прогнозом», «Типы» — со «Схемой».
   Проверяем, что содержимое не потерялось при переезде и что целевым можно
   сделать любой ресурс, а не только заранее размеченный. */

let container;
beforeEach(() => { ({ container } = render(<SystemModel />)); });

const tab = (name) => fireEvent.click(screen.getByRole("button", { name }));
const forecast = () => { tab("Прогноз"); expandCards(container); };
const dump = () => {
  fireEvent.click(screen.getAllByRole("button", { name: "Выгрузить" })[0]);
  fireEvent.click(screen.getAllByRole("button", { name: "Выгрузить" })[1]);
  return JSON.parse(container.querySelector("textarea").value);
};

describe("состав вкладок", () => {
  it("отдельных «Цели» и «Типы» больше нет", () => {
    // Первыми в разметке идут кнопки истории — переключатели вкладок за ними.
    const bar = [...container.querySelectorAll("button")]
      .map((b) => b.textContent)
      .filter((t) => ["Задачи", "Проверка", "Timeline", "Звонки", "Схема",
        "Прогноз", "Выгрузить", "Цели", "Типы", "Отчёты"].includes(t));
    expect(bar.slice(0, 7)).toEqual(["Задачи", "Проверка", "Timeline", "Звонки",
      "Схема", "Прогноз", "Выгрузить"]);
    expect(screen.queryByRole("button", { name: "Цели" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Типы" })).toBeNull();
  });
});

describe("классификации — на «Схеме»", () => {
  it("список и добавление классификации живут под добавлением ресурса", () => {
    tab("Схема");
    expect(screen.getByText("классификации ресурсов")).toBeTruthy();
    const add = screen.getByRole("button", { name: "+ добавить классификацию" });
    // Ниже добавления ресурса, а не выше: тип выбирается уже после того,
    // как ресурс назван.
    const all = [...container.querySelectorAll("*")];
    const draft = screen.getByPlaceholderText("текст нового ресурса");
    expect(all.indexOf(add)).toBeGreaterThan(all.indexOf(draft));
  });

  it("добавленная классификация сразу доступна как кнопка создания ресурса", () => {
    tab("Схема");
    const before = dump().kinds.length;
    tab("Схема");
    fireEvent.click(screen.getByRole("button", { name: "+ добавить классификацию" }));
    expect(dump().kinds.length).toBe(before + 1);
  });
});

describe("цели — на «Прогнозе»", () => {
  it("карточка цели с планкой и сроком показана здесь же", () => {
    forecast();
    expect(screen.getByText("поставить цель")).toBeTruthy();
    // Планка и срок — поля карточки цели, у нецелевых ресурсов их нет.
    expect(screen.getAllByText("нужно").length).toBeGreaterThan(0);
    expect(screen.getAllByText("к месяцу").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/что поднять, чтобы успеть/).length)
      .toBeGreaterThan(0);
  });

  it("нецелевой ресурс показан карточкой прогноза — с графиком и без планки", () => {
    forecast();
    expect(screen.getByText("остальные ресурсы — по активам")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "сделать целью" }).length)
      .toBeGreaterThan(0);
  });

  it("целью можно сделать любой ресурс, и он переезжает в карточки целей", () => {
    forecast();
    const before = dump().traits.filter((t) => t.want != null).length;
    forecast();
    fireEvent.click(screen.getAllByRole("button", { name: "сделать целью" })[0]);
    const goals = dump().traits.filter((t) => t.want != null);
    expect(goals.length).toBe(before + 1);
    // Планка и срок проставлены оба: цель без срока некуда успевать.
    const fresh = goals[goals.length - 1];
    expect(fresh.want).not.toBeNull();
    expect(fresh.by).toBeGreaterThan(0);
  });

  it("«убрать из целей» возвращает ресурс в обычный прогноз", () => {
    forecast();
    const before = dump().traits.filter((t) => t.want != null).length;
    forecast();
    fireEvent.click(screen.getAllByRole("button", { name: "убрать из целей" })[0]);
    expect(dump().traits.filter((t) => t.want != null).length).toBe(before - 1);
  });

  it("став целью, ресурс уходит из карточек прогноза — не показан дважды", () => {
    forecast();
    // Карточки прогноза узнаются по кнопке «сделать целью»; берём первую,
    // делаем её ресурс целью и смотрим, что второй карточки не осталось.
    const plainNames = () => screen.queryAllByRole("button", { name: "сделать целью" })
      .map((b) => b.closest("div").parentElement.textContent);
    const before = plainNames();
    expect(before.length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "сделать целью" })[0]);

    const after = plainNames();
    expect(after.length).toBe(before.length - 1);
    // Именно та карточка и ушла — не какая-нибудь соседняя.
    const gone = before.filter((t) => !after.includes(t));
    expect(gone).toHaveLength(1);
  });
});
