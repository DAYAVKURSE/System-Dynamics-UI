import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { nameSpan, renameEl } from "./helpers/name.js";

/* Тесты на редактирование модели: активы (добавление, перетаскивание,
   удаление), переименование ресурсов и классификации ресурсов. */

const openTab = (name) => fireEvent.click(screen.getByRole("button", { name }));

// Блок актива на схеме — это <g>, внутри которого лежит его подпись.
function entityGroup(container, name) {
  const groups = [...container.querySelectorAll("svg g")];
  const g = groups.find((el) => [...el.querySelectorAll("text")].some((t) => t.textContent === name));
  if (!g) throw new Error(`блок актива «${name}» не найден на схеме`);
  return g;
}

/* Три части актива живут во вкладках: до ресурсов надо переключиться. */
const assetTab = (name) => fireEvent.click(
  screen.getByRole("button", { name: new RegExp(`^${name}`) }));
const entityRect = (container, name) => entityGroup(container, name).querySelector("rect");

// TxtField отдаёт значение наружу по расфокусу — печатаем и уходим с поля.
function typeAndCommit(input, value) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

let container;
beforeEach(() => {
  ({ container } = render(<SystemModel />));
});

describe("активы на схеме", () => {
  it("добавляются кнопкой «+ актив»", () => {
    openTab("Схема");
    expect(nameSpan("Новый актив")).toBeFalsy();

    fireEvent.click(screen.getByRole("button", { name: "+ актив" }));

    // Новый актив выбран, его имя доступно для правки, и он есть на схеме.
    expect(nameSpan("Новый актив")).toBeTruthy();
    expect(entityGroup(container, "Новый актив")).toBeTruthy();
  });

  it("перетаскиваются мышью, и схема запоминает новое положение", () => {
    openTab("Схема");
    const before = entityRect(container, "Пользователи");
    const x0 = Number(before.getAttribute("x"));
    const y0 = Number(before.getAttribute("y"));

    const g = entityGroup(container, "Пользователи");
    fireEvent.pointerDown(g, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(g, { clientX: 160, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(g, { clientX: 160, clientY: 130, pointerId: 1 });

    const after = entityRect(container, "Пользователи");
    expect(Number(after.getAttribute("x"))).toBeGreaterThan(x0);
    expect(Number(after.getAttribute("y"))).toBeGreaterThan(y0);
    // Координаты обязаны остаться числами: NaN уехал бы в сохранённый
    // сценарий, и актив пропал бы со схемы навсегда.
    expect(Number.isFinite(Number(after.getAttribute("x")))).toBe(true);
    expect(Number.isFinite(Number(after.getAttribute("y")))).toBe(true);
  });

  it("короткий тап выбирает актив, а не двигает его", () => {
    openTab("Схема");
    const x0 = Number(entityRect(container, "Рынок услуг").getAttribute("x"));

    const g = entityGroup(container, "Рынок услуг");
    fireEvent.pointerDown(g, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(g, { clientX: 51, clientY: 50, pointerId: 1 }); // меньше порога
    fireEvent.pointerUp(g, { clientX: 51, clientY: 50, pointerId: 1 });

    expect(Number(entityRect(container, "Рынок услуг").getAttribute("x"))).toBe(x0);
    // выбор открыл панель этого актива
    expect(nameSpan("Рынок услуг")).toBeTruthy();
  });

  it("удаляются вместе со своими ресурсами", () => {
    openTab("Схема");
    // «Пользователи» выбраны по умолчанию, у них есть ресурс с этим названием
    assetTab("Ресурсы");
    expect(nameSpan("активные пользователи")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Удалить актив/ }));

    expect(() => entityGroup(container, "Пользователи")).toThrow();
    expect(nameSpan("активные пользователи")).toBeFalsy();
  });
});

describe("переименование ресурса", () => {
  it("меняет название и показывает его в модели", () => {
    openTab("Схема");
    assetTab("Ресурсы");
    // Ресурсы актива — карточки на его вкладке «Ресурсы».
    renameEl(nameSpan("активные пользователи"), "ядро аудитории");

    expect(nameSpan("ядро аудитории")).toBeTruthy();
    expect(nameSpan("активные пользователи")).toBeFalsy();
  });

  it("заводится кнопкой своей классификации и сразу принадлежит активу", () => {
    openTab("Схема");
    assetTab("Ресурсы");
    const box = screen.getByPlaceholderText("текст нового ресурса");
    typeAndCommit(box, "новый запас");
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ ◆ ресурс$/ })[0]);
    expect(nameSpan("новый запас")).toBeTruthy();
  });
});

