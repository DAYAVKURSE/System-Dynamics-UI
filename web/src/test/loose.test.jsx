import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import LooseCrew, { looseOf, rolesOfAsset } from "../components/LooseCrew.jsx";

/* УЧАСТНИКИ БЕЗ АКТИВА.

   Человек вступил, получил роль — и не попал ни в один актив: работы у
   него нет вовсе, а заметить это можно было, только обойдя все активы.
   Подложка появляется, когда такие есть, и исчезает, когда не осталось
   ни одного. Оттуда человека перетаскивают на актив — и актив берёт его,
   только если хоть одна его роль названа у какой-нибудь его функции. */

const PEOPLE = [
  { id: "2", name: "Иван", roles: ["designer"] },
  { id: "3", name: "Пётр", roles: ["editor"] },
  { id: "4", name: "Ольга", roles: ["designer"] },
  { id: "5", name: "Без роли", roles: [] },
];
const ENTITIES = [{ id: "a", name: "Бюро", crew: ["4"] }, { id: "b", name: "Склад", crew: [] }];
const FUNCS = [
  { id: "f1", e: "a", name: "Верстать", posts: { owners: ["designer"] } },
  { id: "f2", e: "b", name: "Принимать", posts: { reviewers: ["editor"] } },
];
const roleName = (id) => ({ designer: "дизайнер", editor: "редактор" })[id] || String(id);

const show = (over = {}) => render(<LooseCrew people={PEOPLE} entities={ENTITIES}
  funcs={FUNCS} roleName={roleName} {...over} />);

/* Перетаскивание — указателем, как и блоки схемы: HTML5 drag-and-drop на
   телефоне не работает вовсе. Куда отпустили, спрашивается у документа. */
const dragTo = (personLabel, entityId) => {
  const chip = screen.getByLabelText(personLabel);
  fireEvent.pointerDown(chip, { clientX: 10, clientY: 10 });
  // Сдвиг — это и есть перетаскивание; без него нажатие открывает страницу.
  fireEvent.pointerMove(window, { clientX: 200, clientY: 200 });
  const target = entityId
    ? { closest: () => ({ getAttribute: () => entityId }) }
    : { closest: () => null };
  document.elementFromPoint = () => target;
  fireEvent.pointerUp(window, { clientX: 300, clientY: 300 });
};

describe("подложка участников без актива", () => {
  it("кто не в активе — тот в списке; без роли — не участник", () => {
    expect(looseOf(PEOPLE, ENTITIES).map((p) => p.id)).toEqual(["2", "3"]);
    // Ольга уже в «Бюро», «Без роли» ещё не работник: роли у него нет.
    expect(rolesOfAsset(FUNCS, "a")).toEqual(["designer"]);
    expect(rolesOfAsset(FUNCS, "нет")).toEqual([]);
  });

  it("появляется, когда такие есть, и исчезает, когда все добавлены", () => {
    const { container, rerender } = show();
    expect(screen.getByLabelText("не добавленные участники: 2")).toBeInTheDocument();
    rerender(<LooseCrew people={PEOPLE} funcs={FUNCS} roleName={roleName}
      entities={[{ id: "a", name: "Бюро", crew: ["2", "3", "4"] }]} />);
    // Никого не осталось — и блока нет вовсе: пустой блок это мебель.
    expect(container.innerHTML).toBe("");
  });

  it("нажатие раскрывает облако: имена и роли", () => {
    show();
    expect(screen.queryByLabelText("не добавленный участник: Иван")).toBeNull();
    fireEvent.click(screen.getByLabelText("не добавленные участники: 2"));
    expect(screen.getByLabelText("не добавленный участник: Иван")).toBeInTheDocument();
    expect(screen.getByText("дизайнер")).toBeInTheDocument();
    expect(screen.getByText("редактор")).toBeInTheDocument();
  });

  it("перетащили на актив со своей ролью — человек добавлен", () => {
    const got = [];
    show({ onAdd: (pid, eid) => got.push([pid, eid]) });
    fireEvent.click(screen.getByLabelText("не добавленные участники: 2"));
    dragTo("не добавленный участник: Иван", "a");
    expect(got).toEqual([["2", "a"]]);
  });

  it("роль в активе не спрашивают — предупреждение, а не молчаливый отказ", () => {
    const got = [];
    show({ onAdd: (pid, eid) => got.push([pid, eid]) });
    fireEvent.click(screen.getByLabelText("не добавленные участники: 2"));
    dragTo("не добавленный участник: Иван", "b");
    expect(got).toEqual([]);
    expect(screen.getByText(/«Склад» спрашивает роли: редактор/)).toBeInTheDocument();
    expect(screen.getByText(/У Иван их нет — дизайнер/)).toBeInTheDocument();
  });

  it("отпустили мимо активов — ничего не случилось и никто не ругается", () => {
    const got = [];
    show({ onAdd: (pid, eid) => got.push([pid, eid]) });
    fireEvent.click(screen.getByLabelText("не добавленные участники: 2"));
    dragTo("не добавленный участник: Иван", "");
    expect(got).toEqual([]);
    expect(screen.queryByText(/спрашивает роли/)).toBeNull();
  });

  it("у актива нет функций с ролями — так и сказано", () => {
    const got = [];
    show({ funcs: [], onAdd: (pid, eid) => got.push([pid, eid]) });
    fireEvent.click(screen.getByLabelText("не добавленные участники: 2"));
    dragTo("не добавленный участник: Иван", "a");
    expect(got).toEqual([]);
    expect(screen.getByText(/ни одна функция не называет роль/)).toBeInTheDocument();
  });
});

describe("нажатие на участника без актива", () => {
  it("отпустили, не сдвинув, — открывается его страница; сдвинули — это перетаскивание", () => {
    /* Владелец (2026-09-13): «при нажатии на участника, у которого нет
       актива на схеме, должно появляться модальное окно с его страницей». */
    const opened = [];
    const added = [];
    show({ onOpen: (id) => opened.push(id), onAdd: (pid, eid) => added.push([pid, eid]) });
    fireEvent.click(screen.getByLabelText("не добавленные участники: 2"));
    const chip = screen.getByLabelText("не добавленный участник: Иван");
    fireEvent.pointerDown(chip, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 12, clientY: 11 });
    expect(opened).toEqual(["2"]);
    expect(added).toEqual([]);
    // А с движением — перенос на актив, окна нет.
    fireEvent.pointerDown(chip, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 200 });
    document.elementFromPoint = () => ({ closest: () => ({ getAttribute: () => "a" }) });
    fireEvent.pointerUp(window, { clientX: 300, clientY: 300 });
    expect(opened).toEqual(["2"]);
    expect(added).toEqual([["2", "a"]]);
  });
});
