import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { Workers } from "../components/AssetPanel.jsx";

/* Должности заводятся в блоке воркеров: там, где виден человек и то, кем
   он числится. Встроенные роли не удаляются; без обработчиков (не
   владелец, одиночный режим) блока нет вовсе. */

const PEOPLE = [{ id: "2", name: "Иван", roleId: "executor" }, { id: "3", name: "Пётр" }];
const ROLES = [
  { id: "executor", name: "исполнитель", builtin: true },
  { id: "r1", name: "дизайнер" },
];
const mount = (over = {}) => render(<Workers workers={{ crew: ["2", "3"] }} people={PEOPLE}
  nameOf={(id) => PEOPLE.find((p) => p.id === id)?.name || id} tasks={[]} funcs={[]}
  roleOf={(id) => ROLES.find((r) => r.id === PEOPLE.find((p) => p.id === id)?.roleId)?.name}
  onOrder={() => {}} onOpenPerson={() => {}} roles={ROLES} {...over} />);

describe("должности в блоке воркеров", () => {
  it("владелец добавляет должность и назначает её воркеру", async () => {
    const onAddRole = vi.fn(async () => {});
    const onSetRole = vi.fn(async () => {});
    mount({ onAddRole, onSetRole, onDropRole: async () => {} });
    expect(screen.getByText("должности")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("новая должность"), { target: { value: "тестировщик" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(onAddRole).toHaveBeenCalledWith("тестировщик"));
    // Поле очищено: следующая должность — с чистого листа.
    await waitFor(() => expect(screen.getByLabelText("новая должность").value).toBe(""));
    fireEvent.change(screen.getByLabelText("должность: Пётр"), { target: { value: "r1" } });
    expect(onSetRole).toHaveBeenCalledWith("3", "r1");
    // У Ивана должность уже стоит — и она выбрана.
    expect(screen.getByLabelText("должность: Иван").value).toBe("executor");
  });

  it("встроенную должность убрать нельзя, свою — можно", () => {
    const onDropRole = vi.fn(async () => {});
    mount({ onAddRole: async () => {}, onDropRole, onSetRole: async () => {} });
    expect(screen.queryByLabelText("убрать должность: исполнитель")).toBeNull();
    fireEvent.click(screen.getByLabelText("убрать должность: дизайнер"));
    expect(onDropRole).toHaveBeenCalledWith("r1");
  });

  it("без права править — ни блока, ни выбора должности", () => {
    mount();
    expect(screen.queryByText("должности")).toBeNull();
    expect(screen.queryByLabelText("должность: Иван")).toBeNull();
  });

  it("отказ сервера — словами под блоком", async () => {
    mount({ onAddRole: async () => { throw new Error("такая должность уже есть"); },
      onDropRole: async () => {}, onSetRole: async () => {} });
    fireEvent.change(screen.getByLabelText("новая должность"), { target: { value: "дизайнер" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    expect(await screen.findByText("такая должность уже есть")).toBeInTheDocument();
  });
});
