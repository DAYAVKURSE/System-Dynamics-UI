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


/* Разделов шесть, и всё, что относится к активу, живёт на «Схеме»: его
   воркеры, функции и ресурсы, а под ними — классификации. Цель ресурса
   задаётся там же, в его карточке, а «Прогноз» её только показывает: два
   места для одного и того же разъехались бы. */

let container;
beforeEach(() => { ({ container } = render(<SystemModel />)); });

const tab = (name) => fireEvent.click(screen.getByRole("button", { name }));
const forecast = () => { tab("Прогноз"); expandCards(container); };
const dump = () => {
  fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
  fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
  fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
  return JSON.parse(container.querySelector("textarea").value);
};

describe("состав вкладок", () => {
  it("отдельных «Цели» и «Типы» больше нет", () => {
    // Первыми в разметке идут кнопки истории — переключатели вкладок за ними.
    const bar = [...container.querySelectorAll("button")]
      .map((b) => b.textContent)
      .filter((t) => ["Задачи", "Проверка", "Timeline", "Схема", "Прогноз",
        "Инструменты", "Звонки", "Выгрузить", "Цели", "Типы", "Отчёты"].includes(t));
    expect(bar.slice(0, 6)).toEqual(["Задачи", "Проверка", "Timeline",
      "Схема", "Прогноз", "Инструменты"]);
    expect(screen.queryByRole("button", { name: "Цели" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Типы" })).toBeNull();
  });
});

describe("классификации — на «Схеме»", () => {
  it("список и добавление классификации живут под карточкой актива", () => {
    tab("Схема");
    expect(screen.getByText("классификации ресурсов")).toBeTruthy();
    const add = screen.getByRole("button", { name: "+ классификация" });
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
    fireEvent.click(screen.getByRole("button", { name: "+ классификация" }));
    expect(dump().kinds.length).toBe(before + 1);
    tab("Схема");
    expect(screen.getByRole("button", { name: /^\+ • новая классификация$/ }))
      .toBeInTheDocument();
  });
});

describe("три части актива — одинаковыми формами", () => {
  it("воркеры, функции и ресурсы стоят в одном месте и в одном порядке", () => {
    tab("Схема");
    const order = ["воркеры актива", "функции актива", "ресурсы актива"]
      .map((t) => [...container.querySelectorAll("*")].indexOf(screen.getByText(t)));
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it("карточки всех трёх разделов раскрываются одинаково", () => {
    tab("Схема");
    // Одна грамматика на все разделы: «развернуть …» + название + «удалить».
    expect(screen.getAllByRole("button", { name: "развернуть функции" }).length)
      .toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "развернуть ресурса" }).length)
      .toBeGreaterThan(0);
  });
});

describe("цель ресурса", () => {
  it("задаётся в карточке ресурса и уезжает в модель", () => {
    tab("Схема");
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть ресурса" })[0]);
    const want = screen.getByPlaceholderText("без цели");
    fireEvent.change(want, { target: { value: "999" } });
    fireEvent.blur(want);
    expect(dump().traits.some((t) => Number(t.want) === 999)).toBe(true);
  });

  it("«Прогноз» показывает цели и два срока — наверняка и в лучшем случае", () => {
    tab("Прогноз");
    expect(screen.getByText("цели")).toBeTruthy();
    expect(screen.getAllByText(/в лучшем случае|не достигается/).length)
      .toBeGreaterThan(0);
  });

  it("ресурс без цели тоже показан — карточкой прогноза", () => {
    tab("Прогноз");
    // «заявки» — ресурс без планки: он в списке своего актива.
    expect(screen.getAllByText("заявки").length).toBeGreaterThan(0);
  });
});
