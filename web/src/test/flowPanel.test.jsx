import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SystemModel from "../components/SystemModel.jsx";
import { WHY_FLOW } from "../lib/funcs.js";

/* Стрелка идёт от элемента к элементу и несёт ресурс. В самих ресурсах
   связь больше не задаётся: ресурс сам себя не передаёт. */

let container;
beforeEach(() => { localStorage.clear(); ({ container } = render(<SystemModel />)); });

const scheme = () => fireEvent.click(screen.getByRole("button", { name: "Схема" }));
const dump = () => {
  fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
  if (!container.querySelector("textarea")) {
    fireEvent.click(screen.getByRole("button", { name: "Выгрузка" }));
  }
  fireEvent.click(screen.getByRole("button", { name: "Выгрузить" }));
  const m = JSON.parse(container.querySelector("textarea").value);
  scheme();
  return m;
};
const twoFuncs = () => {
  scheme();
  fireEvent.click(screen.getByRole("button", { name: "+ элемент" }));
  fireEvent.click(screen.getByRole("button", { name: "+ элемент" }));
  // Раскрываем первый: стрелка заводится в карточке источника.
  fireEvent.click(screen.getAllByRole("button", { name: "развернуть элемент" })[0]);
};

describe("в ресурсах стрелку больше не задать", () => {
  it("кнопок «от «Актив»» нет, и сказано, где стрелка теперь заводится", () => {
    // Выбираем ресурс выбранного актива, чтобы открылась его карточка.
    const m = dump();
    const names = new Set(m.traits.map((t) => t.l));
    scheme();
    // Название ресурса в списке — растянутый на всю строку span.
    const span = [...container.querySelectorAll("span")]
      .find((x) => names.has(x.textContent) && x.style.flex === "1 1 0%");
    expect(span).toBeTruthy();
    fireEvent.click(span.closest("div").parentElement);
    expect(screen.queryByRole("button", { name: /^от «/ })).toBeNull();
    expect(screen.getByText(/Новые стрелки заводятся у функционального элемента/))
      .toBeInTheDocument();
  });
});

describe("стрелка между элементами", () => {
  it("заводится у источника и переживает выгрузку", () => {
    twoFuncs();
    fireEvent.click(screen.getByRole("button", { name: "+ стрелка от этого элемента" }));
    const m = dump();
    expect(m.flows).toHaveLength(1);
    expect(m.flows[0].from).toBe(m.funcs[0].id);
  });

  it("несёт ресурс, ведёт в другой элемент и хранит вилку", () => {
    twoFuncs();
    fireEvent.click(screen.getByRole("button", { name: "+ стрелка от этого элемента" }));
    const traitPick = screen.getByLabelText("какой ресурс несёт стрелка");
    fireEvent.change(traitPick, { target: { value: traitPick.options[1].value } });
    const toPick = screen.getByLabelText("в какой элемент");
    fireEvent.change(toPick, { target: { value: toPick.options[1].value } });
    const nums = container.querySelectorAll('input[type="number"]');
    fireEvent.change(nums[nums.length - 2], { target: { value: "3" } });
    fireEvent.change(nums[nums.length - 1], { target: { value: "5" } });

    expect(screen.getByText(/от 3 до 5/)).toBeInTheDocument();
    const w = dump().flows[0];
    expect(w.trait).toBeTruthy();
    expect(w.to).toBeTruthy();
    expect(w).toMatchObject({ lo: 3, hi: 5 });
  });

  it("недоделанная стрелка красная и объясняется словами", () => {
    twoFuncs();
    fireEvent.click(screen.getByRole("button", { name: "+ стрелка от этого элемента" }));
    const ask = screen.getByRole("button", { name: "почему стрелка не годится" });
    fireEvent.click(ask);
    expect(within(screen.getByRole("dialog")).getByText(WHY_FLOW)).toBeInTheDocument();
  });

  it("удаление элемента уносит его стрелки", () => {
    twoFuncs();
    fireEvent.click(screen.getByRole("button", { name: "+ стрелка от этого элемента" }));
    expect(dump().flows).toHaveLength(1);
    scheme();
    fireEvent.click(screen.getByRole("button", { name: "Удалить актив" }));
    expect(dump().flows).toHaveLength(0);
  });

  it("на схеме стрелка видна и подписана своим ресурсом", () => {
    twoFuncs();
    fireEvent.click(screen.getByRole("button", { name: "+ стрелка от этого элемента" }));
    const traitPick = screen.getByLabelText("какой ресурс несёт стрелка");
    const label = traitPick.options[1].textContent;
    fireEvent.change(traitPick, { target: { value: traitPick.options[1].value } });
    const toPick = screen.getByLabelText("в какой элемент");
    fireEvent.change(toPick, { target: { value: toPick.options[1].value } });

    const texts = [...container.querySelectorAll("svg text")].map((t) => t.textContent);
    expect(texts.some((t) => label.startsWith(t.replace("…", "")))).toBe(true);
  });
});
