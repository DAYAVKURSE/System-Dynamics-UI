import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import ExprField from "../components/ExprField.jsx";

/* ПОЛЕ ВЫРАЖЕНИЯ: «@» открывает список ресурсов, выбранный вставляется
   именем, в запись уходит идентификатор; ошибка — словами под полем. */

const TRAITS = [{ id: "t1", l: "Заявки" }, { id: "t2", l: "Договоры" }, { id: "t3", l: "Заявки в работе" }];

function Host({ value = "", onCommit }) {
  const [v, setV] = React.useState(value);
  return <ExprField value={v} traits={TRAITS} aria-label="сколько ресурса"
    onCommit={(x) => { setV(x); onCommit?.(x); }} />;
}

const type = (el, v) => {
  fireEvent.change(el, { target: { value: v } });
};

describe("поле выражения", () => {
  it("«@» открывает список, выбор вставляет имя, в запись уходит идентификатор", () => {
    const got = [];
    render(<Host onCommit={(x) => got.push(x)} />);
    const el = screen.getByLabelText("сколько ресурса");
    type(el, ">@");
    const list = screen.getByRole("listbox", { name: "ресурсы для выражения" });
    expect([...list.querySelectorAll("[role=option]")].map((o) => o.textContent))
      .toEqual(["@Заявки", "@Договоры", "@Заявки в работе"]);
    // Набранное после «@» фильтрует.
    type(el, ">@Дог");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["@Договоры"]);
    fireEvent.mouseDown(screen.getByRole("option"));
    expect(el.value).toBe(">@Договоры");
    expect(screen.queryByRole("listbox")).toBeNull();
    type(el, ">@Договоры*2");
    fireEvent.blur(el);
    expect(got).toEqual([">@{t2}*2"]);
  });

  it("стрелки и Enter выбирают из списка; Enter без списка — записывает", () => {
    const got = [];
    render(<Host onCommit={(x) => got.push(x)} />);
    const el = screen.getByLabelText("сколько ресурса");
    type(el, "=@За");
    fireEvent.keyDown(el, { key: "ArrowDown" });
    fireEvent.keyDown(el, { key: "Enter" });
    expect(el.value).toBe("=@Заявки в работе");
    fireEvent.keyDown(el, { key: "Enter" });
    expect(got).toEqual(["=@{t3}"]);
  });

  it("записанная ссылка показывается именем; ошибка разбора — словами", () => {
    render(<Host value="<@{t1}+" />);
    const el = screen.getByLabelText("сколько ресурса");
    expect(el.value).toBe("<@Заявки+");
    expect(screen.getByText(/ожидалось число или @ресурс/)).toBeInTheDocument();
    type(el, "<@Заявки+1");
    expect(screen.queryByText(/ожидалось/)).toBeNull();
  });
});

/* ─── знаки кнопками ───

   Набрать «*» или «>» на телефонной клавиатуре — это два переключения
   раскладки. Ряд знаков под полем снимает их: знак встаёт в место
   курсора, а фокус из поля не уходит — иначе ряд исчезал бы от
   собственного нажатия, и клик не доходил бы вовсе. */
describe("ряд знаков", () => {
  const keysOf = () => [...document.querySelectorAll("[aria-label^='знак ']")]
    .map((b) => b.getAttribute("aria-label").replace("знак ", ""));

  it("появляется у поля в фокусе и содержит сравнение и четыре действия", () => {
    render(<Host />);
    const el = screen.getByLabelText("сколько ресурса");
    expect(keysOf()).toEqual([]);
    fireEvent.focus(el);
    expect(keysOf()).toEqual([">", "<", "=", "!", "+", "-", "*", "/", "(", ")", "@"]);
  });

  it("знак встаёт в место курсора, а не в конец", () => {
    const got = [];
    render(<Host value=">10" onCommit={(x) => got.push(x)} />);
    const el = screen.getByLabelText("сколько ресурса");
    fireEvent.focus(el);
    el.setSelectionRange(3, 3);
    fireEvent.mouseDown(screen.getByLabelText("знак *"));
    expect(el.value).toBe(">10*");
    el.setSelectionRange(1, 1);
    fireEvent.mouseDown(screen.getByLabelText("знак ("));
    expect(el.value).toBe(">(10*");
  });

  it("«@» открывает список ресурсов, а не просто ставит знак", () => {
    render(<Host />);
    const el = screen.getByLabelText("сколько ресурса");
    fireEvent.focus(el);
    fireEvent.mouseDown(screen.getByLabelText("знак @"));
    expect(screen.getByRole("listbox", { name: "ресурсы для выражения" })).toBeTruthy();
  });
});
