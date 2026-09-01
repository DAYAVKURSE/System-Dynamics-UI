import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* Единица, тип величины и период — три отдельных поля. Значения ресурса
   показываются в выбранном периоде, а внутри модели остаются месячными. */

const MODEL = {
  entities: [{ id: "me", name: "Моё время", color: "#7CE0FF", x: 24, y: 24 }],
  traits: [
    // Старая запись: период зашит в единицу — приложение должно её разобрать.
    { id: "work", e: "me", k: "growth", l: "рабочее время", unit: "ч/день" },
    { id: "money", e: "me", k: "growth", l: "деньги", unit: "₽", have: 1000 },
  ],
  edges: [{ id: "e0", from: "me", to: "work", carrier: "", gives: 10, per: "день",
    sign: 1, conds: [], basis: "hypo" }],
};

let container;
const load = (model) => {
  fireEvent.click(screen.getByRole("button", { name: "JSON" }));
  const area = container.querySelector("textarea");
  fireEvent.change(area, { target: { value: JSON.stringify(model) } });
  fireEvent.blur(area);
  fireEvent.click(screen.getAllByRole("button", { name: "Загрузить" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Схема" }));
};
beforeEach(() => {
  ({ container } = render(<SystemModel />));
  load(MODEL);
  fireEvent.click(screen.getAllByText("рабочее время")[0]);
});

const unitField = () => screen.getByPlaceholderText("ч, ₽, чел.");
// Списков периодов на экране два — у ресурса и у стрелки. Первый по порядку
// в разметке принадлежит ресурсу: его карточка выше списка стрелок.
const perPicker = () => [...container.querySelectorAll("select")]
  .filter((s) => [...s.options].map((o) => o.value).join(",") === "час,день,нед,мес,квартал,год")[0];
const hypoField = () => container.querySelector('[title="Прогноз с учётом поведенческих допущений"]');
const model = () => {
  fireEvent.click(screen.getByRole("button", { name: "JSON" }));
  fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
  const m = JSON.parse(container.querySelector("textarea").value);
  fireEvent.click(screen.getByRole("button", { name: "Схема" }));
  return m;
};

describe("единица больше не прячет в себе период", () => {
  it("«ч/день» разбирается на единицу и период", () => {
    expect(unitField().value).toBe("ч");
    expect(model().traits.find((t) => t.id === "work"))
      .toMatchObject({ unit: "ч", per: "день", flow: true });
  });

  it("тип величины переключается кнопкой, а не слэшем", () => {
    expect(screen.getByRole("button", { name: "поток" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "запас" })).toBeTruthy();
  });

  it("у запаса периода нет — ему нечего показывать за период", () => {
    fireEvent.click(screen.getAllByText("деньги")[0]);
    expect(screen.queryByText("за")).toBeNull();
  });
});

describe("значения показываются в выбранном периоде", () => {
  it("прогноз показан за день, а не за месяц", () => {
    // 10 ч/день = 300 ч/мес; внутри модели 300, человеку — 10.
    expect(hypoField().textContent).toBe("10");
  });

  it("смена периода меняет показ, но не модель", () => {
    const before = model().traits.find((t) => t.id === "work");
    expect(perPicker().value).toBe("день");
    fireEvent.change(perPicker(), { target: { value: "мес" } });

    expect(hypoField().textContent).toBe("300");
    const after = model().traits.find((t) => t.id === "work");
    // Стартовое значение и цель в модели не сдвинулись — поменялась подпись.
    expect(after.have ?? null).toBe(before.have ?? null);
    expect(after.want ?? null).toBe(before.want ?? null);
  });

  it("введённая цель хранится в месяц, а показывается в периоде", () => {
    const want = screen.getByPlaceholderText("нет цели");
    fireEvent.change(want, { target: { value: "20" } });
    fireEvent.blur(want);

    // 20 в день — это 600 в месяц внутри модели.
    expect(model().traits.find((t) => t.id === "work").want).toBe(600);
    expect(screen.getByDisplayValue("20")).toBeTruthy();
  });

  it("единица в подписях собирается обратно из части и периода", () => {
    expect(screen.getAllByText(/ч\/день/).length).toBeGreaterThan(0);
  });
});

describe("старые сценарии не меняют смысла", () => {
  it("«/мес» считался в месяц и продолжает считаться в месяц", () => {
    load({
      entities: MODEL.entities,
      traits: [{ id: "u", e: "me", k: "growth", l: "пользователи", unit: "чел./мес" }],
      edges: [{ id: "e", from: "me", to: "u", carrier: "", gives: 7, per: "мес",
        sign: 1, conds: [], basis: "hypo" }],
    });
    fireEvent.click(screen.getAllByText("пользователи")[0]);
    expect(hypoField().textContent).toBe("7");
    expect(unitField().value).toBe("чел.");
  });

  it("«₽/ч» — это не период, единицу не режем", () => {
    // «рублей на час труда» — если разрезать, единица потеряет смысл.
    load({
      entities: MODEL.entities,
      traits: [{ id: "p", e: "me", k: "growth", l: "отдача", unit: "₽/ч", have: 5 }],
      edges: [],
    });
    fireEvent.click(screen.getAllByText("отдача")[0]);
    expect(unitField().value).toBe("₽/ч");
    expect(hypoField().textContent).toBe("5");
  });
});
