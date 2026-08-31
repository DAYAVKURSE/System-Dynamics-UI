import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

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
    expect(screen.queryByDisplayValue("Новый актив")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "+ актив" }));

    // Новый актив выбран, его имя доступно для правки, и он есть на схеме.
    expect(screen.getByDisplayValue("Новый актив")).toBeInTheDocument();
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
    expect(screen.getByDisplayValue("Рынок услуг")).toBeInTheDocument();
  });

  it("удаляются вместе со своими ресурсами", () => {
    openTab("Схема");
    // «Пользователи» выбраны по умолчанию, у них есть ресурс с этим названием
    expect(screen.getAllByText(/активные пользователи/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Удалить актив/ }));

    expect(() => entityGroup(container, "Пользователи")).toThrow();
    expect(screen.queryByText(/активные пользователи/i)).toBeNull();
  });
});

describe("переименование ресурса", () => {
  it("меняет название и показывает его в модели", () => {
    openTab("Схема");
    // Выбираем ресурс в списке актива — открывается его карточка.
    fireEvent.click(screen.getAllByText("активные пользователи")[0]);

    const field = screen.getByDisplayValue("активные пользователи");
    typeAndCommit(field, "ядро аудитории");

    expect(screen.getByDisplayValue("ядро аудитории")).toBeInTheDocument();
    expect(screen.queryByText("активные пользователи")).toBeNull();
  });
});

describe("классификации ресурсов", () => {
  it("переименовываются", () => {
    openTab("Типы");
    typeAndCommit(screen.getByDisplayValue("воспроизводимость"), "тиражируемость");

    expect(screen.getByDisplayValue("тиражируемость")).toBeInTheDocument();

    // Название подхватывается там, где классификации выбираются для ресурса.
    openTab("Схема");
    fireEvent.click(screen.getAllByText("активные пользователи")[0]);
    expect(screen.getAllByRole("button", { name: /тиражируемость/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /воспроизводимость/ })).toBeNull();
  });

  it("добавляются", () => {
    openTab("Типы");
    const before = screen.getAllByRole("button", { name: "Удалить" }).length;

    fireEvent.click(screen.getByRole("button", { name: /добавить классификацию/ }));

    expect(screen.getByDisplayValue("новая классификация")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Удалить" })).toHaveLength(before + 1);
  });

  it("удаляются, а их ресурсы переезжают в оставшуюся классификацию", () => {
    openTab("Типы");
    // «рост» — первая классификация, ресурсы на ней есть.
    const row = screen.getByDisplayValue("рост").closest("div").parentElement;
    fireEvent.click(within(row).getByRole("button", { name: "Удалить" }));

    expect(screen.queryByDisplayValue("рост")).toBeNull();
    // Сообщение подтверждает, что ресурсы не остались без типа.
    expect(screen.getByText(/переведено в/)).toBeInTheDocument();
  });

  it("последнюю классификацию удалить нельзя", () => {
    openTab("Типы");
    // Удаляем все, кроме одной.
    for (let i = 0; i < 5; i++) {
      const buttons = screen.getAllByRole("button", { name: "Удалить" });
      fireEvent.click(buttons[0]);
    }
    const last = screen.getAllByRole("button", { name: "Удалить" });
    expect(last).toHaveLength(1);
    expect(last[0]).toBeDisabled();
  });

  it("ресурс со ссылкой на исчезнувшую классификацию не роняет приложение", () => {
    // Через вкладку JSON загружаем модель, где ресурс ссылается на тип,
    // которого нет в списке классификаций.
    openTab("JSON");
    const area = container.querySelector("textarea");
    typeAndCommit(
      area,
      JSON.stringify({
        entities: [{ id: "a", name: "Актив", color: "#fff", x: 0, y: 0 }],
        traits: [{ id: "t1", e: "a", k: "которого-нет", l: "ресурс", unit: "шт." }],
        edges: [],
        kinds: [{ id: "growth", sign: "↑", name: "рост", color: "#3DDC97", dir: "up" }],
      }),
    );
    // «Загрузить» есть и у текстового поля, и у дискового блока — берём первую,
    // она относится к JSON из поля выше.
    fireEvent.click(screen.getAllByRole("button", { name: "Загрузить" })[0]);

    expect(screen.getByText("Загружено.")).toBeInTheDocument();

    openTab("Схема");
    // Приложение не упало: актив из загруженной модели на схеме,
    // и выбор перешёл на него (прежний актив в новой модели отсутствует).
    expect(entityGroup(container, "Актив")).toBeTruthy();
    expect(screen.getByDisplayValue("Актив")).toBeInTheDocument();
    // Ресурс с неизвестной классификацией показан с заглушкой вместо значка.
    expect(screen.getByText("ресурс")).toBeInTheDocument();
    expect(screen.getAllByText("?").length).toBeGreaterThan(0);
  });
});
