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


/* Всё, что относится к активу, живёт на «Схеме»: его воркеры, функции и
   ресурсы, а классификации — там же, где ресурсы, потому что классификация
   это свойство ресурса. Цель у ресурса не хранится: она задаётся в
   «Прогнозе», где у неё есть темп, срок и цена. */

let container;
beforeEach(() => { ({ container } = render(<SystemModel />)); });

const tab = (name) => fireEvent.click(screen.getByRole("button", { name }));
/* Три части актива живут во вкладках: до ресурсов надо переключиться. */
const assetTab = (name) => fireEvent.click(
  screen.getByRole("button", { name: new RegExp(`^${name}`) }));
/* «Прогноз» — подвкладка под схемой: сначала схема, потом он. */
const forecast = () => { tab("Схема"); tab("Прогноз"); expandCards(container); };
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
      .filter((t) => ["Задачи", "Проверка", "Схема",
        "Инструменты", "Звонки", "Выгрузить", "Цели", "Типы", "Отчёты"].includes(t));
    // «Прогноз» и «Timeline» из главного ряда ушли под схему: обе про ту
    // же модель во времени, и ползунок месяца у них общий со схемой.
    expect(bar.slice(0, 4)).toEqual(["Задачи", "Проверка", "Схема", "Инструменты"]);
    expect(screen.queryByRole("button", { name: "Прогноз" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Timeline" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Цели" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Типы" })).toBeNull();
  });
});

