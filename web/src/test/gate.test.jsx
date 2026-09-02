import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";

/* Условие отдельно от переноса: условие говорит «когда», перенос — «что,
   откуда и как часто». Проверяем, что разделение реальное, а не только в
   подписях, и что в условие можно вписать выражение целиком. */

const MODEL = {
  entities: [
    { id: "me", name: "Моё время", color: "#7CE0FF", x: 24, y: 24 },
    { id: "job", name: "Поиск работы", color: "#C792EA", x: 300, y: 24 },
  ],
  traits: [
    { id: "work", e: "me", k: "growth", l: "рабочее время", unit: "ч/день" },
    { id: "quota", e: "me", k: "growth", l: "остаток квоты", unit: "шт.", have: 5 },
    { id: "cv", e: "job", k: "growth", l: "время на резюме", unit: "ч/день" },
  ],
  edges: [
    { id: "e0", from: "me", to: "work", carrier: "", gives: 10, per: "день",
      sign: 1, conds: [], basis: "hypo" },
    { id: "e1", from: "me", to: "cv", carrier: "", gives: 10, per: "день",
      sign: 1, conds: [], basis: "hypo", fromTrait: "work" },
  ],
};

let container;
beforeEach(() => {
  ({ container } = render(<SystemModel />));
  fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
  fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
  const area = container.querySelector("textarea");
  fireEvent.change(area, { target: { value: JSON.stringify(MODEL) } });
  fireEvent.blur(area);
  fireEvent.click(screen.getAllByRole("button", { name: "Загрузить" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Схема" }));
  // Открываем карточку стрелки, входящей в «время на резюме».
  const g = [...container.querySelectorAll("svg g")].find((el) =>
    [...el.querySelectorAll("text")].some((t) => t.textContent === "Поиск работы"));
  fireEvent.pointerDown(g, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(g, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.click(screen.getAllByText("время на резюме")[0]);
});

const commit = (el, value) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};
const kindPicker = () => [...container.querySelectorAll("select")]
  .find((s) => s.textContent.includes("пропускает, если верно"));
const exprField = () => screen.getByPlaceholderText(/10 - \[ресурс\]/);
const addCond = () => fireEvent.click(screen.getByRole("button", { name: "+ добавить условие" }));
const inserter = () => [...container.querySelectorAll("select")]
  .find((s) => s.textContent.includes("вставить ресурс"));
// Карточка условия — блок вокруг подписи «условие N».
const condCard = () => [...container.querySelectorAll("span")]
  .filter((sp) => /^условие \d+$/.test(sp.textContent || ""))
  .map((sp) => sp.parentElement.parentElement)[0];

describe("перенос и условие — разные блоки", () => {
  it("перенос говорит, что берётся и как часто делается попытка", () => {
    expect(screen.getByText(/перенос — что, откуда и как часто/)).toBeTruthy();
    expect(screen.getByText(/за попытку берёт/)).toBeTruthy();
    // «попытка каждый» встречается и в блоке переноса, и в пояснении к
    // расписанию движения — достаточно, что она есть.
    expect(screen.getAllByText(/попытка каждый/).length).toBeGreaterThan(0);
  });

  it("условия вынесены в свой блок и отвечают за «когда»", () => {
    expect(screen.getByText(/условия — когда перенос вообще происходит/)).toBeTruthy();
  });

  it("без условий переносится всё запрошенное, и расчёт запроса виден", () => {
    // 10 за попытку × 30 попыток (каждый день) = 300 ч/мес = 10 ч/день.
    expect(screen.getByText(/Переносится 10 из 10 ч\/день/)).toBeTruthy();
    expect(screen.getByText(/10 за попытку × 30 попыток за месяц/)).toBeTruthy();
  });
});

describe("сводка стрелки говорит правду про нехватку", () => {
  it("две стрелки к одному источнику не получают по полной", () => {
    // Ровно та ошибка, из-за которой карточка показывала обеим по 100%:
    // она печатала запрос, а не то, что уходит на самом деле.
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
    const area = container.querySelector("textarea");
    commit(area, JSON.stringify({
      ...MODEL,
      traits: [...MODEL.traits,
        { id: "bid", e: "job", k: "growth", l: "отклики", unit: "ч", flow: true, per: "мес" }],
      edges: [MODEL.edges[0],
        { ...MODEL.edges[1], gives: 2, per: "час", fromTrait: "work" },
        { id: "e2", from: "me", to: "bid", carrier: "", gives: 2, per: "час",
          sign: 1, conds: [], basis: "hypo", fromTrait: "work" }],
    }));
    fireEvent.click(screen.getAllByRole("button", { name: "Загрузить" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    fireEvent.click(screen.getAllByText("время на резюме")[0]);

    // Внутри модели: 300 ч/мес на двоих, каждый просит 1460, получает 150.
    // На экране всё в периоде ресурса — в днях, то есть делённое на 30.
    expect(screen.getByText(/Переносится 5 из 48,67 ч\/день/)).toBeTruthy();
    expect(screen.getByText(/есть 10, просят 97,33 ч\/день/)).toBeTruthy();
  });

  it("когда источника хватает, про нехватку не говорится", () => {
    expect(screen.queryByText(/на всех не хватает/)).toBeNull();
    expect(screen.getByText(/Переносится/)).toBeTruthy();
  });
});

describe("условие на остаток собственного источника", () => {
  const selfGated = () => {
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
    const area = container.querySelector("textarea");
    commit(area, JSON.stringify({
      ...MODEL,
      edges: [MODEL.edges[0],
        { ...MODEL.edges[1], fromTrait: "work", conds: [{ expr: "{work} >= 1" }] }],
    }));
    fireEvent.click(screen.getAllByRole("button", { name: "Загрузить" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    fireEvent.click(screen.getAllByText("время на резюме")[0]);
  };

  it("подсказывает, что «бери, пока есть» уже встроено", () => {
    selfGated();
    expect(screen.getByText(/из которого\s+стрелка и так берёт/)).toBeTruthy();
    expect(screen.getByText(/имеет\s+смысл только как порог/)).toBeTruthy();
  });

  it("условие видит фонд месяца — модель живая с месяца 0", () => {
    // Раньше поток в условии был остатком: в начале месяца 0 «времени ещё
    // нет», условие ложно, прогноз нулевой — при том что время натекает
    // каждый месяц. Теперь условие видит фонд месяца: 300 часов.
    selfGated();
    expect(screen.getByText(/в начале месяца 300 >= 1 — верно/)).toBeTruthy();
    expect(screen.getByText(/проверяется на каждой попытке/)).toBeTruthy();
    expect(screen.getByText(/Переносится 10 из 10 ч\/день/)).toBeTruthy();
  });

  it("на чужой ресурс подсказки нет", () => {
    addCond();
    commit(exprField(), "[остаток квоты] >= 1");
    expect(screen.queryByText(/и так берёт/)).toBeNull();
  });
});

describe("условие как целое выражение", () => {
  it("новое условие — сравнение, и это одно поле на всё выражение", () => {
    addCond();
    expect(kindPicker().value).toBe("gate");
    expect(exprField()).toBeTruthy();
  });

  it("принимает выражение вида «10 - x > y + z»", () => {
    addCond();
    commit(exprField(), "10 - [остаток квоты] > 2 + 1");
    // 10 − 5 > 3 — верно, перенос идёт.
    expect(exprField().value).toBe("10 - [остаток квоты] > 2 + 1");
    expect(screen.getByText(/в начале месяца 5 > 3 — верно, перенос идёт/)).toBeTruthy();
  });

  it("неверное условие останавливает перенос", () => {
    addCond();
    commit(exprField(), "10 - [остаток квоты] > 6 + 1");
    expect(screen.getByText(/неверно, переноса нет/)).toBeTruthy();
    expect(screen.getByText(/Перенос сейчас не идёт: условия не выполняются/)).toBeTruthy();
  });

  it("ресурсы вставляются из списка, а не набираются руками", () => {
    addCond();
    fireEvent.change(inserter(), { target: { value: "quota" } });
    expect(exprField().value).toContain("[остаток квоты]");
  });

  it("ресурсы актива-источника предлагаются первыми", () => {
    addCond();
    const groups = [...inserter().querySelectorAll("optgroup")].map((g) => g.label);
    expect(groups[0]).toBe("Моё время");
  });

  it("сломанное выражение объясняется и не душит стрелку", () => {
    addCond();
    commit(exprField(), "((((");
    expect(screen.getByText(/не учитывается, пока не исправлено/)).toBeTruthy();
    // Битое условие не душит: переносится всё, что источник может дать.
    expect(screen.getByText(/Переносится 10 из 10 ч\/день/)).toBeTruthy();
  });
});

describe("переключение вида условия", () => {
  it("сравнение переводится в пропорцию, не теряя написанного", () => {
    addCond();
    commit(exprField(), "[остаток квоты] >= 2");
    fireEvent.change(kindPicker(), { target: { value: "min" } });

    // Две стороны стали двумя полями.
    expect(screen.getByDisplayValue("[остаток квоты]")).toBeTruthy();
    expect(screen.getByDisplayValue("2")).toBeTruthy();
  });

  it("и обратно в сравнение", () => {
    addCond();
    commit(exprField(), "[остаток квоты] >= 2");
    fireEvent.change(kindPicker(), { target: { value: "min" } });
    fireEvent.change(kindPicker(), { target: { value: "gate" } });
    expect(exprField().value).toBe("[остаток квоты] >= 2");
  });
});

describe("старые условия продолжают работать", () => {
  it("условие-пропорция из сохранённого сценария открывается своим видом", () => {
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
    const area = container.querySelector("textarea");
    commit(area, JSON.stringify({
      ...MODEL,
      edges: [{ ...MODEL.edges[1], conds: [{ trait: "quota", mode: "min", amt: 10 }] }],
    }));
    fireEvent.click(screen.getAllByRole("button", { name: "Загрузить" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Схема" }));
    fireEvent.click(screen.getAllByText("время на резюме")[0]);

    expect(kindPicker().value).toBe("min");
    expect(screen.getByDisplayValue("[остаток квоты]")).toBeTruthy();
    // 5 против 10 — половина, ровно как считалось раньше.
    expect(within(condCard()).getByText(/50%/)).toBeTruthy();
  });
});
