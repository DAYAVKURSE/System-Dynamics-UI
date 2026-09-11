import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { Workers } from "../components/AssetPanel.jsx";

/* РОЛИ ЧЕЛОВЕКА — в блоке воркеров.

   Прежде их было два списка: роли (что человеку показывать) и должности
   (кем он числится). Вопрос один — кто он здесь, — и список теперь тоже
   один: те же роли открывают вкладки, по ним заключают договоры в «Людях
   и ролях» и назначают работу у функции.

   Ролей у человека НЕСКОЛЬКО: он и дизайнер, и проверяющий. Поэтому здесь
   отметки, а не выпадающий список — выпадающий заставлял выбрать одну и
   молча снимал остальные. */

const PEOPLE = [
  { id: "2", name: "Иван", roles: ["p1"] },
  { id: "3", name: "Пётр", roles: [] },
];
const ROLES = [{ id: "p1", name: "дизайнер" }, { id: "p2", name: "аналитик" }];
const rolesOf = (id) => PEOPLE.find((x) => x.id === id)?.roles || [];
const roleName = (id) => ROLES.find((r) => r.id === String(id))?.name || "";

const mount = (over = {}) => render(<Workers workers={{ crew: ["2", "3"] }} people={PEOPLE}
  nameOf={(id) => PEOPLE.find((p) => p.id === id)?.name || id} tasks={[]} funcs={[]}
  rolesOf={rolesOf} roleName={roleName}
  onOrder={() => {}} onOpenPerson={() => {}}
  positions={ROLES} {...over} />);

describe("роли в блоке воркеров", () => {
  it("владелец заводит роль и отмечает её человеку", async () => {
    const onAddPosition = vi.fn(async () => {});
    const onSetRoles = vi.fn(async () => {});
    mount({ onAddPosition, onSetRoles, onDropPosition: async () => {} });
    expect(screen.getByText("роли")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("новая роль"), { target: { value: "тестировщик" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(onAddPosition).toHaveBeenCalledWith("тестировщик"));
    await waitFor(() => expect(screen.getByLabelText("новая роль").value).toBe(""));
  });

  it("ролей несколько: отметки, а не выпадающий список", () => {
    const onSetRoles = vi.fn(async () => {});
    mount({ onAddPosition: async () => {}, onDropPosition: async () => {}, onSetRoles });
    // Выпадающего списка нет вовсе: он заставлял выбрать одну роль.
    expect(screen.queryByRole("combobox")).toBeNull();
    // У Ивана «дизайнер» уже отмечен, «аналитик» — нет.
    expect(screen.getByLabelText("роль «дизайнер»: Иван")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("роль «аналитик»: Иван")).toHaveAttribute("aria-pressed", "false");
    // Вторая роль ДОБАВЛЯЕТСЯ к первой, а не заменяет её.
    fireEvent.click(screen.getByLabelText("роль «аналитик»: Иван"));
    expect(onSetRoles).toHaveBeenCalledWith("2", ["p1", "p2"]);
    // Повторное нажатие снимает.
    fireEvent.click(screen.getByLabelText("роль «дизайнер»: Иван"));
    expect(onSetRoles).toHaveBeenCalledWith("2", []);
  });

  it("роль убирается из списка", () => {
    const onDropPosition = vi.fn(async () => {});
    mount({ onAddPosition: async () => {}, onDropPosition, onSetRoles: async () => {} });
    fireEvent.click(screen.getByLabelText("убрать роль: дизайнер"));
    expect(onDropPosition).toHaveBeenCalledWith("p1");
  });

  it("без права править — ни блока ролей, ни отметок", () => {
    mount();
    expect(screen.queryByText("роли")).toBeNull();
    expect(screen.queryByLabelText(/^роль «/)).toBeNull();
    // Но сами роли в строке человека видно всем.
    expect(screen.getByText("дизайнер")).toBeInTheDocument();
  });

  it("у кого ролей нет — так и сказано словом", () => {
    mount();
    expect(screen.getByText("без роли")).toBeInTheDocument();
  });

  it("в списке воркеров — только те, у кого есть роль", () => {
    /* Работу назначают РОЛЬЮ: строка с отметкой у человека без роли
       обещала бы то, чего не будет. Уже отмеченные остаются всегда —
       молча пропавший воркер выглядел бы поломкой. */
    mount({ workers: { crew: [] } });
    expect(screen.getByLabelText("воркер актива: Иван")).toBeInTheDocument();
    expect(screen.queryByLabelText("воркер актива: Пётр")).toBeNull();
    // А отмеченный раньше — на месте, даже если роль у него сняли.
    mount({ workers: { crew: ["3"] } });
    expect(screen.getByLabelText("воркер актива: Пётр")).toBeInTheDocument();
  });

  it("отказ сервера — словами под блоком", async () => {
    mount({ onAddPosition: async () => { throw new Error("такая роль уже есть"); },
      onDropPosition: async () => {}, onSetRoles: async () => {} });
    fireEvent.change(screen.getByLabelText("новая роль"), { target: { value: "дизайнер" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    expect(await screen.findByText("такая роль уже есть")).toBeInTheDocument();
  });
});