describe("классификации — на «Схеме»", () => {
  it("список и добавление классификации живут под карточкой актива, за спойлером", () => {
    tab("Схема");
    assetTab("Ресурсы");
    // Под спойлером: правят их редко, а место они занимали всегда.
    expect(screen.queryByRole("button", { name: "+ классификация" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /классификации ресурсов/ }));
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
    assetTab("Ресурсы");
    fireEvent.click(screen.getByRole("button", { name: /классификации ресурсов/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ классификация" }));
    expect(dump().kinds.length).toBe(before + 1);
    tab("Схема");
    assetTab("Ресурсы");
    expect(screen.getByRole("button", { name: /^\+ • новая классификация$/ }))
      .toBeInTheDocument();
  });
});

describe("три части актива — одинаковыми формами", () => {
  it("вкладки идут в одном порядке: сначала люди, потом их работа, потом ресурсы", () => {
    tab("Схема");
    const all = [...container.querySelectorAll("*")];
    const at = (name) => all.indexOf(
      screen.getByRole("button", { name: new RegExp(`^${name} \\d`) }));
    expect(at("Воркеры")).toBeLessThan(at("Функции"));
    expect(at("Функции")).toBeLessThan(at("Ресурсы"));
  });

  it("карточки всех трёх вкладок раскрываются одинаково", () => {
    tab("Схема");
    // Одна грамматика на все части: «развернуть …» + название + «удалить».
    expect(screen.getAllByRole("button", { name: "развернуть функции" }).length)
      .toBeGreaterThan(0);
    assetTab("Ресурсы");
    expect(screen.getAllByRole("button", { name: "развернуть ресурса" }).length)
      .toBeGreaterThan(0);
  });
});

describe("цель", () => {
  it("у ресурса её нет — она задаётся в «Прогнозе»", () => {
    // Полем «сколько нужно» цель обеднялась до числа: ни темпа, ни срока,
    // ни цены в нём не выражалось.
    tab("Схема");
    assetTab("Ресурсы");
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть ресурса" })[0]);
    expect(screen.queryByPlaceholderText("без цели")).toBeNull();
  });

  it("«Прогноз» показывает цели и что из них следует", () => {
    tab("Схема"); tab("Прогноз");
    expect(screen.getByText("цели")).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ цель" })).toBeTruthy();
    // Свёрнутая цель называет себя целиком: «10 … в неделю · через 3 мес».
    expect(screen.getByText(/в неделю · через 3 мес/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть цель" })[0]);
    expect(screen.getByText("что из этого следует")).toBeTruthy();
  });

  it("цель уезжает в модель отдельной частью документа", () => {
    tab("Схема"); tab("Прогноз");
    const m = dump();
    expect(Array.isArray(m.goals)).toBe(true);
    expect(m.goals.length).toBeGreaterThan(0);
    expect(m.goals[0]).toMatchObject({ trait: expect.any(String), rate: expect.any(String) });
  });

  it("ресурс без цели тоже показан — карточкой прогноза", () => {
    tab("Схема"); tab("Прогноз");
    // «заявки» — ресурс без планки: он в списке своего актива.
    expect(screen.getAllByText("заявки").length).toBeGreaterThan(0);
  });
});

describe("стрелка передачи ведёт к своей функции", () => {
  it("нажатие на стрелку открывает функцию, которая её рисует", () => {
    // Стрелку рисует функция — значит по стрелке до неё и надо доходить.
    // Прежде передачу было видно, а дотянуться до её причины приходилось
    // через актив и вкладку, гадая, какая из функций это делает.
    tab("Схема");
    // Заведём передачу: «Сбор заявок» выдаёт ресурс чужого актива.
    assetTab("Функции");
    fireEvent.click(screen.getAllByRole("button", { name: /^развернуть функции/ })[0]);
    const give = screen.getByLabelText("выдать ресурс");
    const alien = [...give.options].find((o) => o.parentElement.label
      && o.parentElement.label !== "этот актив");
    fireEvent.change(give, { target: { value: alien.value } });

    // Уходим на другой актив, чтобы было видно, что нажатие переключает.
    const other = [...container.querySelectorAll("svg text")]
      .find((t) => t.textContent === "Рынок услуг");
    fireEvent.pointerDown(other.closest("g"));
    fireEvent.click(other.closest("g"));

    const arrow = [...container.querySelectorAll("svg g")]
      .find((g) => g.querySelector("title")?.textContent.includes("открыть функцию"));
    expect(arrow).toBeTruthy();
    fireEvent.click(arrow);

    // Открылась карточка именно этой функции — со своими входами и выходами.
    expect(screen.getByDisplayValue("Сбор заявок")).toBeInTheDocument();
    expect(screen.getByLabelText("выдать ресурс")).toBeInTheDocument();
  });
});

describe("применение цели", () => {
  const openGoal = () => {
    tab("Схема"); tab("Прогноз");
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть цель" })[0]);
  };

  it("форма показывает полный расчёт: что прибавится, что убавится и какие задачи заведутся", () => {
    openGoal();
    expect(screen.getByText("прибавится")).toBeInTheDocument();
    expect(screen.getByText("убавится")).toBeInTheDocument();
    expect(screen.getByText(/какие задачи и когда заведутся/)).toBeInTheDocument();
  });

  it("до применения цель ничего не меняет — это прикидка", () => {
    // Без этой границы каждая правка числа молча меняла бы доску задач.
    const before = dump().tasks.length;
    openGoal();
    expect(dump().tasks.length).toBe(before);
    expect(dump().goals[0].appliedAt).toBeNull();
  });

  it("«Применить цель» заводит задачи и отмечает цель применённой", () => {
    const before = dump().tasks.length;
    openGoal();
    fireEvent.click(screen.getByRole("button", { name: "Применить цель" }));
    const m = dump();
    expect(m.tasks.length).toBeGreaterThan(before);
    expect(m.goals[0].appliedAt).toBeTruthy();
    // Задачи знают, откуда они взялись, и ждут постановки.
    const made = m.tasks.filter((t) => t.goalId === m.goals[0].id);
    expect(made.length).toBeGreaterThan(0);
    expect(made[0]).toMatchObject({ status: "wait", funcId: expect.any(String) });
    expect(made[0].start).toBeTruthy();
    expect(made[0].end).toBeTruthy();
  });

  it("применённая цель называет себя применённой и предлагает повтор", () => {
    openGoal();
    fireEvent.click(screen.getByRole("button", { name: "Применить цель" }));
    expect(screen.getByText("· применена")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Применить заново" })).toBeInTheDocument();
  });
});
