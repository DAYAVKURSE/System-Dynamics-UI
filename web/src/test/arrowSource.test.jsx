import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* Выбор ресурса-источника у стрелки: проверяем, что поле не просто есть,
   а действительно доходит до расчёта. */

// Ровно случай из жизни: 10 часов в день на всех и двое желающих по 10.
const MODEL = {
  entities: [
    { id: "me", name: "Моё время", color: "#7CE0FF", x: 24, y: 24 },
    { id: "job", name: "Поиск работы", color: "#C792EA", x: 300, y: 24 },
  ],
  traits: [
    { id: "work", e: "me", k: "growth", l: "рабочее время", unit: "ч/день", have: null },
    { id: "cv", e: "job", k: "growth", l: "время на резюме", unit: "ч/день", have: null },
  ],
  edges: [
    { id: "e0", from: "me", to: "work", carrier: "", gives: 10, per: "день",
      sign: 1, conds: [], basis: "hypo" },
    { id: "e1", from: "me", to: "cv", carrier: "", gives: 10, per: "день",
      sign: 1, conds: [], basis: "hypo" },
  ],
};

let container;
beforeEach(() => {
  ({ container } = render(<SystemModel />));
  fireEvent.click(screen.getByRole("button", { name: "JSON" }));
  const area = container.querySelector("textarea");
  fireEvent.change(area, { target: { value: JSON.stringify(MODEL) } });
  fireEvent.blur(area);
  fireEvent.click(screen.getAllByRole("button", { name: "Загрузить" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Схема" }));
});

// Строка ресурса в панели актива показывает «гип. N» — это и есть прогноз.
const hypoOf = (name) => {
  const label = [...container.querySelectorAll("span")]
    .find((sp) => sp.textContent === name);
  if (!label) throw new Error(`ресурс «${name}» не показан в панели актива`);
  const card = label.closest("div").parentElement;
  const m = card.textContent.match(/гип\.\s*([\d\s\u00a0,.]+)/);
  if (!m) throw new Error(`у «${name}» нет прогноза в строке`);
  return Number(m[1].trim().replace(/[\s\u00a0]/g, "").replace(",", "."));
};

// Актив выбирается pointer-событиями: у блока перетаскивание.
const selectEntity = (name) => {
  const g = [...container.querySelectorAll("svg g")].find((el) =>
    [...el.querySelectorAll("text")].some((t) => t.textContent === name));
  if (!g) throw new Error(`актив «${name}» не найден`);
  fireEvent.pointerDown(g, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(g, { clientX: 10, clientY: 10, pointerId: 1 });
};
// Открыть карточку стрелки, входящей в ресурс: сначала актив, потом ресурс.
const openCv = () => {
  selectEntity("Поиск работы");
  fireEvent.click(screen.getAllByText("время на резюме")[0]);
};
const sourcePicker = () => [...container.querySelectorAll("select")]
  .find((s) => s.textContent.includes("ниоткуда"));

describe("выбор ресурса-источника", () => {
  it("по умолчанию источника нет и об этом сказано прямо", () => {
    openCv();
    expect(sourcePicker().value).toBe("");
    expect(screen.getByText(/уйдёт сразу в несколько мест/)).toBeTruthy();
  });

  it("предлагает только ресурсы актива, из которого идёт стрелка", () => {
    openCv();
    const picker = sourcePicker();
    expect(within(picker).getByText(/рабочее время/)).toBeTruthy();
    // Сам получатель в списке не нужен: ресурс не питает сам себя.
    expect(within(picker).queryByText(/время на резюме/)).toBeNull();
  });

  it("выбранный источник и вправду тратится — прогноз меняется", () => {
    openCv();
    // Пока источника нет: и запас времени, и резюме показывают по 300.
    expect(hypoOf("время на резюме")).toBe(300);

    fireEvent.change(sourcePicker(), { target: { value: "work" } });

    // Резюме забрало всё время, свободного не осталось.
    expect(hypoOf("время на резюме")).toBe(300);
    selectEntity("Моё время");
    expect(hypoOf("рабочее время")).toBe(0);
  });

  it("сказано, что будет при нехватке", () => {
    openCv();
    fireEvent.change(sourcePicker(), { target: { value: "work" } });
    expect(screen.getByText(/на столько же убудет «рабочее время»/)).toBeTruthy();
  });
});

describe("почему «фактически» ноль", () => {
  it("объясняет, что все входящие стрелки — гипотезы", () => {
    openCv();
    expect(screen.getByText(/все входящие стрелки помечены как\s+гипотезы/)).toBeTruthy();
  });

  it("после переключения стрелки на факт объяснение уходит", () => {
    openCv();
    fireEvent.click(screen.getByRole("button", { name: "◇ гипотеза" }));
    expect(screen.queryByText(/все входящие стрелки помечены как/)).toBeNull();
  });
});