/* Классификации живут там же, где ресурсы: классификация — свойство
   ресурса, и держать её в другом месте значило бы разложить одно понятие
   по двум. Под спойлером: правят их редко. */
const openKinds = () => {
  assetTab("Ресурсы");
  fireEvent.click(screen.getByRole("button", { name: /классификации ресурсов/ }));
};

describe("классификации ресурсов", () => {
  const kindRow = (name) =>
    screen.getByDisplayValue(name).closest("div");

  it("переименовываются", () => {
    openTab("Схема");
    openKinds();
    typeAndCommit(screen.getByDisplayValue("рост"), "тиражируемость");
    expect(screen.getByDisplayValue("тиражируемость")).toBeInTheDocument();

    // Название подхватывается там, где классификация выбирается для ресурса.
    assetTab("Ресурсы");
    fireEvent.click(screen.getAllByRole("button", { name: "развернуть ресурса" })[0]);
    expect(screen.getAllByRole("button", { name: /тиражируемость/ }).length)
      .toBeGreaterThan(0);
  });

  it("добавляются", () => {
    openTab("Схема");
    openKinds();
    fireEvent.click(screen.getByRole("button", { name: "+ классификация" }));
    expect(screen.getByDisplayValue("новая классификация")).toBeInTheDocument();
  });

  it("удаляются, а с ресурсов эта классификация снимается", () => {
    /* Классификаций у ресурса может быть несколько, поэтому удалённую
       СНИМАЮТ, а не подменяют другой: перевести вещь в первую попавшуюся
       значило бы решить за человека, чем её теперь считать. */
    openTab("Схема");
    openKinds();
    fireEvent.click(within(kindRow("рост")).getByRole("button", { name: "✕" }));

    expect(screen.queryByDisplayValue("рост")).toBeNull();
    expect(screen.getByText(/эта классификация снята/)).toBeInTheDocument();
  });

  it("последнюю классификацию удалить нельзя — и сказано почему", () => {
    openTab("Схема");
    openKinds();
    ["рост", "затрата"].forEach((name) => {
      fireEvent.click(within(kindRow(name)).getByRole("button", { name: "✕" }));
    });
    fireEvent.click(within(kindRow("ресурс")).getByRole("button", { name: "✕" }));
    expect(screen.getByDisplayValue("ресурс")).toBeInTheDocument();
    expect(screen.getByText(/Нельзя удалить последнюю классификацию/)).toBeInTheDocument();
  });

  it("ресурс со ссылкой на исчезнувшую классификацию не роняет приложение", () => {
    // Через вкладку «Выгрузка» загружаем модель, где ресурс ссылается на
    // тип, которого нет в списке классификаций.
    openTab("Инструменты"); openTab("Выгрузка");
    const area = container.querySelector("textarea");
    typeAndCommit(
      area,
      JSON.stringify({
        entities: [{ id: "a", name: "Актив", color: "#fff", x: 0, y: 0 }],
        traits: [{ id: "t1", e: "a", k: "которого-нет", l: "ресурс", unit: "шт." }],
        funcs: [],
        kinds: [{ id: "growth", sign: "↑", name: "рост", color: "#3DDC97", dir: "up" }],
      }),
    );
    // «Загрузить» есть и у текстового поля, и у дискового блока — берём
    // первую, она относится к JSON из поля выше.
    fireEvent.click(screen.getAllByRole("button", { name: "Загрузить" })[0]);
    expect(screen.getByText("Загружено.")).toBeInTheDocument();

    openTab("Схема");
    // Приложение не упало: актив из загруженной модели на схеме, и выбор
    // перешёл на него (прежний актив в новой модели отсутствует).
    expect(entityGroup(container, "Актив")).toBeTruthy();
    expect(nameSpan("Актив")).toBeTruthy();
    // Ресурс с неизвестной классификацией показан с заглушкой вместо значка.
    assetTab("Ресурсы");
    expect(nameSpan("ресурс")).toBeTruthy();
    expect(screen.getAllByText(/\? без типа/).length).toBeGreaterThan(0);
  });
});
