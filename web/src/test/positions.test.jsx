import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { Workers } from "../components/AssetPanel.jsx";

/* ДОЛЖНОСТИ АКТИВА — в блоке воркеров (владелец, 2026-09-18: «в вкладке
   «Воркер» не должны создаваться новые роли — только выбрать из
   существующих те, которые будут использованы в этом активе, и по ним
   ниже список подходящих сотрудников; одна должность — у одного актива»). */

const PEOPLE = [
  { id: "2", name: "Иван", roles: ["p1"] },
  { id: "3", name: "Пётр", roles: ["p2"] },
  { id: "4", name: "Оля", roles: [] },
];
const ROLES = [{ id: "p1", name: "дизайнер" }, { id: "p2", name: "аналитик" }];
const rolesOf = (id) => PEOPLE.find((x) => x.id === id)?.roles || [];
const roleName = (id) => ROLES.find((r) => r.id === String(id))?.name || "";
const ASSETS = [{ id: "a", name: "Студия", posts: ["p1"] }, { id: "b", name: "Лаборатория", posts: ["p2"] }];

const mount = (over = {}) => render(<Workers workers={{ crew: [] }} people={PEOPLE} entityId="a"
  nameOf={(id) => PEOPLE.find((p) => p.id === id)?.name || id} tasks={[]} funcs={[]}
  rolesOf={rolesOf} roleName={roleName} onOrder={() => {}} onOpenPerson={() => {}}
  positions={ROLES} assets={ASSETS} posts={["p1"]} {...over} />);

describe("должности актива в блоке воркеров", () => {
  it("новые роли не заводятся: только отметки существующих должностей", () => {
    mount({ onTogglePost: vi.fn(), onSetRoles: vi.fn() });
    expect(screen.queryByLabelText("новая роль")).toBeNull();
    expect(screen.queryByRole("button", { name: "Добавить" })).toBeNull();
    expect(screen.getByLabelText("должности актива")).toBeInTheDocument();
    expect(screen.getByLabelText("должность актива «дизайнер»")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("должность актива «аналитик»")).toHaveAttribute("aria-pressed", "false");
  });

  it("должность другого актива подписана его именем; отметка переводит её сюда", () => {
    const onTogglePost = vi.fn();
    mount({ onTogglePost });
    const b = screen.getByLabelText("должность актива «аналитик»");
    expect(b.textContent).toContain("Лаборатория");
    fireEvent.click(b);
    expect(onTogglePost).toHaveBeenCalledWith("p2");
  });

  it("ниже — только сотрудники с должностями актива; уже отмеченные остаются", () => {
    mount({ onTogglePost: vi.fn() });
    expect(screen.getByLabelText("воркер актива: Иван")).toBeInTheDocument();
    expect(screen.queryByLabelText("воркер актива: Пётр")).toBeNull();
    expect(screen.queryByLabelText("воркер актива: Оля")).toBeNull();
    mount({ onTogglePost: vi.fn(), workers: { crew: ["3"] } });
    expect(screen.getByLabelText("воркер актива: Пётр")).toBeInTheDocument();
  });

  it("без должностей актива — подсказка, что сперва отметить их", () => {
    mount({ onTogglePost: vi.fn(), posts: [] });
    expect(screen.getByText(/Сперва отметьте должности актива/)).toBeInTheDocument();
  });

  it("роли человека — отметками, несколько сразу", () => {
    const onSetRoles = vi.fn(async () => {});
    mount({ onTogglePost: vi.fn(), onSetRoles, workers: { crew: ["2"] } });
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByLabelText("роль «аналитик»: Иван"));
    expect(onSetRoles).toHaveBeenCalledWith("2", ["p1", "p2"]);
  });

  it("без права править — ни блока должностей, ни отметок ролей", () => {
    mount();
    expect(screen.queryByLabelText("должности актива")).toBeNull();
    expect(screen.queryByLabelText(/^роль «/)).toBeNull();
  });
});
